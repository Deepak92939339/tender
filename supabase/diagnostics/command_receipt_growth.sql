\set ON_ERROR_STOP on
\pset pager off

-- Owner/admin diagnostic only. Run with the local database-owner connection:
--   docker exec -i supabase_db_tender-local-visual-study \
--     psql -U postgres -d postgres \
--     < supabase/diagnostics/command_receipt_growth.sql
--
-- This script creates no function, view, grant, policy or scheduled cleanup.
-- result_bytes measures stored JSONB result payloads with pg_column_size; it is
-- not total table/index storage.

begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '2s';

select
  current_user as diagnostic_actor,
  current_database() as database_name,
  pg_catalog.now() as observed_at;

select
  pg_catalog.count(*)::bigint as receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)),
    0
  )::bigint as result_bytes,
  pg_catalog.min(receipt.created_at) as oldest_receipt_at,
  pg_catalog.max(receipt.created_at) as newest_receipt_at,
  pg_catalog.count(*) filter (
    where receipt.created_at >= pg_catalog.now() - interval '30 days'
  )::bigint as trailing_30_day_receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)) filter (
      where receipt.created_at >= pg_catalog.now() - interval '30 days'
    ),
    0
  )::bigint as trailing_30_day_result_bytes
from public.command_receipts receipt;

select
  receipt.command_type,
  pg_catalog.count(*)::bigint as receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)),
    0
  )::bigint as result_bytes,
  pg_catalog.min(receipt.created_at) as oldest_receipt_at,
  pg_catalog.max(receipt.created_at) as newest_receipt_at,
  pg_catalog.count(*) filter (
    where receipt.created_at >= pg_catalog.now() - interval '30 days'
  )::bigint as trailing_30_day_receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)) filter (
      where receipt.created_at >= pg_catalog.now() - interval '30 days'
    ),
    0
  )::bigint as trailing_30_day_result_bytes
from public.command_receipts receipt
group by receipt.command_type
order by receipt.command_type;

select
  receipt.organization_id,
  pg_catalog.count(*)::bigint as receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)),
    0
  )::bigint as result_bytes,
  pg_catalog.min(receipt.created_at) as oldest_receipt_at,
  pg_catalog.max(receipt.created_at) as newest_receipt_at,
  pg_catalog.count(*) filter (
    where receipt.created_at >= pg_catalog.now() - interval '30 days'
  )::bigint as trailing_30_day_receipt_count,
  coalesce(
    pg_catalog.sum(pg_catalog.pg_column_size(receipt.result)) filter (
      where receipt.created_at >= pg_catalog.now() - interval '30 days'
    ),
    0
  )::bigint as trailing_30_day_result_bytes
from public.command_receipts receipt
group by receipt.organization_id
order by receipt.organization_id;

rollback;
