create type public.quote_state as enum ('draft', 'waiting', 'approved', 'rejected', 'issued', 'expired');
create type public.quote_charge_type as enum ('freight', 'shipping', 'handling', 'insurance', 'packaging', 'customs_duties', 'other');
create type public.quote_activity_source as enum ('signed_user', 'automatic_rule', 'system');

create table public.quote_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence_year integer not null check (sequence_year between 2000 and 9999),
  last_value bigint not null check (last_value > 0),
  primary key (organization_id, sequence_year)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number text not null check (number ~ '^TND-[0-9]{4}-[0-9]{4,}$'),
  customer_id uuid not null,
  state public.quote_state not null default 'draft',
  version integer not null default 1 check (version > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  locale text not null check (locale ~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'),
  tax_label text not null check (char_length(tax_label) between 1 and 80),
  tax_mode public.tax_price_basis not null,
  customer_tax_treatment public.tax_treatment not null,
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  issue_date date not null,
  valid_until date not null,
  notes text not null default '' check (char_length(notes) <= 5000),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  item_tax_minor bigint not null default 0 check (item_tax_minor >= 0),
  charge_net_minor bigint not null default 0 check (charge_net_minor >= 0),
  charge_tax_minor bigint not null default 0 check (charge_tax_minor >= 0),
  tax_minor bigint generated always as (item_tax_minor + charge_tax_minor) stored,
  charges_minor bigint generated always as (charge_net_minor + charge_tax_minor) stored,
  total_minor bigint not null default 0 check (total_minor >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejected_reason text check (rejected_reason is null or char_length(rejected_reason) between 1 and 1000),
  issued_by uuid references auth.users(id),
  issued_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, number),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  check (valid_until >= issue_date),
  check (total_minor = subtotal_minor - discount_minor + item_tax_minor + charge_net_minor + charge_tax_minor)
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  product_id uuid,
  position integer not null check (position > 0),
  sku_snapshot text not null check (char_length(sku_snapshot) between 1 and 64),
  description_snapshot text not null check (char_length(description_snapshot) between 1 and 500),
  unit_code_snapshot public.unit_code not null,
  quantity_precision_snapshot integer not null check (quantity_precision_snapshot between 0 and 3),
  unit_price_minor_snapshot bigint not null check (unit_price_minor_snapshot >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  quantity_scaled bigint not null check (quantity_scaled > 0),
  quantity_scale bigint not null check (quantity_scale in (1, 10, 100, 1000)),
  tax_code_snapshot text not null check (char_length(tax_code_snapshot) between 1 and 40),
  tax_bps_snapshot integer not null check (tax_bps_snapshot between 0 and 10000),
  tax_price_basis_snapshot public.tax_price_basis not null,
  tax_treatment_snapshot public.tax_treatment not null,
  base_minor bigint not null check (base_minor >= 0),
  discount_minor bigint not null check (discount_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  tax_minor bigint not null check (tax_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quote_id, position),
  unique (organization_id, id),
  foreign key (organization_id, quote_id) references public.quotes(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id),
  check (discount_minor <= base_minor),
  check (line_total_minor = net_minor + tax_minor),
  check ((unit_code_snapshot in ('EA', 'BOX') and quantity_precision_snapshot = 0 and quantity_scale = 1)
      or (unit_code_snapshot in ('M', 'KG', 'L') and quantity_scale = power(10, quantity_precision_snapshot)::bigint))
);

create table public.quote_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  position integer not null check (position > 0),
  charge_type public.quote_charge_type not null,
  description_snapshot text not null check (char_length(description_snapshot) between 1 and 300),
  amount_minor bigint not null check (amount_minor >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  tax_code_snapshot text not null check (char_length(tax_code_snapshot) between 1 and 40),
  tax_bps_snapshot integer not null check (tax_bps_snapshot between 0 and 10000),
  tax_price_basis_snapshot public.tax_price_basis not null,
  tax_treatment_snapshot public.tax_treatment not null,
  discount_applies boolean not null default false,
  discount_minor bigint not null check (discount_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  tax_minor bigint not null check (tax_minor >= 0),
  charge_total_minor bigint not null check (charge_total_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quote_id, position),
  unique (organization_id, id),
  foreign key (organization_id, quote_id) references public.quotes(organization_id, id) on delete cascade,
  check (discount_minor <= amount_minor),
  check (charge_total_minor = net_minor + tax_minor)
);

create table public.quote_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  actor_user_id uuid references auth.users(id),
  actor_name_snapshot text not null check (char_length(actor_name_snapshot) between 1 and 160),
  actor_role_snapshot text not null check (char_length(actor_role_snapshot) between 1 and 80),
  actor_source public.quote_activity_source not null,
  message text not null check (char_length(message) between 1 and 500),
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, quote_id) references public.quotes(organization_id, id) on delete cascade
);

create trigger quotes_set_updated_at before update on public.quotes for each row execute function public.set_updated_at();
create trigger quote_items_set_updated_at before update on public.quote_items for each row execute function public.set_updated_at();
create trigger quote_charges_set_updated_at before update on public.quote_charges for each row execute function public.set_updated_at();

create or replace function public.round_nonnegative_ratio(p_value numeric, p_multiplier numeric, p_divisor numeric)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  result numeric;
begin
  if p_value < 0 or p_multiplier < 0 or p_divisor <= 0 then
    raise exception using errcode = '22023', message = 'nonnegative_ratio_invalid';
  end if;
  result := floor((p_value * p_multiplier + floor(p_divisor / 2)) / p_divisor);
  if result > 9007199254740991 then
    raise exception using errcode = '22003', message = 'commercial_value_out_of_range';
  end if;
  return result::bigint;
end;
$$;

create or replace function public.validate_quantity(
  p_unit_code text,
  p_precision integer,
  p_quantity_scaled bigint,
  p_quantity_scale bigint
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_quantity_scaled > 0
    and p_precision between 0 and 3
    and (
      (p_unit_code in ('EA', 'BOX') and p_precision = 0 and p_quantity_scale = 1)
      or (p_unit_code in ('M', 'KG', 'L') and p_quantity_scale = power(10, p_precision)::bigint)
    ),
    false
  );
$$;

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
  if quote_currency !~ '^[A-Z]{3}$' or quote_discount not between 0 and 10000 then
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

create or replace function public.calculate_quote_payloads(p_payloads jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.calculate_quote_payload(value) order by ordinality), '[]'::jsonb)
  from jsonb_array_elements(p_payloads) with ordinality;
$$;

create or replace function public.next_quote_number(p_organization_id uuid, p_issue_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  sequence_value bigint;
  v_sequence_year integer := extract(year from p_issue_date)::integer;
begin
  insert into public.quote_sequences (organization_id, sequence_year, last_value)
  values (p_organization_id, v_sequence_year, 1)
  on conflict (organization_id, sequence_year)
  do update set last_value = public.quote_sequences.last_value + 1
  returning last_value into sequence_value;
  return 'TND-' || v_sequence_year::text || '-' || lpad(sequence_value::text, 4, '0');
end;
$$;

create or replace function public.quote_actor(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', coalesce(profile.display_name, auth_user.email, 'Tender user'),
    'role', role.label
  )
  from public.organization_memberships membership
  join public.roles role on role.id = membership.role_id
  join auth.users auth_user on auth_user.id = membership.user_id
  left join public.profiles profile on profile.user_id = membership.user_id
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active'
  limit 1;
$$;

create or replace function public.create_quote_draft(
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
  quote_id uuid;
  quote_number text;
  customer_treatment public.tax_treatment;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
begin
  if caller is null or not public.has_org_capability(p_organization_id, 'quote.create') then
    raise exception using errcode = '42501', message = 'quote_create_forbidden';
  end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_command_id::text, 0));
  select receipt.result into existing_result from public.command_receipts receipt
  where receipt.organization_id = p_organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if p_currency_code !~ '^[A-Z]{3}$' or p_locale !~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'
    or char_length(btrim(p_tax_label)) not between 1 and 80 or p_valid_until < p_issue_date then
    raise exception using errcode = '22023', message = 'quote_header_invalid';
  end if;
  select customer.tax_treatment into customer_treatment from public.customers customer
  where customer.organization_id = p_organization_id and customer.id = p_customer_id;
  if customer_treatment is null then raise exception using errcode = '23503', message = 'customer_not_in_organization'; end if;

  quote_number := public.next_quote_number(p_organization_id, p_issue_date);
  insert into public.quotes (
    organization_id, number, customer_id, currency_code, locale, tax_label, tax_mode,
    customer_tax_treatment, issue_date, valid_until, created_by
  ) values (
    p_organization_id, quote_number, p_customer_id, p_currency_code, p_locale, btrim(p_tax_label), p_tax_mode,
    customer_treatment, p_issue_date, p_valid_until, caller
  ) returning id into quote_id;

  actor := public.quote_actor(p_organization_id);
  insert into public.quote_activity (
    organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
    actor_role_snapshot, actor_source, message
  ) values (
    p_organization_id, quote_id, 'draft.created', caller, actor->>'name', actor->>'role',
    'signed_user', 'Draft quotation created.'
  );
  safe_result := jsonb_build_object('id', quote_id, 'number', quote_number, 'state', 'draft', 'version', 1);
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result
  ) values (p_organization_id, p_command_id, 'quote.create_draft', 'quote', quote_id, caller, safe_result);
  return safe_result;
end;
$$;

create or replace function public.save_quote_draft(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_quote public.quotes%rowtype;
  customer_treatment public.tax_treatment;
  calc_items jsonb;
  calc_charges jsonb;
  calc_result jsonb;
  existing_result jsonb;
  safe_result jsonb;
  actor jsonb;
  requested_item_count integer;
  requested_charge_count integer;
  resolved_item_count integer;
  resolved_charge_count integer;
  previous_commercial_count integer;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_command_id is null then raise exception using errcode = '22023', message = 'command_id_required'; end if;
  select * into current_quote from public.quotes quote where quote.id = p_quote_id for update;
  if current_quote.id is null or not public.has_org_capability(current_quote.organization_id, 'quote.edit') then
    raise exception using errcode = '42501', message = 'quote_edit_forbidden';
  end if;
  select receipt.result into existing_result from public.command_receipts receipt
  where receipt.organization_id = current_quote.organization_id and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;
  if current_quote.state <> 'draft' then raise exception using errcode = '55000', message = 'quote_not_draft'; end if;
  if current_quote.version <> p_expected_version then raise exception using errcode = 'P0001', message = 'quote_version_stale'; end if;
  if (p_payload->>'currency_code') !~ '^[A-Z]{3}$'
    or (p_payload->>'locale') !~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'
    or char_length(btrim(p_payload->>'tax_label')) not between 1 and 80
    or (p_payload->>'discount_bps')::integer not between 0 and 10000
    or (p_payload->>'valid_until')::date < (p_payload->>'issue_date')::date
    or char_length(coalesce(p_payload->>'notes', '')) > 5000 then
    raise exception using errcode = '22023', message = 'quote_header_invalid';
  end if;
  select customer.tax_treatment into customer_treatment from public.customers customer
  where customer.organization_id = current_quote.organization_id and customer.id = (p_payload->>'customer_id')::uuid;
  if customer_treatment is null then raise exception using errcode = '23503', message = 'customer_not_in_organization'; end if;

  requested_item_count := jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb));
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
    'position', source.ordinality,
    'product_id', product.id,
    'sku_snapshot', product.sku,
    'description_snapshot', product.description,
    'unit_code_snapshot', product.unit_code,
    'quantity_precision_snapshot', product.quantity_precision,
    'unit_price_minor_snapshot', product.unit_price_minor,
    'currency_code', product.currency_code,
    'quantity_scaled', (source.value->>'quantity_scaled')::bigint,
    'quantity_scale', power(10, product.quantity_precision)::bigint,
    'tax_code_snapshot', tax.code,
    'tax_bps_snapshot', tax.rate_bps,
    'tax_price_basis_snapshot', tax.price_basis,
    'tax_treatment_snapshot', case when customer_treatment = 'standard' then tax.treatment else customer_treatment end
  ) order by source.ordinality), '[]'::jsonb)
  into resolved_item_count, calc_items
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) with ordinality source
  join public.products product on product.organization_id = current_quote.organization_id
    and product.id = (source.value->>'product_id')::uuid and product.active
  join public.tax_profiles tax on tax.organization_id = product.organization_id and tax.id = product.tax_profile_id;
  if resolved_item_count <> requested_item_count then raise exception using errcode = '23503', message = 'quote_product_not_in_organization'; end if;

  requested_charge_count := jsonb_array_length(coalesce(p_payload->'charges', '[]'::jsonb));
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
    'position', source.ordinality,
    'charge_type', source.value->>'charge_type',
    'description_snapshot', btrim(source.value->>'description'),
    'amount_minor', (source.value->>'amount_minor')::bigint,
    'currency_code', p_payload->>'currency_code',
    'tax_code_snapshot', tax.code,
    'tax_bps_snapshot', tax.rate_bps,
    'tax_price_basis_snapshot', tax.price_basis,
    'tax_treatment_snapshot', case when customer_treatment = 'standard' then tax.treatment else customer_treatment end,
    'discount_applies', coalesce((source.value->>'discount_applies')::boolean, false)
  ) order by source.ordinality), '[]'::jsonb)
  into resolved_charge_count, calc_charges
  from jsonb_array_elements(coalesce(p_payload->'charges', '[]'::jsonb)) with ordinality source
  join public.tax_profiles tax on tax.organization_id = current_quote.organization_id
    and tax.id = (source.value->>'tax_profile_id')::uuid and tax.active
  where source.value->>'charge_type' in ('freight', 'shipping', 'handling', 'insurance', 'packaging', 'customs_duties', 'other')
    and char_length(btrim(source.value->>'description')) between 1 and 300;
  if resolved_charge_count <> requested_charge_count then raise exception using errcode = '23503', message = 'quote_charge_configuration_invalid'; end if;

  calc_result := public.calculate_quote_payload(jsonb_build_object(
    'currency_code', p_payload->>'currency_code',
    'discount_bps', (p_payload->>'discount_bps')::integer,
    'items', calc_items,
    'charges', calc_charges
  ));
  select (select count(*) from public.quote_items item where item.organization_id = current_quote.organization_id and item.quote_id = p_quote_id)
       + (select count(*) from public.quote_charges charge where charge.organization_id = current_quote.organization_id and charge.quote_id = p_quote_id)
  into previous_commercial_count;

  delete from public.quote_items item where item.organization_id = current_quote.organization_id and item.quote_id = p_quote_id;
  delete from public.quote_charges charge where charge.organization_id = current_quote.organization_id and charge.quote_id = p_quote_id;

  insert into public.quote_items (
    organization_id, quote_id, product_id, position, sku_snapshot, description_snapshot,
    unit_code_snapshot, quantity_precision_snapshot, unit_price_minor_snapshot, currency_code,
    quantity_scaled, quantity_scale, tax_code_snapshot, tax_bps_snapshot,
    tax_price_basis_snapshot, tax_treatment_snapshot, base_minor, discount_minor,
    net_minor, tax_minor, line_total_minor
  ) select current_quote.organization_id, p_quote_id, record.product_id, record.position,
    record.sku_snapshot, record.description_snapshot, record.unit_code_snapshot,
    record.quantity_precision_snapshot, record.unit_price_minor_snapshot, record.currency_code,
    record.quantity_scaled, record.quantity_scale, record.tax_code_snapshot, record.tax_bps_snapshot,
    record.tax_price_basis_snapshot, record.tax_treatment_snapshot, record.base_minor,
    record.discount_minor, record.net_minor, record.tax_minor, record.line_total_minor
  from jsonb_to_recordset(calc_result->'items') as record(
    position integer, product_id uuid, sku_snapshot text, description_snapshot text,
    unit_code_snapshot public.unit_code, quantity_precision_snapshot integer,
    unit_price_minor_snapshot bigint, currency_code text, quantity_scaled bigint,
    quantity_scale bigint, tax_code_snapshot text, tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis, tax_treatment_snapshot public.tax_treatment,
    base_minor bigint, discount_minor bigint, net_minor bigint, tax_minor bigint, line_total_minor bigint
  );

  insert into public.quote_charges (
    organization_id, quote_id, position, charge_type, description_snapshot, amount_minor,
    currency_code, tax_code_snapshot, tax_bps_snapshot, tax_price_basis_snapshot,
    tax_treatment_snapshot, discount_applies, discount_minor, net_minor, tax_minor, charge_total_minor
  ) select current_quote.organization_id, p_quote_id, record.position, record.charge_type,
    record.description_snapshot, record.amount_minor, record.currency_code, record.tax_code_snapshot,
    record.tax_bps_snapshot, record.tax_price_basis_snapshot, record.tax_treatment_snapshot,
    record.discount_applies, record.discount_minor, record.net_minor, record.tax_minor, record.charge_total_minor
  from jsonb_to_recordset(calc_result->'charges') as record(
    position integer, charge_type public.quote_charge_type, description_snapshot text, amount_minor bigint,
    currency_code text, tax_code_snapshot text, tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis, tax_treatment_snapshot public.tax_treatment,
    discount_applies boolean, discount_minor bigint, net_minor bigint, tax_minor bigint, charge_total_minor bigint
  );

  update public.quotes quote set
    customer_id = (p_payload->>'customer_id')::uuid,
    currency_code = p_payload->>'currency_code',
    locale = p_payload->>'locale',
    tax_label = btrim(p_payload->>'tax_label'),
    tax_mode = (p_payload->>'tax_mode')::public.tax_price_basis,
    customer_tax_treatment = customer_treatment,
    discount_bps = (p_payload->>'discount_bps')::integer,
    issue_date = (p_payload->>'issue_date')::date,
    valid_until = (p_payload->>'valid_until')::date,
    notes = coalesce(p_payload->>'notes', ''),
    subtotal_minor = (calc_result->>'subtotal_minor')::bigint,
    discount_minor = (calc_result->>'discount_minor')::bigint,
    item_tax_minor = (calc_result->>'item_tax_minor')::bigint,
    charge_net_minor = (calc_result->>'charge_net_minor')::bigint,
    charge_tax_minor = (calc_result->>'charge_tax_minor')::bigint,
    total_minor = (calc_result->>'total_minor')::bigint,
    version = quote.version + 1
  where quote.organization_id = current_quote.organization_id and quote.id = p_quote_id;

  if previous_commercial_count = 0 and requested_item_count + requested_charge_count > 0 then
    actor := public.quote_actor(current_quote.organization_id);
    insert into public.quote_activity (
      organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
      actor_role_snapshot, actor_source, message
    ) values (
      current_quote.organization_id, p_quote_id, 'draft.prepared', caller,
      actor->>'name', actor->>'role', 'signed_user', 'Commercial lines first prepared.'
    );
  end if;

  safe_result := jsonb_build_object(
    'id', p_quote_id,
    'number', current_quote.number,
    'state', 'draft',
    'version', current_quote.version + 1,
    'subtotal_minor', calc_result->'subtotal_minor',
    'discount_minor', calc_result->'discount_minor',
    'tax_minor', calc_result->'tax_minor',
    'charges_minor', calc_result->'charges_minor',
    'total_minor', calc_result->'total_minor'
  );
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result
  ) values (current_quote.organization_id, p_command_id, 'quote.save_draft', 'quote', p_quote_id, caller, safe_result);
  return safe_result;
end;
$$;

alter table public.quote_sequences enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_charges enable row level security;
alter table public.quote_activity enable row level security;

create policy quotes_select_member on public.quotes for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_items_select_member on public.quote_items for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_charges_select_member on public.quote_charges for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_activity_select_member on public.quote_activity for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));

revoke all on public.quote_sequences, public.quotes, public.quote_items, public.quote_charges, public.quote_activity from anon, authenticated;
grant select on public.quotes, public.quote_items, public.quote_charges, public.quote_activity to authenticated;
grant execute on function public.calculate_quote_payload(jsonb), public.calculate_quote_payloads(jsonb) to authenticated;
grant execute on function public.create_quote_draft(uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid) to authenticated;
grant execute on function public.save_quote_draft(uuid, integer, uuid, jsonb) to authenticated;
revoke execute on function public.next_quote_number(uuid, date), public.quote_actor(uuid) from public, anon, authenticated;
