begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name in (
        'customer_name_snapshot',
        'contact_name_snapshot',
        'email_snapshot',
        'billing_address_line1_snapshot',
        'billing_address_line2_snapshot',
        'billing_city_snapshot',
        'billing_region_snapshot',
        'billing_postal_code_snapshot',
        'billing_country_code_snapshot',
        'tax_identifier_snapshot',
        'approval_threshold_bps_snapshot'
      )
  ),
  11,
  'quote carries every required customer and approval-policy snapshot column'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'quotes_submitted_snapshots_check'),
  'submitted quote states require a complete snapshot'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'quotes_submission_snapshots_immutable'),
  'submitted snapshots have an immutability trigger'
);

create or replace function pg_temp.make_snapshot_quote(p_discount_bps integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_date date;
  created jsonb;
  quote_id uuid;
begin
  local_date := public.organization_local_date(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    statement_timestamp()
  );
  created := public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR',
    'en-IN',
    'GST',
    'exclusive',
    local_date,
    local_date + 30,
    extensions.gen_random_uuid()
  );
  quote_id := (created ->> 'id')::uuid;
  perform public.save_quote_draft(
    quote_id,
    1,
    extensions.gen_random_uuid(),
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR',
      'locale', 'en-IN',
      'tax_label', 'GST',
      'tax_mode', 'exclusive',
      'discount_bps', p_discount_bps,
      'issue_date', local_date,
      'valid_until', local_date + 30,
      'notes', '',
      'items', jsonb_build_array(jsonb_build_object(
        'line_id', null,
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1,
        'quantity_scaled', 1,
        'quantity_scale', 1
      )),
      'charges', '[]'::jsonb
    )
  );
  return quote_id;
end;
$$;

create temporary table snapshot_quotes (label text primary key, id uuid not null);
grant all on snapshot_quotes to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into snapshot_quotes values ('waiting', pg_temp.make_snapshot_quote(1200));

select lives_ok(
  $$select public.submit_quote(
    (select id from snapshot_quotes where label = 'waiting'),
    2,
    'c2300000-0000-4000-8000-000000000001'
  )$$,
  'submission snapshots customer and policy atomically'
);
select is((select customer_name_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'Asha Engineering Works', 'customer name is snapshotted');
select is((select contact_name_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'Priya Mehta', 'contact name is snapshotted');
select is((select email_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'procurement@asha.example', 'email is snapshotted');
select is((select billing_address_line1_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), '18 Industrial Estate Road', 'billing address is snapshotted');
select is((select billing_country_code_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'IN', 'billing country is snapshotted');
select is((select tax_identifier_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'GSTIN-DEMO-18ASHA', 'tax identifier is snapshotted');
select is((select approval_threshold_bps_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 1000, 'approval threshold is snapshotted');
select is((select state::text from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'waiting', 'routing uses the snapshotted 1000 bps threshold');

reset role;
update public.customers
set
  name = 'Asha Renamed After Submission',
  billing_address_line1 = '99 Changed Address',
  tax_identifier = 'CHANGED-TAX-ID'
where id = 'a3000000-0000-4000-8000-000000000001';
update public.organizations
set approval_threshold_bps = 500
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is((select name from public.customers where id = 'a3000000-0000-4000-8000-000000000001'), 'Asha Renamed After Submission', 'live customer changed after submission');
select is((select customer_name_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'Asha Engineering Works', 'submitted customer name remains unchanged');
select is((select billing_address_line1_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), '18 Industrial Estate Road', 'submitted address remains unchanged');
select is((select tax_identifier_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 'GSTIN-DEMO-18ASHA', 'submitted tax identifier remains unchanged');
select is((select approval_threshold_bps_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'waiting')), 1000, 'waiting quote retains the original threshold');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (public.submit_quote(
    (select id from snapshot_quotes where label = 'waiting'),
    2,
    'c2300000-0000-4000-8000-000000000001'
  ) ->> 'version')::integer,
  3,
  'exact duplicate submit returns the original result after live data changes'
);
select is(
  (
    select concat_ws('|', customer_name_snapshot, billing_address_line1_snapshot, tax_identifier_snapshot, approval_threshold_bps_snapshot)
    from public.quotes
    where id = (select id from snapshot_quotes where label = 'waiting')
  ),
  'Asha Engineering Works|18 Industrial Estate Road|GSTIN-DEMO-18ASHA|1000',
  'duplicate submit does not resnapshot changed live data'
);

reset role;
select throws_ok(
  $$update public.quotes
    set customer_name_snapshot = 'Tampered'
    where id = (select id from snapshot_quotes where label = 'waiting')$$,
  '55000',
  'quote_submission_snapshots_immutable',
  'submitted snapshot columns cannot be changed'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into snapshot_quotes values ('automatic', pg_temp.make_snapshot_quote(400));
select lives_ok(
  $$select public.submit_quote(
    (select id from snapshot_quotes where label = 'automatic'),
    2,
    'c2300000-0000-4000-8000-000000000002'
  )$$,
  'automatic approval snapshots and routes with the current 500 bps policy'
);
select is((select state::text from public.quotes where id = (select id from snapshot_quotes where label = 'automatic')), 'approved', 'automatic quote is approved against its snapshot');
select is(
  (select approval_threshold_bps_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'automatic')),
  500,
  'automatic quote stores the exact threshold used'
);
select is(
  (
    select (safe_metadata ->> 'threshold_bps')::integer
    from public.quote_activity
    where quote_id = (select id from snapshot_quotes where label = 'automatic')
      and event_type = 'quote.approved'
  ),
  (select approval_threshold_bps_snapshot from public.quotes where id = (select id from snapshot_quotes where label = 'automatic')),
  'automatic approval Activity references the snapshotted threshold'
);

select * from finish();
rollback;
