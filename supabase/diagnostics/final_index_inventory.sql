\pset pager off
begin read only;

\echo === COMPLETE RELEVANT INDEX INVENTORY ===
select
  table_relation.relname as table_name,
  index_relation.relname as index_name,
  index_catalog.indisunique,
  index_catalog.indisvalid,
  index_catalog.indisready,
  pg_catalog.pg_get_indexdef(
    index_catalog.indexrelid
  ) as definition,
  pg_catalog.pg_get_expr(
    index_catalog.indpred,
    index_catalog.indrelid
  ) as predicate
from pg_catalog.pg_index index_catalog
join pg_catalog.pg_class table_relation
  on table_relation.oid = index_catalog.indrelid
join pg_catalog.pg_class index_relation
  on index_relation.oid = index_catalog.indexrelid
join pg_catalog.pg_namespace namespace
  on namespace.oid = table_relation.relnamespace
where namespace.nspname = 'public'
  and table_relation.relname in (
    'quotes',
    'quote_activity',
    'products',
    'customers',
    'tax_profiles',
    'command_receipts',
    'quote_items',
    'quote_charges'
  )
order by table_relation.relname, index_relation.relname;

set local enable_seqscan = off;
set local enable_bitmapscan = off;

\echo === QUOTE LIST PLAN ===
explain (costs off)
select id
from public.quotes
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
order by updated_at desc;

\echo === APPROVAL QUEUE PLAN ===
explain (costs off)
select id
from public.quotes
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and state = 'waiting'
  and valid_until >= date '2026-07-24'
order by submitted_at;

\echo === QUOTE ACTIVITY PLAN ===
explain (costs off)
select id
from public.quote_activity
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and quote_id = '11111111-1111-4111-8111-111111111111'
order by created_at desc;

\echo === ACTIVE TAX-PROFILE SELECTOR PLAN ===
explain (costs off)
select id
from public.tax_profiles
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and active = true
order by code;

\echo === SETTINGS TAX-PROFILE PLAN ===
explain (costs off)
select id
from public.tax_profiles
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
order by active desc, code;

rollback;
