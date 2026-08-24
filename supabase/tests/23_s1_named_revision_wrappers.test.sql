begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select is(
  (select proargnames from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public' and proname = 'submit_quote_revision'),
  '{p_quote_id,p_revision_id,p_expected_version,p_command_id}',
  'submit wrapper exposes named arguments to PostgREST'
);
select is(
  (select proargnames from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public' and proname = 'approve_quote_revision'),
  '{p_quote_id,p_revision_id,p_expected_version,p_command_id}',
  'approve wrapper exposes named arguments to PostgREST'
);
select is(
  (select proargnames from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public' and proname = 'issue_quote_revision'),
  '{p_quote_id,p_revision_id,p_expected_version,p_command_id}',
  'issue wrapper exposes named arguments to PostgREST'
);
select is(
  (select proargnames from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public' and proname = 'reject_quote_revision'),
  '{p_quote_id,p_revision_id,p_expected_version,p_command_id,p_reason}',
  'reject wrapper exposes named arguments to PostgREST'
);
select ok(
  not has_function_privilege('anon', 'public.submit_quote_revision(uuid,uuid,integer,uuid)', 'execute'),
  'anon cannot execute named submit wrapper'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_quote_revision(uuid,uuid,integer,uuid)', 'execute'),
  'authenticated can execute named submit wrapper'
);
select is(
  (select count(*)::integer from pg_proc
   join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public'
     and proname in ('submit_quote_revision', 'approve_quote_revision', 'reject_quote_revision', 'issue_quote_revision')
     and prosecdef),
  4,
  'all named revision wrappers are security definers'
);
select is(
  (select count(*)::integer from pg_proc
   join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where nspname = 'public'
     and proname in ('submit_quote_revision', 'approve_quote_revision', 'reject_quote_revision', 'issue_quote_revision')
     and array_to_string(proconfig, ',') = 'search_path=""'),
  4,
  'all named revision wrappers pin an empty search path'
);

create temporary table wrapper_values (key text primary key, value text not null);
grant all on wrapper_values to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with created as (
  select public.create_verified_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', '2026-08-24', '2026-09-14',
    'c2000000-0000-4000-8000-000000000001'
  ) result
)
insert into wrapper_values values
  ('quote_id', (select result->>'id' from created)),
  ('revision_id', (select result->>'current_revision_id' from created));

select lives_ok($$
  select public.save_quote_draft(
    (select value::uuid from wrapper_values where key='quote_id'), 1,
    'c2000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR', 'locale', 'en-IN', 'tax_label', 'GST 18%',
      'tax_mode', 'exclusive', 'discount_bps', 0,
      'issue_date', '2026-08-24', 'valid_until', '2026-09-14',
      'notes', 'Named wrapper contract',
      'items', jsonb_build_array(jsonb_build_object(
        'line_id', null, 'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
      )),
      'charges', '[]'::jsonb
    )
  )
$$, 'named-wrapper fixture saves through the authoritative calculator');

with submitted as (
  select public.submit_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    (select value::uuid from wrapper_values where key='revision_id'), 2,
    'c2000000-0000-4000-8000-000000000003'
  ) result
)
insert into wrapper_values values ('submit_result', (select result::text from submitted));

select is(
  (select state::text from public.quote_revisions
   where id=(select value::uuid from wrapper_values where key='revision_id')),
  'approved',
  'submit wrapper delegates the correct action and revision'
);
select is(
  public.submit_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    (select value::uuid from wrapper_values where key='revision_id'), 2,
    'c2000000-0000-4000-8000-000000000003'
  )::text,
  (select value from wrapper_values where key='submit_result'),
  'submit wrapper exact command replay is idempotent'
);
select throws_ok($$
  select public.submit_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    (select value::uuid from wrapper_values where key='revision_id'), 3,
    'c2000000-0000-4000-8000-000000000004'
  )
$$, '55000', 'revision_not_draft', 'submit wrapper refuses a new command after decision');
select throws_ok($$
  select public.issue_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    'c2000000-0000-4000-8000-000000000099', 3,
    'c2000000-0000-4000-8000-000000000005'
  )
$$, '40001', 'revision_stale', 'issue wrapper rejects a revision identity mismatch');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$
  select public.issue_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    (select value::uuid from wrapper_values where key='revision_id'), 3,
    'c2000000-0000-4000-8000-000000000006'
  )
$$, '42501', 'quote_issue_forbidden', 'issue wrapper refuses cross-organization authorization');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$
  select public.issue_quote_revision(
    (select value::uuid from wrapper_values where key='quote_id'),
    (select value::uuid from wrapper_values where key='revision_id'), 3,
    'c2000000-0000-4000-8000-000000000007'
  )
$$, 'authorized issue wrapper completes');
reset role;

select is(
  (select current_revision_id from public.quotes
   where id=(select value::uuid from wrapper_values where key='quote_id')),
  (select value::uuid from wrapper_values where key='revision_id'),
  'issue wrapper preserves the requested revision identity'
);
select is(
  (select jsonb_build_object(
    'legal_name', quote.seller_legal_name_snapshot,
    'address_line1', quote.seller_address_line1_snapshot,
    'address_line2', coalesce(quote.seller_address_line2_snapshot, ''),
    'city', quote.seller_city_snapshot,
    'region', coalesce(quote.seller_region_snapshot, ''),
    'postal_code', coalesce(quote.seller_postal_code_snapshot, ''),
    'country_code', quote.seller_country_code_snapshot,
    'tax_identifier', quote.seller_tax_identifier_snapshot,
    'contact_email', quote.seller_contact_email_snapshot,
    'contact_phone', quote.seller_contact_phone_snapshot
  )::text from public.quotes quote
  where quote.id=(select value::uuid from wrapper_values where key='quote_id')),
  (select (revision.snapshot->'seller')::text from public.quote_revisions revision
   where revision.id=(select value::uuid from wrapper_values where key='revision_id')),
  'issue wrapper preserves the sealed seller snapshot invariant'
);
select ok(
  not has_column_privilege('authenticated', 'public.quote_share_links', 'selector', 'select'),
  'authenticated link listings cannot read selectors after one-time presentation'
);
select ok(
  not has_column_privilege('authenticated', 'public.quote_share_links', 'token_hash', 'select'),
  'authenticated link listings cannot read token hashes'
);
select ok(
  has_column_privilege('authenticated', 'public.quote_share_links', 'organization_id', 'select')
  and has_column_privilege('authenticated', 'public.quote_share_links', 'quote_id', 'select'),
  'authenticated link listings retain only tenant and quote filter columns'
);

select * from finish();
rollback;
