begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

select is(
  (
    with browser_definer(signature) as (
      values
        ('approve_quote(uuid,integer,uuid)'),
        ('archive_customer(uuid,integer,uuid)'),
        ('archive_product(uuid,integer,uuid)'),
        ('archive_tax_profile(uuid,integer,uuid)'),
        ('archive_tax_profile(uuid,integer,uuid,uuid)'),
        ('commit_catalog_import(uuid,boolean,uuid)'),
        ('create_customer(uuid,jsonb,uuid)'),
        ('create_organization(text,text,uuid)'),
        ('create_product(uuid,jsonb,uuid)'),
        ('create_quote_draft(uuid,uuid,text,text,text,tax_price_basis,date,date,uuid)'),
        ('create_tax_profile(uuid,jsonb,uuid)'),
        ('has_org_capability(uuid,text)'),
        ('is_active_org_member(uuid)'),
        ('issue_quote(uuid,integer,uuid)'),
        ('prepare_catalog_import(uuid,text,jsonb)'),
        ('refresh_quote_line_from_catalog(uuid,uuid,integer,uuid)'),
        ('reject_quote(uuid,integer,uuid,text)'),
        ('save_quote_draft(uuid,integer,uuid,jsonb)'),
        ('search_customers(uuid,text,text,integer,integer)'),
        ('search_products(uuid,text,text,integer,integer)'),
        ('submit_quote(uuid,integer,uuid)'),
        ('update_customer(uuid,integer,jsonb,uuid)'),
        ('update_organization_settings(uuid,integer,jsonb,uuid)'),
        ('update_product(uuid,integer,jsonb,uuid)'),
        ('update_tax_profile(uuid,integer,jsonb,uuid)')
    )
    select count(*)::integer
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prosecdef
      and routine.oid::regprocedure::text not in (
        select signature from browser_definer
      )
      and (
        has_function_privilege('authenticated', routine.oid, 'EXECUTE')
        or has_function_privilege('anon', routine.oid, 'EXECUTE')
      )
  ),
  0,
  'internal_security_definer_helpers_remain_revoked'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  0,
  'blanket FORCE RLS is not claimed by the current guard model'
);

create temporary table r4_guard_quote (
  id uuid primary key
);
grant all on r4_guard_quote to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into r4_guard_quote (id)
    select (
      public.create_quote_draft(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a3000000-0000-4000-8000-000000000001',
        'INR',
        'en-IN',
        'GST',
        'exclusive',
        public.organization_local_date(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          statement_timestamp()
        ),
        public.organization_local_date(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          statement_timestamp()
        ) + 30,
        'c4000000-0000-4000-8000-000000000010'
      ) ->> 'id'
    )::uuid$$,
  'same-organization setup creates the quote used by cross-org proof'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select throws_ok(
  $$select public.archive_product(
    'a2000000-0000-4000-8000-000000000001',
    1,
    'c4000000-0000-4000-8000-000000000011'
  )$$,
  '42501',
  'product_archive_forbidden',
  'cross_organization_product_mutation_denied'
);

select throws_ok(
  $$select public.archive_customer(
    'a3000000-0000-4000-8000-000000000001',
    1,
    'c4000000-0000-4000-8000-000000000012'
  )$$,
  '42501',
  'customer_archive_forbidden',
  'cross_organization_customer_mutation_denied'
);

select throws_ok(
  $$select public.archive_tax_profile(
    'a1000000-0000-4000-8000-000000000001',
    1,
    'c4000000-0000-4000-8000-000000000013'
  )$$,
  '42501',
  'tax_profile_archive_forbidden',
  'cross_organization_tax_profile_mutation_denied'
);

select throws_ok(
  $$select public.submit_quote(
    (select id from r4_guard_quote),
    1,
    'c4000000-0000-4000-8000-000000000014'
  )$$,
  '42501',
  'quote_submit_forbidden',
  'cross_organization_quote_mutation_denied'
);

select throws_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    '{"name":"Cross-organization overwrite","default_currency_code":"INR","default_locale":"en-IN","timezone":"UTC","approval_threshold_bps":1000}'::jsonb,
    'c4000000-0000-4000-8000-000000000015'
  )$$,
  '42501',
  'organization_settings_update_forbidden',
  'cross_organization_settings_mutation_denied'
);

reset role;

select is(
  (
    select product.active::text || ':' || product.version::text
    from public.products product
    where product.id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'true:1',
  'denied cross-org product mutation changes no state'
);

select is(
  (
    select customer.active::text || ':' || customer.version::text
    from public.customers customer
    where customer.id = 'a3000000-0000-4000-8000-000000000001'
  ),
  'true:1',
  'denied cross-org customer mutation changes no state'
);

select is(
  (
    select profile.active::text || ':' || profile.version::text
    from public.tax_profiles profile
    where profile.id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'true:1',
  'denied cross-org tax-profile mutation changes no state'
);

select is(
  (
    select quote.state::text || ':' || quote.version::text
    from public.quotes quote
    where quote.id = (select id from r4_guard_quote)
  ),
  'draft:1',
  'denied cross-org quote mutation changes no state'
);

select is(
  (
    select organization.version::text || ':' || organization.timezone
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  '1:Asia/Kolkata',
  'denied cross-org settings mutation changes no state'
);

select * from finish();
rollback;
