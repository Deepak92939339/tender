begin;

alter table public.quotes
  add column customer_name_snapshot text
    check (customer_name_snapshot is null or char_length(btrim(customer_name_snapshot)) between 1 and 160),
  add column contact_name_snapshot text
    check (contact_name_snapshot is null or char_length(contact_name_snapshot) <= 120),
  add column email_snapshot text
    check (email_snapshot is null or char_length(email_snapshot) <= 254),
  add column billing_address_line1_snapshot text
    check (billing_address_line1_snapshot is null or char_length(billing_address_line1_snapshot) <= 160),
  add column billing_address_line2_snapshot text
    check (billing_address_line2_snapshot is null or char_length(billing_address_line2_snapshot) <= 160),
  add column billing_city_snapshot text
    check (billing_city_snapshot is null or char_length(billing_city_snapshot) <= 100),
  add column billing_region_snapshot text
    check (billing_region_snapshot is null or char_length(billing_region_snapshot) <= 100),
  add column billing_postal_code_snapshot text
    check (billing_postal_code_snapshot is null or char_length(billing_postal_code_snapshot) <= 24),
  add column billing_country_code_snapshot text
    check (billing_country_code_snapshot is null or billing_country_code_snapshot ~ '^[A-Z]{2}$'),
  add column tax_identifier_snapshot text
    check (tax_identifier_snapshot is null or char_length(tax_identifier_snapshot) <= 80),
  add column approval_threshold_bps_snapshot integer
    check (approval_threshold_bps_snapshot is null or approval_threshold_bps_snapshot between 0 and 10000);

-- Existing locally produced submitted rows are made structurally compatible.
-- New submissions snapshot atomically in submit_quote_c0_impl below.
update public.quotes quote
set
  customer_name_snapshot = customer.name,
  contact_name_snapshot = customer.contact_name,
  email_snapshot = customer.email,
  billing_address_line1_snapshot = customer.billing_address_line1,
  billing_address_line2_snapshot = customer.billing_address_line2,
  billing_city_snapshot = customer.billing_city,
  billing_region_snapshot = customer.billing_region,
  billing_postal_code_snapshot = customer.billing_postal_code,
  billing_country_code_snapshot = customer.billing_country_code,
  tax_identifier_snapshot = customer.tax_identifier,
  approval_threshold_bps_snapshot = organization.approval_threshold_bps
from public.customers customer, public.organizations organization
where quote.state <> 'draft'
  and customer.organization_id = quote.organization_id
  and customer.id = quote.customer_id
  and organization.id = quote.organization_id;

alter table public.quotes
  add constraint quotes_submitted_snapshots_check
  check (
    state = 'draft'
    or (
      customer_name_snapshot is not null
      and contact_name_snapshot is not null
      and email_snapshot is not null
      and billing_address_line1_snapshot is not null
      and billing_address_line2_snapshot is not null
      and billing_city_snapshot is not null
      and billing_region_snapshot is not null
      and billing_postal_code_snapshot is not null
      and billing_country_code_snapshot is not null
      and approval_threshold_bps_snapshot is not null
    )
  ) not valid;
alter table public.quotes validate constraint quotes_submitted_snapshots_check;

create or replace function public.prevent_quote_submission_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submitted_at is not null
    and row(
      new.customer_name_snapshot,
      new.contact_name_snapshot,
      new.email_snapshot,
      new.billing_address_line1_snapshot,
      new.billing_address_line2_snapshot,
      new.billing_city_snapshot,
      new.billing_region_snapshot,
      new.billing_postal_code_snapshot,
      new.billing_country_code_snapshot,
      new.tax_identifier_snapshot,
      new.approval_threshold_bps_snapshot
    ) is distinct from row(
      old.customer_name_snapshot,
      old.contact_name_snapshot,
      old.email_snapshot,
      old.billing_address_line1_snapshot,
      old.billing_address_line2_snapshot,
      old.billing_city_snapshot,
      old.billing_region_snapshot,
      old.billing_postal_code_snapshot,
      old.billing_country_code_snapshot,
      old.tax_identifier_snapshot,
      old.approval_threshold_bps_snapshot
    ) then
    raise exception using
      errcode = '55000',
      message = 'quote_submission_snapshots_immutable';
  end if;
  return new;
end;
$$;

create trigger quotes_submission_snapshots_immutable
before update on public.quotes
for each row execute function public.prevent_quote_submission_snapshot_change();

create or replace function public.submit_quote_c0_impl(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  customer_row public.customers%rowtype;
  threshold_bps integer;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
  next_state public.quote_state;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into quote_row
  from public.quotes quote
  where quote.id = p_quote_id
  for update;
  if quote_row.id is null
    or not public.has_org_capability(quote_row.organization_id, 'quote.submit') then
    raise exception using errcode = '42501', message = 'quote_submit_forbidden';
  end if;
  select receipt.result into existing_result
  from public.command_receipts receipt
  where receipt.organization_id = quote_row.organization_id
    and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if quote_row.state <> 'draft' then
    raise exception using errcode = 'P0001', message = 'quote_not_draft';
  end if;
  if quote_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'quote_version_stale';
  end if;
  if not exists (
    select 1
    from public.quote_items item
    where item.organization_id = quote_row.organization_id
      and item.quote_id = quote_row.id
  ) then
    raise exception using errcode = 'P0001', message = 'quote_requires_item';
  end if;
  if quote_row.valid_until < quote_row.issue_date then
    raise exception using errcode = '22023', message = 'quote_dates_invalid';
  end if;

  select * into customer_row
  from public.customers customer
  where customer.organization_id = quote_row.organization_id
    and customer.id = quote_row.customer_id
  for share;
  if customer_row.id is null then
    raise exception using errcode = '23503', message = 'quote_customer_not_in_organization';
  end if;
  select organization.approval_threshold_bps into threshold_bps
  from public.organizations organization
  where organization.id = quote_row.organization_id
  for share;
  if threshold_bps is null then
    raise exception using errcode = '23503', message = 'quote_organization_not_found';
  end if;

  perform public.recalculate_quote(quote_row.organization_id, quote_row.id);
  next_state := case
    when quote_row.discount_bps <= threshold_bps then 'approved'::public.quote_state
    else 'waiting'::public.quote_state
  end;

  update public.quotes quote
  set
    state = next_state,
    version = quote.version + 1,
    submitted_by = caller,
    submitted_at = now(),
    approved_by = null,
    approved_at = case when next_state = 'approved' then now() else null end,
    customer_name_snapshot = customer_row.name,
    contact_name_snapshot = customer_row.contact_name,
    email_snapshot = customer_row.email,
    billing_address_line1_snapshot = customer_row.billing_address_line1,
    billing_address_line2_snapshot = customer_row.billing_address_line2,
    billing_city_snapshot = customer_row.billing_city,
    billing_region_snapshot = customer_row.billing_region,
    billing_postal_code_snapshot = customer_row.billing_postal_code,
    billing_country_code_snapshot = customer_row.billing_country_code,
    tax_identifier_snapshot = customer_row.tax_identifier,
    approval_threshold_bps_snapshot = threshold_bps
  where quote.organization_id = quote_row.organization_id
    and quote.id = quote_row.id;

  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (
    organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
    actor_role_snapshot, actor_source, message
  )
  values (
    quote_row.organization_id, quote_row.id, 'quote.submitted', caller,
    actor ->> 'name', actor ->> 'role', 'signed_user',
    'Quotation submitted for decision.'
  );
  if next_state = 'approved' then
    insert into public.quote_activity (
      organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
      actor_role_snapshot, actor_source, message, safe_metadata
    )
    values (
      quote_row.organization_id, quote_row.id, 'quote.approved', null,
      'Approval rule', 'Organization policy', 'automatic_rule',
      'Quotation approved by the organization threshold rule.',
      jsonb_build_object('threshold_bps', threshold_bps)
    );
  end if;
  safe_result := jsonb_build_object(
    'id', quote_row.id,
    'number', quote_row.number,
    'state', next_state,
    'version', quote_row.version + 1
  );
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id,
    actor_user_id, result
  )
  values (
    quote_row.organization_id, p_command_id, 'quote.submit', 'quote',
    quote_row.id, caller, safe_result
  );
  return safe_result;
end;
$$;

revoke execute on function public.prevent_quote_submission_snapshot_change() from public, anon, authenticated;

commit;
