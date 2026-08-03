begin;

alter table public.command_receipts
  drop constraint command_receipts_result_check;
alter table public.command_receipts
  add constraint command_receipts_result_check
  check (
    jsonb_typeof(result) = 'object'
    and pg_column_size(result) <= 262144
  ) not valid;
alter table public.command_receipts
  validate constraint command_receipts_result_check;

create or replace function public.quote_draft_projection(
  p_organization_id uuid,
  p_quote_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', quote.id,
    'number', quote.number,
    'state', quote.state,
    'version', quote.version,
    'customer_id', quote.customer_id,
    'currency_code', quote.currency_code,
    'locale', quote.locale,
    'tax_label', quote.tax_label,
    'tax_mode', quote.tax_mode,
    'customer_tax_treatment', quote.customer_tax_treatment,
    'discount_bps', quote.discount_bps,
    'issue_date', quote.issue_date,
    'valid_until', quote.valid_until,
    'notes', quote.notes,
    'subtotal_minor', quote.subtotal_minor,
    'discount_minor', quote.discount_minor,
    'tax_minor', quote.tax_minor,
    'charges_minor', quote.charges_minor,
    'total_minor', quote.total_minor,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'position', item.position,
        'product_id', item.product_id,
        'sku_snapshot', item.sku_snapshot,
        'description_snapshot', item.description_snapshot,
        'unit_code_snapshot', item.unit_code_snapshot,
        'quantity_precision_snapshot', item.quantity_precision_snapshot,
        'unit_price_minor_snapshot', item.unit_price_minor_snapshot,
        'currency_code', item.currency_code,
        'quantity_scaled', item.quantity_scaled,
        'quantity_scale', item.quantity_scale,
        'tax_code_snapshot', item.tax_code_snapshot,
        'tax_bps_snapshot', item.tax_bps_snapshot,
        'tax_price_basis_snapshot', item.tax_price_basis_snapshot,
        'tax_treatment_snapshot', item.tax_treatment_snapshot,
        'base_minor', item.base_minor,
        'discount_minor', item.discount_minor,
        'net_minor', item.net_minor,
        'tax_minor', item.tax_minor,
        'line_total_minor', item.line_total_minor
      ) order by item.position)
      from public.quote_items item
      where item.organization_id = quote.organization_id
        and item.quote_id = quote.id
    ), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', charge.id,
        'position', charge.position,
        'charge_type', charge.charge_type,
        'description_snapshot', charge.description_snapshot,
        'amount_minor', charge.amount_minor,
        'currency_code', charge.currency_code,
        'tax_code_snapshot', charge.tax_code_snapshot,
        'tax_bps_snapshot', charge.tax_bps_snapshot,
        'tax_price_basis_snapshot', charge.tax_price_basis_snapshot,
        'tax_treatment_snapshot', charge.tax_treatment_snapshot,
        'discount_applies', charge.discount_applies,
        'discount_minor', charge.discount_minor,
        'net_minor', charge.net_minor,
        'tax_minor', charge.tax_minor,
        'charge_total_minor', charge.charge_total_minor
      ) order by charge.position)
      from public.quote_charges charge
      where charge.organization_id = quote.organization_id
        and charge.quote_id = quote.id
    ), '[]'::jsonb)
  )
  from public.quotes quote
  where quote.organization_id = p_organization_id
    and quote.id = p_quote_id;
$$;

create or replace function public.recalculate_quote(
  p_organization_id uuid,
  p_quote_id uuid
)
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
  select *
  into quote_row
  from public.quotes quote
  where quote.organization_id = p_organization_id
    and quote.id = p_quote_id;
  if quote_row.id is null then
    raise exception using errcode = 'P0001', message = 'quote_not_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'position', item.position,
    'product_id', item.product_id,
    'sku_snapshot', item.sku_snapshot,
    'description_snapshot', item.description_snapshot,
    'unit_code_snapshot', item.unit_code_snapshot,
    'quantity_precision_snapshot', item.quantity_precision_snapshot,
    'unit_price_minor_snapshot', item.unit_price_minor_snapshot,
    'currency_code', item.currency_code,
    'quantity_scaled', item.quantity_scaled,
    'quantity_scale', item.quantity_scale,
    'tax_code_snapshot', item.tax_code_snapshot,
    'tax_bps_snapshot', item.tax_bps_snapshot,
    'tax_price_basis_snapshot', quote_row.tax_mode,
    'tax_treatment_snapshot', item.tax_treatment_snapshot
  ) order by item.position), '[]'::jsonb)
  into item_payload
  from public.quote_items item
  where item.organization_id = p_organization_id
    and item.quote_id = p_quote_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', charge.id,
    'position', charge.position,
    'charge_type', charge.charge_type,
    'description_snapshot', charge.description_snapshot,
    'amount_minor', charge.amount_minor,
    'currency_code', charge.currency_code,
    'tax_code_snapshot', charge.tax_code_snapshot,
    'tax_bps_snapshot', charge.tax_bps_snapshot,
    'tax_price_basis_snapshot', quote_row.tax_mode,
    'tax_treatment_snapshot', charge.tax_treatment_snapshot,
    'discount_applies', charge.discount_applies
  ) order by charge.position), '[]'::jsonb)
  into charge_payload
  from public.quote_charges charge
  where charge.organization_id = p_organization_id
    and charge.quote_id = p_quote_id;

  result := public.calculate_quote_payload(jsonb_build_object(
    'currency_code', quote_row.currency_code,
    'tax_mode', quote_row.tax_mode,
    'discount_bps', quote_row.discount_bps,
    'items', item_payload,
    'charges', charge_payload
  ));
  result := jsonb_set(
    result,
    '{items}',
    coalesce((
      select jsonb_agg(
        calculated.value || jsonb_build_object('id', source.value -> 'id')
        order by calculated.ordinality
      )
      from jsonb_array_elements(result -> 'items')
        with ordinality calculated(value, ordinality)
      join jsonb_array_elements(item_payload)
        with ordinality source(value, ordinality)
        using (ordinality)
    ), '[]'::jsonb)
  );
  result := jsonb_set(
    result,
    '{charges}',
    coalesce((
      select jsonb_agg(
        calculated.value || jsonb_build_object('id', source.value -> 'id')
        order by calculated.ordinality
      )
      from jsonb_array_elements(result -> 'charges')
        with ordinality calculated(value, ordinality)
      join jsonb_array_elements(charge_payload)
        with ordinality source(value, ordinality)
        using (ordinality)
    ), '[]'::jsonb)
  );

  update public.quote_items item
  set
    tax_price_basis_snapshot = calculated.tax_price_basis_snapshot,
    base_minor = calculated.base_minor,
    discount_minor = calculated.discount_minor,
    net_minor = calculated.net_minor,
    tax_minor = calculated.tax_minor,
    line_total_minor = calculated.line_total_minor
  from jsonb_to_recordset(result -> 'items') as calculated(
    id uuid,
    tax_price_basis_snapshot public.tax_price_basis,
    base_minor bigint,
    discount_minor bigint,
    net_minor bigint,
    tax_minor bigint,
    line_total_minor bigint
  )
  where item.organization_id = p_organization_id
    and item.quote_id = p_quote_id
    and item.id = calculated.id;

  update public.quote_charges charge
  set
    tax_price_basis_snapshot = calculated.tax_price_basis_snapshot,
    discount_minor = calculated.discount_minor,
    net_minor = calculated.net_minor,
    tax_minor = calculated.tax_minor,
    charge_total_minor = calculated.charge_total_minor
  from jsonb_to_recordset(result -> 'charges') as calculated(
    id uuid,
    tax_price_basis_snapshot public.tax_price_basis,
    discount_minor bigint,
    net_minor bigint,
    tax_minor bigint,
    charge_total_minor bigint
  )
  where charge.organization_id = p_organization_id
    and charge.quote_id = p_quote_id
    and charge.id = calculated.id;

  update public.quotes quote
  set
    subtotal_minor = (result ->> 'subtotal_minor')::bigint,
    discount_minor = (result ->> 'discount_minor')::bigint,
    item_tax_minor = (result ->> 'item_tax_minor')::bigint,
    charge_net_minor = (result ->> 'charge_net_minor')::bigint,
    charge_tax_minor = (result ->> 'charge_tax_minor')::bigint,
    total_minor = (result ->> 'total_minor')::bigint
  where quote.organization_id = p_organization_id
    and quote.id = p_quote_id;

  return result;
end;
$$;

create or replace function public.save_quote_draft_c1_payload_impl(
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
  safe_result jsonb;
  actor jsonb;
  requested_item_count integer;
  requested_charge_count integer;
  resolved_item_count integer;
  resolved_charge_count integer;
  previous_commercial_count integer;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;

  select *
  into current_quote
  from public.quotes quote
  where quote.id = p_quote_id
  for update;
  if current_quote.id is null
    or not public.has_org_capability(current_quote.organization_id, 'quote.edit') then
    raise exception using errcode = '42501', message = 'quote_edit_forbidden';
  end if;
  if current_quote.state <> 'draft' then
    raise exception using errcode = '55000', message = 'quote_not_draft';
  end if;
  if current_quote.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'quote_version_stale';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'quote_payload_object_required';
  end if;
  if pg_column_size(p_payload) > 262144 then
    raise exception using errcode = '22023', message = 'quote_payload_too_large';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_payload) key
    where key not in (
      'customer_id', 'currency_code', 'locale', 'tax_label', 'tax_mode',
      'discount_bps', 'issue_date', 'valid_until', 'notes', 'items', 'charges',
      'subtotal_minor', 'discount_minor', 'tax_minor', 'charges_minor', 'total_minor'
    )
  ) then
    raise exception using errcode = '22023', message = 'quote_payload_unknown_field';
  end if;
  if jsonb_typeof(coalesce(p_payload -> 'items', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload -> 'charges', 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'quote_payload_arrays_required';
  end if;

  requested_item_count := jsonb_array_length(p_payload -> 'items');
  requested_charge_count := jsonb_array_length(p_payload -> 'charges');
  if requested_item_count > 100 then
    raise exception using errcode = '22023', message = 'quote_item_limit';
  end if;
  if requested_charge_count > 25 then
    raise exception using errcode = '22023', message = 'quote_charge_limit';
  end if;
  if char_length(coalesce(p_payload ->> 'notes', '')) > 5000 then
    raise exception using errcode = '22023', message = 'quote_notes_too_long';
  end if;
  if exists (
    select 1
    from unnest(array[
      'subtotal_minor', 'discount_minor', 'tax_minor', 'charges_minor', 'total_minor'
    ]) key
    where p_payload ? key
      and (
        coalesce(p_payload ->> key, '') !~ '^[0-9]{1,16}$'
        or (p_payload ->> key)::numeric > 9007199254740991
      )
  ) then
    raise exception using errcode = '22023', message = 'quote_client_total_invalid';
  end if;

  if coalesce(p_payload ->> 'customer_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(p_payload ->> 'currency_code', '') !~ '^[A-Z]{3}$'
    or not public.is_supported_currency(p_payload ->> 'currency_code')
    or char_length(coalesce(p_payload ->> 'locale', '')) > 35
    or coalesce(p_payload ->> 'locale', '') !~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'
    or char_length(btrim(coalesce(p_payload ->> 'tax_label', ''))) not between 1 and 80
    or coalesce(p_payload ->> 'tax_mode', '') not in ('exclusive', 'inclusive')
    or coalesce(p_payload ->> 'discount_bps', '') !~ '^[0-9]{1,5}$'
    or (p_payload ->> 'discount_bps')::integer not between 0 and 10000
    or coalesce(p_payload ->> 'issue_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_payload ->> 'valid_until', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_payload ->> 'valid_until')::date < (p_payload ->> 'issue_date')::date then
    raise exception using errcode = '22023', message = 'quote_header_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'items') source
    where jsonb_typeof(source) <> 'object'
      or not (source ?& array[
        'line_id', 'product_id', 'position', 'quantity_scaled', 'quantity_scale'
      ])
      or exists (
        select 1
        from jsonb_object_keys(source) key
        where key not in (
          'line_id', 'product_id', 'position', 'quantity_scaled', 'quantity_scale'
        )
      )
      or jsonb_typeof(source -> 'line_id') not in ('null', 'string')
      or (
        jsonb_typeof(source -> 'line_id') = 'string'
        and coalesce(source ->> 'line_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )
      or coalesce(source ->> 'product_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(source ->> 'position', '') !~ '^[1-9][0-9]{0,2}$'
      or (source ->> 'position')::integer > 100
      or coalesce(source ->> 'quantity_scaled', '') !~ '^[1-9][0-9]{0,15}$'
      or (source ->> 'quantity_scaled')::numeric > 9007199254740991
      or coalesce(source ->> 'quantity_scale', '') not in ('1', '10', '100', '1000')
  ) then
    raise exception using errcode = '22023', message = 'quote_item_invalid';
  end if;
  if requested_item_count > 0 and (
    (
      select count(distinct (source ->> 'position')::integer)
      from jsonb_array_elements(p_payload -> 'items') source
    ) <> requested_item_count
    or (
      select max((source ->> 'position')::integer)
      from jsonb_array_elements(p_payload -> 'items') source
    ) <> requested_item_count
  ) then
    raise exception using errcode = '22023', message = 'quote_item_positions_invalid';
  end if;
  if exists (
    select source ->> 'line_id'
    from jsonb_array_elements(p_payload -> 'items') source
    where jsonb_typeof(source -> 'line_id') = 'string'
    group by source ->> 'line_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'quote_line_id_duplicate';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'charges') source
    where jsonb_typeof(source) <> 'object'
      or not (source ?& array[
        'charge_id', 'position', 'charge_type', 'description', 'amount_minor',
        'tax_profile_id', 'discount_applies'
      ])
      or exists (
        select 1
        from jsonb_object_keys(source) key
        where key not in (
          'charge_id', 'position', 'charge_type', 'description', 'amount_minor',
          'tax_profile_id', 'discount_applies'
        )
      )
      or jsonb_typeof(source -> 'charge_id') not in ('null', 'string')
      or (
        jsonb_typeof(source -> 'charge_id') = 'string'
        and coalesce(source ->> 'charge_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )
      or coalesce(source ->> 'position', '') !~ '^[1-9][0-9]{0,2}$'
      or (source ->> 'position')::integer > 25
      or coalesce(source ->> 'charge_type', '') not in (
        'freight', 'shipping', 'handling', 'insurance',
        'packaging', 'customs_duties', 'other'
      )
      or char_length(btrim(coalesce(source ->> 'description', ''))) not between 1 and 300
      or coalesce(source ->> 'amount_minor', '') !~ '^[0-9]{1,16}$'
      or (source ->> 'amount_minor')::numeric > 9007199254740991
      or coalesce(source ->> 'tax_profile_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(source -> 'discount_applies') <> 'boolean'
  ) then
    raise exception using errcode = '22023', message = 'quote_charge_invalid';
  end if;
  if requested_charge_count > 0 and (
    (
      select count(distinct (source ->> 'position')::integer)
      from jsonb_array_elements(p_payload -> 'charges') source
    ) <> requested_charge_count
    or (
      select max((source ->> 'position')::integer)
      from jsonb_array_elements(p_payload -> 'charges') source
    ) <> requested_charge_count
  ) then
    raise exception using errcode = '22023', message = 'quote_charge_positions_invalid';
  end if;
  if exists (
    select source ->> 'charge_id'
    from jsonb_array_elements(p_payload -> 'charges') source
    where jsonb_typeof(source -> 'charge_id') = 'string'
    group by source ->> 'charge_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'quote_charge_id_duplicate';
  end if;

  select customer.tax_treatment
  into customer_treatment
  from public.customers customer
  where customer.organization_id = current_quote.organization_id
    and customer.id = (p_payload ->> 'customer_id')::uuid;
  if customer_treatment is null then
    raise exception using errcode = '23503', message = 'customer_not_in_organization';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'items') source
    where jsonb_typeof(source -> 'line_id') = 'string'
      and not exists (
        select 1
        from public.quote_items item
        where item.organization_id = current_quote.organization_id
          and item.quote_id = p_quote_id
          and item.id = (source ->> 'line_id')::uuid
          and item.product_id = (source ->> 'product_id')::uuid
      )
  ) then
    raise exception using errcode = '23503', message = 'quote_line_not_in_quote';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'items') source
    join public.quote_items item
      on item.organization_id = current_quote.organization_id
      and item.quote_id = p_quote_id
      and item.id = (source ->> 'line_id')::uuid
    where jsonb_typeof(source -> 'line_id') = 'string'
      and item.quantity_scale <> (source ->> 'quantity_scale')::bigint
  ) then
    raise exception using errcode = '22023', message = 'quote_line_quantity_scale_invalid';
  end if;

  select count(*)::integer
  into resolved_item_count
  from jsonb_array_elements(p_payload -> 'items') source
  join public.products product
    on product.organization_id = current_quote.organization_id
    and product.id = (source ->> 'product_id')::uuid
    and product.active
  join public.tax_profiles tax
    on tax.organization_id = product.organization_id
    and tax.id = product.tax_profile_id
    and tax.active
  where jsonb_typeof(source -> 'line_id') = 'null'
    and power(10, product.quantity_precision)::bigint =
      (source ->> 'quantity_scale')::bigint;
  if resolved_item_count <> (
    select count(*)
    from jsonb_array_elements(p_payload -> 'items') source
    where jsonb_typeof(source -> 'line_id') = 'null'
  ) then
    raise exception using errcode = '23503', message = 'quote_product_not_in_organization';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'charges') source
    where jsonb_typeof(source -> 'charge_id') = 'string'
      and not exists (
        select 1
        from public.quote_charges charge
        where charge.organization_id = current_quote.organization_id
          and charge.quote_id = p_quote_id
          and charge.id = (source ->> 'charge_id')::uuid
      )
  ) then
    raise exception using errcode = '23503', message = 'quote_charge_not_in_quote';
  end if;

  select count(*)::integer
  into resolved_charge_count
  from jsonb_array_elements(p_payload -> 'charges') source
  join public.tax_profiles tax
    on tax.organization_id = current_quote.organization_id
    and tax.id = (source ->> 'tax_profile_id')::uuid
    and tax.active
  where jsonb_typeof(source -> 'charge_id') = 'null';
  if resolved_charge_count <> (
    select count(*)
    from jsonb_array_elements(p_payload -> 'charges') source
    where jsonb_typeof(source -> 'charge_id') = 'null'
  ) then
    raise exception using errcode = '23503', message = 'quote_charge_configuration_invalid';
  end if;

  select coalesce(jsonb_agg(resolved.payload order by resolved.position), '[]'::jsonb)
  into calc_items
  from jsonb_array_elements(p_payload -> 'items') source
  cross join lateral (
    select
      (source ->> 'position')::integer as position,
      jsonb_build_object(
        'id', item.id,
        'position', (source ->> 'position')::integer,
        'product_id', item.product_id,
        'sku_snapshot', item.sku_snapshot,
        'description_snapshot', item.description_snapshot,
        'unit_code_snapshot', item.unit_code_snapshot,
        'quantity_precision_snapshot', item.quantity_precision_snapshot,
        'unit_price_minor_snapshot', item.unit_price_minor_snapshot,
        'currency_code', item.currency_code,
        'quantity_scaled', (source ->> 'quantity_scaled')::bigint,
        'quantity_scale', item.quantity_scale,
        'tax_code_snapshot', item.tax_code_snapshot,
        'tax_bps_snapshot', item.tax_bps_snapshot,
        'tax_price_basis_snapshot', p_payload ->> 'tax_mode',
        'tax_treatment_snapshot', item.tax_treatment_snapshot
      ) as payload
    from public.quote_items item
    where jsonb_typeof(source -> 'line_id') = 'string'
      and item.organization_id = current_quote.organization_id
      and item.quote_id = p_quote_id
      and item.id = (source ->> 'line_id')::uuid

    union all

    select
      (source ->> 'position')::integer,
      jsonb_build_object(
        'id', gen_random_uuid(),
        'position', (source ->> 'position')::integer,
        'product_id', product.id,
        'sku_snapshot', product.sku,
        'description_snapshot', product.description,
        'unit_code_snapshot', product.unit_code,
        'quantity_precision_snapshot', product.quantity_precision,
        'unit_price_minor_snapshot', product.unit_price_minor,
        'currency_code', product.currency_code,
        'quantity_scaled', (source ->> 'quantity_scaled')::bigint,
        'quantity_scale', (source ->> 'quantity_scale')::bigint,
        'tax_code_snapshot', tax.code,
        'tax_bps_snapshot', tax.rate_bps,
        'tax_price_basis_snapshot', p_payload ->> 'tax_mode',
        'tax_treatment_snapshot',
          case when customer_treatment = 'standard'
            then tax.treatment else customer_treatment end
      )
    from public.products product
    join public.tax_profiles tax
      on tax.organization_id = product.organization_id
      and tax.id = product.tax_profile_id
      and tax.active
    where jsonb_typeof(source -> 'line_id') = 'null'
      and product.organization_id = current_quote.organization_id
      and product.id = (source ->> 'product_id')::uuid
      and product.active
  ) resolved;

  select coalesce(jsonb_agg(resolved.payload order by resolved.position), '[]'::jsonb)
  into calc_charges
  from jsonb_array_elements(p_payload -> 'charges') source
  cross join lateral (
    select
      (source ->> 'position')::integer as position,
      jsonb_build_object(
        'id', charge.id,
        'position', (source ->> 'position')::integer,
        'charge_type', source ->> 'charge_type',
        'description_snapshot', btrim(source ->> 'description'),
        'amount_minor', (source ->> 'amount_minor')::bigint,
        'currency_code', p_payload ->> 'currency_code',
        'tax_code_snapshot', charge.tax_code_snapshot,
        'tax_bps_snapshot', charge.tax_bps_snapshot,
        'tax_price_basis_snapshot', p_payload ->> 'tax_mode',
        'tax_treatment_snapshot', charge.tax_treatment_snapshot,
        'discount_applies', (source ->> 'discount_applies')::boolean
      ) as payload
    from public.quote_charges charge
    where jsonb_typeof(source -> 'charge_id') = 'string'
      and charge.organization_id = current_quote.organization_id
      and charge.quote_id = p_quote_id
      and charge.id = (source ->> 'charge_id')::uuid

    union all

    select
      (source ->> 'position')::integer,
      jsonb_build_object(
        'id', gen_random_uuid(),
        'position', (source ->> 'position')::integer,
        'charge_type', source ->> 'charge_type',
        'description_snapshot', btrim(source ->> 'description'),
        'amount_minor', (source ->> 'amount_minor')::bigint,
        'currency_code', p_payload ->> 'currency_code',
        'tax_code_snapshot', tax.code,
        'tax_bps_snapshot', tax.rate_bps,
        'tax_price_basis_snapshot', p_payload ->> 'tax_mode',
        'tax_treatment_snapshot',
          case when customer_treatment = 'standard'
            then tax.treatment else customer_treatment end,
        'discount_applies', (source ->> 'discount_applies')::boolean
      )
    from public.tax_profiles tax
    where jsonb_typeof(source -> 'charge_id') = 'null'
      and tax.organization_id = current_quote.organization_id
      and tax.id = (source ->> 'tax_profile_id')::uuid
      and tax.active
  ) resolved;

  calc_result := public.calculate_quote_payload(jsonb_build_object(
    'currency_code', p_payload ->> 'currency_code',
    'tax_mode', p_payload ->> 'tax_mode',
    'discount_bps', (p_payload ->> 'discount_bps')::integer,
    'items', calc_items,
    'charges', calc_charges
  ));
  calc_result := jsonb_set(
    calc_result,
    '{items}',
    coalesce((
      select jsonb_agg(
        calculated.value || jsonb_build_object('id', source.value -> 'id')
        order by calculated.ordinality
      )
      from jsonb_array_elements(calc_result -> 'items')
        with ordinality calculated(value, ordinality)
      join jsonb_array_elements(calc_items)
        with ordinality source(value, ordinality)
        using (ordinality)
    ), '[]'::jsonb)
  );
  calc_result := jsonb_set(
    calc_result,
    '{charges}',
    coalesce((
      select jsonb_agg(
        calculated.value || jsonb_build_object('id', source.value -> 'id')
        order by calculated.ordinality
      )
      from jsonb_array_elements(calc_result -> 'charges')
        with ordinality calculated(value, ordinality)
      join jsonb_array_elements(calc_charges)
        with ordinality source(value, ordinality)
        using (ordinality)
    ), '[]'::jsonb)
  );

  select
    (select count(*) from public.quote_items item
      where item.organization_id = current_quote.organization_id
        and item.quote_id = p_quote_id)
    +
    (select count(*) from public.quote_charges charge
      where charge.organization_id = current_quote.organization_id
        and charge.quote_id = p_quote_id)
  into previous_commercial_count;

  update public.quote_items item
  set position = item.position + 1000
  where item.organization_id = current_quote.organization_id
    and item.quote_id = p_quote_id;
  delete from public.quote_items item
  where item.organization_id = current_quote.organization_id
    and item.quote_id = p_quote_id
    and not exists (
      select 1
      from jsonb_array_elements(calc_result -> 'items') calculated
      where (calculated ->> 'id')::uuid = item.id
    );

  insert into public.quote_items (
    id, organization_id, quote_id, product_id, position, sku_snapshot,
    description_snapshot, unit_code_snapshot, quantity_precision_snapshot,
    unit_price_minor_snapshot, currency_code, quantity_scaled, quantity_scale,
    tax_code_snapshot, tax_bps_snapshot, tax_price_basis_snapshot,
    tax_treatment_snapshot, base_minor, discount_minor, net_minor, tax_minor,
    line_total_minor
  )
  select
    record.id, current_quote.organization_id, p_quote_id, record.product_id,
    record.position, record.sku_snapshot, record.description_snapshot,
    record.unit_code_snapshot, record.quantity_precision_snapshot,
    record.unit_price_minor_snapshot, record.currency_code,
    record.quantity_scaled, record.quantity_scale, record.tax_code_snapshot,
    record.tax_bps_snapshot, record.tax_price_basis_snapshot,
    record.tax_treatment_snapshot, record.base_minor, record.discount_minor,
    record.net_minor, record.tax_minor, record.line_total_minor
  from jsonb_to_recordset(calc_result -> 'items') as record(
    id uuid,
    position integer,
    product_id uuid,
    sku_snapshot text,
    description_snapshot text,
    unit_code_snapshot public.unit_code,
    quantity_precision_snapshot integer,
    unit_price_minor_snapshot bigint,
    currency_code text,
    quantity_scaled bigint,
    quantity_scale bigint,
    tax_code_snapshot text,
    tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis,
    tax_treatment_snapshot public.tax_treatment,
    base_minor bigint,
    discount_minor bigint,
    net_minor bigint,
    tax_minor bigint,
    line_total_minor bigint
  )
  on conflict (id) do update
  set
    position = excluded.position,
    product_id = excluded.product_id,
    sku_snapshot = excluded.sku_snapshot,
    description_snapshot = excluded.description_snapshot,
    unit_code_snapshot = excluded.unit_code_snapshot,
    quantity_precision_snapshot = excluded.quantity_precision_snapshot,
    unit_price_minor_snapshot = excluded.unit_price_minor_snapshot,
    currency_code = excluded.currency_code,
    quantity_scaled = excluded.quantity_scaled,
    quantity_scale = excluded.quantity_scale,
    tax_code_snapshot = excluded.tax_code_snapshot,
    tax_bps_snapshot = excluded.tax_bps_snapshot,
    tax_price_basis_snapshot = excluded.tax_price_basis_snapshot,
    tax_treatment_snapshot = excluded.tax_treatment_snapshot,
    base_minor = excluded.base_minor,
    discount_minor = excluded.discount_minor,
    net_minor = excluded.net_minor,
    tax_minor = excluded.tax_minor,
    line_total_minor = excluded.line_total_minor;

  update public.quote_charges charge
  set position = charge.position + 1000
  where charge.organization_id = current_quote.organization_id
    and charge.quote_id = p_quote_id;
  delete from public.quote_charges charge
  where charge.organization_id = current_quote.organization_id
    and charge.quote_id = p_quote_id
    and not exists (
      select 1
      from jsonb_array_elements(calc_result -> 'charges') calculated
      where (calculated ->> 'id')::uuid = charge.id
    );

  insert into public.quote_charges (
    id, organization_id, quote_id, position, charge_type, description_snapshot,
    amount_minor, currency_code, tax_code_snapshot, tax_bps_snapshot,
    tax_price_basis_snapshot, tax_treatment_snapshot, discount_applies,
    discount_minor, net_minor, tax_minor, charge_total_minor
  )
  select
    record.id, current_quote.organization_id, p_quote_id, record.position,
    record.charge_type, record.description_snapshot, record.amount_minor,
    record.currency_code, record.tax_code_snapshot, record.tax_bps_snapshot,
    record.tax_price_basis_snapshot, record.tax_treatment_snapshot,
    record.discount_applies, record.discount_minor, record.net_minor,
    record.tax_minor, record.charge_total_minor
  from jsonb_to_recordset(calc_result -> 'charges') as record(
    id uuid,
    position integer,
    charge_type public.quote_charge_type,
    description_snapshot text,
    amount_minor bigint,
    currency_code text,
    tax_code_snapshot text,
    tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis,
    tax_treatment_snapshot public.tax_treatment,
    discount_applies boolean,
    discount_minor bigint,
    net_minor bigint,
    tax_minor bigint,
    charge_total_minor bigint
  )
  on conflict (id) do update
  set
    position = excluded.position,
    charge_type = excluded.charge_type,
    description_snapshot = excluded.description_snapshot,
    amount_minor = excluded.amount_minor,
    currency_code = excluded.currency_code,
    tax_code_snapshot = excluded.tax_code_snapshot,
    tax_bps_snapshot = excluded.tax_bps_snapshot,
    tax_price_basis_snapshot = excluded.tax_price_basis_snapshot,
    tax_treatment_snapshot = excluded.tax_treatment_snapshot,
    discount_applies = excluded.discount_applies,
    discount_minor = excluded.discount_minor,
    net_minor = excluded.net_minor,
    tax_minor = excluded.tax_minor,
    charge_total_minor = excluded.charge_total_minor;

  update public.quotes quote
  set
    customer_id = (p_payload ->> 'customer_id')::uuid,
    currency_code = p_payload ->> 'currency_code',
    locale = p_payload ->> 'locale',
    tax_label = btrim(p_payload ->> 'tax_label'),
    tax_mode = (p_payload ->> 'tax_mode')::public.tax_price_basis,
    customer_tax_treatment = customer_treatment,
    discount_bps = (p_payload ->> 'discount_bps')::integer,
    issue_date = (p_payload ->> 'issue_date')::date,
    valid_until = (p_payload ->> 'valid_until')::date,
    notes = coalesce(p_payload ->> 'notes', ''),
    subtotal_minor = (calc_result ->> 'subtotal_minor')::bigint,
    discount_minor = (calc_result ->> 'discount_minor')::bigint,
    item_tax_minor = (calc_result ->> 'item_tax_minor')::bigint,
    charge_net_minor = (calc_result ->> 'charge_net_minor')::bigint,
    charge_tax_minor = (calc_result ->> 'charge_tax_minor')::bigint,
    total_minor = (calc_result ->> 'total_minor')::bigint,
    version = quote.version + 1
  where quote.organization_id = current_quote.organization_id
    and quote.id = p_quote_id;

  if previous_commercial_count = 0
    and requested_item_count + requested_charge_count > 0 then
    actor := public.quote_actor(current_quote.organization_id);
    insert into public.quote_activity (
      organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
      actor_role_snapshot, actor_source, message
    )
    values (
      current_quote.organization_id, p_quote_id, 'draft.prepared', caller,
      actor ->> 'name', actor ->> 'role', 'signed_user',
      'Commercial lines first prepared.'
    );
  end if;

  safe_result := public.quote_draft_projection(
    current_quote.organization_id,
    p_quote_id
  );
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id,
    actor_user_id, result
  )
  values (
    current_quote.organization_id, p_command_id, 'quote.save_draft', 'quote',
    p_quote_id, caller, safe_result
  );
  return safe_result;
end;
$$;

create or replace function public.refresh_quote_line_from_catalog(
  p_quote_id uuid,
  p_line_id uuid,
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
  line_row public.quote_items%rowtype;
  product_row public.products%rowtype;
  tax_row public.tax_profiles%rowtype;
  request jsonb;
  replay jsonb;
  result jsonb;
  actor jsonb;
  new_scale bigint;
  new_quantity_scaled bigint;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;

  select *
  into quote_row
  from public.quotes quote
  where quote.id = p_quote_id
  for update;
  if quote_row.id is null
    or not public.has_org_capability(quote_row.organization_id, 'quote.edit') then
    raise exception using errcode = '42501', message = 'quote_edit_forbidden';
  end if;

  request := jsonb_build_object(
    'quote_id', p_quote_id,
    'line_id', p_line_id,
    'expected_version', p_expected_version
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || quote_row.organization_id::text || ':' ||
      p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization', quote_row.organization_id, p_command_id,
    'quote.line.refresh', 'quote', p_quote_id, request
  );
  if replay is not null then
    return replay;
  end if;
  if quote_row.state <> 'draft' then
    raise exception using errcode = '55000', message = 'quote_not_draft';
  end if;
  if quote_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'quote_version_stale';
  end if;

  select *
  into line_row
  from public.quote_items item
  where item.organization_id = quote_row.organization_id
    and item.quote_id = p_quote_id
    and item.id = p_line_id
  for update;
  if line_row.id is null or line_row.product_id is null then
    raise exception using errcode = '23503', message = 'quote_line_not_in_quote';
  end if;

  select *
  into product_row
  from public.products product
  where product.organization_id = quote_row.organization_id
    and product.id = line_row.product_id
    and product.active;
  if product_row.id is null or product_row.currency_code <> quote_row.currency_code then
    raise exception using errcode = '23503', message = 'quote_refresh_product_invalid';
  end if;
  select *
  into tax_row
  from public.tax_profiles tax
  where tax.organization_id = quote_row.organization_id
    and tax.id = product_row.tax_profile_id
    and tax.active;
  if tax_row.id is null then
    raise exception using errcode = '23503', message = 'quote_refresh_tax_invalid';
  end if;

  new_scale := power(10, product_row.quantity_precision)::bigint;
  if mod(line_row.quantity_scaled * new_scale, line_row.quantity_scale) <> 0 then
    raise exception using
      errcode = '22023',
      message = 'quote_line_refresh_quantity_incompatible';
  end if;
  new_quantity_scaled :=
    line_row.quantity_scaled * new_scale / line_row.quantity_scale;
  if not public.validate_quantity(
    product_row.unit_code::text,
    product_row.quantity_precision,
    new_quantity_scaled,
    new_scale
  ) then
    raise exception using
      errcode = '22023',
      message = 'quote_line_refresh_quantity_incompatible';
  end if;

  perform public.set_command_receipt_context(
    'organization', quote_row.organization_id, p_command_id, request
  );
  update public.quote_items item
  set
    sku_snapshot = product_row.sku,
    description_snapshot = product_row.description,
    unit_code_snapshot = product_row.unit_code,
    quantity_precision_snapshot = product_row.quantity_precision,
    unit_price_minor_snapshot = product_row.unit_price_minor,
    currency_code = product_row.currency_code,
    quantity_scaled = new_quantity_scaled,
    quantity_scale = new_scale,
    tax_code_snapshot = tax_row.code,
    tax_bps_snapshot = tax_row.rate_bps,
    tax_price_basis_snapshot = quote_row.tax_mode,
    tax_treatment_snapshot = case
      when quote_row.customer_tax_treatment = 'standard'
        then tax_row.treatment
      else quote_row.customer_tax_treatment
    end
  where item.organization_id = quote_row.organization_id
    and item.quote_id = p_quote_id
    and item.id = p_line_id;

  perform public.recalculate_quote(quote_row.organization_id, p_quote_id);
  update public.quotes quote
  set version = quote.version + 1
  where quote.organization_id = quote_row.organization_id
    and quote.id = p_quote_id;

  actor := public.quote_actor(quote_row.organization_id);
  insert into public.quote_activity (
    organization_id, quote_id, event_type, actor_user_id, actor_name_snapshot,
    actor_role_snapshot, actor_source, message, safe_metadata
  )
  values (
    quote_row.organization_id, p_quote_id, 'draft.line_refreshed', caller,
    actor ->> 'name', actor ->> 'role', 'signed_user',
    'Line pricing refreshed from catalog.',
    jsonb_build_object('line_id', p_line_id, 'product_id', product_row.id)
  );

  result := public.quote_draft_projection(quote_row.organization_id, p_quote_id);
  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id,
    actor_user_id, result
  )
  values (
    quote_row.organization_id, p_command_id, 'quote.line.refresh', 'quote',
    p_quote_id, caller, result
  );
  return result;
end;
$$;

revoke all on function public.quote_draft_projection(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.recalculate_quote(uuid, uuid)
  from public, anon, authenticated;
revoke all on function
  public.save_quote_draft_c1_payload_impl(uuid, integer, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function
  public.refresh_quote_line_from_catalog(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function
  public.refresh_quote_line_from_catalog(uuid, uuid, integer, uuid)
  to authenticated;

commit;
