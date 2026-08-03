begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

select ok(
  to_regprocedure('public.search_products(uuid,text,text,integer,integer)') is not null,
  'bounded product search RPC exists'
);
select ok(
  to_regprocedure('public.search_customers(uuid,text,text,integer,integer)') is not null,
  'bounded customer search RPC exists'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::integer from public.search_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '', 'active', 100, 0)),
  3,
  'empty active-product search is tenant-scoped and bounded'
);
select is(
  (select count(*)::integer from public.search_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PCA', 'active', 100, 0)),
  1,
  'product search finds a literal SKU fragment'
);
select is(
  (select count(*)::integer from public.search_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '%', 'active', 100, 0)),
  0,
  'percent is literal product search text rather than a wildcard'
);
select is(
  (select count(*)::integer from public.search_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '_', 'active', 100, 0)),
  0,
  'underscore is literal product search text rather than a wildcard'
);
select throws_ok(
  $$select * from public.search_products(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repeat('x', 101),
    'active',
    100,
    0
  )$$,
  '22023',
  'search_query_invalid',
  'overlong product search text is rejected'
);
select throws_ok(
  $$select * from public.search_products(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '',
    'active',
    101,
    0
  )$$,
  '22023',
  'search_bounds_invalid',
  'product result limits are bounded'
);
select is(
  (select count(*)::integer from public.search_customers('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Asha', 'active', 100, 0)),
  1,
  'customer search finds a literal name fragment'
);
select is(
  (select count(*)::integer from public.search_customers('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'asha', 'active', 100, 0)),
  1,
  'customer search is case-insensitive'
);
select is(
  (select count(*)::integer from public.search_customers('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '%', 'active', 100, 0)),
  0,
  'percent is literal customer search text rather than a wildcard'
);
select is(
  (select count(*)::integer from public.search_customers('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '', 'inactive', 100, 0)),
  0,
  'active-state customer filtering is explicit'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$select * from public.search_customers(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '',
    'active',
    100,
    0
  )$$,
  '42501',
  'customer_search_forbidden',
  'another tenant cannot search organization customers'
);

select * from finish();
rollback;
