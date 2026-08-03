begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

select ok(to_regprocedure('public.is_supported_currency(text)') is not null, 'supported-currency predicate exists');
select ok(public.is_supported_currency('INR'), 'INR is supported');
select ok(public.is_supported_currency('USD'), 'USD is supported');
select ok(public.is_supported_currency('EUR'), 'EUR is supported');
select ok(public.is_supported_currency('GBP'), 'GBP is supported');
select ok(public.is_supported_currency('RUB'), 'RUB is supported');
select ok(not public.is_supported_currency('JPY'), 'JPY is unsupported');
select ok(not public.is_supported_currency('KWD'), 'KWD is unsupported');
select ok(not public.is_supported_currency('usd'), 'stored and calculation currency codes are canonical uppercase');

select lives_ok(
  $$select public.calculate_quote_payload('{"currency_code":"EUR","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[]}'::jsonb)$$,
  'a supported currency reaches the SQL calculation kernel'
);
select throws_ok(
  $$select public.calculate_quote_payload('{"currency_code":"JPY","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[]}'::jsonb)$$,
  '22023',
  'quote_calculation_currency_unsupported',
  'JPY is rejected by the SQL calculation kernel'
);
select throws_ok(
  $$select public.calculate_quote_payload('{"currency_code":"KWD","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[]}'::jsonb)$$,
  '22023',
  'quote_calculation_currency_unsupported',
  'KWD is rejected by the SQL calculation kernel'
);
select throws_ok(
  $$select public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Mixed","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"USD","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T0","tax_bps_snapshot":0,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb)$$,
  '22023',
  'mixed_item_currency',
  'mixed supported currencies remain rejected'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'organizations_supported_currency_check'),
  'organization default currency has an explicit supported-currency constraint'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'products_supported_currency_check'),
  'product currency has an explicit supported-currency constraint'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'customers_supported_currency_check'),
  'customer currency has an explicit supported-currency constraint'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'quotes_supported_currency_check'),
  'quote currency has an explicit supported-currency constraint'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'quote_items_supported_currency_check'),
  'quote item currency has an explicit supported-currency constraint'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'quote_charges_supported_currency_check'),
  'quote charge currency has an explicit supported-currency constraint'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"JPY-NOT-SUPPORTED","description":"Unsupported precision product","unit_code":"EA","quantity_precision":0,"unit_price_minor":100,"currency_code":"JPY","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c2100000-0000-4000-8000-000000000001'
  )$$,
  '23514',
  null,
  'product RPC rejects JPY'
);
select throws_ok(
  $$select public.create_customer(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"name":"KWD customer","contact_name":"","email":"","phone":"","billing_address_line1":"","billing_address_line2":"","billing_city":"","billing_region":"","billing_postal_code":"","billing_country_code":"KW","locale":"en-KW","preferred_currency_code":"KWD","tax_treatment":"standard","tax_identifier":null,"active":true}'::jsonb,
    'c2100000-0000-4000-8000-000000000002'
  )$$,
  '23514',
  null,
  'customer RPC rejects KWD'
);
select throws_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'JPY',
    'en-IN',
    'Tax',
    'exclusive',
    '2026-07-23',
    '2026-08-23',
    'c2100000-0000-4000-8000-000000000003'
  )$$,
  '23514',
  null,
  'quote creation rejects JPY'
);

select lives_ok(
  $$select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"LOWER-USD","description":"Normalized currency product","unit_code":"EA","quantity_precision":0,"unit_price_minor":100,"currency_code":"usd","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c2100000-0000-4000-8000-000000000004'
  )$$,
  'supported lowercase product currency is accepted at the human-entry boundary'
);
select is(
  (select currency_code::text from public.products where sku = 'LOWER-USD'),
  'USD',
  'human-entry product currency is normalized to uppercase'
);

select is(
  (public.prepare_catalog_import(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'unsupported-currency.csv',
    '[{"sku":"CSV-JPY","description":"Unsupported currency","unit_code":"EA","quantity_precision":"0","unit_price":"1.00","currency_code":"JPY","tax_code":"IN_GST18","active":"true"}]'::jsonb
  ) ->> 'invalid_count')::integer,
  1,
  'CSV review rejects an unsupported currency'
);
select is(
  (select error_codes[1] from public.catalog_import_rows where normalized_payload ->> 'sku' = 'CSV-JPY'),
  'CURRENCY_UNSUPPORTED',
  'CSV review returns a specific unsupported-currency code'
);
select is(
  (public.prepare_catalog_import(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'normalized-currency.csv',
    '[{"sku":"CSV-LOWER-USD","description":"Normalized currency","unit_code":"EA","quantity_precision":"0","unit_price":"1.00","currency_code":"usd","tax_code":"IN_GST18","active":"true"}]'::jsonb
  ) ->> 'valid_count')::integer,
  1,
  'CSV review accepts a supported lowercase human-entry currency'
);
select is(
  (select normalized_payload ->> 'currency_code' from public.catalog_import_rows where normalized_payload ->> 'sku' = 'CSV-LOWER-USD'),
  'USD',
  'CSV review stores the canonical uppercase currency'
);

reset role;
select throws_ok(
  $$update public.organizations set default_currency_code = 'JPY' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514',
  null,
  'organization table rejects unsupported currency independently of RPCs'
);
select throws_ok(
  $$update public.products set currency_code = 'KWD' where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'product table rejects unsupported currency independently of RPCs'
);

select * from finish();
rollback;
