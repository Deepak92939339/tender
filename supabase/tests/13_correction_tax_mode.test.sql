begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select ok(
  not has_function_privilege('authenticated', 'public.calculate_quote_payload(jsonb)', 'execute'),
  'authenticated_cannot_execute_authoritative_calculator'
);
select ok(
  not has_function_privilege('authenticated', 'public.calculate_quote_payload_c2_legacy_impl(jsonb)', 'execute'),
  'authenticated cannot bypass quote tax mode through the legacy calculator'
);

select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) ->> 'total_minor')::bigint,
  139::bigint,
  'exclusive quote mode adds tax to the line amount'
);
select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"inclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) ->> 'total_minor')::bigint,
  118::bigint,
  'inclusive quote mode extracts tax from the line amount'
);
select isnt(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) ->> 'total_minor')::bigint,
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"inclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) ->> 'total_minor')::bigint,
  'exclusive and inclusive quote modes produce distinct correct totals'
);
select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"inclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) ->> 'total_minor')::bigint,
  139::bigint,
  'legacy line price basis cannot override exclusive quote mode'
);
select is(
  public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Line","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"inclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb
  ) -> 'items' -> 0 ->> 'tax_price_basis_snapshot',
  'exclusive',
  'item projection records the applied quote basis'
);
select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[{"position":1,"charge_type":"freight","description_snapshot":"Freight","amount_minor":100,"currency_code":"INR","tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"inclusive","tax_treatment_snapshot":"standard","discount_applies":false}]}'::jsonb
  ) ->> 'total_minor')::bigint,
  118::bigint,
  'exclusive quote mode applies to charges'
);
select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"inclusive","discount_bps":0,"items":[],"charges":[{"position":1,"charge_type":"freight","description_snapshot":"Freight","amount_minor":118,"currency_code":"INR","tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard","discount_applies":false}]}'::jsonb
  ) ->> 'total_minor')::bigint,
  118::bigint,
  'inclusive quote mode applies to charges'
);
select is(
  (public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"inclusive","discount_bps":0,"items":[],"charges":[{"position":1,"charge_type":"freight","description_snapshot":"Freight","amount_minor":118,"currency_code":"INR","tax_code_snapshot":"EX","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"exempt","discount_applies":false}]}'::jsonb
  ) ->> 'tax_minor')::bigint,
  0::bigint,
  'non-collecting charge treatment remains zero tax'
);

reset role;
update public.tax_profiles
set price_basis = 'inclusive'
where id = 'a1000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

create temporary table tax_mode_quote as
select (public.create_quote_draft(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a3000000-0000-4000-8000-000000000001',
  'INR',
  'en-IN',
  'GST',
  'exclusive',
  public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()),
  public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()) + 30,
  'c2400000-0000-4000-8000-000000000001'
) ->> 'id')::uuid as id;

select lives_ok(
  $$select public.save_quote_draft(
    (select id from tax_mode_quote),
    1,
    'c2400000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR',
      'locale', 'en-IN',
      'tax_label', 'GST',
      'tax_mode', 'exclusive',
      'discount_bps', 0,
      'issue_date', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()),
      'valid_until', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()) + 30,
      'notes', '',
      'items', '[{"line_id":null,"product_id":"a2000000-0000-4000-8000-000000000001","position":1,"quantity_scaled":1,"quantity_scale":1}]'::jsonb,
      'charges', '[]'::jsonb
    )
  )$$,
  'exclusive draft save succeeds even when legacy profile basis is inclusive'
);
select is((select tax_price_basis_snapshot::text from public.quote_items where quote_id = (select id from tax_mode_quote)), 'exclusive', 'saved item snapshots quote exclusive basis');
select is((select total_minor from public.quotes where id = (select id from tax_mode_quote)), 1321600::bigint, 'saved exclusive quote total uses quote mode');

select lives_ok(
  $$select public.save_quote_draft(
    (select id from tax_mode_quote),
    2,
    'c2400000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR',
      'locale', 'en-IN',
      'tax_label', 'GST',
      'tax_mode', 'inclusive',
      'discount_bps', 0,
      'issue_date', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()),
      'valid_until', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()) + 30,
      'notes', '',
      'items', jsonb_build_array(jsonb_build_object(
        'line_id', (select id from public.quote_items where quote_id = (select id from tax_mode_quote)),
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1,
        'quantity_scaled', 1,
        'quantity_scale', 1
      )),
      'charges', '[]'::jsonb
    )
  )$$,
  'inclusive draft save succeeds'
);
select is((select tax_price_basis_snapshot::text from public.quote_items where quote_id = (select id from tax_mode_quote)), 'inclusive', 'saved item snapshots quote inclusive basis');
select is((select total_minor from public.quotes where id = (select id from tax_mode_quote)), 1120000::bigint, 'saved inclusive quote total uses quote mode');

reset role;
update public.tax_profiles
set price_basis = 'exclusive'
where id = 'a1000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.save_quote_draft(
    (select id from tax_mode_quote),
    3,
    'c2400000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR',
      'locale', 'en-IN',
      'tax_label', 'GST',
      'tax_mode', 'inclusive',
      'discount_bps', 0,
      'issue_date', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()),
      'valid_until', public.organization_local_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', statement_timestamp()) + 30,
      'notes', 'legacy profile changed',
      'items', jsonb_build_array(jsonb_build_object(
        'line_id', (select id from public.quote_items where quote_id = (select id from tax_mode_quote)),
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1,
        'quantity_scaled', 1,
        'quantity_scale', 1
      )),
      'charges', '[]'::jsonb
    )
  )$$,
  'legacy profile basis change cannot alter inclusive quote calculation'
);
select is((select total_minor from public.quotes where id = (select id from tax_mode_quote)), 1120000::bigint, 'inclusive total remains stable after legacy profile basis change');
select is((select tax_mode::text from public.quotes where id = (select id from tax_mode_quote)), 'inclusive', 'quote stores the authoritative basis used by print labels');

select * from finish();
rollback;
