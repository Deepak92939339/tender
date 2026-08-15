begin;

do $$
begin
  if to_regprocedure('public.execute_quote_revision_command(text,uuid,uuid,integer,uuid,text)') is null then
    raise exception using errcode = '55000', message = 'issued_seller_snapshot_predecessor_missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.quotes'::regclass
      and attribute.attname = 'seller_legal_name_snapshot'
      and not attribute.attisdropped
  ) then
    raise exception using errcode = '55000', message = 'issued_seller_snapshot_predecessor_missing';
  end if;
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
  v_issued_seller jsonb;
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
    v_issued_seller := revision.snapshot -> 'seller';
    if jsonb_typeof(v_issued_seller) <> 'object'
      or not (v_issued_seller ?& array[
        'legal_name', 'address_line1', 'address_line2', 'city', 'region',
        'postal_code', 'country_code', 'tax_identifier', 'contact_email', 'contact_phone'
      ])
      or jsonb_typeof(v_issued_seller -> 'legal_name') <> 'string'
      or nullif(btrim(v_issued_seller ->> 'legal_name'), '') is null
      or jsonb_typeof(v_issued_seller -> 'address_line1') <> 'string'
      or nullif(btrim(v_issued_seller ->> 'address_line1'), '') is null
      or jsonb_typeof(v_issued_seller -> 'address_line2') <> 'string'
      or jsonb_typeof(v_issued_seller -> 'city') <> 'string'
      or nullif(btrim(v_issued_seller ->> 'city'), '') is null
      or jsonb_typeof(v_issued_seller -> 'region') <> 'string'
      or jsonb_typeof(v_issued_seller -> 'postal_code') <> 'string'
      or jsonb_typeof(v_issued_seller -> 'country_code') <> 'string'
      or nullif(btrim(v_issued_seller ->> 'country_code'), '') is null
      or jsonb_typeof(v_issued_seller -> 'tax_identifier') not in ('string', 'null')
      or jsonb_typeof(v_issued_seller -> 'contact_email') not in ('string', 'null')
      or jsonb_typeof(v_issued_seller -> 'contact_phone') not in ('string', 'null') then
      raise exception using errcode = '55000', message = 'sealed_seller_snapshot_invalid';
    end if;
    update public.quote_revisions set state = 'issued', issued_by = caller, issued_at = now(),
      verification_code = upper(encode(extensions.gen_random_bytes(16), 'hex')) where id = revision.id;
    update public.quotes set state = 'issued', version = version + 1, issued_by = caller, issued_at = now(),
      seller_legal_name_snapshot = v_issued_seller ->> 'legal_name',
      seller_address_line1_snapshot = v_issued_seller ->> 'address_line1',
      seller_address_line2_snapshot = nullif(v_issued_seller ->> 'address_line2', ''),
      seller_city_snapshot = v_issued_seller ->> 'city',
      seller_region_snapshot = nullif(v_issued_seller ->> 'region', ''),
      seller_postal_code_snapshot = nullif(v_issued_seller ->> 'postal_code', ''),
      seller_country_code_snapshot = v_issued_seller ->> 'country_code',
      seller_tax_identifier_snapshot = v_issued_seller ->> 'tax_identifier',
      seller_contact_email_snapshot = v_issued_seller ->> 'contact_email',
      seller_contact_phone_snapshot = v_issued_seller ->> 'contact_phone'
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

do $$
begin
  if exists (
    select 1
    from public.quotes quote
    join public.quote_revisions revision
      on revision.organization_id = quote.organization_id
      and revision.quote_id = quote.id
      and revision.id = quote.current_revision_id
    cross join lateral (select revision.snapshot -> 'seller' seller) sealed
    where quote.state = 'issued'
      and revision.state = 'issued'
      and (
        jsonb_typeof(sealed.seller) <> 'object'
        or not (sealed.seller ?& array[
          'legal_name', 'address_line1', 'address_line2', 'city', 'region',
          'postal_code', 'country_code', 'tax_identifier', 'contact_email', 'contact_phone'
        ])
        or jsonb_typeof(sealed.seller -> 'legal_name') <> 'string'
        or nullif(btrim(sealed.seller ->> 'legal_name'), '') is null
        or jsonb_typeof(sealed.seller -> 'address_line1') <> 'string'
        or nullif(btrim(sealed.seller ->> 'address_line1'), '') is null
        or jsonb_typeof(sealed.seller -> 'address_line2') <> 'string'
        or jsonb_typeof(sealed.seller -> 'city') <> 'string'
        or nullif(btrim(sealed.seller ->> 'city'), '') is null
        or jsonb_typeof(sealed.seller -> 'region') <> 'string'
        or jsonb_typeof(sealed.seller -> 'postal_code') <> 'string'
        or jsonb_typeof(sealed.seller -> 'country_code') <> 'string'
        or nullif(btrim(sealed.seller ->> 'country_code'), '') is null
        or jsonb_typeof(sealed.seller -> 'tax_identifier') not in ('string', 'null')
        or jsonb_typeof(sealed.seller -> 'contact_email') not in ('string', 'null')
        or jsonb_typeof(sealed.seller -> 'contact_phone') not in ('string', 'null')
      )
  ) then
    raise exception using errcode = '55000', message = 'sealed_seller_snapshot_invalid';
  end if;
end;
$$;

alter table public.quotes disable trigger quotes_seller_snapshots_immutable;

update public.quotes quote
set
  seller_legal_name_snapshot = sealed.seller ->> 'legal_name',
  seller_address_line1_snapshot = sealed.seller ->> 'address_line1',
  seller_address_line2_snapshot = nullif(sealed.seller ->> 'address_line2', ''),
  seller_city_snapshot = sealed.seller ->> 'city',
  seller_region_snapshot = nullif(sealed.seller ->> 'region', ''),
  seller_postal_code_snapshot = nullif(sealed.seller ->> 'postal_code', ''),
  seller_country_code_snapshot = sealed.seller ->> 'country_code',
  seller_tax_identifier_snapshot = sealed.seller ->> 'tax_identifier',
  seller_contact_email_snapshot = sealed.seller ->> 'contact_email',
  seller_contact_phone_snapshot = sealed.seller ->> 'contact_phone'
from public.quote_revisions revision
cross join lateral (select revision.snapshot -> 'seller' seller) sealed
where quote.state = 'issued'
  and revision.organization_id = quote.organization_id
  and revision.quote_id = quote.id
  and revision.id = quote.current_revision_id
  and revision.state = 'issued'
  and row(
    quote.seller_legal_name_snapshot,
    quote.seller_address_line1_snapshot,
    quote.seller_address_line2_snapshot,
    quote.seller_city_snapshot,
    quote.seller_region_snapshot,
    quote.seller_postal_code_snapshot,
    quote.seller_country_code_snapshot,
    quote.seller_tax_identifier_snapshot,
    quote.seller_contact_email_snapshot,
    quote.seller_contact_phone_snapshot
  ) is distinct from row(
    sealed.seller ->> 'legal_name',
    sealed.seller ->> 'address_line1',
    nullif(sealed.seller ->> 'address_line2', ''),
    sealed.seller ->> 'city',
    nullif(sealed.seller ->> 'region', ''),
    nullif(sealed.seller ->> 'postal_code', ''),
    sealed.seller ->> 'country_code',
    sealed.seller ->> 'tax_identifier',
    sealed.seller ->> 'contact_email',
    sealed.seller ->> 'contact_phone'
  );

alter table public.quotes enable trigger quotes_seller_snapshots_immutable;

commit;
