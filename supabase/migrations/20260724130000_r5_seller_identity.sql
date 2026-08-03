begin;

alter table public.organizations
  add column seller_legal_name text
    check (
      seller_legal_name is null
      or (
        char_length(btrim(seller_legal_name)) between 1 and 160
        and seller_legal_name !~ '[[:cntrl:]]'
      )
    ),
  add column seller_address_line1 text
    check (
      seller_address_line1 is null
      or (
        char_length(btrim(seller_address_line1)) between 1 and 160
        and seller_address_line1 !~ '[[:cntrl:]]'
      )
    ),
  add column seller_address_line2 text
    check (
      seller_address_line2 is null
      or (
        char_length(btrim(seller_address_line2)) between 1 and 160
        and seller_address_line2 !~ '[[:cntrl:]]'
      )
    ),
  add column seller_city text
    check (
      seller_city is null
      or (
        char_length(btrim(seller_city)) between 1 and 100
        and seller_city !~ '[[:cntrl:]]'
      )
    ),
  add column seller_region text
    check (
      seller_region is null
      or (
        char_length(btrim(seller_region)) between 1 and 100
        and seller_region !~ '[[:cntrl:]]'
      )
    ),
  add column seller_postal_code text
    check (
      seller_postal_code is null
      or (
        char_length(btrim(seller_postal_code)) between 1 and 24
        and seller_postal_code !~ '[[:cntrl:]]'
      )
    ),
  add column seller_country_code text
    check (
      seller_country_code is null
      or seller_country_code ~ '^[A-Z]{2}$'
    ),
  add column seller_tax_identifier text
    check (
      seller_tax_identifier is null
      or (
        char_length(btrim(seller_tax_identifier)) between 1 and 80
        and seller_tax_identifier !~ '[[:cntrl:]]'
      )
    ),
  add column seller_contact_email text
    check (
      seller_contact_email is null
      or (
        char_length(btrim(seller_contact_email)) between 1 and 254
        and seller_contact_email !~ '[[:cntrl:]]'
      )
    ),
  add column seller_contact_phone text
    check (
      seller_contact_phone is null
      or (
        char_length(btrim(seller_contact_phone)) between 1 and 40
        and seller_contact_phone !~ '[[:cntrl:]]'
      )
    ),
  add column seller_profile_version integer not null default 1
    check (seller_profile_version > 0);

-- Existing organizations receive only a truthful legal-name default.
-- Disable the general version trigger so migration backfill is not presented
-- as an operator settings edit.
alter table public.organizations
  disable trigger organizations_bump_version;
update public.organizations organization
set seller_legal_name = btrim(organization.name)
where organization.seller_legal_name is null;
alter table public.organizations
  enable trigger organizations_bump_version;

create or replace function public.maintain_organization_seller_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.seller_legal_name := coalesce(
      nullif(btrim(new.seller_legal_name), ''),
      btrim(new.name)
    );
    new.seller_profile_version := 1;
    return new;
  end if;

  if row(
    new.seller_legal_name,
    new.seller_address_line1,
    new.seller_address_line2,
    new.seller_city,
    new.seller_region,
    new.seller_postal_code,
    new.seller_country_code,
    new.seller_tax_identifier,
    new.seller_contact_email,
    new.seller_contact_phone
  ) is distinct from row(
    old.seller_legal_name,
    old.seller_address_line1,
    old.seller_address_line2,
    old.seller_city,
    old.seller_region,
    old.seller_postal_code,
    old.seller_country_code,
    old.seller_tax_identifier,
    old.seller_contact_email,
    old.seller_contact_phone
  ) then
    new.seller_profile_version := old.seller_profile_version + 1;
  else
    new.seller_profile_version := old.seller_profile_version;
  end if;
  return new;
end;
$$;

create trigger organizations_maintain_seller_profile
before insert or update on public.organizations
for each row execute function public.maintain_organization_seller_profile();

alter table public.quotes
  add column seller_legal_name_snapshot text
    check (
      seller_legal_name_snapshot is null
      or (
        char_length(btrim(seller_legal_name_snapshot)) between 1 and 160
        and seller_legal_name_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_address_line1_snapshot text
    check (
      seller_address_line1_snapshot is null
      or (
        char_length(btrim(seller_address_line1_snapshot)) between 1 and 160
        and seller_address_line1_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_address_line2_snapshot text
    check (
      seller_address_line2_snapshot is null
      or (
        char_length(btrim(seller_address_line2_snapshot)) between 1 and 160
        and seller_address_line2_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_city_snapshot text
    check (
      seller_city_snapshot is null
      or (
        char_length(btrim(seller_city_snapshot)) between 1 and 100
        and seller_city_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_region_snapshot text
    check (
      seller_region_snapshot is null
      or (
        char_length(btrim(seller_region_snapshot)) between 1 and 100
        and seller_region_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_postal_code_snapshot text
    check (
      seller_postal_code_snapshot is null
      or (
        char_length(btrim(seller_postal_code_snapshot)) between 1 and 24
        and seller_postal_code_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_country_code_snapshot text
    check (
      seller_country_code_snapshot is null
      or seller_country_code_snapshot ~ '^[A-Z]{2}$'
    ),
  add column seller_tax_identifier_snapshot text
    check (
      seller_tax_identifier_snapshot is null
      or (
        char_length(btrim(seller_tax_identifier_snapshot)) between 1 and 80
        and seller_tax_identifier_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_contact_email_snapshot text
    check (
      seller_contact_email_snapshot is null
      or (
        char_length(btrim(seller_contact_email_snapshot)) between 1 and 254
        and seller_contact_email_snapshot !~ '[[:cntrl:]]'
      )
    ),
  add column seller_contact_phone_snapshot text
    check (
      seller_contact_phone_snapshot is null
      or (
        char_length(btrim(seller_contact_phone_snapshot)) between 1 and 40
        and seller_contact_phone_snapshot !~ '[[:cntrl:]]'
      )
    );

create or replace function public.prevent_quote_seller_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.issued_at is null
    and new.issued_at is not null
    and (
      nullif(btrim(new.seller_legal_name_snapshot), '') is null
      or nullif(btrim(new.seller_address_line1_snapshot), '') is null
      or nullif(btrim(new.seller_city_snapshot), '') is null
      or nullif(btrim(new.seller_country_code_snapshot), '') is null
    ) then
    raise exception using
      errcode = '55000',
      message = 'SELLER_PROFILE_INCOMPLETE',
      detail = 'required_seller_snapshots_missing',
      hint = 'Issue through the guarded quotation command.';
  end if;

  if old.issued_at is not null
    and row(
      new.seller_legal_name_snapshot,
      new.seller_address_line1_snapshot,
      new.seller_address_line2_snapshot,
      new.seller_city_snapshot,
      new.seller_region_snapshot,
      new.seller_postal_code_snapshot,
      new.seller_country_code_snapshot,
      new.seller_tax_identifier_snapshot,
      new.seller_contact_email_snapshot,
      new.seller_contact_phone_snapshot
    ) is distinct from row(
      old.seller_legal_name_snapshot,
      old.seller_address_line1_snapshot,
      old.seller_address_line2_snapshot,
      old.seller_city_snapshot,
      old.seller_region_snapshot,
      old.seller_postal_code_snapshot,
      old.seller_country_code_snapshot,
      old.seller_tax_identifier_snapshot,
      old.seller_contact_email_snapshot,
      old.seller_contact_phone_snapshot
    ) then
    raise exception using
      errcode = '55000',
      message = 'quote_seller_snapshots_immutable';
  end if;
  return new;
end;
$$;

create trigger quotes_seller_snapshots_immutable
before update on public.quotes
for each row execute function public.prevent_quote_seller_snapshot_change();

create or replace function public.issue_quote_c0_impl(
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
  organization_row public.organizations%rowtype;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
  missing_fields text[] := '{}';
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into quote_row
  from public.quotes quote
  where quote.id = p_quote_id
  for update;

  if quote_row.id is null
    or not public.has_org_capability(
      quote_row.organization_id,
      'quote.issue'
    ) then
    raise exception using errcode = '42501', message = 'quote_issue_forbidden';
  end if;

  select receipt.result
  into existing_result
  from public.command_receipts receipt
  where receipt.organization_id = quote_row.organization_id
    and receipt.command_id = p_command_id;
  if existing_result is not null then
    return existing_result;
  end if;

  if quote_row.state <> 'approved' then
    raise exception using errcode = 'P0001', message = 'quote_not_approved';
  end if;
  if quote_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'quote_version_stale';
  end if;

  select *
  into organization_row
  from public.organizations organization
  where organization.id = quote_row.organization_id
  for share;
  if organization_row.id is null then
    raise exception using
      errcode = '23503',
      message = 'quote_organization_not_found';
  end if;

  if nullif(btrim(organization_row.seller_legal_name), '') is null then
    missing_fields := array_append(missing_fields, 'seller_legal_name');
  end if;
  if nullif(btrim(organization_row.seller_address_line1), '') is null then
    missing_fields := array_append(missing_fields, 'seller_address_line1');
  end if;
  if nullif(btrim(organization_row.seller_city), '') is null then
    missing_fields := array_append(missing_fields, 'seller_city');
  end if;
  if nullif(btrim(organization_row.seller_country_code), '') is null then
    missing_fields := array_append(missing_fields, 'seller_country_code');
  end if;
  if cardinality(missing_fields) > 0 then
    raise exception using
      errcode = '55000',
      message = 'SELLER_PROFILE_INCOMPLETE',
      detail = 'missing_fields=' || array_to_string(missing_fields, ','),
      hint = 'Complete the required seller fields in organization settings.';
  end if;

  perform public.recalculate_quote(quote_row.organization_id, quote_row.id);

  update public.quotes quote
  set
    state = 'issued',
    version = quote.version + 1,
    issued_by = caller,
    issued_at = now(),
    seller_legal_name_snapshot = organization_row.seller_legal_name,
    seller_address_line1_snapshot = organization_row.seller_address_line1,
    seller_address_line2_snapshot = organization_row.seller_address_line2,
    seller_city_snapshot = organization_row.seller_city,
    seller_region_snapshot = organization_row.seller_region,
    seller_postal_code_snapshot = organization_row.seller_postal_code,
    seller_country_code_snapshot = organization_row.seller_country_code,
    seller_tax_identifier_snapshot = organization_row.seller_tax_identifier,
    seller_contact_email_snapshot = organization_row.seller_contact_email,
    seller_contact_phone_snapshot = organization_row.seller_contact_phone
  where quote.organization_id = quote_row.organization_id
    and quote.id = quote_row.id;

  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (
    organization_id,
    quote_id,
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_role_snapshot,
    actor_source,
    message
  )
  values (
    quote_row.organization_id,
    quote_row.id,
    'quote.issued',
    caller,
    actor ->> 'name',
    actor ->> 'role',
    'signed_user',
    'Quotation issued. Delivery has not occurred.'
  );

  safe_result := jsonb_build_object(
    'id',
    quote_row.id,
    'number',
    quote_row.number,
    'state',
    'issued',
    'version',
    quote_row.version + 1
  );
  insert into public.command_receipts (
    organization_id,
    command_id,
    command_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    result
  )
  values (
    quote_row.organization_id,
    p_command_id,
    'quote.issue',
    'quote',
    quote_row.id,
    caller,
    safe_result
  );
  return safe_result;
end;
$$;

revoke all on function
  public.maintain_organization_seller_profile(),
  public.prevent_quote_seller_snapshot_change(),
  public.issue_quote_c0_impl(uuid, integer, uuid)
from public, anon, authenticated;

commit;
