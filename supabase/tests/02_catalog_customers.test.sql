begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select ok(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'catalog.manage'), 'operator receives catalog.manage through role capabilities');

select throws_ok($$
  select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"PCA-220","description":"Duplicate","unit_code":"EA","quantity_precision":0,"unit_price_minor":100,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'a2000000-0000-4000-8000-000000000101'
  )
$$, '23505', null, 'duplicate organization SKU is blocked through the mutation RPC');

select throws_ok($$
  select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"BAD-EA","description":"Fractional each","unit_code":"EA","quantity_precision":3,"unit_price_minor":100,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'a2000000-0000-4000-8000-000000000102'
  )
$$, '22023', 'product_payload_invalid', 'fractional EA precision is rejected by the mutation RPC');

select lives_ok($$
  select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"GOOD-M","description":"Fractional metre","unit_code":"M","quantity_precision":3,"unit_price_minor":100,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'a2000000-0000-4000-8000-000000000103'
  )
$$, 'fractional metre precision is accepted through the mutation RPC');

select throws_ok($$
  select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"CROSS-TAX","description":"Cross tenant tax","unit_code":"EA","quantity_precision":0,"unit_price_minor":100,"currency_code":"INR","tax_profile_id":"b1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'a2000000-0000-4000-8000-000000000104'
  )
$$, '23503', 'product_tax_profile_invalid', 'cross-organization tax profile reference is blocked by the mutation RPC');

select lives_ok($$
  select public.create_customer(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"name":"<img src=x onerror=alert(1)>","contact_name":"<script>contact</script>","email":"safe@example.test","phone":"","billing_address_line1":"","billing_address_line2":"","billing_city":"","billing_region":"","billing_postal_code":"","billing_country_code":"IN","locale":"en-IN","preferred_currency_code":"INR","tax_treatment":"standard","tax_identifier":null,"active":true}'::jsonb,
    'a3000000-0000-4000-8000-000000000101'
  )
$$, 'malicious-looking customer text remains inert data through the mutation RPC');
select is((select name from public.customers where name like '<img%'), '<img src=x onerror=alert(1)>', 'untrusted customer text round-trips exactly as data');

select is(
  (public.prepare_catalog_import(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a2-review.csv',
    '[{"sku":"CSV-A2-1","description":"=SUM(A1:A2) remains text","unit_code":"KG","quantity_precision":"3","unit_price":"12.34","currency_code":"INR","tax_code":"IN_GST18","active":"true"},{"sku":"CSV-A2-2","description":"Invalid tax","unit_code":"EA","quantity_precision":"0","unit_price":"3.00","currency_code":"INR","tax_code":"UNKNOWN","active":"true"}]'::jsonb
  )->>'valid_count')::integer,
  1,
  'server CSV review identifies the valid row'
);
select is(
  (public.prepare_catalog_import(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'renamed.csv',
    '[{"sku":"CSV-A2-1","description":"=SUM(A1:A2) remains text","unit_code":"KG","quantity_precision":"3","unit_price":"12.34","currency_code":"INR","tax_code":"IN_GST18","active":"true"},{"sku":"CSV-A2-2","description":"Invalid tax","unit_code":"EA","quantity_precision":"0","unit_price":"3.00","currency_code":"INR","tax_code":"UNKNOWN","active":"true"}]'::jsonb
  )->>'batch_id'),
  (select id::text from public.catalog_import_batches where filename = 'a2-review.csv'),
  'normalized content hash makes repeated CSV review idempotent'
);
select is((select count(*)::integer from public.catalog_import_batches where filename = 'a2-review.csv'), 1, 'idempotent preview creates one batch');

select throws_ok(
  format(
    'select public.commit_catalog_import(%L, false, %L)',
    (select id from public.catalog_import_batches where filename = 'a2-review.csv'),
    '90000000-0000-4000-8000-000000000021'
  ),
  '22023', 'partial_confirmation_required',
  'partial catalog import requires explicit confirmation'
);
select lives_ok(
  format(
    'select public.commit_catalog_import(%L, true, %L)',
    (select id from public.catalog_import_batches where filename = 'a2-review.csv'),
    '90000000-0000-4000-8000-000000000022'
  ),
  'explicit partial import commits valid rows'
);
select is((select count(*)::integer from public.products where sku = 'CSV-A2-1'), 1, 'partial import creates exactly one valid product');
select is((select description from public.products where sku = 'CSV-A2-1'), '=SUM(A1:A2) remains text', 'formula-like CSV cell remains inert text');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::integer from public.products where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'other organization cannot read products');
select is((select count(*)::integer from public.customers where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'other organization cannot read customers');

reset role;
update public.organization_memberships set status = 'suspended' where user_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::integer from public.products), 0, 'suspended member cannot read catalog data');

select * from finish();
rollback;
