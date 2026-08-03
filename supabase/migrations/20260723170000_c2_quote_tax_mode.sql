begin;

comment on column public.tax_profiles.price_basis is
  'Deprecated Milestone A metadata. quotes.tax_mode is the sole calculation basis and runtime/UI must ignore this column.';

alter function public.calculate_quote_payload(jsonb)
  rename to calculate_quote_payload_c2_legacy_impl;

create or replace function public.calculate_quote_payload(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  quote_tax_mode public.tax_price_basis;
  normalized_items jsonb;
  normalized_charges jsonb;
  normalized_payload jsonb;
  result jsonb;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or coalesce(p_payload ->> 'tax_mode', '') not in ('exclusive', 'inclusive') then
    raise exception using errcode = '22023', message = 'quote_tax_mode_invalid';
  end if;
  quote_tax_mode := (p_payload ->> 'tax_mode')::public.tax_price_basis;
  if jsonb_typeof(coalesce(p_payload -> 'items', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload -> 'charges', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'quote_calculation_arrays_required';
  end if;

  select coalesce(
    jsonb_agg(
      source.value || jsonb_build_object(
        'tax_price_basis_snapshot', quote_tax_mode
      )
      order by source.ordinality
    ),
    '[]'::jsonb
  )
  into normalized_items
  from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb))
    with ordinality source(value, ordinality);

  select coalesce(
    jsonb_agg(
      source.value || jsonb_build_object(
        'tax_price_basis_snapshot', quote_tax_mode
      )
      order by source.ordinality
    ),
    '[]'::jsonb
  )
  into normalized_charges
  from jsonb_array_elements(coalesce(p_payload -> 'charges', '[]'::jsonb))
    with ordinality source(value, ordinality);

  normalized_payload := p_payload
    || jsonb_build_object(
      'items', normalized_items,
      'charges', normalized_charges
    );
  result := public.calculate_quote_payload_c2_legacy_impl(normalized_payload);
  return result || jsonb_build_object('tax_mode', quote_tax_mode);
end;
$$;

-- Recompile the bounded C1 save implementation so its calculation call includes
-- the already-validated quote tax_mode. The asserted source transformation is
-- deliberately narrow; migration application fails if the frozen predecessor
-- does not match the reviewed contract.
do $$
declare
  definition text;
  target text :=
    $target$'discount_bps', (p_payload ->> 'discount_bps')::integer,$target$;
  replacement text :=
    $replacement$'tax_mode', p_payload ->> 'tax_mode',
    'discount_bps', (p_payload ->> 'discount_bps')::integer,$replacement$;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_quote_draft_c1_payload_impl(uuid,integer,uuid,jsonb)'::regprocedure
  )
  into definition;
  patched := replace(definition, target, replacement);
  if patched = definition then
    raise exception using
      errcode = '55000',
      message = 'c2_tax_mode_save_predecessor_mismatch';
  end if;
  execute patched;
end;
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
  select * into quote_row
  from public.quotes quote
  where quote.organization_id = p_organization_id
    and quote.id = p_quote_id;
  if quote_row.id is null then
    raise exception using errcode = 'P0001', message = 'quote_not_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', item.position, 'product_id', item.product_id,
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

revoke all on function public.calculate_quote_payload_c2_legacy_impl(jsonb)
  from public, anon, authenticated;
revoke all on function public.is_supported_currency(text)
  from public, anon, authenticated;
revoke all on function
  public.save_quote_draft_c1_payload_impl(uuid, integer, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.calculate_quote_payload(jsonb)
  from public, anon, authenticated;
grant execute on function public.calculate_quote_payload(jsonb)
  to authenticated;

commit;
