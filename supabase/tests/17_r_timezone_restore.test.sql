begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select is(
  (
    select pg_catalog.pg_get_expr(attribute.adbin, attribute.adrelid)
    from pg_catalog.pg_attribute column_definition
    join pg_catalog.pg_attrdef attribute
      on attribute.adrelid = column_definition.attrelid
      and attribute.adnum = column_definition.attnum
    where column_definition.attrelid = 'public.organizations'::regclass
      and column_definition.attname = 'timezone'
      and not column_definition.attisdropped
  ),
  '''UTC''::text',
  'organization timezone retains the safe UTC default'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.organizations'::regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
        like '%is_valid_iana_timezone%'
  ),
  0,
  'organization_table_has_no_catalog_dependent_timezone_check'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select lives_ok(
  $$select public.create_organization(
    'R4 Timezone Organization',
    'r4-timezone-organization',
    'c4000000-0000-4000-8000-000000000001'
  )$$,
  'organization creation accepts its validated safe timezone default'
);

select is(
  (
    select organization.timezone
    from public.organizations organization
    where organization.slug = 'r4-timezone-organization'
  ),
  'UTC',
  'organization creation persists the safe UTC timezone'
);

select ok(
  public.is_valid_iana_timezone(
    (
      select organization.timezone
      from public.organizations organization
      where organization.slug = 'r4-timezone-organization'
    )
  ),
  'organization creation persists a catalog-valid timezone'
);

select lives_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select version from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    '{"name":"Tender Demonstration Company","default_currency_code":"INR","default_locale":"en-IN","timezone":"Europe/Berlin","approval_threshold_bps":1000}'::jsonb,
    'c4000000-0000-4000-8000-000000000002'
  )$$,
  'valid_iana_timezone_accepted_by_rpc'
);

select is(
  (
    select organization.timezone
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'Europe/Berlin',
  'organization settings RPC persists the valid timezone'
);

select throws_ok(
  $$select public.update_organization_settings(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select version from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    '{"name":"Tender Demonstration Company","default_currency_code":"INR","default_locale":"en-IN","timezone":"Mars/Olympus","approval_threshold_bps":1000}'::jsonb,
    'c4000000-0000-4000-8000-000000000003'
  )$$,
  '22023',
  'organization_timezone_invalid',
  'invalid_timezone_rejected_by_rpc'
);

select is(
  (
    select organization.timezone
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'Europe/Berlin',
  'invalid timezone attempt leaves the valid value unchanged'
);

select throws_ok(
  $$update public.organizations
    set timezone = 'UTC'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'direct_timezone_update_denied'
);

select * from finish();
rollback;
