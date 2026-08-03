\pset pager off
\pset null '(null)'
begin read only;

\echo === ROUTINE SUMMARY ===
with routines as (
  select
    routine.oid,
    routine.prosecdef,
    has_function_privilege(
      'authenticated',
      routine.oid,
      'EXECUTE'
    ) as authenticated_execute,
    has_function_privilege(
      'anon',
      routine.oid,
      'EXECUTE'
    ) as anon_execute,
    exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          routine.proacl,
          pg_catalog.acldefault('f', routine.proowner)
        )
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public'
)
select
  count(*) as public_routines,
  count(*) filter (
    where prosecdef
  ) as security_definers,
  count(*) filter (
    where authenticated_execute
  ) as authenticated_executable,
  count(*) filter (
    where prosecdef
      and authenticated_execute
  ) as authenticated_executable_definers,
  count(*) filter (
    where anon_execute
  ) as anon_executable,
  count(*) filter (
    where public_execute
  ) as public_executable
from routines;

\echo === COMPLETE ROUTINE INVENTORY ===
select
  format(
    '%I.%I(%s)',
    namespace.nspname,
    routine.proname,
    pg_catalog.pg_get_function_identity_arguments(routine.oid)
  ) as signature,
  pg_catalog.pg_get_userbyid(routine.proowner) as owner,
  case
    when routine.prosecdef then 'SECURITY DEFINER'
    else 'SECURITY INVOKER'
  end as security_mode,
  coalesce(array_to_string(routine.proconfig, ','), '') as configuration,
  has_function_privilege(
    'authenticated',
    routine.oid,
    'EXECUTE'
  ) as authenticated_execute,
  has_function_privilege(
    'anon',
    routine.oid,
    'EXECUTE'
  ) as anon_execute,
  exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_execute
from pg_catalog.pg_proc routine
join pg_catalog.pg_namespace namespace
  on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
order by signature;

\echo === INTERNAL ROUTINES REVOKED FROM BROWSER ROLES ===
select routine.oid::regprocedure::text as signature
from pg_catalog.pg_proc routine
join pg_catalog.pg_namespace namespace
  on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and not has_function_privilege(
    'authenticated',
    routine.oid,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    routine.oid,
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  )
order by signature;

\echo === DEFINER OWNER/BYPASS MODEL ===
select
  owner.rolname as owner,
  owner.rolbypassrls,
  owner.rolsuper,
  count(*) as authenticated_definer_functions
from pg_catalog.pg_proc routine
join pg_catalog.pg_namespace namespace
  on namespace.oid = routine.pronamespace
join pg_catalog.pg_roles owner
  on owner.oid = routine.proowner
where namespace.nspname = 'public'
  and routine.prosecdef
  and has_function_privilege(
    'authenticated',
    routine.oid,
    'EXECUTE'
  )
group by owner.rolname, owner.rolbypassrls, owner.rolsuper
order by owner.rolname;

\echo === DEFINER SEARCH-PATH AND DYNAMIC-SQL CHECKS ===
select
  count(*) filter (
    where not exists (
      select 1
      from unnest(
        coalesce(routine.proconfig, array[]::text[])
      ) setting
      where setting = 'search_path=""'
    )
  ) as definers_without_empty_search_path,
  count(*) filter (
    where upper(routine.prosrc) like '%EXECUTE %'
  ) as functions_with_dynamic_execute
from pg_catalog.pg_proc routine
join pg_catalog.pg_namespace namespace
  on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and routine.prosecdef;

\echo === DIRECT TABLE GRANTS ===
select
  grantee,
  table_name,
  string_agg(
    privilege_type,
    ','
    order by privilege_type
  ) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

\echo === DIRECT COLUMN GRANTS ===
select
  grantee,
  table_name,
  column_name,
  string_agg(
    privilege_type,
    ','
    order by privilege_type
  ) as privileges
from information_schema.role_column_grants
where table_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
group by grantee, table_name, column_name
order by grantee, table_name, column_name;

\echo === VERSION/TENANT/PROVENANCE BYPASS CHECK ===
with browser_roles(role_name) as (
  values ('anon'), ('authenticated')
),
protected_columns as (
  select
    relation.oid,
    relation.relname,
    attribute.attnum,
    attribute.attname
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_attribute attribute
    on attribute.attrelid = relation.oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and attribute.attname in (
      'organization_id',
      'created_by',
      'version',
      'state',
      'subtotal_minor',
      'discount_minor',
      'tax_minor',
      'charges_minor',
      'total_minor'
    )
)
select
  role_name,
  relname,
  attname,
  privilege_name
from browser_roles
cross join protected_columns
cross join (
  values ('INSERT'), ('UPDATE')
) privileges(privilege_name)
where has_column_privilege(
  role_name::name,
  oid,
  attnum,
  privilege_name
)
order by role_name, relname, attname, privilege_name;

\echo === RLS TABLES AND POLICY COUNTS ===
select
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls,
  count(policy.oid) as policy_count
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace namespace
  on namespace.oid = relation.relnamespace
left join pg_catalog.pg_policy policy
  on policy.polrelid = relation.oid
where namespace.nspname = 'public'
  and relation.relkind = 'r'
group by
  relation.relname,
  relation.relrowsecurity,
  relation.relforcerowsecurity
order by relation.relname;

\echo === POLICY DEFINITIONS ===
select
  relation.relname as table_name,
  policy.polname,
  policy.polcmd,
  pg_catalog.pg_get_expr(
    policy.polqual,
    policy.polrelid
  ) as using_expression,
  pg_catalog.pg_get_expr(
    policy.polwithcheck,
    policy.polrelid
  ) as check_expression
from pg_catalog.pg_policy policy
join pg_catalog.pg_class relation
  on relation.oid = policy.polrelid
join pg_catalog.pg_namespace namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
order by relation.relname, policy.polname;

\echo === REQUIRED NEGATIVE CHECKS ===
select
  not has_function_privilege(
    'authenticated',
    'public.calculate_quote_payload(jsonb)',
    'EXECUTE'
  ) as calculator_denied_to_authenticated,
  not has_function_privilege(
    'authenticated',
    'public.next_quote_number(uuid,date)',
    'EXECUTE'
  ) as numbering_helper_denied,
  not has_function_privilege(
    'authenticated',
    'public.quote_actor(uuid)',
    'EXECUTE'
  ) as actor_helper_denied,
  not has_function_privilege(
    'authenticated',
    'public.recalculate_quote(uuid,uuid)',
    'EXECUTE'
  ) as recalculation_helper_denied,
  not has_table_privilege(
    'authenticated',
    'public.command_receipts',
    'SELECT'
  ) as receipt_table_denied,
  not has_table_privilege(
    'authenticated',
    'public.quote_sequences',
    'SELECT'
  ) as sequence_table_denied;

rollback;
