begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(43);

select ok(to_regprocedure('public.create_product(uuid,jsonb,uuid)') is not null, 'product create RPC exists');
select ok(to_regprocedure('public.update_product(uuid,integer,jsonb,uuid)') is not null, 'product update RPC exists');
select ok(to_regprocedure('public.archive_product(uuid,integer,uuid)') is not null, 'product archive RPC exists');
select ok(to_regprocedure('public.create_customer(uuid,jsonb,uuid)') is not null, 'customer create RPC exists');
select ok(to_regprocedure('public.update_customer(uuid,integer,jsonb,uuid)') is not null, 'customer update RPC exists');
select ok(to_regprocedure('public.archive_customer(uuid,integer,uuid)') is not null, 'customer archive RPC exists');
select ok(to_regprocedure('public.create_tax_profile(uuid,jsonb,uuid)') is not null, 'tax-profile create RPC exists');
select ok(to_regprocedure('public.update_tax_profile(uuid,integer,jsonb,uuid)') is not null, 'tax-profile update RPC exists');
select ok(to_regprocedure('public.archive_tax_profile(uuid,integer,uuid)') is not null, 'tax-profile archive RPC exists');
select ok(to_regprocedure('public.update_organization_settings(uuid,integer,jsonb,uuid)') is not null, 'organization settings update RPC exists');

select ok(not has_table_privilege('authenticated', 'public.products', 'insert'), 'authenticated has no direct product insert grant');
select ok(not has_table_privilege('authenticated', 'public.customers', 'update'), 'authenticated has no direct customer update grant');
select ok(not has_table_privilege('authenticated', 'public.tax_profiles', 'insert'), 'authenticated has no direct tax-profile insert grant');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'update'), 'authenticated has no direct organization update grant');
select ok(not has_column_privilege('authenticated', 'public.products', 'sku', 'insert'), 'authenticated has no product insert column grant');
select ok(not has_column_privilege('authenticated', 'public.customers', 'name', 'update'), 'authenticated has no customer update column grant');
select ok(not has_column_privilege('authenticated', 'public.tax_profiles', 'code', 'insert'), 'authenticated has no tax-profile insert column grant');
select ok(not has_column_privilege('authenticated', 'public.organizations', 'name', 'update'), 'authenticated has no organization update column grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"RPC-C1","description":"RPC-owned product","unit_code":"KG","quantity_precision":3,"unit_price_minor":1234,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000001'
  )$$,
  'product creation is owned by the command RPC'
);
select is((select version from public.products where sku = 'RPC-C1'), 1, 'created product starts at version one');
select is(
  public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"RPC-C1","description":"RPC-owned product","unit_code":"KG","quantity_precision":3,"unit_price_minor":1234,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000001'
  ) ->> 'id',
  (select id::text from public.products where sku = 'RPC-C1'),
  'an exact product-create replay returns the original product'
);
select throws_ok(
  $$select public.create_product(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sku":"RPC-C1-CHANGED","description":"Changed command meaning","unit_code":"EA","quantity_precision":0,"unit_price_minor":1,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'command_id_collision',
  'product-create command IDs reject changed semantics'
);
select lives_ok(
  $$select public.update_product(
    (select id from public.products where sku = 'RPC-C1'),
    1,
    '{"sku":"RPC-C1","description":"RPC-owned product updated","unit_code":"KG","quantity_precision":3,"unit_price_minor":2345,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000002'
  )$$,
  'product update is versioned by RPC'
);
select is((select version from public.products where sku = 'RPC-C1'), 2, 'product update increments the version');
select throws_ok(
  $$select public.update_product(
    (select id from public.products where sku = 'RPC-C1'),
    1,
    '{"sku":"RPC-C1","description":"stale overwrite","unit_code":"KG","quantity_precision":3,"unit_price_minor":1,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'product_version_stale',
  'stale product updates are rejected'
);
select lives_ok(
  $$select public.archive_product(
    (select id from public.products where sku = 'RPC-C1'),
    2,
    'c3000000-0000-4000-8000-000000000004'
  )$$,
  'product archive is versioned by RPC'
);
select is((select active from public.products where sku = 'RPC-C1'), false, 'product archive is a non-destructive active-state change');

select lives_ok(
  $$select public.create_customer(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"name":"RPC Customer","contact_name":"Bounded Contact","email":"rpc@example.test","phone":"+91 100","billing_address_line1":"1 RPC Road","billing_address_line2":"","billing_city":"Pune","billing_region":"Maharashtra","billing_postal_code":"411001","billing_country_code":"IN","locale":"en-IN","preferred_currency_code":"INR","tax_treatment":"standard","tax_identifier":"C1-TAX-ID","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000010'
  )$$,
  'customer creation is owned by the command RPC'
);
select is((select version from public.customers where name = 'RPC Customer'), 1, 'created customer starts at version one');
select lives_ok(
  $$select public.update_customer(
    (select id from public.customers where name = 'RPC Customer'),
    1,
    '{"name":"RPC Customer","contact_name":"Updated Contact","email":"rpc@example.test","phone":"+91 200","billing_address_line1":"1 RPC Road","billing_address_line2":"","billing_city":"Pune","billing_region":"Maharashtra","billing_postal_code":"411001","billing_country_code":"IN","locale":"en-IN","preferred_currency_code":"INR","tax_treatment":"standard","tax_identifier":"C1-TAX-ID","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000011'
  )$$,
  'customer update is versioned by RPC'
);
select is((select version from public.customers where name = 'RPC Customer'), 2, 'customer update increments the version');
select lives_ok(
  $$select public.archive_customer(
    (select id from public.customers where name = 'RPC Customer'),
    2,
    'c3000000-0000-4000-8000-000000000012'
  )$$,
  'customer archive is versioned by RPC'
);
select is((select active from public.customers where name = 'RPC Customer'), false, 'customer archive is non-destructive');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select lives_ok(
  $$select public.create_tax_profile(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"code":"C1_TAX","label":"Correction tax","jurisdiction_country_code":"IN","rate_bps":500,"treatment":"standard","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000020'
  )$$,
  'tax-profile creation is owned by the command RPC'
);
select is((select version from public.tax_profiles where code = 'C1_TAX'), 1, 'created tax profile starts at version one');
select lives_ok(
  $$select public.update_tax_profile(
    (select id from public.tax_profiles where code = 'C1_TAX'),
    1,
    '{"code":"C1_TAX","label":"Correction tax updated","jurisdiction_country_code":"IN","rate_bps":600,"treatment":"standard","active":true}'::jsonb,
    'c3000000-0000-4000-8000-000000000021'
  )$$,
  'tax-profile update is versioned by RPC'
);
select is((select version from public.tax_profiles where code = 'C1_TAX'), 2, 'tax-profile update increments the version');
select lives_ok(
  $$select public.archive_tax_profile(
    (select id from public.tax_profiles where code = 'C1_TAX'),
    2,
    'c3000000-0000-4000-8000-000000000022'
  )$$,
  'tax-profile archive is versioned by RPC'
);
select is((select active from public.tax_profiles where code = 'C1_TAX'), false, 'tax-profile archive is non-destructive');

select lives_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    '{"name":"Tender Demonstration Company Updated","default_currency_code":"INR","default_locale":"en-IN","approval_threshold_bps":1200}'::jsonb,
    'c3000000-0000-4000-8000-000000000030'
  )$$,
  'organization settings update is versioned by RPC'
);
select is(
  (select version from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2,
  'organization settings update increments the version'
);
select throws_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    '{"name":"Changed command meaning","default_currency_code":"INR","default_locale":"en-IN","approval_threshold_bps":1300}'::jsonb,
    'c3000000-0000-4000-8000-000000000030'
  )$$,
  '22023',
  'command_id_collision',
  'organization-setting command IDs reject changed semantics'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    2,
    '{"name":"Operator overwrite","default_currency_code":"INR","default_locale":"en-IN","approval_threshold_bps":1000}'::jsonb,
    'c3000000-0000-4000-8000-000000000031'
  )$$,
  '42501',
  'organization_settings_update_forbidden',
  'an operator cannot call organization settings mutation RPC'
);

select * from finish();
rollback;
