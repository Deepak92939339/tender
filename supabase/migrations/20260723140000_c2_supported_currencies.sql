begin;

-- Milestone A stores every commercial amount with a two-decimal minor-unit
-- exponent. Human-entry boundaries normalize case, while storage and
-- calculation boundaries accept only these canonical codes.
create or replace function public.is_supported_currency(p_currency_code text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_currency_code in ('INR', 'USD', 'EUR', 'GBP', 'RUB');
$$;

alter table public.organizations
  add constraint organizations_supported_currency_check
  check (public.is_supported_currency(default_currency_code::text)) not valid;
alter table public.products
  add constraint products_supported_currency_check
  check (public.is_supported_currency(currency_code::text)) not valid;
alter table public.customers
  add constraint customers_supported_currency_check
  check (public.is_supported_currency(preferred_currency_code::text)) not valid;
alter table public.quotes
  add constraint quotes_supported_currency_check
  check (public.is_supported_currency(currency_code)) not valid;
alter table public.quote_items
  add constraint quote_items_supported_currency_check
  check (public.is_supported_currency(currency_code)) not valid;
alter table public.quote_charges
  add constraint quote_charges_supported_currency_check
  check (public.is_supported_currency(currency_code)) not valid;

alter table public.organizations validate constraint organizations_supported_currency_check;
alter table public.products validate constraint products_supported_currency_check;
alter table public.customers validate constraint customers_supported_currency_check;
alter table public.quotes validate constraint quotes_supported_currency_check;
alter table public.quote_items validate constraint quote_items_supported_currency_check;
alter table public.quote_charges validate constraint quote_charges_supported_currency_check;

create or replace function public.calculate_quote_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  quote_currency text := p_payload->>'currency_code';
  quote_discount integer := coalesce((p_payload->>'discount_bps')::integer, 0);
  item jsonb;
  charge jsonb;
  items_result jsonb := '[]'::jsonb;
  charges_result jsonb := '[]'::jsonb;
  unit_price bigint;
  quantity_scaled bigint;
  quantity_scale bigint;
  quantity_precision integer;
  tax_bps integer;
  amount_minor bigint;
  price_base bigint;
  base_minor bigint;
  discount_minor bigint;
  net_minor bigint;
  tax_minor bigint;
  total_minor bigint;
  discounted_gross bigint;
  applies_discount boolean;
  subtotal_sum bigint := 0;
  discount_sum bigint := 0;
  item_tax_sum bigint := 0;
  charge_net_sum bigint := 0;
  charge_tax_sum bigint := 0;
  charge_discount_sum bigint := 0;
begin
  if not public.is_supported_currency(quote_currency) then
    raise exception using
      errcode = '22023',
      message = 'quote_calculation_currency_unsupported';
  end if;
  if quote_discount not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'quote_calculation_header_invalid';
  end if;
  if jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'charges', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'quote_calculation_arrays_required';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    if item->>'currency_code' <> quote_currency then
      raise exception using errcode = '22023', message = 'mixed_item_currency';
    end if;
    unit_price := (item->>'unit_price_minor_snapshot')::bigint;
    quantity_scaled := (item->>'quantity_scaled')::bigint;
    quantity_scale := (item->>'quantity_scale')::bigint;
    quantity_precision := (item->>'quantity_precision_snapshot')::integer;
    tax_bps := (item->>'tax_bps_snapshot')::integer;
    if unit_price < 0 or tax_bps not between 0 and 10000
      or not public.validate_quantity(item->>'unit_code_snapshot', quantity_precision, quantity_scaled, quantity_scale) then
      raise exception using errcode = '22023', message = 'quote_item_invalid';
    end if;
    price_base := public.round_nonnegative_ratio(unit_price, quantity_scaled, quantity_scale);

    if item->>'tax_treatment_snapshot' <> 'standard' then
      base_minor := price_base;
      net_minor := public.round_nonnegative_ratio(price_base, 10000 - quote_discount, 10000);
      discount_minor := base_minor - net_minor;
      tax_minor := 0;
      total_minor := net_minor;
    elsif item->>'tax_price_basis_snapshot' = 'inclusive' then
      base_minor := public.round_nonnegative_ratio(price_base, 10000, 10000 + tax_bps);
      discounted_gross := public.round_nonnegative_ratio(price_base, 10000 - quote_discount, 10000);
      net_minor := public.round_nonnegative_ratio(discounted_gross, 10000, 10000 + tax_bps);
      discount_minor := base_minor - net_minor;
      tax_minor := discounted_gross - net_minor;
      total_minor := discounted_gross;
    elsif item->>'tax_price_basis_snapshot' = 'exclusive' then
      base_minor := price_base;
      net_minor := public.round_nonnegative_ratio(base_minor, 10000 - quote_discount, 10000);
      discount_minor := base_minor - net_minor;
      tax_minor := public.round_nonnegative_ratio(net_minor, tax_bps, 10000);
      total_minor := net_minor + tax_minor;
    else
      raise exception using errcode = '22023', message = 'quote_item_tax_basis_invalid';
    end if;

    subtotal_sum := subtotal_sum + base_minor;
    discount_sum := discount_sum + discount_minor;
    item_tax_sum := item_tax_sum + tax_minor;
    items_result := items_result || jsonb_build_array(jsonb_build_object(
      'position', (item->>'position')::integer,
      'product_id', item->>'product_id',
      'sku_snapshot', item->>'sku_snapshot',
      'description_snapshot', item->>'description_snapshot',
      'unit_code_snapshot', item->>'unit_code_snapshot',
      'quantity_precision_snapshot', quantity_precision,
      'unit_price_minor_snapshot', unit_price,
      'currency_code', quote_currency,
      'quantity_scaled', quantity_scaled,
      'quantity_scale', quantity_scale,
      'tax_code_snapshot', item->>'tax_code_snapshot',
      'tax_bps_snapshot', tax_bps,
      'tax_price_basis_snapshot', item->>'tax_price_basis_snapshot',
      'tax_treatment_snapshot', item->>'tax_treatment_snapshot',
      'base_minor', base_minor,
      'discount_minor', discount_minor,
      'net_minor', net_minor,
      'tax_minor', tax_minor,
      'line_total_minor', total_minor
    ));
  end loop;

  for charge in select value from jsonb_array_elements(coalesce(p_payload->'charges', '[]'::jsonb)) loop
    if charge->>'currency_code' <> quote_currency
      or charge->>'charge_type' not in ('freight', 'shipping', 'handling', 'insurance', 'packaging', 'customs_duties', 'other') then
      raise exception using errcode = '22023', message = 'quote_charge_invalid';
    end if;
    amount_minor := (charge->>'amount_minor')::bigint;
    tax_bps := (charge->>'tax_bps_snapshot')::integer;
    applies_discount := coalesce((charge->>'discount_applies')::boolean, false);
    if amount_minor < 0 or tax_bps not between 0 and 10000 then
      raise exception using errcode = '22023', message = 'quote_charge_amount_invalid';
    end if;

    if charge->>'tax_treatment_snapshot' <> 'standard' then
      base_minor := amount_minor;
      net_minor := case when applies_discount then public.round_nonnegative_ratio(base_minor, 10000 - quote_discount, 10000) else base_minor end;
      discount_minor := base_minor - net_minor;
      tax_minor := 0;
      total_minor := net_minor;
    elsif charge->>'tax_price_basis_snapshot' = 'inclusive' then
      base_minor := public.round_nonnegative_ratio(amount_minor, 10000, 10000 + tax_bps);
      discounted_gross := case when applies_discount then public.round_nonnegative_ratio(amount_minor, 10000 - quote_discount, 10000) else amount_minor end;
      net_minor := public.round_nonnegative_ratio(discounted_gross, 10000, 10000 + tax_bps);
      discount_minor := base_minor - net_minor;
      tax_minor := discounted_gross - net_minor;
      total_minor := discounted_gross;
    elsif charge->>'tax_price_basis_snapshot' = 'exclusive' then
      base_minor := amount_minor;
      net_minor := case when applies_discount then public.round_nonnegative_ratio(base_minor, 10000 - quote_discount, 10000) else base_minor end;
      discount_minor := base_minor - net_minor;
      tax_minor := public.round_nonnegative_ratio(net_minor, tax_bps, 10000);
      total_minor := net_minor + tax_minor;
    else
      raise exception using errcode = '22023', message = 'quote_charge_tax_basis_invalid';
    end if;

    charge_net_sum := charge_net_sum + net_minor;
    charge_tax_sum := charge_tax_sum + tax_minor;
    charge_discount_sum := charge_discount_sum + discount_minor;
    charges_result := charges_result || jsonb_build_array(jsonb_build_object(
      'position', (charge->>'position')::integer,
      'charge_type', charge->>'charge_type',
      'description_snapshot', charge->>'description_snapshot',
      'amount_minor', amount_minor,
      'currency_code', quote_currency,
      'tax_code_snapshot', charge->>'tax_code_snapshot',
      'tax_bps_snapshot', tax_bps,
      'tax_price_basis_snapshot', charge->>'tax_price_basis_snapshot',
      'tax_treatment_snapshot', charge->>'tax_treatment_snapshot',
      'discount_applies', applies_discount,
      'discount_minor', discount_minor,
      'net_minor', net_minor,
      'tax_minor', tax_minor,
      'charge_total_minor', total_minor
    ));
  end loop;

  total_minor := subtotal_sum - discount_sum + item_tax_sum + charge_net_sum + charge_tax_sum;
  return jsonb_build_object(
    'currency_code', quote_currency,
    'discount_bps', quote_discount,
    'items', items_result,
    'charges', charges_result,
    'subtotal_minor', subtotal_sum,
    'discount_minor', discount_sum,
    'item_tax_minor', item_tax_sum,
    'charge_net_minor', charge_net_sum,
    'charge_tax_minor', charge_tax_sum,
    'charge_discount_minor', charge_discount_sum,
    'tax_minor', item_tax_sum + charge_tax_sum,
    'charges_minor', charge_net_sum + charge_tax_sum,
    'total_minor', total_minor
  );
end;
$$;

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
    if not public.is_supported_currency(currency_value) then codes := array_append(codes, 'CURRENCY_UNSUPPORTED'); fields := array_append(fields, 'currency_code'); end if;
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

commit;
