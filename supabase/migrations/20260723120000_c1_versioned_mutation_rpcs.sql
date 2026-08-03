begin;

alter table public.organizations
  add column version integer not null default 1 check (version > 0);

alter table public.tax_profiles
  add column version integer not null default 1 check (version > 0),
  add column created_by uuid references auth.users(id);

update public.tax_profiles profile
set created_by = organization.created_by
from public.organizations organization
where organization.id = profile.organization_id
  and profile.created_by is null;

alter table public.tax_profiles
  alter column created_by set not null;

alter table public.customers
  add column active boolean not null default true;

drop trigger organizations_set_updated_at on public.organizations;
create trigger organizations_bump_version
before update on public.organizations
for each row execute function public.bump_record_version();

drop trigger tax_profiles_set_updated_at on public.tax_profiles;
create trigger tax_profiles_bump_version
before update on public.tax_profiles
for each row execute function public.bump_record_version();

create index customers_org_active_name_idx
  on public.customers (organization_id, active, name);

create or replace function public.apply_command_receipt_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_scope_type text :=
    nullif(pg_catalog.current_setting('tender.command_scope_type', true), '');
  configured_scope_id text :=
    nullif(pg_catalog.current_setting('tender.command_scope_id', true), '');
  configured_command_id text :=
    nullif(pg_catalog.current_setting('tender.command_id', true), '');
  configured_request_hash text :=
    nullif(pg_catalog.current_setting('tender.command_request_hash', true), '');
begin
  if new.scope_type is null and configured_scope_type is not null then
    new.scope_type := configured_scope_type;
    new.scope_id := configured_scope_id::uuid;
    new.command_id := configured_command_id::uuid;
    new.request_hash := configured_request_hash;
  else
    new.scope_type := coalesce(
      new.scope_type,
      case when new.command_type = 'organization.create' then 'user' else 'organization' end
    );
    new.scope_id := coalesce(
      new.scope_id,
      case when new.scope_type = 'user' then new.actor_user_id else new.organization_id end
    );
    new.request_hash := coalesce(
      new.request_hash,
      public.command_request_hash(jsonb_build_object(
        'command_type', new.command_type,
        'aggregate_type', new.aggregate_type,
        'aggregate_id', new.aggregate_id,
        'result', new.result
      ))
    );
  end if;
  return new;
end;
$$;

create or replace function public.record_organization_command(
  p_organization_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_actor_user_id uuid,
  p_request jsonb,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id,
    actor_user_id, result, scope_type, scope_id, request_hash
  )
  values (
    p_organization_id, p_command_id, p_command_type, p_aggregate_type,
    p_aggregate_id, p_actor_user_id, p_result, 'organization',
    p_organization_id, public.command_request_hash(p_request)
  );
end;
$$;

create or replace function public.normalize_product_payload(
  p_organization_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sku_value text;
  description_value text;
  unit_value text;
  precision_value integer;
  price_value bigint;
  currency_value text;
  tax_profile_value uuid;
  active_value boolean;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 16384
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'sku', 'description', 'unit_code', 'quantity_precision',
        'unit_price_minor', 'currency_code', 'tax_profile_id', 'active'
      )
    ) then
    raise exception using errcode = '22023', message = 'product_payload_invalid';
  end if;

  sku_value := btrim(coalesce(p_payload ->> 'sku', ''));
  description_value := btrim(coalesce(p_payload ->> 'description', ''));
  unit_value := upper(btrim(coalesce(p_payload ->> 'unit_code', '')));
  currency_value := upper(btrim(coalesce(p_payload ->> 'currency_code', '')));

  if char_length(sku_value) not between 1 and 64
    or sku_value ~ '[[:cntrl:]]'
    or char_length(description_value) not between 1 and 500
    or description_value ~ '[[:cntrl:]]'
    or unit_value not in ('EA', 'M', 'KG', 'L', 'BOX')
    or coalesce(p_payload ->> 'quantity_precision', '') !~ '^[0-3]$'
    or coalesce(p_payload ->> 'unit_price_minor', '') !~ '^[0-9]{1,15}$'
    or currency_value !~ '^[A-Z]{3}$'
    or coalesce(p_payload ->> 'tax_profile_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or jsonb_typeof(coalesce(p_payload -> 'active', 'null'::jsonb)) <> 'boolean' then
    raise exception using errcode = '22023', message = 'product_payload_invalid';
  end if;

  precision_value := (p_payload ->> 'quantity_precision')::integer;
  price_value := (p_payload ->> 'unit_price_minor')::bigint;
  tax_profile_value := (p_payload ->> 'tax_profile_id')::uuid;
  active_value := (p_payload ->> 'active')::boolean;

  if price_value > 999999999999999
    or (unit_value in ('EA', 'BOX') and precision_value <> 0) then
    raise exception using errcode = '22023', message = 'product_payload_invalid';
  end if;
  if not exists (
      select 1
      from public.tax_profiles profile
      where profile.organization_id = p_organization_id
        and profile.id = tax_profile_value
        and profile.active
    ) then
    raise exception using errcode = '23503', message = 'product_tax_profile_invalid';
  end if;

  return jsonb_build_object(
    'sku', sku_value,
    'description', description_value,
    'unit_code', unit_value,
    'quantity_precision', precision_value,
    'unit_price_minor', price_value,
    'currency_code', currency_value,
    'tax_profile_id', tax_profile_value,
    'active', active_value
  );
end;
$$;

create or replace function public.normalize_customer_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  name_value text;
  contact_value text;
  email_value text;
  phone_value text;
  address1_value text;
  address2_value text;
  city_value text;
  region_value text;
  postal_value text;
  country_value text;
  locale_value text;
  currency_value text;
  treatment_value text;
  identifier_value text;
  active_value boolean;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 16384
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'name', 'contact_name', 'email', 'phone', 'billing_address_line1',
        'billing_address_line2', 'billing_city', 'billing_region',
        'billing_postal_code', 'billing_country_code', 'locale',
        'preferred_currency_code', 'tax_treatment', 'tax_identifier', 'active'
      )
    ) then
    raise exception using errcode = '22023', message = 'customer_payload_invalid';
  end if;

  name_value := btrim(coalesce(p_payload ->> 'name', ''));
  contact_value := btrim(coalesce(p_payload ->> 'contact_name', ''));
  email_value := btrim(coalesce(p_payload ->> 'email', ''));
  phone_value := btrim(coalesce(p_payload ->> 'phone', ''));
  address1_value := btrim(coalesce(p_payload ->> 'billing_address_line1', ''));
  address2_value := btrim(coalesce(p_payload ->> 'billing_address_line2', ''));
  city_value := btrim(coalesce(p_payload ->> 'billing_city', ''));
  region_value := btrim(coalesce(p_payload ->> 'billing_region', ''));
  postal_value := btrim(coalesce(p_payload ->> 'billing_postal_code', ''));
  country_value := upper(btrim(coalesce(p_payload ->> 'billing_country_code', '')));
  locale_value := btrim(coalesce(p_payload ->> 'locale', ''));
  currency_value := upper(btrim(coalesce(p_payload ->> 'preferred_currency_code', '')));
  treatment_value := coalesce(p_payload ->> 'tax_treatment', '');
  identifier_value := nullif(btrim(coalesce(p_payload ->> 'tax_identifier', '')), '');

  if char_length(name_value) not between 1 and 160
    or char_length(contact_value) > 120
    or char_length(email_value) > 254
    or char_length(phone_value) > 40
    or char_length(address1_value) > 160
    or char_length(address2_value) > 160
    or char_length(city_value) > 100
    or char_length(region_value) > 100
    or char_length(postal_value) > 24
    or char_length(coalesce(identifier_value, '')) > 80
    or concat_ws(
      '', name_value, contact_value, email_value, phone_value, address1_value,
      address2_value, city_value, region_value, postal_value,
      coalesce(identifier_value, '')
    ) ~ '[[:cntrl:]]'
    or (email_value <> '' and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or country_value !~ '^[A-Z]{2}$'
    or char_length(locale_value) > 35
    or locale_value !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    or currency_value !~ '^[A-Z]{3}$'
    or treatment_value not in ('standard', 'exempt', 'zero_rated', 'reverse_charge')
    or jsonb_typeof(coalesce(p_payload -> 'active', 'null'::jsonb)) <> 'boolean' then
    raise exception using errcode = '22023', message = 'customer_payload_invalid';
  end if;
  active_value := (p_payload ->> 'active')::boolean;

  return jsonb_build_object(
    'name', name_value,
    'contact_name', contact_value,
    'email', email_value,
    'phone', phone_value,
    'billing_address_line1', address1_value,
    'billing_address_line2', address2_value,
    'billing_city', city_value,
    'billing_region', region_value,
    'billing_postal_code', postal_value,
    'billing_country_code', country_value,
    'locale', locale_value,
    'preferred_currency_code', currency_value,
    'tax_treatment', treatment_value,
    'tax_identifier', identifier_value,
    'active', active_value
  );
end;
$$;

create or replace function public.normalize_tax_profile_payload(p_payload jsonb)
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
  basis_value text;
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
        'code', 'label', 'jurisdiction_country_code', 'rate_bps',
        'price_basis', 'treatment', 'active'
      )
    ) then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;
  code_value := upper(btrim(coalesce(p_payload ->> 'code', '')));
  label_value := btrim(coalesce(p_payload ->> 'label', ''));
  country_value := nullif(upper(btrim(coalesce(p_payload ->> 'jurisdiction_country_code', ''))), '');
  basis_value := coalesce(p_payload ->> 'price_basis', '');
  treatment_value := coalesce(p_payload ->> 'treatment', '');
  if code_value !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
    or char_length(label_value) not between 1 and 120
    or label_value ~ '[[:cntrl:]]'
    or (country_value is not null and country_value !~ '^[A-Z]{2}$')
    or coalesce(p_payload ->> 'rate_bps', '') !~ '^[0-9]{1,5}$'
    or basis_value not in ('exclusive', 'inclusive')
    or treatment_value not in ('standard', 'exempt', 'zero_rated', 'reverse_charge')
    or jsonb_typeof(coalesce(p_payload -> 'active', 'null'::jsonb)) <> 'boolean' then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;
  rate_value := (p_payload ->> 'rate_bps')::integer;
  active_value := (p_payload ->> 'active')::boolean;
  if rate_value not between 0 and 10000
    or (treatment_value <> 'standard' and rate_value <> 0) then
    raise exception using errcode = '22023', message = 'tax_profile_payload_invalid';
  end if;
  return jsonb_build_object(
    'code', code_value,
    'label', label_value,
    'jurisdiction_country_code', country_value,
    'rate_bps', rate_value,
    'price_basis', basis_value,
    'treatment', treatment_value,
    'active', active_value
  );
end;
$$;

create or replace function public.normalize_organization_settings_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  name_value text;
  currency_value text;
  locale_value text;
  threshold_value integer;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 8192
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'name', 'default_currency_code', 'default_locale', 'approval_threshold_bps'
      )
    ) then
    raise exception using errcode = '22023', message = 'organization_settings_payload_invalid';
  end if;
  name_value := btrim(coalesce(p_payload ->> 'name', ''));
  currency_value := upper(btrim(coalesce(p_payload ->> 'default_currency_code', '')));
  locale_value := btrim(coalesce(p_payload ->> 'default_locale', ''));
  if char_length(name_value) not between 1 and 120
    or name_value ~ '[[:cntrl:]]'
    or currency_value !~ '^[A-Z]{3}$'
    or char_length(locale_value) > 35
    or locale_value !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    or coalesce(p_payload ->> 'approval_threshold_bps', '') !~ '^[0-9]{1,5}$' then
    raise exception using errcode = '22023', message = 'organization_settings_payload_invalid';
  end if;
  threshold_value := (p_payload ->> 'approval_threshold_bps')::integer;
  if threshold_value not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'organization_settings_payload_invalid';
  end if;
  return jsonb_build_object(
    'name', name_value,
    'default_currency_code', currency_value,
    'default_locale', locale_value,
    'approval_threshold_bps', threshold_value
  );
end;
$$;

create or replace function public.create_product(
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
  product_id uuid;
  result jsonb;
begin
  if caller is null
    or not public.has_org_capability(p_organization_id, 'catalog.manage') then
    raise exception using errcode = '42501', message = 'product_create_forbidden';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;
  request := jsonb_build_object('organization_id', p_organization_id, 'payload', p_payload);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || p_organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', p_organization_id, p_command_id, 'product.create',
    'product', null, request
  );
  if replay is not null then return replay; end if;
  normalized := public.normalize_product_payload(p_organization_id, p_payload);
  insert into public.products (
    organization_id, sku, description, unit_code, quantity_precision,
    unit_price_minor, currency_code, tax_profile_id, active, created_by
  )
  values (
    p_organization_id, normalized ->> 'sku', normalized ->> 'description',
    (normalized ->> 'unit_code')::public.unit_code,
    (normalized ->> 'quantity_precision')::smallint,
    (normalized ->> 'unit_price_minor')::bigint,
    normalized ->> 'currency_code',
    (normalized ->> 'tax_profile_id')::uuid,
    (normalized ->> 'active')::boolean, caller
  )
  returning id into product_id;
  result := jsonb_build_object(
    'id', product_id, 'version', 1, 'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    p_organization_id, p_command_id, 'product.create', 'product',
    product_id, caller, request, result
  );
  return result;
end;
$$;

create or replace function public.update_product(
  p_product_id uuid,
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
  product_row public.products%rowtype;
  request jsonb;
  normalized jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into product_row from public.products product where product.id = p_product_id for update;
  if product_row.id is null
    or not public.has_org_capability(product_row.organization_id, 'catalog.manage') then
    raise exception using errcode = '42501', message = 'product_update_forbidden';
  end if;
  request := jsonb_build_object(
    'product_id', p_product_id, 'expected_version', p_expected_version, 'payload', p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || product_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', product_row.organization_id, p_command_id, 'product.update',
    'product', p_product_id, request
  );
  if replay is not null then return replay; end if;
  if product_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'product_version_stale';
  end if;
  normalized := public.normalize_product_payload(product_row.organization_id, p_payload);
  update public.products product
  set
    sku = normalized ->> 'sku',
    description = normalized ->> 'description',
    unit_code = (normalized ->> 'unit_code')::public.unit_code,
    quantity_precision = (normalized ->> 'quantity_precision')::smallint,
    unit_price_minor = (normalized ->> 'unit_price_minor')::bigint,
    currency_code = normalized ->> 'currency_code',
    tax_profile_id = (normalized ->> 'tax_profile_id')::uuid,
    active = (normalized ->> 'active')::boolean
  where product.id = p_product_id;
  result := jsonb_build_object(
    'id', p_product_id, 'version', product_row.version + 1,
    'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    product_row.organization_id, p_command_id, 'product.update', 'product',
    p_product_id, caller, request, result
  );
  return result;
end;
$$;

create or replace function public.archive_product(
  p_product_id uuid,
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
  product_row public.products%rowtype;
  request jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into product_row from public.products product where product.id = p_product_id for update;
  if product_row.id is null
    or not public.has_org_capability(product_row.organization_id, 'catalog.manage') then
    raise exception using errcode = '42501', message = 'product_archive_forbidden';
  end if;
  request := jsonb_build_object(
    'product_id', p_product_id, 'expected_version', p_expected_version
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || product_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', product_row.organization_id, p_command_id, 'product.archive',
    'product', p_product_id, request
  );
  if replay is not null then return replay; end if;
  if product_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'product_version_stale';
  end if;
  update public.products set active = false where id = p_product_id;
  result := jsonb_build_object(
    'id', p_product_id, 'version', product_row.version + 1, 'active', false
  );
  perform public.record_organization_command(
    product_row.organization_id, p_command_id, 'product.archive', 'product',
    p_product_id, caller, request, result
  );
  return result;
end;
$$;

create or replace function public.create_customer(
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
  customer_id uuid;
  result jsonb;
begin
  if caller is null
    or not public.has_org_capability(p_organization_id, 'customer.manage') then
    raise exception using errcode = '42501', message = 'customer_create_forbidden';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;
  request := jsonb_build_object('organization_id', p_organization_id, 'payload', p_payload);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || p_organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', p_organization_id, p_command_id, 'customer.create',
    'customer', null, request
  );
  if replay is not null then return replay; end if;
  normalized := public.normalize_customer_payload(p_payload);
  insert into public.customers (
    organization_id, name, contact_name, email, phone, billing_address_line1,
    billing_address_line2, billing_city, billing_region, billing_postal_code,
    billing_country_code, locale, preferred_currency_code, tax_treatment,
    tax_identifier, active, created_by
  )
  values (
    p_organization_id, normalized ->> 'name', normalized ->> 'contact_name',
    normalized ->> 'email', normalized ->> 'phone',
    normalized ->> 'billing_address_line1', normalized ->> 'billing_address_line2',
    normalized ->> 'billing_city', normalized ->> 'billing_region',
    normalized ->> 'billing_postal_code', normalized ->> 'billing_country_code',
    normalized ->> 'locale', normalized ->> 'preferred_currency_code',
    (normalized ->> 'tax_treatment')::public.tax_treatment,
    normalized ->> 'tax_identifier', (normalized ->> 'active')::boolean, caller
  )
  returning id into customer_id;
  result := jsonb_build_object(
    'id', customer_id, 'version', 1, 'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    p_organization_id, p_command_id, 'customer.create', 'customer',
    customer_id, caller, request, result
  );
  return result;
end;
$$;

create or replace function public.update_customer(
  p_customer_id uuid,
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
  customer_row public.customers%rowtype;
  request jsonb;
  normalized jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into customer_row from public.customers customer where customer.id = p_customer_id for update;
  if customer_row.id is null
    or not public.has_org_capability(customer_row.organization_id, 'customer.manage') then
    raise exception using errcode = '42501', message = 'customer_update_forbidden';
  end if;
  request := jsonb_build_object(
    'customer_id', p_customer_id, 'expected_version', p_expected_version, 'payload', p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || customer_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', customer_row.organization_id, p_command_id, 'customer.update',
    'customer', p_customer_id, request
  );
  if replay is not null then return replay; end if;
  if customer_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'customer_version_stale';
  end if;
  normalized := public.normalize_customer_payload(p_payload);
  update public.customers customer
  set
    name = normalized ->> 'name',
    contact_name = normalized ->> 'contact_name',
    email = normalized ->> 'email',
    phone = normalized ->> 'phone',
    billing_address_line1 = normalized ->> 'billing_address_line1',
    billing_address_line2 = normalized ->> 'billing_address_line2',
    billing_city = normalized ->> 'billing_city',
    billing_region = normalized ->> 'billing_region',
    billing_postal_code = normalized ->> 'billing_postal_code',
    billing_country_code = normalized ->> 'billing_country_code',
    locale = normalized ->> 'locale',
    preferred_currency_code = normalized ->> 'preferred_currency_code',
    tax_treatment = (normalized ->> 'tax_treatment')::public.tax_treatment,
    tax_identifier = normalized ->> 'tax_identifier',
    active = (normalized ->> 'active')::boolean
  where customer.id = p_customer_id;
  result := jsonb_build_object(
    'id', p_customer_id, 'version', customer_row.version + 1,
    'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    customer_row.organization_id, p_command_id, 'customer.update', 'customer',
    p_customer_id, caller, request, result
  );
  return result;
end;
$$;

create or replace function public.archive_customer(
  p_customer_id uuid,
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
  customer_row public.customers%rowtype;
  request jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into customer_row from public.customers customer where customer.id = p_customer_id for update;
  if customer_row.id is null
    or not public.has_org_capability(customer_row.organization_id, 'customer.manage') then
    raise exception using errcode = '42501', message = 'customer_archive_forbidden';
  end if;
  request := jsonb_build_object(
    'customer_id', p_customer_id, 'expected_version', p_expected_version
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || customer_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', customer_row.organization_id, p_command_id, 'customer.archive',
    'customer', p_customer_id, request
  );
  if replay is not null then return replay; end if;
  if customer_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'customer_version_stale';
  end if;
  update public.customers set active = false where id = p_customer_id;
  result := jsonb_build_object(
    'id', p_customer_id, 'version', customer_row.version + 1, 'active', false
  );
  perform public.record_organization_command(
    customer_row.organization_id, p_command_id, 'customer.archive', 'customer',
    p_customer_id, caller, request, result
  );
  return result;
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
    or not public.has_org_capability(p_organization_id, 'organization.manage') then
    raise exception using errcode = '42501', message = 'tax_profile_create_forbidden';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;
  request := jsonb_build_object('organization_id', p_organization_id, 'payload', p_payload);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || p_organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', p_organization_id, p_command_id, 'tax_profile.create',
    'tax_profile', null, request
  );
  if replay is not null then return replay; end if;
  normalized := public.normalize_tax_profile_payload(p_payload);
  insert into public.tax_profiles (
    organization_id, code, label, jurisdiction_country_code, rate_bps,
    price_basis, treatment, active, created_by
  )
  values (
    p_organization_id, normalized ->> 'code', normalized ->> 'label',
    normalized ->> 'jurisdiction_country_code',
    (normalized ->> 'rate_bps')::integer,
    (normalized ->> 'price_basis')::public.tax_price_basis,
    (normalized ->> 'treatment')::public.tax_treatment,
    (normalized ->> 'active')::boolean, caller
  )
  returning id into profile_id;
  result := jsonb_build_object(
    'id', profile_id, 'version', 1, 'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    p_organization_id, p_command_id, 'tax_profile.create', 'tax_profile',
    profile_id, caller, request, result
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
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into profile_row from public.tax_profiles profile where profile.id = p_tax_profile_id for update;
  if profile_row.id is null
    or not public.has_org_capability(profile_row.organization_id, 'organization.manage') then
    raise exception using errcode = '42501', message = 'tax_profile_update_forbidden';
  end if;
  request := jsonb_build_object(
    'tax_profile_id', p_tax_profile_id, 'expected_version', p_expected_version,
    'payload', p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || profile_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', profile_row.organization_id, p_command_id, 'tax_profile.update',
    'tax_profile', p_tax_profile_id, request
  );
  if replay is not null then return replay; end if;
  if profile_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'tax_profile_version_stale';
  end if;
  normalized := public.normalize_tax_profile_payload(p_payload);
  update public.tax_profiles profile
  set
    code = normalized ->> 'code',
    label = normalized ->> 'label',
    jurisdiction_country_code = normalized ->> 'jurisdiction_country_code',
    rate_bps = (normalized ->> 'rate_bps')::integer,
    price_basis = (normalized ->> 'price_basis')::public.tax_price_basis,
    treatment = (normalized ->> 'treatment')::public.tax_treatment,
    active = (normalized ->> 'active')::boolean
  where profile.id = p_tax_profile_id;
  result := jsonb_build_object(
    'id', p_tax_profile_id, 'version', profile_row.version + 1,
    'active', (normalized ->> 'active')::boolean
  );
  perform public.record_organization_command(
    profile_row.organization_id, p_command_id, 'tax_profile.update', 'tax_profile',
    p_tax_profile_id, caller, request, result
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  profile_row public.tax_profiles%rowtype;
  request jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into profile_row from public.tax_profiles profile where profile.id = p_tax_profile_id for update;
  if profile_row.id is null
    or not public.has_org_capability(profile_row.organization_id, 'organization.manage') then
    raise exception using errcode = '42501', message = 'tax_profile_archive_forbidden';
  end if;
  request := jsonb_build_object(
    'tax_profile_id', p_tax_profile_id, 'expected_version', p_expected_version
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || profile_row.organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', profile_row.organization_id, p_command_id, 'tax_profile.archive',
    'tax_profile', p_tax_profile_id, request
  );
  if replay is not null then return replay; end if;
  if profile_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'tax_profile_version_stale';
  end if;
  update public.tax_profiles set active = false where id = p_tax_profile_id;
  result := jsonb_build_object(
    'id', p_tax_profile_id, 'version', profile_row.version + 1, 'active', false
  );
  perform public.record_organization_command(
    profile_row.organization_id, p_command_id, 'tax_profile.archive', 'tax_profile',
    p_tax_profile_id, caller, request, result
  );
  return result;
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
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into organization_row
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if organization_row.id is null
    or not public.has_org_capability(p_organization_id, 'organization.manage') then
    raise exception using errcode = '42501', message = 'organization_settings_update_forbidden';
  end if;
  request := jsonb_build_object(
    'organization_id', p_organization_id, 'expected_version', p_expected_version,
    'payload', p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || p_organization_id::text || ':' || p_command_id::text, 0
    )
  );
  replay := public.command_receipt_replay(
    'organization', p_organization_id, p_command_id, 'organization.settings.update',
    'organization', p_organization_id, request
  );
  if replay is not null then return replay; end if;
  if organization_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'organization_version_stale';
  end if;
  normalized := public.normalize_organization_settings_payload(p_payload);
  update public.organizations organization
  set
    name = normalized ->> 'name',
    default_currency_code = normalized ->> 'default_currency_code',
    default_locale = normalized ->> 'default_locale',
    approval_threshold_bps = (normalized ->> 'approval_threshold_bps')::integer
  where organization.id = p_organization_id;
  result := jsonb_build_object(
    'id', p_organization_id, 'version', organization_row.version + 1
  );
  perform public.record_organization_command(
    p_organization_id, p_command_id, 'organization.settings.update', 'organization',
    p_organization_id, caller, request, result
  );
  return result;
end;
$$;

revoke insert, update, delete on
  public.products, public.customers, public.tax_profiles
from authenticated;
revoke update on public.organizations from authenticated;

do $$
declare
  privilege record;
begin
  for privilege in
    select table_schema, table_name, column_name, privilege_type
    from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('products', 'customers', 'tax_profiles', 'organizations')
      and privilege_type in ('INSERT', 'UPDATE')
  loop
    execute format(
      'revoke %s (%I) on table %I.%I from authenticated',
      privilege.privilege_type,
      privilege.column_name,
      privilege.table_schema,
      privilege.table_name
    );
  end loop;
end;
$$;

revoke all on function
  public.record_organization_command(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.normalize_product_payload(uuid, jsonb),
  public.normalize_customer_payload(jsonb),
  public.normalize_tax_profile_payload(jsonb),
  public.normalize_organization_settings_payload(jsonb)
from public, anon, authenticated;

revoke all on function
  public.create_product(uuid, jsonb, uuid),
  public.update_product(uuid, integer, jsonb, uuid),
  public.archive_product(uuid, integer, uuid),
  public.create_customer(uuid, jsonb, uuid),
  public.update_customer(uuid, integer, jsonb, uuid),
  public.archive_customer(uuid, integer, uuid),
  public.create_tax_profile(uuid, jsonb, uuid),
  public.update_tax_profile(uuid, integer, jsonb, uuid),
  public.archive_tax_profile(uuid, integer, uuid),
  public.update_organization_settings(uuid, integer, jsonb, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_product(uuid, jsonb, uuid),
  public.update_product(uuid, integer, jsonb, uuid),
  public.archive_product(uuid, integer, uuid),
  public.create_customer(uuid, jsonb, uuid),
  public.update_customer(uuid, integer, jsonb, uuid),
  public.archive_customer(uuid, integer, uuid),
  public.create_tax_profile(uuid, jsonb, uuid),
  public.update_tax_profile(uuid, integer, jsonb, uuid),
  public.archive_tax_profile(uuid, integer, uuid),
  public.update_organization_settings(uuid, integer, jsonb, uuid)
to authenticated;

commit;
