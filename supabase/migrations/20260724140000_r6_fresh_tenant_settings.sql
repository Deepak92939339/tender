begin;

create or replace function public.provision_default_no_tax_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.tax_profiles (
    organization_id,
    code,
    label,
    jurisdiction_country_code,
    rate_bps,
    price_basis,
    treatment,
    active,
    created_by
  )
  values (
    new.id,
    'NO_TAX',
    'No tax',
    null,
    0,
    'exclusive',
    'exempt',
    true,
    new.created_by
  );
  return new;
end;
$$;

create trigger organizations_provision_default_no_tax_profile
after insert on public.organizations
for each row execute function public.provision_default_no_tax_profile();

-- Backfill only organizations that have never had the reserved profile.
-- An existing inactive NO_TAX row is historical operator intent and is not
-- silently reactivated or replaced.
insert into public.tax_profiles (
  organization_id,
  code,
  label,
  jurisdiction_country_code,
  rate_bps,
  price_basis,
  treatment,
  active,
  created_by
)
select
  organization.id,
  'NO_TAX',
  'No tax',
  null,
  0,
  'exclusive',
  'exempt',
  true,
  organization.created_by
from public.organizations organization
where not exists (
  select 1
  from public.tax_profiles profile
  where profile.organization_id = organization.id
    and profile.code = 'NO_TAX'
);

create or replace function public.normalize_organization_settings_payload(
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  name_value text;
  currency_value text;
  locale_value text;
  timezone_value text;
  threshold_value integer;
  seller_legal_name_value text;
  seller_address_line1_value text;
  seller_address_line2_value text;
  seller_city_value text;
  seller_region_value text;
  seller_postal_code_value text;
  seller_country_code_value text;
  seller_tax_identifier_value text;
  seller_contact_email_value text;
  seller_contact_phone_value text;
  normalized jsonb;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 8192
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'name',
        'default_currency_code',
        'default_locale',
        'timezone',
        'approval_threshold_bps',
        'seller_legal_name',
        'seller_address_line1',
        'seller_address_line2',
        'seller_city',
        'seller_region',
        'seller_postal_code',
        'seller_country_code',
        'seller_tax_identifier',
        'seller_contact_email',
        'seller_contact_phone'
      )
    )
    or jsonb_typeof(coalesce(p_payload -> 'name', 'null'::jsonb)) <> 'string'
    or jsonb_typeof(
      coalesce(p_payload -> 'default_currency_code', 'null'::jsonb)
    ) <> 'string'
    or jsonb_typeof(
      coalesce(p_payload -> 'default_locale', 'null'::jsonb)
    ) <> 'string'
    or jsonb_typeof(
      coalesce(p_payload -> 'approval_threshold_bps', 'null'::jsonb)
    ) <> 'number'
    or (
      p_payload ? 'timezone'
      and jsonb_typeof(p_payload -> 'timezone') <> 'string'
    )
    or exists (
      select 1
      from (
        values
          ('seller_legal_name'),
          ('seller_address_line1'),
          ('seller_address_line2'),
          ('seller_city'),
          ('seller_region'),
          ('seller_postal_code'),
          ('seller_country_code'),
          ('seller_tax_identifier'),
          ('seller_contact_email'),
          ('seller_contact_phone')
      ) seller_field(key)
      where p_payload ? seller_field.key
        and jsonb_typeof(p_payload -> seller_field.key) not in ('string', 'null')
    ) then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  name_value := btrim(coalesce(p_payload ->> 'name', ''));
  currency_value := upper(
    btrim(coalesce(p_payload ->> 'default_currency_code', ''))
  );
  locale_value := btrim(coalesce(p_payload ->> 'default_locale', ''));
  timezone_value := btrim(coalesce(p_payload ->> 'timezone', ''));
  seller_legal_name_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_legal_name', '')),
    ''
  );
  seller_address_line1_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_address_line1', '')),
    ''
  );
  seller_address_line2_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_address_line2', '')),
    ''
  );
  seller_city_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_city', '')),
    ''
  );
  seller_region_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_region', '')),
    ''
  );
  seller_postal_code_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_postal_code', '')),
    ''
  );
  seller_country_code_value := nullif(
    upper(btrim(coalesce(p_payload ->> 'seller_country_code', ''))),
    ''
  );
  seller_tax_identifier_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_tax_identifier', '')),
    ''
  );
  seller_contact_email_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_contact_email', '')),
    ''
  );
  seller_contact_phone_value := nullif(
    btrim(coalesce(p_payload ->> 'seller_contact_phone', '')),
    ''
  );

  if char_length(name_value) not between 1 and 120
    or name_value ~ '[[:cntrl:]]'
    or currency_value !~ '^[A-Z]{3}$'
    or char_length(locale_value) > 35
    or locale_value !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    or (
      p_payload ? 'timezone'
      and (
        char_length(timezone_value) not between 1 and 64
        or timezone_value !~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)*$'
        or timezone_value ~ '^(posix|right)/'
      )
    )
    or coalesce(p_payload ->> 'approval_threshold_bps', '')
      !~ '^[0-9]{1,5}$'
    or char_length(coalesce(seller_legal_name_value, '')) > 160
    or char_length(coalesce(seller_address_line1_value, '')) > 160
    or char_length(coalesce(seller_address_line2_value, '')) > 160
    or char_length(coalesce(seller_city_value, '')) > 100
    or char_length(coalesce(seller_region_value, '')) > 100
    or char_length(coalesce(seller_postal_code_value, '')) > 24
    or char_length(coalesce(seller_tax_identifier_value, '')) > 80
    or char_length(coalesce(seller_contact_email_value, '')) > 254
    or char_length(coalesce(seller_contact_phone_value, '')) > 40
    or concat_ws(
      '',
      seller_legal_name_value,
      seller_address_line1_value,
      seller_address_line2_value,
      seller_city_value,
      seller_region_value,
      seller_postal_code_value,
      seller_tax_identifier_value,
      seller_contact_email_value,
      seller_contact_phone_value
    ) ~ '[[:cntrl:]]'
    or (
      seller_country_code_value is not null
      and seller_country_code_value !~ '^[A-Z]{2}$'
    )
    or (
      seller_contact_email_value is not null
      and seller_contact_email_value
        !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  threshold_value := (p_payload ->> 'approval_threshold_bps')::integer;
  if threshold_value not between 0 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  normalized := jsonb_build_object(
    'name',
    name_value,
    'default_currency_code',
    currency_value,
    'default_locale',
    locale_value,
    'approval_threshold_bps',
    threshold_value
  );

  if p_payload ? 'timezone' then
    normalized := normalized || jsonb_build_object(
      'timezone',
      timezone_value
    );
  end if;
  if p_payload ? 'seller_legal_name' then
    normalized := normalized || jsonb_build_object(
      'seller_legal_name',
      seller_legal_name_value
    );
  end if;
  if p_payload ? 'seller_address_line1' then
    normalized := normalized || jsonb_build_object(
      'seller_address_line1',
      seller_address_line1_value
    );
  end if;
  if p_payload ? 'seller_address_line2' then
    normalized := normalized || jsonb_build_object(
      'seller_address_line2',
      seller_address_line2_value
    );
  end if;
  if p_payload ? 'seller_city' then
    normalized := normalized || jsonb_build_object(
      'seller_city',
      seller_city_value
    );
  end if;
  if p_payload ? 'seller_region' then
    normalized := normalized || jsonb_build_object(
      'seller_region',
      seller_region_value
    );
  end if;
  if p_payload ? 'seller_postal_code' then
    normalized := normalized || jsonb_build_object(
      'seller_postal_code',
      seller_postal_code_value
    );
  end if;
  if p_payload ? 'seller_country_code' then
    normalized := normalized || jsonb_build_object(
      'seller_country_code',
      seller_country_code_value
    );
  end if;
  if p_payload ? 'seller_tax_identifier' then
    normalized := normalized || jsonb_build_object(
      'seller_tax_identifier',
      seller_tax_identifier_value
    );
  end if;
  if p_payload ? 'seller_contact_email' then
    normalized := normalized || jsonb_build_object(
      'seller_contact_email',
      seller_contact_email_value
    );
  end if;
  if p_payload ? 'seller_contact_phone' then
    normalized := normalized || jsonb_build_object(
      'seller_contact_phone',
      seller_contact_phone_value
    );
  end if;

  return normalized;
end;
$$;

create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  organization_row public.organizations%rowtype;
  request jsonb;
  normalized jsonb;
  timezone_value text;
  replay jsonb;
  result jsonb;
  updated_version integer;
  updated_seller_profile_version integer;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into organization_row
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if organization_row.id is null
    or not public.has_org_capability(
      p_organization_id,
      'organization.manage'
    ) then
    raise exception using
      errcode = '42501',
      message = 'organization_settings_update_forbidden';
  end if;

  request := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'expected_version',
    p_expected_version,
    'payload',
    p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:'
        || p_organization_id::text
        || ':'
        || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization',
    p_organization_id,
    p_command_id,
    'organization.settings.update',
    'organization',
    p_organization_id,
    request
  );
  if replay is not null then
    return replay;
  end if;

  if organization_row.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'organization_version_stale';
  end if;

  normalized := public.normalize_organization_settings_payload(p_payload);
  timezone_value := coalesce(
    normalized ->> 'timezone',
    organization_row.timezone
  );
  if not public.is_valid_iana_timezone(timezone_value) then
    raise exception using
      errcode = '22023',
      message = 'organization_timezone_invalid';
  end if;

  update public.organizations organization
  set
    name = normalized ->> 'name',
    default_currency_code = normalized ->> 'default_currency_code',
    default_locale = normalized ->> 'default_locale',
    timezone = timezone_value,
    approval_threshold_bps =
      (normalized ->> 'approval_threshold_bps')::integer,
    seller_legal_name = case
      when normalized ? 'seller_legal_name'
        then normalized ->> 'seller_legal_name'
      else organization_row.seller_legal_name
    end,
    seller_address_line1 = case
      when normalized ? 'seller_address_line1'
        then normalized ->> 'seller_address_line1'
      else organization_row.seller_address_line1
    end,
    seller_address_line2 = case
      when normalized ? 'seller_address_line2'
        then normalized ->> 'seller_address_line2'
      else organization_row.seller_address_line2
    end,
    seller_city = case
      when normalized ? 'seller_city'
        then normalized ->> 'seller_city'
      else organization_row.seller_city
    end,
    seller_region = case
      when normalized ? 'seller_region'
        then normalized ->> 'seller_region'
      else organization_row.seller_region
    end,
    seller_postal_code = case
      when normalized ? 'seller_postal_code'
        then normalized ->> 'seller_postal_code'
      else organization_row.seller_postal_code
    end,
    seller_country_code = case
      when normalized ? 'seller_country_code'
        then normalized ->> 'seller_country_code'
      else organization_row.seller_country_code
    end,
    seller_tax_identifier = case
      when normalized ? 'seller_tax_identifier'
        then normalized ->> 'seller_tax_identifier'
      else organization_row.seller_tax_identifier
    end,
    seller_contact_email = case
      when normalized ? 'seller_contact_email'
        then normalized ->> 'seller_contact_email'
      else organization_row.seller_contact_email
    end,
    seller_contact_phone = case
      when normalized ? 'seller_contact_phone'
        then normalized ->> 'seller_contact_phone'
      else organization_row.seller_contact_phone
    end
  where organization.id = p_organization_id
  returning
    organization.version,
    organization.seller_profile_version
  into updated_version, updated_seller_profile_version;

  result := jsonb_build_object(
    'id',
    p_organization_id,
    'version',
    updated_version,
    'seller_profile_version',
    updated_seller_profile_version
  );
  perform public.record_organization_command(
    p_organization_id,
    p_command_id,
    'organization.settings.update',
    'organization',
    p_organization_id,
    caller,
    request,
    result
  );
  return result;
end;
$$;

create or replace function public.normalize_tax_profile_payload(
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  code_value text;
  label_value text;
  country_value text;
  rate_value integer;
  treatment_value text;
  active_value boolean;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 8192
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'code',
        'label',
        'jurisdiction_country_code',
        'rate_bps',
        'treatment',
        'active'
      )
    )
    or jsonb_typeof(coalesce(p_payload -> 'code', 'null'::jsonb)) <> 'string'
    or jsonb_typeof(coalesce(p_payload -> 'label', 'null'::jsonb)) <> 'string'
    or (
      p_payload ? 'jurisdiction_country_code'
      and jsonb_typeof(p_payload -> 'jurisdiction_country_code')
        not in ('string', 'null')
    )
    or jsonb_typeof(
      coalesce(p_payload -> 'rate_bps', 'null'::jsonb)
    ) <> 'number'
    or jsonb_typeof(
      coalesce(p_payload -> 'treatment', 'null'::jsonb)
    ) <> 'string'
    or jsonb_typeof(
      coalesce(p_payload -> 'active', 'null'::jsonb)
    ) <> 'boolean' then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;

  code_value := upper(btrim(coalesce(p_payload ->> 'code', '')));
  label_value := btrim(coalesce(p_payload ->> 'label', ''));
  country_value := nullif(
    upper(btrim(coalesce(p_payload ->> 'jurisdiction_country_code', ''))),
    ''
  );
  treatment_value := coalesce(p_payload ->> 'treatment', '');

  if code_value !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
    or char_length(label_value) not between 1 and 120
    or label_value ~ '[[:cntrl:]]'
    or (country_value is not null and country_value !~ '^[A-Z]{2}$')
    or coalesce(p_payload ->> 'rate_bps', '') !~ '^[0-9]{1,5}$'
    or treatment_value not in (
      'standard',
      'exempt',
      'zero_rated',
      'reverse_charge'
    ) then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;

  rate_value := (p_payload ->> 'rate_bps')::integer;
  active_value := (p_payload ->> 'active')::boolean;
  if rate_value not between 0 and 10000
    or (treatment_value <> 'standard' and rate_value <> 0) then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;

  return jsonb_build_object(
    'code',
    code_value,
    'label',
    label_value,
    'jurisdiction_country_code',
    country_value,
    'rate_bps',
    rate_value,
    'treatment',
    treatment_value,
    'active',
    active_value
  );
end;
$$;

create or replace function public.create_tax_profile(
  p_organization_id uuid,
  p_payload jsonb,
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
  normalized jsonb;
  replay jsonb;
  profile_id uuid;
  result jsonb;
begin
  if caller is null
    or not public.has_org_capability(
      p_organization_id,
      'organization.manage'
    ) then
    raise exception using
      errcode = '42501',
      message = 'tax_profile_create_forbidden';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;

  request := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'payload',
    p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:'
        || p_organization_id::text
        || ':'
        || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization',
    p_organization_id,
    p_command_id,
    'tax_profile.create',
    'tax_profile',
    null,
    request
  );
  if replay is not null then
    return replay;
  end if;

  normalized := public.normalize_tax_profile_payload(p_payload);
  insert into public.tax_profiles (
    organization_id,
    code,
    label,
    jurisdiction_country_code,
    rate_bps,
    price_basis,
    treatment,
    active,
    created_by
  )
  values (
    p_organization_id,
    normalized ->> 'code',
    normalized ->> 'label',
    normalized ->> 'jurisdiction_country_code',
    (normalized ->> 'rate_bps')::integer,
    'exclusive',
    (normalized ->> 'treatment')::public.tax_treatment,
    (normalized ->> 'active')::boolean,
    caller
  )
  returning id into profile_id;

  result := jsonb_build_object(
    'id',
    profile_id,
    'version',
    1,
    'active',
    (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    p_organization_id,
    p_command_id,
    'tax_profile.create',
    'tax_profile',
    profile_id,
    caller,
    request,
    result
  );
  return result;
end;
$$;

create or replace function public.update_tax_profile(
  p_tax_profile_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  profile_row public.tax_profiles%rowtype;
  request jsonb;
  normalized jsonb;
  replay jsonb;
  result jsonb;
  updated_version integer;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into profile_row
  from public.tax_profiles profile
  where profile.id = p_tax_profile_id
  for update;

  if profile_row.id is null
    or not public.has_org_capability(
      profile_row.organization_id,
      'organization.manage'
    ) then
    raise exception using
      errcode = '42501',
      message = 'tax_profile_update_forbidden';
  end if;

  request := jsonb_build_object(
    'tax_profile_id',
    p_tax_profile_id,
    'expected_version',
    p_expected_version,
    'payload',
    p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:'
        || profile_row.organization_id::text
        || ':'
        || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization',
    profile_row.organization_id,
    p_command_id,
    'tax_profile.update',
    'tax_profile',
    p_tax_profile_id,
    request
  );
  if replay is not null then
    return replay;
  end if;
  if profile_row.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'tax_profile_version_stale';
  end if;

  normalized := public.normalize_tax_profile_payload(p_payload);
  if profile_row.active
    and not (normalized ->> 'active')::boolean then
    raise exception using
      errcode = '22023',
      message = 'tax_profile_archive_required';
  end if;

  update public.tax_profiles profile
  set
    code = normalized ->> 'code',
    label = normalized ->> 'label',
    jurisdiction_country_code =
      normalized ->> 'jurisdiction_country_code',
    rate_bps = (normalized ->> 'rate_bps')::integer,
    treatment = (normalized ->> 'treatment')::public.tax_treatment,
    active = (normalized ->> 'active')::boolean
  where profile.id = p_tax_profile_id
  returning profile.version into updated_version;

  result := jsonb_build_object(
    'id',
    p_tax_profile_id,
    'version',
    updated_version,
    'active',
    (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    profile_row.organization_id,
    p_command_id,
    'tax_profile.update',
    'tax_profile',
    p_tax_profile_id,
    caller,
    request,
    result
  );
  return result;
end;
$$;

create or replace function public.guard_product_tax_profile_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or new.tax_profile_id is distinct from old.tax_profile_id
    or (new.active and not old.active) then
    perform 1
    from public.tax_profiles profile
    where profile.organization_id = new.organization_id
      and profile.id = new.tax_profile_id
      and profile.active
    for share;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'product_tax_profile_invalid';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_guard_active_tax_profile
before insert or update on public.products
for each row execute function public.guard_product_tax_profile_binding();

create or replace function public.archive_tax_profile(
  p_tax_profile_id uuid,
  p_expected_version integer,
  p_replacement_tax_profile_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  profile_row public.tax_profiles%rowtype;
  replacement_row public.tax_profiles%rowtype;
  request jsonb;
  replay jsonb;
  result jsonb;
  reassigned_product_count integer := 0;
  updated_version integer;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into profile_row
  from public.tax_profiles profile
  where profile.id = p_tax_profile_id;

  if profile_row.id is null
    or not public.has_org_capability(
      profile_row.organization_id,
      'organization.manage'
    ) then
    raise exception using
      errcode = '42501',
      message = 'tax_profile_archive_forbidden';
  end if;

  request := jsonb_build_object(
    'tax_profile_id',
    p_tax_profile_id,
    'expected_version',
    p_expected_version
  );
  if p_replacement_tax_profile_id is not null then
    request := request || jsonb_build_object(
      'replacement_tax_profile_id',
      p_replacement_tax_profile_id
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:'
        || profile_row.organization_id::text
        || ':'
        || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization',
    profile_row.organization_id,
    p_command_id,
    'tax_profile.archive',
    'tax_profile',
    p_tax_profile_id,
    request
  );
  if replay is not null then
    return replay;
  end if;

  -- Lock both profile rows in UUID order. The active-binding trigger takes a
  -- SHARE lock on a selected profile, so a concurrent product bind either
  -- completes before this lock and is reassigned below, or observes the
  -- archived profile and fails safely.
  perform profile.id
  from public.tax_profiles profile
  where profile.id = p_tax_profile_id
    or (
      p_replacement_tax_profile_id is not null
      and profile.id = p_replacement_tax_profile_id
    )
  order by profile.id
  for update;

  select *
  into profile_row
  from public.tax_profiles profile
  where profile.id = p_tax_profile_id;

  if profile_row.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'tax_profile_version_stale';
  end if;
  if not profile_row.active then
    raise exception using
      errcode = 'P0001',
      message = 'tax_profile_already_archived';
  end if;

  if p_replacement_tax_profile_id is not null then
    select *
    into replacement_row
    from public.tax_profiles profile
    where profile.id = p_replacement_tax_profile_id;

    if replacement_row.id is null
      or replacement_row.id = profile_row.id
      or replacement_row.organization_id <> profile_row.organization_id
      or not replacement_row.active then
      raise exception using
        errcode = '23503',
        message = 'tax_profile_replacement_invalid';
    end if;
  end if;

  if exists (
      select 1
      from public.products product
      where product.organization_id = profile_row.organization_id
        and product.tax_profile_id = profile_row.id
        and product.active
    )
    and p_replacement_tax_profile_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'tax_profile_replacement_required';
  end if;

  if p_replacement_tax_profile_id is not null then
    update public.products product
    set tax_profile_id = p_replacement_tax_profile_id
    where product.organization_id = profile_row.organization_id
      and product.tax_profile_id = profile_row.id
      and product.active;
    get diagnostics reassigned_product_count = row_count;
  end if;

  update public.tax_profiles profile
  set active = false
  where profile.id = p_tax_profile_id
  returning profile.version into updated_version;

  result := jsonb_build_object(
    'id',
    p_tax_profile_id,
    'version',
    updated_version,
    'active',
    false
  );
  if p_replacement_tax_profile_id is not null then
    result := result || jsonb_build_object(
      'replacement_tax_profile_id',
      p_replacement_tax_profile_id,
      'reassigned_product_count',
      reassigned_product_count
    );
  end if;

  perform public.record_organization_command(
    profile_row.organization_id,
    p_command_id,
    'tax_profile.archive',
    'tax_profile',
    p_tax_profile_id,
    caller,
    request,
    result
  );
  return result;
end;
$$;

create or replace function public.archive_tax_profile(
  p_tax_profile_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.archive_tax_profile(
    p_tax_profile_id,
    p_expected_version,
    null::uuid,
    p_command_id
  );
$$;

revoke insert, update, delete on
  public.products,
  public.tax_profiles
from authenticated;
revoke update on public.organizations from authenticated;

revoke all on function
  public.provision_default_no_tax_profile(),
  public.normalize_organization_settings_payload(jsonb),
  public.normalize_tax_profile_payload(jsonb),
  public.guard_product_tax_profile_binding()
from public, anon, authenticated;

revoke all on function
  public.update_organization_settings(uuid, integer, jsonb, uuid),
  public.create_tax_profile(uuid, jsonb, uuid),
  public.update_tax_profile(uuid, integer, jsonb, uuid),
  public.archive_tax_profile(uuid, integer, uuid),
  public.archive_tax_profile(uuid, integer, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.update_organization_settings(uuid, integer, jsonb, uuid),
  public.create_tax_profile(uuid, jsonb, uuid),
  public.update_tax_profile(uuid, integer, jsonb, uuid),
  public.archive_tax_profile(uuid, integer, uuid),
  public.archive_tax_profile(uuid, integer, uuid, uuid)
to authenticated;

commit;
