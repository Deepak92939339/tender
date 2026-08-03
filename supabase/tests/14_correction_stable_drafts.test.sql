begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(44);

create temp table stable_context (
  key text primary key,
  value uuid not null
) on commit drop;
create temp table stable_results (
  key text primary key,
  value jsonb not null
) on commit drop;

create function pg_temp.stable_payload(
  p_quote_id uuid,
  p_notes text,
  p_items jsonb,
  p_charges jsonb
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'customer_id', quote.customer_id,
    'currency_code', quote.currency_code,
    'locale', quote.locale,
    'tax_label', quote.tax_label,
    'tax_mode', quote.tax_mode,
    'discount_bps', quote.discount_bps,
    'issue_date', quote.issue_date,
    'valid_until', quote.valid_until,
    'notes', p_notes,
    'items', p_items,
    'charges', p_charges
  )
  from public.quotes quote
  where quote.id = p_quote_id;
$$;

grant select, insert, update, delete on stable_context, stable_results to authenticated;
grant execute on function pg_temp.stable_payload(uuid, text, jsonb, jsonb) to authenticated;

select ok(
  to_regprocedure('public.refresh_quote_line_from_catalog(uuid,uuid,integer,uuid)') is not null,
  'explicit bounded line-refresh command exists'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$
  with created as (
    select public.create_quote_draft(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'a3000000-0000-4000-8000-000000000001',
      'INR', 'en-IN', 'GST 18%', 'exclusive',
      '2026-07-23', '2026-08-23',
      'c5000000-0000-4000-8000-000000000001'
    ) result
  )
  insert into stable_context(key, value)
  select 'quote', (result ->> 'id')::uuid from created
$$, 'primary draft is created');

select lives_ok($$
  insert into stable_results(key, value)
  select 'initial', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    1,
    'c5000000-0000-4000-8000-000000000002',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Initial stable draft',
      jsonb_build_array(jsonb_build_object(
        'line_id', null,
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1,
        'quantity_scaled', 1,
        'quantity_scale', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'charge_id', null,
        'position', 1,
        'charge_type', 'freight',
        'description', 'Stable freight',
        'amount_minor', 10000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 'new item and charge save with explicit identity payload');

select is(
  jsonb_array_length((select value -> 'items' from stable_results where key = 'initial')),
  1,
  'save result contains authoritative item projection'
);
select is(
  jsonb_array_length((select value -> 'charges' from stable_results where key = 'initial')),
  1,
  'save result contains authoritative charge projection'
);

insert into stable_context(key, value)
select 'initial_line', item.id
from public.quote_items item
where item.quote_id = (select value from stable_context where key = 'quote');
insert into stable_context(key, value)
select 'initial_charge', charge.id
from public.quote_charges charge
where charge.quote_id = (select value from stable_context where key = 'quote');

select is(
  (select value -> 'items' -> 0 ->> 'id' from stable_results where key = 'initial'),
  (select value::text from stable_context where key = 'initial_line'),
  'authoritative item projection exposes stored stable ID'
);
select is(
  (select value -> 'charges' -> 0 ->> 'id' from stable_results where key = 'initial'),
  (select value::text from stable_context where key = 'initial_charge'),
  'authoritative charge projection exposes stored stable ID'
);

reset role;
update public.products
set unit_price_minor = 1200000,
    description = 'Catalog description changed after snapshot'
where id = 'a2000000-0000-4000-8000-000000000001';
update public.tax_profiles
set rate_bps = 1900,
    code = 'IN_GST19'
where id = 'a1000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$
  insert into stable_results(key, value)
  select 'edited', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    2,
    'c5000000-0000-4000-8000-000000000003',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Notes and quantity changed',
      jsonb_build_array(jsonb_build_object(
        'line_id', (select value from stable_context where key = 'initial_line'),
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1,
        'quantity_scaled', 2,
        'quantity_scale', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'charge_id', (select value from stable_context where key = 'initial_charge'),
        'position', 1,
        'charge_type', 'freight',
        'description', 'Stable freight revised',
        'amount_minor', 12000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 'notes, quantity and permitted charge fields save by stable IDs');

select is(
  (select id from public.quote_items where quote_id = (select value from stable_context where key = 'quote')),
  (select value from stable_context where key = 'initial_line'),
  'notes and quantity save preserves line ID'
);
select is(
  (select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'initial_line')),
  1120000::bigint,
  'catalog price change does not silently reprice existing line'
);
select is(
  (select tax_bps_snapshot from public.quote_items where id = (select value from stable_context where key = 'initial_line')),
  1800,
  'tax-profile edit does not mutate existing line tax snapshot'
);
select is(
  (select description_snapshot from public.quote_items where id = (select value from stable_context where key = 'initial_line')),
  'Precision coupling assembly',
  'catalog description change does not mutate existing line snapshot'
);
select is(
  (select id from public.quote_charges where quote_id = (select value from stable_context where key = 'quote')),
  (select value from stable_context where key = 'initial_charge'),
  'permitted charge edit preserves charge ID'
);
select is(
  (select tax_bps_snapshot from public.quote_charges where id = (select value from stable_context where key = 'initial_charge')),
  1800,
  'tax-profile edit does not mutate existing charge tax snapshot'
);

reset role;
update public.products
set unit_price_minor = 400000
where id = 'a2000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$
  insert into stable_results(key, value)
  select 'added', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    3,
    'c5000000-0000-4000-8000-000000000004',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Added second line',
      jsonb_build_array(
        jsonb_build_object(
          'line_id', (select value from stable_context where key = 'initial_line'),
          'product_id', 'a2000000-0000-4000-8000-000000000001',
          'position', 1, 'quantity_scaled', 2, 'quantity_scale', 1
        ),
        jsonb_build_object(
          'line_id', null,
          'product_id', 'a2000000-0000-4000-8000-000000000002',
          'position', 2, 'quantity_scaled', 1250, 'quantity_scale', 1000
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'charge_id', (select value from stable_context where key = 'initial_charge'),
        'position', 1, 'charge_type', 'freight',
        'description', 'Stable freight revised', 'amount_minor', 12000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 'new line snapshots current catalog values once');

insert into stable_context(key, value)
select 'second_line', item.id
from public.quote_items item
where item.quote_id = (select value from stable_context where key = 'quote')
  and item.product_id = 'a2000000-0000-4000-8000-000000000002';

select is(
  (select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'second_line')),
  400000::bigint,
  'new line receives current catalog price'
);
select isnt(
  (select value from stable_context where key = 'second_line'),
  (select value from stable_context where key = 'initial_line'),
  'new line receives an independent stable ID'
);

select lives_ok($$
  insert into stable_results(key, value)
  select 'reordered', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    4,
    'c5000000-0000-4000-8000-000000000005',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Reordered',
      jsonb_build_array(
        jsonb_build_object(
          'line_id', (select value from stable_context where key = 'second_line'),
          'product_id', 'a2000000-0000-4000-8000-000000000002',
          'position', 1, 'quantity_scaled', 1250, 'quantity_scale', 1000
        ),
        jsonb_build_object(
          'line_id', (select value from stable_context where key = 'initial_line'),
          'product_id', 'a2000000-0000-4000-8000-000000000001',
          'position', 2, 'quantity_scaled', 2, 'quantity_scale', 1
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'charge_id', (select value from stable_context where key = 'initial_charge'),
        'position', 1, 'charge_type', 'freight',
        'description', 'Stable freight revised', 'amount_minor', 12000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 'reordering saves without recreating commercial lines');

select is((select position from public.quote_items where id = (select value from stable_context where key = 'second_line')), 1, 'second line moves to position one');
select is((select position from public.quote_items where id = (select value from stable_context where key = 'initial_line')), 2, 'first line moves to position two');
select is((select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'initial_line')), 1120000::bigint, 'reordering preserves first commercial snapshot');

select lives_ok($$
  insert into stable_results(key, value)
  select 'removed', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    5,
    'c5000000-0000-4000-8000-000000000006',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Removed first product',
      jsonb_build_array(jsonb_build_object(
        'line_id', (select value from stable_context where key = 'second_line'),
        'product_id', 'a2000000-0000-4000-8000-000000000002',
        'position', 1, 'quantity_scaled', 1250, 'quantity_scale', 1000
      )),
      jsonb_build_array(jsonb_build_object(
        'charge_id', (select value from stable_context where key = 'initial_charge'),
        'position', 1, 'charge_type', 'freight',
        'description', 'Stable freight revised', 'amount_minor', 12000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 'omitting an existing line removes it atomically');
select is(
  (select count(*)::integer from public.quote_items where id = (select value from stable_context where key = 'initial_line')),
  0,
  'removed stable line no longer exists'
);

reset role;
update public.products
set unit_price_minor = 1300000
where id = 'a2000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$
  insert into stable_results(key, value)
  select 'readded', public.save_quote_draft(
    (select value from stable_context where key = 'quote'),
    6,
    'c5000000-0000-4000-8000-000000000007',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'quote'),
      'Re-added product',
      jsonb_build_array(
        jsonb_build_object(
          'line_id', (select value from stable_context where key = 'second_line'),
          'product_id', 'a2000000-0000-4000-8000-000000000002',
          'position', 1, 'quantity_scaled', 1250, 'quantity_scale', 1000
        ),
        jsonb_build_object(
          'line_id', null,
          'product_id', 'a2000000-0000-4000-8000-000000000001',
          'position', 2, 'quantity_scaled', 1, 'quantity_scale', 1
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'charge_id', (select value from stable_context where key = 'initial_charge'),
        'position', 1, 'charge_type', 'freight',
        'description', 'Stable freight revised', 'amount_minor', 12000,
        'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
        'discount_applies', false
      ))
    )
  )
$$, 're-adding a removed product creates a fresh snapshot');

insert into stable_context(key, value)
select 'readded_line', item.id
from public.quote_items item
where item.quote_id = (select value from stable_context where key = 'quote')
  and item.product_id = 'a2000000-0000-4000-8000-000000000001';

select isnt(
  (select value from stable_context where key = 'readded_line'),
  (select value from stable_context where key = 'initial_line'),
  're-added product receives a fresh line ID'
);
select is(
  (select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'readded_line')),
  1300000::bigint,
  're-added product receives current catalog price'
);

select lives_ok($$
  with created as (
    select public.create_quote_draft(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'a3000000-0000-4000-8000-000000000001',
      'INR', 'en-IN', 'GST 18%', 'exclusive',
      '2026-07-23', '2026-08-23',
      'c5000000-0000-4000-8000-000000000008'
    ) result
  )
  insert into stable_context(key, value)
  select 'other_quote', (result ->> 'id')::uuid from created
$$, 'second same-organization draft is created');

select lives_ok($$
  insert into stable_results(key, value)
  select 'other_saved', public.save_quote_draft(
    (select value from stable_context where key = 'other_quote'),
    1,
    'c5000000-0000-4000-8000-000000000009',
    pg_temp.stable_payload(
      (select value from stable_context where key = 'other_quote'),
      'Other quote',
      jsonb_build_array(jsonb_build_object(
        'line_id', null,
        'product_id', 'a2000000-0000-4000-8000-000000000003',
        'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
      )),
      '[]'::jsonb
    )
  )
$$, 'second quote receives its own stable line');

insert into stable_context(key, value)
select 'other_line', item.id
from public.quote_items item
where item.quote_id = (select value from stable_context where key = 'other_quote');

select throws_ok(
  format(
    $statement$select public.save_quote_draft(
      %L::uuid, 7, 'c5000000-0000-4000-8000-000000000010',
      pg_temp.stable_payload(
        %L::uuid, 'Foreign line attempt',
        jsonb_build_array(jsonb_build_object(
          'line_id', %L::uuid,
          'product_id', 'a2000000-0000-4000-8000-000000000003',
          'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
        )),
        '[]'::jsonb
      )
    )$statement$,
    (select value from stable_context where key = 'quote'),
    (select value from stable_context where key = 'quote'),
    (select value from stable_context where key = 'other_line')
  ),
  '23503',
  null,
  'line ID belonging to another quote is rejected'
);
select is(
  (select version from public.quotes where id = (select value from stable_context where key = 'quote')),
  7,
  'rejected foreign-line save leaves quote version unchanged'
);
select is(
  (select count(*)::integer from public.quote_items where quote_id = (select value from stable_context where key = 'quote')),
  2,
  'rejected foreign-line save leaves all existing lines unchanged'
);

reset role;
insert into public.customers (
  id, organization_id, name, billing_country_code, locale,
  preferred_currency_code, tax_treatment, created_by
) values (
  'b3000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Other tenant customer', 'US', 'en-US', 'USD', 'standard',
  '44444444-4444-4444-8444-444444444444'
);
insert into public.quotes (
  id, organization_id, number, customer_id, currency_code, locale, tax_label,
  tax_mode, customer_tax_treatment, issue_date, valid_until, created_by
) values (
  'b5000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'TND-2026-9001',
  'b3000000-0000-4000-8000-000000000001',
  'USD', 'en-US', 'Tax', 'exclusive', 'standard',
  '2026-07-23', '2026-08-23',
  '44444444-4444-4444-8444-444444444444'
);
insert into public.quote_items (
  id, organization_id, quote_id, product_id, position, sku_snapshot,
  description_snapshot, unit_code_snapshot, quantity_precision_snapshot,
  unit_price_minor_snapshot, currency_code, quantity_scaled, quantity_scale,
  tax_code_snapshot, tax_bps_snapshot, tax_price_basis_snapshot,
  tax_treatment_snapshot, base_minor, discount_minor, net_minor, tax_minor,
  line_total_minor
) values (
  'b6000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'b5000000-0000-4000-8000-000000000001',
  null, 1, 'OTHER', 'Other tenant line', 'EA', 0, 100, 'USD', 1, 1,
  'OTHER_TAX', 500, 'exclusive', 'standard', 100, 0, 100, 5, 105
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  format(
    $statement$select public.save_quote_draft(
      %L::uuid, 7, 'c5000000-0000-4000-8000-000000000011',
      pg_temp.stable_payload(
        %L::uuid, 'Cross-tenant line attempt',
        jsonb_build_array(jsonb_build_object(
          'line_id', 'b6000000-0000-4000-8000-000000000001',
          'product_id', 'a2000000-0000-4000-8000-000000000001',
          'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
        )),
        '[]'::jsonb
      )
    )$statement$,
    (select value from stable_context where key = 'quote'),
    (select value from stable_context where key = 'quote')
  ),
  '23503',
  null,
  'line ID belonging to another organization is rejected'
);
select is(
  (select count(*)::integer from public.quote_items where quote_id = (select value from stable_context where key = 'quote')),
  2,
  'cross-tenant line rejection is atomic'
);

reset role;
update public.products
set unit_price_minor = 1400000
where id = 'a2000000-0000-4000-8000-000000000001';
update public.tax_profiles
set rate_bps = 2000,
    code = 'IN_GST20'
where id = 'a1000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into stable_results(key, value)
  select 'refreshed', public.refresh_quote_line_from_catalog(
    (select value from stable_context where key = 'quote'),
    (select value from stable_context where key = 'readded_line'),
    7,
    'c5000000-0000-4000-8000-000000000012'
  )
$$, 'explicit refresh updates the selected draft line');
select is(
  (select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'readded_line')),
  1400000::bigint,
  'explicit refresh applies current selected product price'
);
select is(
  (select tax_bps_snapshot from public.quote_items where id = (select value from stable_context where key = 'readded_line')),
  2000,
  'explicit refresh applies current selected tax rate'
);
select is(
  (select unit_price_minor_snapshot from public.quote_items where id = (select value from stable_context where key = 'second_line')),
  400000::bigint,
  'explicit refresh leaves every other line snapshot unchanged'
);
select is(
  (select tax_bps_snapshot from public.quote_charges where id = (select value from stable_context where key = 'initial_charge')),
  1800,
  'explicit line refresh leaves charge snapshot unchanged'
);
select is(
  (select version from public.quotes where id = (select value from stable_context where key = 'quote')),
  8,
  'explicit refresh increments quote version exactly once'
);
select is(
  (select count(*)::integer from public.quote_activity where quote_id = (select value from stable_context where key = 'quote') and event_type = 'draft.line_refreshed'),
  1,
  'explicit refresh appends one meaningful Activity row'
);
select is(
  (
    public.refresh_quote_line_from_catalog(
      (select value from stable_context where key = 'quote'),
      (select value from stable_context where key = 'readded_line'),
      7,
      'c5000000-0000-4000-8000-000000000012'
    ) ->> 'version'
  )::integer,
  8,
  'exact refresh replay returns original authoritative result'
);
select is(
  (select count(*)::integer from public.quote_activity where quote_id = (select value from stable_context where key = 'quote') and event_type = 'draft.line_refreshed'),
  1,
  'exact refresh replay does not duplicate Activity'
);
select is(
  (select value ->> 'tax_mode' from stable_results where key = 'refreshed'),
  'exclusive',
  'refresh result carries authoritative quote header projection'
);
select is(
  jsonb_array_length((select value -> 'items' from stable_results where key = 'refreshed')),
  2,
  'refresh result carries complete authoritative commercial projection'
);

select * from finish();
rollback;
