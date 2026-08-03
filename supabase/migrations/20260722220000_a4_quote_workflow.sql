create or replace function public.recalculate_quote(p_organization_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_row public.quotes%rowtype;
  item_payload jsonb;
  charge_payload jsonb;
  result jsonb;
begin
  select * into quote_row from public.quotes quote
  where quote.organization_id = p_organization_id and quote.id = p_quote_id;
  if quote_row.id is null then raise exception using errcode = 'P0001', message = 'quote_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', item.position, 'product_id', item.product_id, 'sku_snapshot', item.sku_snapshot,
    'description_snapshot', item.description_snapshot, 'unit_code_snapshot', item.unit_code_snapshot,
    'quantity_precision_snapshot', item.quantity_precision_snapshot,
    'unit_price_minor_snapshot', item.unit_price_minor_snapshot, 'currency_code', item.currency_code,
    'quantity_scaled', item.quantity_scaled, 'quantity_scale', item.quantity_scale,
    'tax_code_snapshot', item.tax_code_snapshot, 'tax_bps_snapshot', item.tax_bps_snapshot,
    'tax_price_basis_snapshot', item.tax_price_basis_snapshot,
    'tax_treatment_snapshot', item.tax_treatment_snapshot
  ) order by item.position), '[]'::jsonb) into item_payload
  from public.quote_items item where item.organization_id = p_organization_id and item.quote_id = p_quote_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', charge.position, 'charge_type', charge.charge_type,
    'description_snapshot', charge.description_snapshot, 'amount_minor', charge.amount_minor,
    'currency_code', charge.currency_code, 'tax_code_snapshot', charge.tax_code_snapshot,
    'tax_bps_snapshot', charge.tax_bps_snapshot,
    'tax_price_basis_snapshot', charge.tax_price_basis_snapshot,
    'tax_treatment_snapshot', charge.tax_treatment_snapshot,
    'discount_applies', charge.discount_applies
  ) order by charge.position), '[]'::jsonb) into charge_payload
  from public.quote_charges charge where charge.organization_id = p_organization_id and charge.quote_id = p_quote_id;
  result := public.calculate_quote_payload(jsonb_build_object(
    'currency_code', quote_row.currency_code,
    'discount_bps', quote_row.discount_bps,
    'items', item_payload,
    'charges', charge_payload
  ));
  update public.quotes quote set
    subtotal_minor = (result->>'subtotal_minor')::bigint,
    discount_minor = (result->>'discount_minor')::bigint,
    item_tax_minor = (result->>'item_tax_minor')::bigint,
    charge_net_minor = (result->>'charge_net_minor')::bigint,
    charge_tax_minor = (result->>'charge_tax_minor')::bigint,
    total_minor = (result->>'total_minor')::bigint
  where quote.organization_id = p_organization_id and quote.id = p_quote_id;
  return result;
end;
$$;

create or replace function public.submit_quote(p_quote_id uuid, p_expected_version integer, p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  threshold_bps integer;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
  next_state public.quote_state;
begin
  if caller is null or p_command_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  select * into quote_row from public.quotes quote where quote.id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.submit') then raise exception using errcode = '42501', message = 'quote_submit_forbidden'; end if;
  select receipt.result into existing_result from public.command_receipts receipt where receipt.organization_id = quote_row.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if quote_row.state <> 'draft' then raise exception using errcode = 'P0001', message = 'quote_not_draft'; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = 'P0001', message = 'quote_version_stale'; end if;
  if not exists (select 1 from public.quote_items item where item.organization_id = quote_row.organization_id and item.quote_id = quote_row.id) then raise exception using errcode = 'P0001', message = 'quote_requires_item'; end if;
  if quote_row.valid_until < quote_row.issue_date then raise exception using errcode = '22023', message = 'quote_dates_invalid'; end if;
  perform public.recalculate_quote(quote_row.organization_id, quote_row.id);
  select organization.approval_threshold_bps into threshold_bps from public.organizations organization where organization.id = quote_row.organization_id;
  next_state := case when quote_row.discount_bps <= threshold_bps then 'approved'::public.quote_state else 'waiting'::public.quote_state end;
  update public.quotes quote set
    state = next_state,
    version = quote.version + 1,
    submitted_by = caller,
    submitted_at = now(),
    approved_by = null,
    approved_at = case when next_state = 'approved' then now() else null end
  where quote.organization_id = quote_row.organization_id and quote.id = quote_row.id;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot, actor_role_snapshot, actor_source, message)
  values (quote_row.organization_id, quote_row.id, 'quote.submitted', caller, actor->>'name', actor->>'role', 'signed_user', 'Quotation submitted for decision.');
  if next_state = 'approved' then
    insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot, actor_role_snapshot, actor_source, message, safe_metadata)
    values (quote_row.organization_id, quote_row.id, 'quote.approved', null, 'Approval rule', 'Organization policy', 'automatic_rule', 'Quotation approved by the organization threshold rule.', jsonb_build_object('threshold_bps', threshold_bps));
  end if;
  safe_result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', next_state, 'version', quote_row.version + 1);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, p_command_id, 'quote.submit', 'quote', quote_row.id, caller, safe_result);
  return safe_result;
end;
$$;

create or replace function public.approve_quote(p_quote_id uuid, p_expected_version integer, p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
begin
  if caller is null or p_command_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  select * into quote_row from public.quotes quote where quote.id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.approve') then raise exception using errcode = '42501', message = 'quote_approve_forbidden'; end if;
  select receipt.result into existing_result from public.command_receipts receipt where receipt.organization_id = quote_row.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if quote_row.state <> 'waiting' then raise exception using errcode = 'P0001', message = 'quote_not_waiting'; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = 'P0001', message = 'quote_version_stale'; end if;
  perform public.recalculate_quote(quote_row.organization_id, quote_row.id);
  update public.quotes quote set state = 'approved', version = quote.version + 1, approved_by = caller, approved_at = now()
  where quote.organization_id = quote_row.organization_id and quote.id = quote_row.id;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot, actor_role_snapshot, actor_source, message)
  values (quote_row.organization_id, quote_row.id, 'quote.approved', caller, actor->>'name', actor->>'role', 'signed_user', 'Quotation approved.');
  safe_result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', 'approved', 'version', quote_row.version + 1);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, p_command_id, 'quote.approve', 'quote', quote_row.id, caller, safe_result);
  return safe_result;
end;
$$;

create or replace function public.reject_quote(p_quote_id uuid, p_expected_version integer, p_command_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
  reason text := btrim(p_reason);
begin
  if caller is null or p_command_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if char_length(reason) not between 3 and 1000 then raise exception using errcode = '22023', message = 'rejection_reason_invalid'; end if;
  select * into quote_row from public.quotes quote where quote.id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.reject') then raise exception using errcode = '42501', message = 'quote_reject_forbidden'; end if;
  select receipt.result into existing_result from public.command_receipts receipt where receipt.organization_id = quote_row.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if quote_row.state <> 'waiting' then raise exception using errcode = 'P0001', message = 'quote_not_waiting'; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = 'P0001', message = 'quote_version_stale'; end if;
  update public.quotes quote set state = 'rejected', version = quote.version + 1, rejected_by = caller, rejected_at = now(), rejected_reason = reason
  where quote.organization_id = quote_row.organization_id and quote.id = quote_row.id;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot, actor_role_snapshot, actor_source, message, safe_metadata)
  values (quote_row.organization_id, quote_row.id, 'quote.rejected', caller, actor->>'name', actor->>'role', 'signed_user', 'Quotation rejected.', jsonb_build_object('reason', reason));
  safe_result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', 'rejected', 'version', quote_row.version + 1);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, p_command_id, 'quote.reject', 'quote', quote_row.id, caller, safe_result);
  return safe_result;
end;
$$;

create or replace function public.issue_quote(p_quote_id uuid, p_expected_version integer, p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
begin
  if caller is null or p_command_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  select * into quote_row from public.quotes quote where quote.id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.issue') then raise exception using errcode = '42501', message = 'quote_issue_forbidden'; end if;
  select receipt.result into existing_result from public.command_receipts receipt where receipt.organization_id = quote_row.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if quote_row.state <> 'approved' then raise exception using errcode = 'P0001', message = 'quote_not_approved'; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = 'P0001', message = 'quote_version_stale'; end if;
  perform public.recalculate_quote(quote_row.organization_id, quote_row.id);
  update public.quotes quote set state = 'issued', version = quote.version + 1, issued_by = caller, issued_at = now()
  where quote.organization_id = quote_row.organization_id and quote.id = quote_row.id;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot, actor_role_snapshot, actor_source, message)
  values (quote_row.organization_id, quote_row.id, 'quote.issued', caller, actor->>'name', actor->>'role', 'signed_user', 'Quotation issued. Delivery has not occurred.');
  safe_result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', 'issued', 'version', quote_row.version + 1);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, p_command_id, 'quote.issue', 'quote', quote_row.id, caller, safe_result);
  return safe_result;
end;
$$;

grant execute on function public.submit_quote(uuid, integer, uuid) to authenticated;
grant execute on function public.approve_quote(uuid, integer, uuid) to authenticated;
grant execute on function public.reject_quote(uuid, integer, uuid, text) to authenticated;
grant execute on function public.issue_quote(uuid, integer, uuid) to authenticated;
revoke execute on function public.recalculate_quote(uuid, uuid) from public, anon, authenticated;
