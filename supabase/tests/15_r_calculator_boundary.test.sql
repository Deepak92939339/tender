begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.calculate_quote_payload(jsonb)',
    'execute'
  ),
  'authenticated_cannot_execute_authoritative_calculator'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.calculate_quote_payload(jsonb)',
    'execute'
  ),
  'anon_cannot_execute_authoritative_calculator'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) privilege
    where routine.oid = 'public.calculate_quote_payload(jsonb)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public_cannot_execute_authoritative_calculator'
);

set local role authenticated;
select throws_ok(
  $$select public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[]}'::jsonb
  )$$,
  '42501',
  null,
  'authenticated calculator call is denied at execution'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.calculate_quote_payload(
    '{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[],"charges":[]}'::jsonb
  )$$,
  '42501',
  null,
  'anon calculator call is denied at execution'
);
reset role;

select set_eq(
  $actual$
    select routine.oid::regprocedure::text
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and has_function_privilege('authenticated', routine.oid, 'EXECUTE')
  $actual$,
  $expected$
    select signature
    from (
      values
        ('approve_quote(uuid,integer,uuid)'),
        ('approve_quote_revision(uuid,uuid,integer,uuid)'),
        ('archive_customer(uuid,integer,uuid)'),
        ('archive_product(uuid,integer,uuid)'),
        ('archive_tax_profile(uuid,integer,uuid)'),
        ('archive_tax_profile(uuid,integer,uuid,uuid)'),
        ('commit_catalog_import(uuid,boolean,uuid)'),
        ('create_customer(uuid,jsonb,uuid)'),
        ('create_organization(text,text,uuid)'),
        ('create_product(uuid,jsonb,uuid)'),
        ('create_quote_draft(uuid,uuid,text,text,text,tax_price_basis,date,date,uuid)'),
        ('create_quote_share_link(uuid,uuid,integer,text,timestamp with time zone,uuid)'),
        ('create_verified_quote_draft(uuid,uuid,text,text,text,tax_price_basis,date,date,uuid)'),
        ('create_tax_profile(uuid,jsonb,uuid)'),
        ('has_org_capability(uuid,text)'),
        ('is_active_org_member(uuid)'),
        ('is_valid_iana_timezone(text)'),
        ('issue_quote(uuid,integer,uuid)'),
        ('issue_quote_revision(uuid,uuid,integer,uuid)'),
        ('organization_local_date(uuid,timestamp with time zone)'),
        ('prepare_catalog_import(uuid,text,jsonb)'),
        ('quote_effective_state(quote_state,date,text,timestamp with time zone)'),
        ('refresh_quote_line_from_catalog(uuid,uuid,integer,uuid)'),
        ('begin_quote_revision(uuid,uuid,integer,uuid)'),
        ('reject_quote(uuid,integer,uuid,text)'),
        ('reject_quote_revision(uuid,uuid,integer,uuid,text)'),
        ('revoke_quote_share_link(uuid,uuid,integer,uuid)'),
        ('round_nonnegative_ratio(numeric,numeric,numeric)'),
        ('save_quote_draft(uuid,integer,uuid,jsonb)'),
        ('search_customers(uuid,text,text,integer,integer)'),
        ('search_products(uuid,text,text,integer,integer)'),
        ('submit_quote(uuid,integer,uuid)'),
        ('submit_quote_revision(uuid,uuid,integer,uuid)'),
        ('start_verified_revision_from_legacy_quote(uuid,integer,uuid)'),
        ('update_customer(uuid,integer,jsonb,uuid)'),
        ('update_organization_settings(uuid,integer,jsonb,uuid)'),
        ('update_product(uuid,integer,jsonb,uuid)'),
        ('update_tax_profile(uuid,integer,jsonb,uuid)'),
        ('validate_quantity(text,integer,bigint,bigint)')
    ) expected(signature)
  $expected$,
  'authenticated executable routines match the committed R allowlist'
);

select * from finish();
rollback;
