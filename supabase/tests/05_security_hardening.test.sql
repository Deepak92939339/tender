begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

select is((
  select count(*)::integer
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relkind = 'r'
    and relation.relname in (
      'profiles','organizations','roles','capabilities','role_capabilities',
      'organization_memberships','command_receipts','tax_profiles','products',
      'customers','catalog_import_batches','catalog_import_rows','quote_sequences',
      'quotes','quote_items','quote_charges','quote_activity'
    ) and relation.relrowsecurity
), 17, 'all 17 Milestone A application tables have RLS enabled');

select is((
  select count(*)::integer from pg_catalog.pg_proc function
  join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
  where namespace.nspname = 'public' and function.prosecdef
    and not exists (
      select 1 from unnest(coalesce(function.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
    )
), 0, 'every public SECURITY DEFINER function has an explicit search_path');

select is((
  select count(*)::integer from pg_catalog.pg_proc function
  join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
  cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) acl
  where namespace.nspname = 'public' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
), 0, 'PUBLIC has execute on no public-schema function');

select ok(not has_function_privilege('anon', 'public.submit_quote(uuid,integer,uuid)', 'EXECUTE'), 'anon cannot execute submit');
select ok(not has_function_privilege('anon', 'public.create_organization(text,text,uuid)', 'EXECUTE'), 'anon cannot execute organization creation');
select ok(has_function_privilege('authenticated', 'public.create_organization(text,text,uuid)', 'EXECUTE'), 'authenticated can execute organization creation');
select ok(has_function_privilege('authenticated', 'public.save_quote_draft(uuid,integer,uuid,jsonb)', 'EXECUTE'), 'authenticated can execute draft save');
select ok(has_function_privilege('authenticated', 'public.submit_quote(uuid,integer,uuid)', 'EXECUTE'), 'authenticated can execute submit through server authorization');
select ok(has_function_privilege('authenticated', 'public.approve_quote(uuid,integer,uuid)', 'EXECUTE'), 'authenticated can execute approve through server authorization');
select ok(has_function_privilege('authenticated', 'public.reject_quote(uuid,integer,uuid,text)', 'EXECUTE'), 'authenticated can execute reject through server authorization');
select ok(has_function_privilege('authenticated', 'public.issue_quote(uuid,integer,uuid)', 'EXECUTE'), 'authenticated can execute issue through server authorization');
select ok(not has_function_privilege('authenticated', 'public.next_quote_number(uuid,date)', 'EXECUTE'), 'authenticated cannot call internal numbering helper');
select ok(not has_function_privilege('authenticated', 'public.quote_actor(uuid)', 'EXECUTE'), 'authenticated cannot call internal actor helper');
select ok(not has_function_privilege('authenticated', 'public.recalculate_quote(uuid,uuid)', 'EXECUTE'), 'authenticated cannot call internal recalculation helper');

select ok(not has_column_privilege('authenticated', 'public.products', 'description', 'UPDATE'), 'product description is mutable only through an authorized RPC');
select ok(not has_column_privilege('authenticated', 'public.products', 'organization_id', 'UPDATE'), 'product organization is immutable to browser roles');
select ok(not has_column_privilege('authenticated', 'public.products', 'created_by', 'UPDATE'), 'product creator provenance is immutable to browser roles');
select ok(not has_column_privilege('authenticated', 'public.products', 'version', 'UPDATE'), 'product version is trigger authority');
select ok(not has_column_privilege('authenticated', 'public.customers', 'name', 'UPDATE'), 'customer name is mutable only through an authorized RPC');
select ok(not has_column_privilege('authenticated', 'public.customers', 'organization_id', 'UPDATE'), 'customer organization is immutable to browser roles');
select ok(not has_column_privilege('authenticated', 'public.customers', 'created_by', 'UPDATE'), 'customer creator provenance is immutable to browser roles');
select ok(not has_column_privilege('authenticated', 'public.customers', 'version', 'UPDATE'), 'customer version is trigger authority');
select ok(not has_column_privilege('authenticated', 'public.tax_profiles', 'label', 'UPDATE'), 'tax profile label is mutable only through an authorized RPC');
select ok(not has_column_privilege('authenticated', 'public.tax_profiles', 'organization_id', 'UPDATE'), 'tax profile organization is immutable to browser roles');
select is((select count(*)::integer from pg_catalog.pg_proc function join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace where namespace.nspname = 'public' and upper(function.prosrc) like '%EXECUTE %'), 0, 'public functions contain no dynamic SQL EXECUTE');

select * from finish();
rollback;
