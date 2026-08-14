begin;

create or replace function public.quote_calculation_document_v1(p_quote_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format_version', 1,
    'currency_code', quote.currency_code,
    'tax_mode', quote.tax_mode,
    'discount_bps', quote.discount_bps,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'unit_code', item.unit_code_snapshot,
        'quantity_precision', item.quantity_precision_snapshot,
        'unit_price_minor', item.unit_price_minor_snapshot,
        'quantity_scaled', item.quantity_scaled,
        'quantity_scale', item.quantity_scale,
        'tax_bps', item.tax_bps_snapshot,
        'tax_treatment', item.tax_treatment_snapshot,
        'base_minor', item.base_minor,
        'discount_minor', item.discount_minor,
        'net_minor', item.net_minor,
        'tax_minor', item.tax_minor,
        'line_total_minor', item.line_total_minor
      ) order by item.position)
      from public.quote_items item
      where item.organization_id = quote.organization_id and item.quote_id = quote.id
    ), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', charge.position,
        'amount_minor', charge.amount_minor,
        'tax_bps', charge.tax_bps_snapshot,
        'tax_treatment', charge.tax_treatment_snapshot,
        'discount_applies', charge.discount_applies,
        'discount_minor', charge.discount_minor,
        'net_minor', charge.net_minor,
        'tax_minor', charge.tax_minor,
        'total_minor', charge.charge_total_minor
      ) order by charge.position)
      from public.quote_charges charge
      where charge.organization_id = quote.organization_id and charge.quote_id = quote.id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal_minor', quote.subtotal_minor,
      'discount_minor', quote.discount_minor,
      'item_tax_minor', quote.item_tax_minor,
      'charge_net_minor', quote.charge_net_minor,
      'charge_tax_minor', quote.charge_tax_minor,
      'tax_minor', quote.tax_minor,
      'charges_minor', quote.charges_minor,
      'total_minor', quote.total_minor
    )
  )
  from public.quotes quote
  where quote.id = p_quote_id;
$$;

create or replace function public.quote_snapshot_v1(
  p_revision_id uuid,
  p_calculation_fingerprint text,
  p_threshold_bps integer,
  p_requires_manual boolean,
  p_reason_codes text[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format_version', 1,
    'quote', jsonb_build_object(
      'id', quote.id,
      'number', quote.number,
      'revision_number', revision.revision_number,
      'parent_snapshot_hash', parent.snapshot_hash
    ),
    'seller', jsonb_build_object(
      'legal_name', organization.seller_legal_name,
      'address_line1', organization.seller_address_line1,
      'address_line2', coalesce(organization.seller_address_line2, ''),
      'city', organization.seller_city,
      'region', coalesce(organization.seller_region, ''),
      'postal_code', coalesce(organization.seller_postal_code, ''),
      'country_code', organization.seller_country_code,
      'tax_identifier', organization.seller_tax_identifier,
      'contact_email', organization.seller_contact_email,
      'contact_phone', organization.seller_contact_phone
    ),
    'buyer', jsonb_build_object(
      'customer_id', customer.id,
      'name', customer.name,
      'contact_name', customer.contact_name,
      'email', customer.email,
      'address_line1', customer.billing_address_line1,
      'address_line2', customer.billing_address_line2,
      'city', customer.billing_city,
      'region', customer.billing_region,
      'postal_code', customer.billing_postal_code,
      'country_code', customer.billing_country_code,
      'tax_identifier', customer.tax_identifier
    ),
    'commercial', jsonb_build_object(
      'currency_code', quote.currency_code,
      'locale', quote.locale,
      'tax_label', quote.tax_label,
      'tax_mode', quote.tax_mode,
      'customer_tax_treatment', quote.customer_tax_treatment,
      'discount_bps', quote.discount_bps,
      'issue_date', quote.issue_date::text,
      'valid_until', quote.valid_until::text,
      'notes', quote.notes
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'position', item.position,
        'product_id', item.product_id,
        'sku', item.sku_snapshot,
        'description', item.description_snapshot,
        'unit_code', item.unit_code_snapshot,
        'quantity_precision', item.quantity_precision_snapshot,
        'unit_price_minor', item.unit_price_minor_snapshot,
        'currency_code', item.currency_code,
        'quantity_scaled', item.quantity_scaled,
        'quantity_scale', item.quantity_scale,
        'tax_code', item.tax_code_snapshot,
        'tax_bps', item.tax_bps_snapshot,
        'tax_price_basis', item.tax_price_basis_snapshot,
        'tax_treatment', item.tax_treatment_snapshot,
        'base_minor', item.base_minor,
        'discount_minor', item.discount_minor,
        'net_minor', item.net_minor,
        'tax_minor', item.tax_minor,
        'line_total_minor', item.line_total_minor
      ) order by item.position)
      from public.quote_items item
      where item.organization_id = quote.organization_id and item.quote_id = quote.id
    ), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', charge.id,
        'position', charge.position,
        'charge_type', charge.charge_type,
        'description', charge.description_snapshot,
        'amount_minor', charge.amount_minor,
        'currency_code', charge.currency_code,
        'tax_code', charge.tax_code_snapshot,
        'tax_bps', charge.tax_bps_snapshot,
        'tax_price_basis', charge.tax_price_basis_snapshot,
        'tax_treatment', charge.tax_treatment_snapshot,
        'discount_applies', charge.discount_applies,
        'discount_minor', charge.discount_minor,
        'net_minor', charge.net_minor,
        'tax_minor', charge.tax_minor,
        'total_minor', charge.charge_total_minor
      ) order by charge.position)
      from public.quote_charges charge
      where charge.organization_id = quote.organization_id and charge.quote_id = quote.id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal_minor', quote.subtotal_minor,
      'discount_minor', quote.discount_minor,
      'item_tax_minor', quote.item_tax_minor,
      'charge_net_minor', quote.charge_net_minor,
      'charge_tax_minor', quote.charge_tax_minor,
      'tax_minor', quote.tax_minor,
      'charges_minor', quote.charges_minor,
      'total_minor', quote.total_minor
    ),
    'approval_policy', jsonb_build_object(
      'threshold_bps', p_threshold_bps,
      'requires_manual_approval', p_requires_manual,
      'reason_codes', to_jsonb(p_reason_codes)
    ),
    'calculation', jsonb_build_object(
      'format_version', 1,
      'fingerprint', p_calculation_fingerprint
    )
  )
  from public.quote_revisions revision
  join public.quotes quote on quote.organization_id = revision.organization_id and quote.id = revision.quote_id
  join public.organizations organization on organization.id = quote.organization_id
  join public.customers customer on customer.organization_id = quote.organization_id and customer.id = quote.customer_id
  left join public.quote_revisions parent on parent.organization_id = revision.organization_id
    and parent.quote_id = revision.quote_id and parent.id = revision.parent_revision_id
  where revision.id = p_revision_id;
$$;

create or replace function public.create_verified_quote_draft(
  p_organization_id uuid,
  p_customer_id uuid,
  p_currency_code text,
  p_locale text,
  p_tax_label text,
  p_tax_mode public.tax_price_basis,
  p_issue_date date,
  p_valid_until date,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  request jsonb;
  replay jsonb;
  created jsonb;
  quote_id uuid;
  revision_id uuid;
  result jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  if not public.has_org_capability(p_organization_id, 'quote.create') then
    raise exception using errcode = '42501', message = 'quote_create_forbidden';
  end if;
  request := jsonb_build_object('organization_id', p_organization_id, 'customer_id', p_customer_id,
    'currency_code', p_currency_code, 'locale', p_locale, 'tax_label', p_tax_label,
    'tax_mode', p_tax_mode, 'issue_date', p_issue_date, 'valid_until', p_valid_until);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || p_organization_id::text || ':' || p_command_id::text, 0));
  replay := public.command_receipt_replay('organization', p_organization_id, p_command_id,
    'quote.create_verified_draft', 'quote', null, request);
  if replay is not null then return replay; end if;
  created := public.create_quote_draft(p_organization_id, p_customer_id, p_currency_code, p_locale,
    p_tax_label, p_tax_mode, p_issue_date, p_valid_until, gen_random_uuid());
  quote_id := (created->>'id')::uuid;
  insert into public.quote_revisions (
    organization_id, quote_id, revision_number, record_kind, state,
    source_quote_version, created_by
  ) values (p_organization_id, quote_id, 1, 'verified_revision', 'draft', 1, caller)
  returning id into revision_id;
  update public.quotes set current_revision_id = revision_id, revision_counter = 1 where id = quote_id;
  result := created || jsonb_build_object('current_revision_id', revision_id, 'revision_number', 1);
  perform public.set_command_receipt_context('organization', p_organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (p_organization_id, gen_random_uuid(), 'quote.create_verified_draft', 'quote', quote_id, caller, result);
  return result;
end;
$$;

create or replace function public.start_verified_revision_from_legacy_quote(
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
  request jsonb := jsonb_build_object('quote_id', p_quote_id, 'expected_version', p_expected_version);
  replay jsonb;
  capture_id uuid;
  revision_id uuid;
  result jsonb;
  actor jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  select * into quote_row from public.quotes where id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.revise') then
    raise exception using errcode = '42501', message = 'quote_revise_forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || quote_row.organization_id::text || ':' || p_command_id::text, 0));
  replay := public.command_receipt_replay('organization', quote_row.organization_id, p_command_id,
    'quote.adopt_legacy', 'quote', p_quote_id, request);
  if replay is not null then return replay; end if;
  if quote_row.current_revision_id is not null or quote_row.revision_counter <> 0 then
    raise exception using errcode = '55000', message = 'quote_already_revisioned';
  end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = '40001', message = 'quote_version_stale'; end if;

  insert into public.quote_revisions (
    organization_id, quote_id, revision_number, record_kind, state, source_quote_version,
    created_by, legacy_snapshot, legacy_captured_at
  ) values (
    quote_row.organization_id, quote_row.id, 0, 'legacy_capture', quote_row.state,
    quote_row.version, caller,
    jsonb_build_object(
      'evidence_status', 'unverified_legacy_capture',
      'quote', to_jsonb(quote_row),
      'items', coalesce((select jsonb_agg(to_jsonb(item) order by item.position) from public.quote_items item where item.quote_id = quote_row.id), '[]'::jsonb),
      'charges', coalesce((select jsonb_agg(to_jsonb(charge) order by charge.position) from public.quote_charges charge where charge.quote_id = quote_row.id), '[]'::jsonb)
    ), now()
  ) returning id into capture_id;
  insert into public.quote_revisions (
    organization_id, quote_id, revision_number, record_kind, state, legacy_source_revision_id,
    source_quote_version, created_by
  ) values (quote_row.organization_id, quote_row.id, 1, 'verified_revision', 'draft', capture_id,
    quote_row.version + 1, caller)
  returning id into revision_id;
  update public.quotes set state = 'draft', version = version + 1,
    current_revision_id = revision_id, accepted_revision_id = null, revision_counter = 1,
    submitted_by = null, submitted_at = null, approved_by = null, approved_at = null,
    rejected_by = null, rejected_at = null, rejected_reason = null, issued_by = null, issued_at = null
  where id = quote_row.id;
  update public.quotes set
    seller_legal_name_snapshot = null, seller_address_line1_snapshot = null,
    seller_address_line2_snapshot = null, seller_city_snapshot = null,
    seller_region_snapshot = null, seller_postal_code_snapshot = null,
    seller_country_code_snapshot = null, seller_tax_identifier_snapshot = null,
    seller_contact_email_snapshot = null, seller_contact_phone_snapshot = null
  where id = quote_row.id;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id,
    actor_name_snapshot, actor_role_snapshot, actor_source, message, safe_metadata)
  values (quote_row.organization_id, quote_row.id, 'quote.verified_revision_started', caller,
    actor->>'name', actor->>'role', 'signed_user',
    'Legacy quotation captured without verification evidence; verified revision 1 started.',
    jsonb_build_object('legacy_capture_id', capture_id, 'revision_id', revision_id));
  result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', 'draft',
    'version', quote_row.version + 1, 'legacy_capture_id', capture_id,
    'current_revision_id', revision_id, 'revision_number', 1);
  perform public.set_command_receipt_context('organization', quote_row.organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, gen_random_uuid(), 'quote.adopt_legacy', 'quote', quote_row.id, caller, result);
  return result;
end;
$$;

create or replace function public.begin_quote_revision(
  p_quote_id uuid,
  p_base_revision_id uuid,
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
  base public.quote_revisions%rowtype;
  request jsonb := jsonb_build_object('quote_id', p_quote_id, 'base_revision_id', p_base_revision_id, 'expected_version', p_expected_version);
  replay jsonb;
  revision_id uuid;
  next_number integer;
  result jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  select * into quote_row from public.quotes where id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.revise') then
    raise exception using errcode = '42501', message = 'quote_revise_forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || quote_row.organization_id::text || ':' || p_command_id::text, 0));
  replay := public.command_receipt_replay('organization', quote_row.organization_id, p_command_id,
    'quote.begin_revision', 'quote', p_quote_id, request);
  if replay is not null then return replay; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = '40001', message = 'quote_version_stale'; end if;
  if quote_row.accepted_revision_id is not null then raise exception using errcode = '55000', message = 'quote_already_accepted'; end if;
  select * into base from public.quote_revisions where organization_id = quote_row.organization_id
    and quote_id = quote_row.id and id = p_base_revision_id for share;
  if base.id is null or quote_row.current_revision_id <> base.id or base.record_kind <> 'verified_revision'
    or not (
      base.state in ('issued', 'rejected')
      or public.quote_effective_state(
        base.state,
        base.valid_until,
        (select organization.timezone from public.organizations organization where organization.id = quote_row.organization_id),
        statement_timestamp()
      ) = 'expired'
    ) then
    raise exception using errcode = '55000', message = 'base_revision_not_revisable';
  end if;
  next_number := quote_row.revision_counter + 1;
  insert into public.quote_revisions (organization_id, quote_id, revision_number, record_kind,
    state, parent_revision_id, source_quote_version, created_by)
  values (quote_row.organization_id, quote_row.id, next_number, 'verified_revision', 'draft',
    base.id, quote_row.version + 1, caller) returning id into revision_id;

  delete from public.quote_items where organization_id = quote_row.organization_id and quote_id = quote_row.id;
  delete from public.quote_charges where organization_id = quote_row.organization_id and quote_id = quote_row.id;
  insert into public.quote_items (id, organization_id, quote_id, product_id, position, sku_snapshot,
    description_snapshot, unit_code_snapshot, quantity_precision_snapshot, unit_price_minor_snapshot,
    currency_code, quantity_scaled, quantity_scale, tax_code_snapshot, tax_bps_snapshot,
    tax_price_basis_snapshot, tax_treatment_snapshot, base_minor, discount_minor, net_minor, tax_minor, line_total_minor)
  select (entry->>'id')::uuid, quote_row.organization_id, quote_row.id, (entry->>'product_id')::uuid,
    (entry->>'position')::integer, entry->>'sku', entry->>'description', (entry->>'unit_code')::public.unit_code,
    (entry->>'quantity_precision')::integer, (entry->>'unit_price_minor')::bigint, entry->>'currency_code',
    (entry->>'quantity_scaled')::bigint, (entry->>'quantity_scale')::bigint, entry->>'tax_code',
    (entry->>'tax_bps')::integer, (entry->>'tax_price_basis')::public.tax_price_basis,
    (entry->>'tax_treatment')::public.tax_treatment, (entry->>'base_minor')::bigint,
    (entry->>'discount_minor')::bigint, (entry->>'net_minor')::bigint,
    (entry->>'tax_minor')::bigint, (entry->>'line_total_minor')::bigint
  from jsonb_array_elements(base.snapshot->'items') entry;
  insert into public.quote_charges (id, organization_id, quote_id, position, charge_type,
    description_snapshot, amount_minor, currency_code, tax_code_snapshot, tax_bps_snapshot,
    tax_price_basis_snapshot, tax_treatment_snapshot, discount_applies, discount_minor,
    net_minor, tax_minor, charge_total_minor)
  select (entry->>'id')::uuid, quote_row.organization_id, quote_row.id, (entry->>'position')::integer,
    (entry->>'charge_type')::public.quote_charge_type, entry->>'description', (entry->>'amount_minor')::bigint,
    entry->>'currency_code', entry->>'tax_code', (entry->>'tax_bps')::integer,
    (entry->>'tax_price_basis')::public.tax_price_basis, (entry->>'tax_treatment')::public.tax_treatment,
    (entry->>'discount_applies')::boolean, (entry->>'discount_minor')::bigint,
    (entry->>'net_minor')::bigint, (entry->>'tax_minor')::bigint, (entry->>'total_minor')::bigint
  from jsonb_array_elements(base.snapshot->'charges') entry;
  update public.quotes set
    customer_id = (base.snapshot#>>'{buyer,customer_id}')::uuid,
    currency_code = base.snapshot#>>'{commercial,currency_code}', locale = base.snapshot#>>'{commercial,locale}',
    tax_label = base.snapshot#>>'{commercial,tax_label}', tax_mode = (base.snapshot#>>'{commercial,tax_mode}')::public.tax_price_basis,
    customer_tax_treatment = (base.snapshot#>>'{commercial,customer_tax_treatment}')::public.tax_treatment,
    discount_bps = (base.snapshot#>>'{commercial,discount_bps}')::integer,
    issue_date = (base.snapshot#>>'{commercial,issue_date}')::date,
    valid_until = (base.snapshot#>>'{commercial,valid_until}')::date, notes = base.snapshot#>>'{commercial,notes}',
    subtotal_minor = (base.snapshot#>>'{totals,subtotal_minor}')::bigint,
    discount_minor = (base.snapshot#>>'{totals,discount_minor}')::bigint,
    item_tax_minor = (base.snapshot#>>'{totals,item_tax_minor}')::bigint,
    charge_net_minor = (base.snapshot#>>'{totals,charge_net_minor}')::bigint,
    charge_tax_minor = (base.snapshot#>>'{totals,charge_tax_minor}')::bigint,
    total_minor = (base.snapshot#>>'{totals,total_minor}')::bigint,
    state = 'draft', version = version + 1, current_revision_id = revision_id,
    revision_counter = next_number, submitted_by = null, submitted_at = null,
    approved_by = null, approved_at = null, rejected_by = null, rejected_at = null,
    rejected_reason = null, issued_by = null, issued_at = null
  where id = quote_row.id;
  update public.quotes set
    seller_legal_name_snapshot = null, seller_address_line1_snapshot = null,
    seller_address_line2_snapshot = null, seller_city_snapshot = null,
    seller_region_snapshot = null, seller_postal_code_snapshot = null,
    seller_country_code_snapshot = null, seller_tax_identifier_snapshot = null,
    seller_contact_email_snapshot = null, seller_contact_phone_snapshot = null
  where id = quote_row.id;
  update public.quote_share_links set disabled_at = now(), disabled_reason = 'superseded'
  where organization_id = quote_row.organization_id and quote_id = quote_row.id and disabled_at is null;
  result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', 'draft',
    'version', quote_row.version + 1, 'current_revision_id', revision_id, 'revision_number', next_number);
  perform public.set_command_receipt_context('organization', quote_row.organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, gen_random_uuid(), 'quote.begin_revision', 'quote', quote_row.id, caller, result);
  return result;
end;
$$;

create or replace function public.execute_quote_revision_command(
  p_action text,
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  quote_row public.quotes%rowtype;
  revision public.quote_revisions%rowtype;
  organization public.organizations%rowtype;
  customer public.customers%rowtype;
  capability text;
  request jsonb;
  replay jsonb;
  v_calculation_document jsonb;
  v_calculation_bytes bytea;
  v_calculation_fingerprint text;
  v_snapshot_document jsonb;
  v_snapshot_bytes bytea;
  reasons text[] := '{}'::text[];
  requires_manual boolean;
  next_state public.quote_state;
  result jsonb;
  actor jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  if p_action not in ('submit', 'approve', 'reject', 'issue') then raise exception using errcode = '22023', message = 'revision_action_invalid'; end if;
  select * into quote_row from public.quotes where id = p_quote_id for update;
  capability := 'quote.' || p_action;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, capability) then
    raise exception using errcode = '42501', message = 'quote_' || p_action || '_forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || quote_row.organization_id::text || ':' || p_command_id::text, 0));
  request := jsonb_build_object('action', p_action, 'quote_id', p_quote_id, 'revision_id', p_revision_id, 'expected_version', p_expected_version,
    'reason', case when p_action = 'reject' then btrim(coalesce(p_reason, '')) else null end);
  replay := public.command_receipt_replay('organization', quote_row.organization_id, p_command_id,
    'quote.revision_' || p_action, 'quote_revision', p_revision_id, request);
  if replay is not null then return replay; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = '40001', message = 'quote_version_stale'; end if;
  if quote_row.current_revision_id <> p_revision_id then raise exception using errcode = '40001', message = 'revision_stale'; end if;
  select * into revision from public.quote_revisions where organization_id = quote_row.organization_id
    and quote_id = quote_row.id and id = p_revision_id for update;
  if revision.id is null or revision.record_kind <> 'verified_revision' then raise exception using errcode = '55000', message = 'verified_revision_required'; end if;
  select * into organization from public.organizations where id = quote_row.organization_id for share;

  if p_action = 'submit' then
    if revision.state <> 'draft' or quote_row.state <> 'draft' then raise exception using errcode = '55000', message = 'revision_not_draft'; end if;
    if quote_row.valid_until < public.organization_local_date(quote_row.organization_id, statement_timestamp()) then
      raise exception using errcode = '22023', message = 'QUOTE_EXPIRED';
    end if;
    if not exists (select 1 from public.quote_items where organization_id = quote_row.organization_id and quote_id = quote_row.id) then
      raise exception using errcode = '55000', message = 'quote_requires_item';
    end if;
    if nullif(btrim(organization.seller_legal_name), '') is null
      or nullif(btrim(organization.seller_address_line1), '') is null
      or nullif(btrim(organization.seller_city), '') is null
      or nullif(btrim(organization.seller_country_code), '') is null then
      raise exception using errcode = '55000', message = 'SELLER_PROFILE_INCOMPLETE';
    end if;
    select * into customer from public.customers where organization_id = quote_row.organization_id and id = quote_row.customer_id for share;
    perform public.recalculate_quote(quote_row.organization_id, quote_row.id);
    select * into quote_row from public.quotes where id = p_quote_id;
    if revision.parent_revision_id is not null then reasons := array_append(reasons, 'successor_revision'); end if;
    if revision.legacy_source_revision_id is not null then reasons := array_append(reasons, 'legacy_adoption'); end if;
    if quote_row.discount_bps > organization.approval_threshold_bps then reasons := array_append(reasons, 'discount_above_threshold'); end if;
    select coalesce(array_agg(reason order by convert_to(reason, 'UTF8')), '{}') into reasons from unnest(reasons) reason;
    requires_manual := cardinality(reasons) > 0;
    next_state := case when requires_manual then 'waiting'::public.quote_state else 'approved'::public.quote_state end;
    v_calculation_document := public.quote_calculation_document_v1(quote_row.id);
    v_calculation_bytes := public.canonical_json_v1(v_calculation_document);
    v_calculation_fingerprint := public.sha256_hex(v_calculation_bytes);
    v_snapshot_document := public.quote_snapshot_v1(revision.id, v_calculation_fingerprint,
      organization.approval_threshold_bps, requires_manual, reasons);
    v_snapshot_bytes := public.canonical_json_v1(v_snapshot_document);
    update public.quote_revisions set state = next_state, snapshot_format_version = 1,
      calculation_format_version = 1, snapshot = v_snapshot_document, canonical_snapshot = v_snapshot_bytes,
      calculation_document = v_calculation_document, canonical_calculation = v_calculation_bytes,
      calculation_fingerprint = v_calculation_fingerprint, calculation_hash = v_calculation_fingerprint,
      snapshot_hash = public.sha256_hex(v_snapshot_bytes), currency_code = quote_row.currency_code,
      total_minor = quote_row.total_minor, valid_until = quote_row.valid_until,
      approval_threshold_bps = organization.approval_threshold_bps,
      requires_manual_approval = requires_manual, approval_reason_codes = reasons,
      submitted_by = caller, submitted_at = now(), approved_by = null,
      approved_at = case when next_state = 'approved' then now() else null end
    where id = revision.id;
    update public.quotes set state = next_state, version = version + 1, submitted_by = caller, submitted_at = now(),
      approved_by = null,
      approved_at = case when next_state = 'approved' then now() else null end,
      customer_name_snapshot = customer.name, contact_name_snapshot = customer.contact_name,
      email_snapshot = customer.email, billing_address_line1_snapshot = customer.billing_address_line1,
      billing_address_line2_snapshot = customer.billing_address_line2, billing_city_snapshot = customer.billing_city,
      billing_region_snapshot = customer.billing_region, billing_postal_code_snapshot = customer.billing_postal_code,
      billing_country_code_snapshot = customer.billing_country_code, tax_identifier_snapshot = customer.tax_identifier,
      approval_threshold_bps_snapshot = organization.approval_threshold_bps
    where id = quote_row.id;
    if next_state = 'approved' then
      insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id,
        actor_name_snapshot, actor_role_snapshot, actor_source, message, safe_metadata)
      values (quote_row.organization_id, quote_row.id, 'quote.revision_approved', null,
        'Approval rule', 'Organization policy', 'automatic_rule',
        'Verified revision approved by the organization threshold rule.',
        jsonb_build_object('revision_id', revision.id, 'threshold_bps', organization.approval_threshold_bps));
    end if;
  elsif p_action = 'approve' then
    if revision.state <> 'waiting' then raise exception using errcode = '55000', message = 'revision_not_waiting'; end if;
    if revision.valid_until < public.organization_local_date(quote_row.organization_id, statement_timestamp()) then raise exception using errcode = '22023', message = 'QUOTE_EXPIRED'; end if;
    update public.quote_revisions set state = 'approved', approved_by = caller, approved_at = now() where id = revision.id;
    update public.quotes set state = 'approved', version = version + 1, approved_by = caller, approved_at = now() where id = quote_row.id;
    next_state := 'approved';
  elsif p_action = 'reject' then
    if revision.state <> 'waiting' then raise exception using errcode = '55000', message = 'revision_not_waiting'; end if;
    if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then raise exception using errcode = '22023', message = 'rejection_reason_invalid'; end if;
    update public.quote_revisions set state = 'rejected', rejected_by = caller, rejected_at = now(), rejected_reason = btrim(p_reason) where id = revision.id;
    update public.quotes set state = 'rejected', version = version + 1, rejected_by = caller, rejected_at = now(), rejected_reason = btrim(p_reason) where id = quote_row.id;
    next_state := 'rejected';
  else
    if revision.state <> 'approved' then raise exception using errcode = '55000', message = 'revision_not_approved'; end if;
    if revision.valid_until < public.organization_local_date(quote_row.organization_id, statement_timestamp()) then raise exception using errcode = '22023', message = 'QUOTE_EXPIRED'; end if;
    update public.quote_revisions set state = 'issued', issued_by = caller, issued_at = now(),
      verification_code = upper(encode(extensions.gen_random_bytes(16), 'hex')) where id = revision.id;
    update public.quotes set state = 'issued', version = version + 1, issued_by = caller, issued_at = now(),
      seller_legal_name_snapshot = coalesce(seller_legal_name_snapshot, organization.seller_legal_name),
      seller_address_line1_snapshot = coalesce(seller_address_line1_snapshot, organization.seller_address_line1),
      seller_address_line2_snapshot = coalesce(seller_address_line2_snapshot, organization.seller_address_line2),
      seller_city_snapshot = coalesce(seller_city_snapshot, organization.seller_city),
      seller_region_snapshot = coalesce(seller_region_snapshot, organization.seller_region),
      seller_postal_code_snapshot = coalesce(seller_postal_code_snapshot, organization.seller_postal_code),
      seller_country_code_snapshot = coalesce(seller_country_code_snapshot, organization.seller_country_code),
      seller_tax_identifier_snapshot = coalesce(seller_tax_identifier_snapshot, organization.seller_tax_identifier),
      seller_contact_email_snapshot = coalesce(seller_contact_email_snapshot, organization.seller_contact_email),
      seller_contact_phone_snapshot = coalesce(seller_contact_phone_snapshot, organization.seller_contact_phone)
    where id = quote_row.id;
    next_state := 'issued';
  end if;
  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (organization_id, quote_id, event_type, actor_user_id,
    actor_name_snapshot, actor_role_snapshot, actor_source, message, safe_metadata)
  values (quote_row.organization_id, quote_row.id, 'quote.revision_' || p_action, caller,
    actor->>'name', actor->>'role', 'signed_user', 'Verified quotation revision ' || p_action || ' completed.',
    jsonb_build_object('revision_id', revision.id, 'revision_number', revision.revision_number));
  result := jsonb_build_object('id', quote_row.id, 'number', quote_row.number, 'state', next_state,
    'version', quote_row.version + 1, 'current_revision_id', revision.id, 'revision_number', revision.revision_number);
  perform public.set_command_receipt_context('organization', quote_row.organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, gen_random_uuid(), 'quote.revision_' || p_action, 'quote_revision', revision.id, caller, result);
  return result;
end;
$$;

create or replace function public.submit_quote_revision(uuid, uuid, integer, uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select public.execute_quote_revision_command('submit', $1, $2, $3, $4, null); $$;
create or replace function public.approve_quote_revision(uuid, uuid, integer, uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select public.execute_quote_revision_command('approve', $1, $2, $3, $4, null); $$;
create or replace function public.reject_quote_revision(uuid, uuid, integer, uuid, text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.execute_quote_revision_command('reject', $1, $2, $3, $4, $5); $$;
create or replace function public.issue_quote_revision(uuid, uuid, integer, uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select public.execute_quote_revision_command('issue', $1, $2, $3, $4, null); $$;

create or replace function public.create_quote_share_link(
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_recipient_email text,
  p_expires_at timestamptz,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid(); quote_row public.quotes%rowtype; revision public.quote_revisions%rowtype;
  request jsonb; replay jsonb; secret_bytes bytea; secret text; link_id uuid; selector uuid; result jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  select * into quote_row from public.quotes where id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.share') then raise exception using errcode = '42501', message = 'quote_share_forbidden'; end if;
  request := jsonb_build_object('quote_id', p_quote_id, 'revision_id', p_revision_id, 'expected_version', p_expected_version,
    'recipient_email', lower(btrim(p_recipient_email)), 'expires_at', p_expires_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || quote_row.organization_id::text || ':' || p_command_id::text, 0));
  replay := public.command_receipt_replay('organization', quote_row.organization_id, p_command_id, 'quote.create_share_link', 'quote_revision', p_revision_id, request);
  if replay is not null then return replay || jsonb_build_object('status', 'replayed_without_secret', 'secret', null); end if;
  if quote_row.version <> p_expected_version or quote_row.current_revision_id <> p_revision_id then raise exception using errcode = '40001', message = 'revision_stale'; end if;
  if quote_row.accepted_revision_id is not null then raise exception using errcode = '55000', message = 'quote_already_accepted'; end if;
  select * into revision from public.quote_revisions where id = p_revision_id and organization_id = quote_row.organization_id and quote_id = quote_row.id for update;
  if revision.state <> 'issued' then raise exception using errcode = '55000', message = 'revision_not_issued'; end if;
  if revision.valid_until < public.organization_local_date(quote_row.organization_id, statement_timestamp()) then raise exception using errcode = '22023', message = 'QUOTE_EXPIRED'; end if;
  if p_expires_at <= statement_timestamp() or p_expires_at > ((revision.valid_until + 1)::timestamp at time zone (select timezone from public.organizations where id = quote_row.organization_id)) then
    raise exception using errcode = '22023', message = 'share_expiry_invalid';
  end if;
  if char_length(btrim(p_recipient_email)) not between 3 and 254 then raise exception using errcode = '22023', message = 'recipient_email_invalid'; end if;
  secret_bytes := extensions.gen_random_bytes(32);
  secret := translate(rtrim(encode(secret_bytes, 'base64'), '='), '+/', '-_');
  insert into public.quote_share_links (organization_id, quote_id, revision_id, token_hash, recipient_email, expires_at, created_by)
  values (quote_row.organization_id, quote_row.id, revision.id, extensions.digest(convert_to(secret, 'UTF8'), 'sha256'), lower(btrim(p_recipient_email)), p_expires_at, caller)
  returning id, quote_share_links.selector into link_id, selector;
  result := jsonb_build_object('status', 'created', 'link_id', link_id, 'selector', selector, 'secret', secret,
    'revision_id', revision.id, 'expires_at', p_expires_at);
  perform public.set_command_receipt_context('organization', quote_row.organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, gen_random_uuid(), 'quote.create_share_link', 'quote_revision', revision.id, caller,
    result - 'secret' || jsonb_build_object('status', 'created'));
  return result;
end;
$$;

create or replace function public.revoke_quote_share_link(
  p_quote_id uuid,
  p_share_link_id uuid,
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
  link public.quote_share_links%rowtype;
  request jsonb := jsonb_build_object('quote_id', p_quote_id, 'share_link_id', p_share_link_id, 'expected_version', p_expected_version);
  replay jsonb;
  result jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  select * into quote_row from public.quotes where id = p_quote_id for update;
  if quote_row.id is null or not public.has_org_capability(quote_row.organization_id, 'quote.share') then
    raise exception using errcode = '42501', message = 'quote_share_forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:' || quote_row.organization_id::text || ':' || p_command_id::text, 0));
  replay := public.command_receipt_replay('organization', quote_row.organization_id, p_command_id,
    'quote.revoke_share_link', 'quote_share_link', p_share_link_id, request);
  if replay is not null then return replay; end if;
  if quote_row.version <> p_expected_version then raise exception using errcode = '40001', message = 'quote_version_stale'; end if;
  select * into link from public.quote_share_links where organization_id = quote_row.organization_id
    and quote_id = quote_row.id and id = p_share_link_id for update;
  if link.id is null then raise exception using errcode = '42501', message = 'quote_share_forbidden'; end if;
  if link.disabled_at is not null then raise exception using errcode = '55000', message = 'share_link_not_active'; end if;
  update public.quote_share_links set disabled_at = now(), disabled_reason = 'revoked' where id = link.id;
  result := jsonb_build_object('id', link.id, 'quote_id', quote_row.id, 'revision_id', link.revision_id,
    'disabled_reason', 'revoked', 'disabled_at', now());
  perform public.set_command_receipt_context('organization', quote_row.organization_id, p_command_id, request);
  insert into public.command_receipts (organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result)
  values (quote_row.organization_id, gen_random_uuid(), 'quote.revoke_share_link', 'quote_share_link', link.id, caller, result);
  return result;
end;
$$;

revoke all on function public.quote_calculation_document_v1(uuid), public.quote_snapshot_v1(uuid,text,integer,boolean,text[]),
  public.execute_quote_revision_command(text,uuid,uuid,integer,uuid,text)
from public, anon, authenticated;

revoke all on function public.create_verified_quote_draft(uuid,uuid,text,text,text,public.tax_price_basis,date,date,uuid),
  public.start_verified_revision_from_legacy_quote(uuid,integer,uuid),
  public.begin_quote_revision(uuid,uuid,integer,uuid),
  public.submit_quote_revision(uuid,uuid,integer,uuid),
  public.approve_quote_revision(uuid,uuid,integer,uuid),
  public.reject_quote_revision(uuid,uuid,integer,uuid,text),
  public.issue_quote_revision(uuid,uuid,integer,uuid),
  public.create_quote_share_link(uuid,uuid,integer,text,timestamptz,uuid),
  public.revoke_quote_share_link(uuid,uuid,integer,uuid)
from public, anon, authenticated;
grant execute on function public.create_verified_quote_draft(uuid,uuid,text,text,text,public.tax_price_basis,date,date,uuid),
  public.start_verified_revision_from_legacy_quote(uuid,integer,uuid),
  public.begin_quote_revision(uuid,uuid,integer,uuid),
  public.submit_quote_revision(uuid,uuid,integer,uuid),
  public.approve_quote_revision(uuid,uuid,integer,uuid),
  public.reject_quote_revision(uuid,uuid,integer,uuid,text),
  public.issue_quote_revision(uuid,uuid,integer,uuid),
  public.create_quote_share_link(uuid,uuid,integer,text,timestamptz,uuid),
  public.revoke_quote_share_link(uuid,uuid,integer,uuid)
to authenticated;

commit;
