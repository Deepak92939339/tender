begin;

revoke execute on function public.calculate_quote_payloads(jsonb) from public, anon, authenticated;

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

  select receipt.result
  into existing_result
  from public.command_receipts receipt
  where receipt.organization_id = current_quote.organization_id
    and receipt.command_id = p_command_id;
  if existing_result is not null then
    return existing_result;
  end if;

  if current_quote.state <> 'draft' then
    raise exception using errcode = '55000', message = 'quote_not_draft';
  end if;
  if current_quote.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'quote_version_stale';
  end if;

  -- The complete untrusted payload boundary is checked before resolving catalog
  -- rows and before any existing commercial row can be deleted.
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
    or char_length(coalesce(p_payload ->> 'currency_code', '')) <> 3
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
  ) then
    raise exception using errcode = '22023', message = 'quote_item_invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'items') source
    where exists (
      select 1
      from jsonb_object_keys(source) key
      where key not in ('line_id', 'product_id', 'quantity_scaled')
    )
      or coalesce(source ->> 'product_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (
        source ? 'line_id'
        and coalesce(source ->> 'line_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )
      or coalesce(source ->> 'quantity_scaled', '') !~ '^[1-9][0-9]{0,15}$'
      or (source ->> 'quantity_scaled')::numeric > 9007199254740991
  ) then
    raise exception using errcode = '22023', message = 'quote_item_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'charges') source
    where jsonb_typeof(source) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'quote_charge_invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'charges') source
    where exists (
      select 1
      from jsonb_object_keys(source) key
      where key not in (
        'charge_id', 'charge_type', 'description', 'amount_minor',
        'tax_profile_id', 'discount_applies'
      )
    )
      or coalesce(source ->> 'charge_type', '') not in (
        'freight', 'shipping', 'handling', 'insurance',
        'packaging', 'customs_duties', 'other'
      )
      or char_length(btrim(coalesce(source ->> 'description', ''))) not between 1 and 300
      or coalesce(source ->> 'amount_minor', '') !~ '^[0-9]{1,16}$'
      or (source ->> 'amount_minor')::numeric > 9007199254740991
      or coalesce(source ->> 'tax_profile_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (
        source ? 'charge_id'
        and coalesce(source ->> 'charge_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )
      or jsonb_typeof(coalesce(source -> 'discount_applies', 'null'::jsonb)) <> 'boolean'
  ) then
    raise exception using errcode = '22023', message = 'quote_charge_invalid';
  end if;

  select customer.tax_treatment
  into customer_treatment
  from public.customers customer
  where customer.organization_id = current_quote.organization_id
    and customer.id = (p_payload ->> 'customer_id')::uuid;
  if customer_treatment is null then
    raise exception using errcode = '23503', message = 'customer_not_in_organization';
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'position', source.ordinality,
      'product_id', product.id,
      'sku_snapshot', product.sku,
      'description_snapshot', product.description,
      'unit_code_snapshot', product.unit_code,
      'quantity_precision_snapshot', product.quantity_precision,
      'unit_price_minor_snapshot', product.unit_price_minor,
      'currency_code', product.currency_code,
      'quantity_scaled', (source.value ->> 'quantity_scaled')::bigint,
      'quantity_scale', power(10, product.quantity_precision)::bigint,
      'tax_code_snapshot', tax.code,
      'tax_bps_snapshot', tax.rate_bps,
      'tax_price_basis_snapshot', tax.price_basis,
      'tax_treatment_snapshot',
        case when customer_treatment = 'standard' then tax.treatment else customer_treatment end
    ) order by source.ordinality), '[]'::jsonb)
  into resolved_item_count, calc_items
  from jsonb_array_elements(p_payload -> 'items') with ordinality source
  join public.products product
    on product.organization_id = current_quote.organization_id
    and product.id = (source.value ->> 'product_id')::uuid
    and product.active
    and char_length(product.sku) <= 120
    and char_length(product.description) <= 1000
  join public.tax_profiles tax
    on tax.organization_id = product.organization_id
    and tax.id = product.tax_profile_id;
  if resolved_item_count <> requested_item_count then
    raise exception using errcode = '23503', message = 'quote_product_not_in_organization';
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'position', source.ordinality,
      'charge_type', source.value ->> 'charge_type',
      'description_snapshot', btrim(source.value ->> 'description'),
      'amount_minor', (source.value ->> 'amount_minor')::bigint,
      'currency_code', p_payload ->> 'currency_code',
      'tax_code_snapshot', tax.code,
      'tax_bps_snapshot', tax.rate_bps,
      'tax_price_basis_snapshot', tax.price_basis,
      'tax_treatment_snapshot',
        case when customer_treatment = 'standard' then tax.treatment else customer_treatment end,
      'discount_applies', (source.value ->> 'discount_applies')::boolean
    ) order by source.ordinality), '[]'::jsonb)
  into resolved_charge_count, calc_charges
  from jsonb_array_elements(p_payload -> 'charges') with ordinality source
  join public.tax_profiles tax
    on tax.organization_id = current_quote.organization_id
    and tax.id = (source.value ->> 'tax_profile_id')::uuid
    and tax.active;
  if resolved_charge_count <> requested_charge_count then
    raise exception using errcode = '23503', message = 'quote_charge_configuration_invalid';
  end if;

  calc_result := public.calculate_quote_payload(jsonb_build_object(
    'currency_code', p_payload ->> 'currency_code',
    'discount_bps', (p_payload ->> 'discount_bps')::integer,
    'items', calc_items,
    'charges', calc_charges
  ));

  select
    (select count(*) from public.quote_items item
      where item.organization_id = current_quote.organization_id and item.quote_id = p_quote_id)
    +
    (select count(*) from public.quote_charges charge
      where charge.organization_id = current_quote.organization_id and charge.quote_id = p_quote_id)
  into previous_commercial_count;

  delete from public.quote_items item
  where item.organization_id = current_quote.organization_id and item.quote_id = p_quote_id;
  delete from public.quote_charges charge
  where charge.organization_id = current_quote.organization_id and charge.quote_id = p_quote_id;

  insert into public.quote_items (
    organization_id, quote_id, product_id, position, sku_snapshot, description_snapshot,
    unit_code_snapshot, quantity_precision_snapshot, unit_price_minor_snapshot, currency_code,
    quantity_scaled, quantity_scale, tax_code_snapshot, tax_bps_snapshot,
    tax_price_basis_snapshot, tax_treatment_snapshot, base_minor, discount_minor,
    net_minor, tax_minor, line_total_minor
  )
  select
    current_quote.organization_id, p_quote_id, record.product_id, record.position,
    record.sku_snapshot, record.description_snapshot, record.unit_code_snapshot,
    record.quantity_precision_snapshot, record.unit_price_minor_snapshot, record.currency_code,
    record.quantity_scaled, record.quantity_scale, record.tax_code_snapshot, record.tax_bps_snapshot,
    record.tax_price_basis_snapshot, record.tax_treatment_snapshot, record.base_minor,
    record.discount_minor, record.net_minor, record.tax_minor, record.line_total_minor
  from jsonb_to_recordset(calc_result -> 'items') as record(
    position integer, product_id uuid, sku_snapshot text, description_snapshot text,
    unit_code_snapshot public.unit_code, quantity_precision_snapshot integer,
    unit_price_minor_snapshot bigint, currency_code text, quantity_scaled bigint,
    quantity_scale bigint, tax_code_snapshot text, tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis, tax_treatment_snapshot public.tax_treatment,
    base_minor bigint, discount_minor bigint, net_minor bigint, tax_minor bigint,
    line_total_minor bigint
  );

  insert into public.quote_charges (
    organization_id, quote_id, position, charge_type, description_snapshot, amount_minor,
    currency_code, tax_code_snapshot, tax_bps_snapshot, tax_price_basis_snapshot,
    tax_treatment_snapshot, discount_applies, discount_minor, net_minor, tax_minor,
    charge_total_minor
  )
  select
    current_quote.organization_id, p_quote_id, record.position, record.charge_type,
    record.description_snapshot, record.amount_minor, record.currency_code,
    record.tax_code_snapshot, record.tax_bps_snapshot, record.tax_price_basis_snapshot,
    record.tax_treatment_snapshot, record.discount_applies, record.discount_minor,
    record.net_minor, record.tax_minor, record.charge_total_minor
  from jsonb_to_recordset(calc_result -> 'charges') as record(
    position integer, charge_type public.quote_charge_type, description_snapshot text,
    amount_minor bigint, currency_code text, tax_code_snapshot text, tax_bps_snapshot integer,
    tax_price_basis_snapshot public.tax_price_basis, tax_treatment_snapshot public.tax_treatment,
    discount_applies boolean, discount_minor bigint, net_minor bigint, tax_minor bigint,
    charge_total_minor bigint
  );

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

  safe_result := jsonb_build_object(
    'id', p_quote_id,
    'number', current_quote.number,
    'state', 'draft',
    'version', current_quote.version + 1,
    'subtotal_minor', calc_result -> 'subtotal_minor',
    'discount_minor', calc_result -> 'discount_minor',
    'tax_minor', calc_result -> 'tax_minor',
    'charges_minor', calc_result -> 'charges_minor',
    'total_minor', calc_result -> 'total_minor'
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

revoke all on function public.save_quote_draft(uuid, integer, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_quote_draft(uuid, integer, uuid, jsonb)
  to authenticated;

commit;
