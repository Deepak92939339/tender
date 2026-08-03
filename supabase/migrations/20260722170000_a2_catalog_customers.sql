begin;

create type public.tax_price_basis as enum ('exclusive', 'inclusive');
create type public.tax_treatment as enum ('standard', 'exempt', 'zero_rated', 'reverse_charge');
create type public.unit_code as enum ('EA', 'M', 'KG', 'L', 'BOX');
create type public.catalog_import_status as enum ('previewed', 'committed', 'rejected');
create type public.catalog_import_row_status as enum ('valid', 'invalid', 'committed');

create table public.tax_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  jurisdiction_country_code char(2) check (jurisdiction_country_code is null or jurisdiction_country_code ~ '^[A-Z]{2}$'),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  price_basis public.tax_price_basis not null,
  treatment public.tax_treatment not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (treatment = 'standard' or rate_bps = 0)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null check (char_length(btrim(sku)) between 1 and 64 and sku !~ '[[:cntrl:]]'),
  description text not null check (char_length(btrim(description)) between 1 and 500 and description !~ '[[:cntrl:]]'),
  unit_code public.unit_code not null,
  quantity_precision smallint not null check (quantity_precision between 0 and 3),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 999999999999999),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  tax_profile_id uuid not null,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku),
  unique (organization_id, id),
  foreign key (organization_id, tax_profile_id) references public.tax_profiles(organization_id, id),
  check (
    (unit_code in ('EA', 'BOX') and quantity_precision = 0)
    or (unit_code in ('M', 'KG', 'L') and quantity_precision between 0 and 3)
  )
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160 and name !~ '[[:cntrl:]]'),
  contact_name text not null default '' check (char_length(contact_name) <= 120 and contact_name !~ '[[:cntrl:]]'),
  email text not null default '' check (char_length(email) <= 254 and email !~ '[[:cntrl:]]'),
  phone text not null default '' check (char_length(phone) <= 40 and phone !~ '[[:cntrl:]]'),
  billing_address_line1 text not null default '' check (char_length(billing_address_line1) <= 160 and billing_address_line1 !~ '[[:cntrl:]]'),
  billing_address_line2 text not null default '' check (char_length(billing_address_line2) <= 160 and billing_address_line2 !~ '[[:cntrl:]]'),
  billing_city text not null default '' check (char_length(billing_city) <= 100 and billing_city !~ '[[:cntrl:]]'),
  billing_region text not null default '' check (char_length(billing_region) <= 100 and billing_region !~ '[[:cntrl:]]'),
  billing_postal_code text not null default '' check (char_length(billing_postal_code) <= 24 and billing_postal_code !~ '[[:cntrl:]]'),
  billing_country_code char(2) not null check (billing_country_code ~ '^[A-Z]{2}$'),
  locale text not null check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  preferred_currency_code char(3) not null check (preferred_currency_code ~ '^[A-Z]{3}$'),
  tax_treatment public.tax_treatment not null default 'standard',
  tax_identifier text check (tax_identifier is null or (char_length(tax_identifier) <= 80 and tax_identifier !~ '[[:cntrl:]]')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.catalog_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null check (char_length(btrim(filename)) between 1 and 255 and filename !~ '[[:cntrl:]]'),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status public.catalog_import_status not null default 'previewed',
  row_count integer not null check (row_count between 1 and 1000),
  valid_count integer not null check (valid_count between 0 and row_count),
  invalid_count integer not null check (invalid_count between 0 and row_count),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (organization_id, content_hash),
  unique (organization_id, id),
  check (valid_count + invalid_count = row_count)
);

create table public.catalog_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  batch_id uuid not null,
  row_number integer not null check (row_number between 1 and 1000),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object' and pg_column_size(normalized_payload) <= 8192),
  status public.catalog_import_row_status not null,
  error_codes text[] not null default '{}',
  error_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (batch_id, row_number),
  foreign key (organization_id, batch_id) references public.catalog_import_batches(organization_id, id) on delete cascade,
  check (
    (status = 'invalid' and cardinality(error_codes) > 0)
    or (status in ('valid', 'committed') and cardinality(error_codes) = 0)
  )
);

create index products_org_active_idx on public.products (organization_id, active, sku);
create index customers_org_name_idx on public.customers (organization_id, name);
create index catalog_import_rows_batch_status_idx on public.catalog_import_rows (organization_id, batch_id, status, row_number);

create trigger tax_profiles_set_updated_at before update on public.tax_profiles
for each row execute function public.set_updated_at();

create or replace function public.bump_record_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

create trigger products_bump_version before update on public.products
for each row execute function public.bump_record_version();
create trigger customers_bump_version before update on public.customers
for each row execute function public.bump_record_version();

create or replace function public.prepare_catalog_import(
  p_organization_id uuid,
  p_filename text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  row_count integer;
  v_content_hash text;
  v_batch_id uuid;
  existing_batch public.catalog_import_batches%rowtype;
  raw_row jsonb;
  row_index integer := 0;
  normalized jsonb;
  codes text[];
  fields text[];
  sku_value text;
  description_value text;
  unit_value text;
  precision_text text;
  precision_value integer;
  price_text text;
  price_minor bigint;
  currency_value text;
  tax_code_value text;
  active_text text;
  active_value boolean;
  tax_profile uuid;
  valid_rows integer := 0;
  invalid_rows integer := 0;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if not public.has_org_capability(p_organization_id, 'catalog.import') then
    raise exception using errcode = '42501', message = 'catalog_import_forbidden';
  end if;
  if char_length(btrim(p_filename)) not between 1 and 255 or p_filename ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'filename_invalid';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception using errcode = '22023', message = 'rows_must_be_array'; end if;
  row_count := jsonb_array_length(p_rows);
  if row_count not between 1 and 1000 or pg_column_size(p_rows) > 1048576 then
    raise exception using errcode = '22023', message = 'catalog_import_size_limit';
  end if;

  v_content_hash := encode(extensions.digest(pg_catalog.convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || v_content_hash, 0));
  select * into existing_batch from public.catalog_import_batches batch
  where batch.organization_id = p_organization_id and batch.content_hash = v_content_hash;
  if found then
    return jsonb_build_object(
      'batch_id', existing_batch.id, 'status', existing_batch.status,
      'row_count', existing_batch.row_count, 'valid_count', existing_batch.valid_count,
      'invalid_count', existing_batch.invalid_count, 'content_hash', existing_batch.content_hash
    );
  end if;

  insert into public.catalog_import_batches (
    organization_id, filename, content_hash, row_count, valid_count, invalid_count, created_by
  ) values (p_organization_id, btrim(p_filename), v_content_hash, row_count, 0, row_count, caller)
  returning id into v_batch_id;

  for raw_row in select value from jsonb_array_elements(p_rows)
  loop
    row_index := row_index + 1;
    codes := '{}'; fields := '{}'; normalized := '{}'::jsonb;
    sku_value := btrim(coalesce(raw_row ->> 'sku', ''));
    description_value := btrim(coalesce(raw_row ->> 'description', ''));
    unit_value := upper(btrim(coalesce(raw_row ->> 'unit_code', '')));
    precision_text := btrim(coalesce(raw_row ->> 'quantity_precision', ''));
    price_text := btrim(coalesce(raw_row ->> 'unit_price', ''));
    currency_value := upper(btrim(coalesce(raw_row ->> 'currency_code', '')));
    tax_code_value := upper(btrim(coalesce(raw_row ->> 'tax_code', '')));
    active_text := lower(btrim(coalesce(raw_row ->> 'active', 'true')));
    precision_value := null; price_minor := null; tax_profile := null; active_value := null;

    if jsonb_typeof(raw_row) <> 'object' or exists (
      select 1 from jsonb_object_keys(raw_row) key
      where key not in ('sku','description','unit_code','quantity_precision','unit_price','currency_code','tax_code','active')
    ) then codes := array_append(codes, 'UNKNOWN_FIELD'); fields := array_append(fields, 'row'); end if;
    if char_length(sku_value) not between 1 and 64 or sku_value ~ '[[:cntrl:]]' then codes := array_append(codes, 'SKU_INVALID'); fields := array_append(fields, 'sku'); end if;
    if char_length(description_value) not between 1 and 500 or description_value ~ '[[:cntrl:]]' then codes := array_append(codes, 'DESCRIPTION_INVALID'); fields := array_append(fields, 'description'); end if;
    if unit_value not in ('EA','M','KG','L','BOX') then codes := array_append(codes, 'UNIT_CODE_INVALID'); fields := array_append(fields, 'unit_code'); end if;
    if precision_text ~ '^[0-3]$' then precision_value := precision_text::integer; else codes := array_append(codes, 'QUANTITY_PRECISION_INVALID'); fields := array_append(fields, 'quantity_precision'); end if;
    if precision_value is not null and unit_value in ('EA','BOX') and precision_value <> 0 then codes := array_append(codes, 'FRACTIONAL_UNIT_NOT_ALLOWED'); fields := array_append(fields, 'quantity_precision'); end if;
    if price_text ~ '^([0-9]{1,13})(\.[0-9]{1,2})?$' then price_minor := round(price_text::numeric * 100)::bigint; else codes := array_append(codes, 'UNIT_PRICE_INVALID'); fields := array_append(fields, 'unit_price'); end if;
    if currency_value !~ '^[A-Z]{3}$' then codes := array_append(codes, 'CURRENCY_INVALID'); fields := array_append(fields, 'currency_code'); end if;
    if active_text in ('true','1','yes') then active_value := true; elsif active_text in ('false','0','no') then active_value := false; else codes := array_append(codes, 'ACTIVE_INVALID'); fields := array_append(fields, 'active'); end if;

    select profile.id into tax_profile from public.tax_profiles profile
    where profile.organization_id = p_organization_id and profile.code = tax_code_value and profile.active;
    if tax_profile is null then codes := array_append(codes, 'TAX_CODE_UNKNOWN'); fields := array_append(fields, 'tax_code'); end if;

    if exists (select 1 from public.products product where product.organization_id = p_organization_id and product.sku = sku_value) then
      codes := array_append(codes, 'SKU_EXISTS'); fields := array_append(fields, 'sku');
    end if;
    if exists (select 1 from public.catalog_import_rows imported where imported.batch_id = v_batch_id and imported.normalized_payload ->> 'sku' = sku_value) then
      codes := array_append(codes, 'SKU_DUPLICATE_IN_FILE'); fields := array_append(fields, 'sku');
    end if;

    normalized := jsonb_build_object(
      'sku', sku_value, 'description', description_value, 'unit_code', unit_value,
      'quantity_precision', precision_value, 'unit_price_minor', price_minor,
      'currency_code', currency_value, 'tax_code', tax_code_value,
      'tax_profile_id', tax_profile, 'active', active_value
    );

    if cardinality(codes) = 0 then valid_rows := valid_rows + 1; else invalid_rows := invalid_rows + 1; end if;
    insert into public.catalog_import_rows (
      organization_id, batch_id, row_number, normalized_payload, status, error_codes, error_fields
    ) values (
      p_organization_id, v_batch_id, row_index, normalized,
      case when cardinality(codes) = 0 then 'valid'::public.catalog_import_row_status else 'invalid'::public.catalog_import_row_status end,
      codes, fields
    );
  end loop;

  update public.catalog_import_batches
  set valid_count = valid_rows, invalid_count = invalid_rows
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'status', 'previewed', 'row_count', row_count,
    'valid_count', valid_rows, 'invalid_count', invalid_rows, 'content_hash', v_content_hash
  );
end;
$$;

create or replace function public.commit_catalog_import(
  p_batch_id uuid,
  p_allow_partial boolean,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  batch public.catalog_import_batches%rowtype;
  existing_result jsonb;
  safe_result jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;

  select * into batch from public.catalog_import_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'catalog_import_not_found'; end if;
  if not public.has_org_capability(batch.organization_id, 'catalog.import') then
    raise exception using errcode = '42501', message = 'catalog_import_forbidden';
  end if;
  select receipt.result into existing_result from public.command_receipts receipt
  where receipt.organization_id = batch.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if batch.status <> 'previewed' then raise exception using errcode = '55000', message = 'catalog_import_not_previewed'; end if;
  if batch.invalid_count > 0 and not p_allow_partial then
    raise exception using errcode = '22023', message = 'partial_confirmation_required';
  end if;
  if batch.valid_count = 0 then raise exception using errcode = '22023', message = 'catalog_import_has_no_valid_rows'; end if;

  insert into public.products (
    organization_id, sku, description, unit_code, quantity_precision,
    unit_price_minor, currency_code, tax_profile_id, active, created_by
  )
  select
    row.organization_id,
    row.normalized_payload ->> 'sku',
    row.normalized_payload ->> 'description',
    (row.normalized_payload ->> 'unit_code')::public.unit_code,
    (row.normalized_payload ->> 'quantity_precision')::smallint,
    (row.normalized_payload ->> 'unit_price_minor')::bigint,
    row.normalized_payload ->> 'currency_code',
    (row.normalized_payload ->> 'tax_profile_id')::uuid,
    (row.normalized_payload ->> 'active')::boolean,
    caller
  from public.catalog_import_rows row
  where row.batch_id = p_batch_id and row.status = 'valid'
  order by row.row_number;

  update public.catalog_import_rows set status = 'committed' where batch_id = p_batch_id and status = 'valid';
  update public.catalog_import_batches set status = 'committed', committed_at = transaction_timestamp() where id = p_batch_id;

  safe_result := jsonb_build_object(
    'batch_id', p_batch_id, 'status', 'committed',
    'imported_count', batch.valid_count, 'skipped_count', batch.invalid_count
  );
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result
  ) values (
    batch.organization_id, p_command_id, 'catalog.import.commit', 'catalog_import', p_batch_id, caller, safe_result
  );
  return safe_result;
end;
$$;

alter table public.tax_profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.catalog_import_batches enable row level security;
alter table public.catalog_import_rows enable row level security;

create policy tax_profiles_select on public.tax_profiles for select to authenticated using (public.has_org_capability(organization_id, 'catalog.read'));
create policy tax_profiles_insert on public.tax_profiles for insert to authenticated with check (public.has_org_capability(organization_id, 'catalog.manage'));
create policy tax_profiles_update on public.tax_profiles for update to authenticated using (public.has_org_capability(organization_id, 'catalog.manage')) with check (public.has_org_capability(organization_id, 'catalog.manage'));

create policy products_select on public.products for select to authenticated using (public.has_org_capability(organization_id, 'catalog.read'));
create policy products_insert on public.products for insert to authenticated with check (public.has_org_capability(organization_id, 'catalog.manage') and created_by = auth.uid());
create policy products_update on public.products for update to authenticated using (public.has_org_capability(organization_id, 'catalog.manage')) with check (public.has_org_capability(organization_id, 'catalog.manage'));

create policy customers_select on public.customers for select to authenticated using (public.has_org_capability(organization_id, 'customer.read'));
create policy customers_insert on public.customers for insert to authenticated with check (public.has_org_capability(organization_id, 'customer.manage') and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated using (public.has_org_capability(organization_id, 'customer.manage')) with check (public.has_org_capability(organization_id, 'customer.manage'));

create policy catalog_batches_select on public.catalog_import_batches for select to authenticated using (public.has_org_capability(organization_id, 'catalog.read'));
create policy catalog_rows_select on public.catalog_import_rows for select to authenticated using (public.has_org_capability(organization_id, 'catalog.read'));

revoke all on public.tax_profiles, public.products, public.customers,
  public.catalog_import_batches, public.catalog_import_rows from anon, authenticated;
grant select, insert, update on public.tax_profiles, public.products to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select on public.catalog_import_batches, public.catalog_import_rows to authenticated;

revoke all on function public.prepare_catalog_import(uuid, text, jsonb) from public;
revoke all on function public.commit_catalog_import(uuid, boolean, uuid) from public;
grant execute on function public.prepare_catalog_import(uuid, text, jsonb) to authenticated;
grant execute on function public.commit_catalog_import(uuid, boolean, uuid) to authenticated;

commit;
