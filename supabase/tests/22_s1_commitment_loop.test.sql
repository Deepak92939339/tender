begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(98);

select ok(not exists (
  select 1 from pg_constraint where conname in ('quotes_current_revision_fkey', 'quotes_accepted_revision_fkey') and not convalidated
), 'quote revision pointer foreign keys are validated');
select ok(not exists (
  select 1 from pg_constraint where conname in ('quotes_current_revision_fkey', 'quotes_accepted_revision_fkey') and condeferrable
), 'quote revision pointer foreign keys are immediate and non-deferrable');
select has_table('quote_revisions', 'revision table exists');
select has_table('quote_share_links', 'share-link table exists');
select has_table('quote_recipient_events', 'recipient event table exists');
select has_table('quote_acceptances', 'acceptance table exists');
select has_table('quote_public_rate_buckets', 'database rate buckets exist');

select ok(not has_function_privilege('anon', 'public.broker_open_quote(uuid,text,bytea)', 'execute'), 'anon cannot execute broker open');
select ok(not has_function_privilege('anon', 'public.quote_acceptance_statement_text_v1(smallint)', 'execute'), 'anon cannot execute acceptance statement helper');
select ok(not has_function_privilege('authenticated', 'public.quote_acceptance_statement_text_v1(smallint)', 'execute'), 'authenticated cannot execute acceptance statement helper');
select ok(not has_function_privilege('authenticated', 'public.broker_open_quote(uuid,text,bytea)', 'execute'), 'authenticated cannot execute broker open');
select ok(has_function_privilege('service_role', 'public.broker_open_quote(uuid,text,bytea)', 'execute'), 'service role alone can execute broker open');
select ok(not has_table_privilege('service_role', 'public.quote_share_links', 'select'), 'service role has no direct share-link table select grant');
select ok(not has_column_privilege('authenticated', 'public.quote_share_links', 'token_hash', 'select'), 'authenticated seller cannot read token hashes');
select ok(not has_table_privilege('anon', 'public.quote_revisions', 'select'), 'anon has no revision table grant');
select ok(not has_function_privilege('anon', 'public.quote_public_link_status(uuid,text,text,bytea,integer,integer)', 'execute'), 'anon cannot bypass broker through link-status helper');
select ok(not has_function_privilege('anon', 'public.broker_record_quote_event(quote_recipient_event_type,uuid,text,bytea,uuid,text)', 'execute'), 'anon cannot execute broker event');
select ok(not has_function_privilege('authenticated', 'public.broker_record_quote_event(quote_recipient_event_type,uuid,text,bytea,uuid,text)', 'execute'), 'authenticated cannot execute broker event');
select ok(has_function_privilege('service_role', 'public.broker_record_quote_event(quote_recipient_event_type,uuid,text,bytea,uuid,text)', 'execute'), 'service role alone can execute broker event');
select ok(not has_function_privilege('anon', 'public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint)', 'execute'), 'anon cannot execute broker acceptance');
select ok(not has_function_privilege('authenticated', 'public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint)', 'execute'), 'authenticated cannot execute broker acceptance');
select ok(has_function_privilege('service_role', 'public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint)', 'execute'), 'service role alone can execute broker acceptance');
select ok(not has_function_privilege('anon', 'public.broker_verify_quote(text,bytea)', 'execute'), 'anon cannot execute broker verification');
select ok(not has_function_privilege('authenticated', 'public.broker_verify_quote(text,bytea)', 'execute'), 'authenticated cannot execute broker verification');
select ok(has_function_privilege('service_role', 'public.broker_verify_quote(text,bytea)', 'execute'), 'service role alone can execute broker verification');
select ok(exists (select 1 from pg_indexes where schemaname='public' and indexname='quote_recipient_events_terminal_revision_idx'), 'terminal-response uniqueness is revision-scoped');
select ok(not exists (select 1 from pg_indexes where schemaname='public' and indexname='quote_recipient_events_terminal_link_idx'), 'no link-scoped terminal-response bypass index remains');

create temporary table s1_values (key text primary key, value text not null);
grant all on s1_values to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with created as (
  select public.create_verified_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', '2026-08-14', '2026-09-14',
    'b1000000-0000-4000-8000-000000000001'
  ) result
)
insert into s1_values values
  ('quote_id', (select result->>'id' from created)),
  ('revision_id', (select result->>'current_revision_id' from created));

select is((select revision_counter from public.quotes where id=(select value::uuid from s1_values where key='quote_id')), 1, 'verified draft starts at revision 1');
select is((select record_kind::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), 'verified_revision', 'new quote has verified revision record');

select lives_ok($$
  select public.save_quote_draft(
    (select value::uuid from s1_values where key='quote_id'), 1,
    'b1000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001', 'currency_code', 'INR',
      'locale', 'en-IN', 'tax_label', 'GST 18%', 'tax_mode', 'exclusive',
      'discount_bps', 0, 'issue_date', '2026-08-14', 'valid_until', '2026-09-14',
      'notes', E'Canonical\nquote', 'items', jsonb_build_array(jsonb_build_object(
        'line_id', null, 'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
      )), 'charges', '[]'::jsonb
    )
  )
$$, 'working draft can be prepared through existing calculator boundary');
select lives_ok($$select public.submit_quote_revision(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='revision_id'), 2,
  'b1000000-0000-4000-8000-000000000003')$$, 'revision submits and seals atomically');
select is((select state::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), 'approved', 'first below-threshold revision auto-approves');
select is((select approved_by from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), null, 'automatic approval does not spoof a signed approver');
select is((select actor_source::text from public.quote_activity where quote_id=(select value::uuid from s1_values where key='quote_id') and event_type='quote.revision_approved'), 'automatic_rule', 'automatic approval has rule provenance');
reset role;
select is((select calculation_fingerprint::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')),
  (select public.sha256_hex(canonical_calculation) from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), 'calculation fingerprint hashes exact canonical calculation bytes');
select is((select snapshot_hash::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')),
  (select public.sha256_hex(canonical_snapshot) from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), 'snapshot hash hashes exact canonical snapshot bytes');
select is((select encode(canonical_snapshot, 'hex') from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')),
  (select encode(public.canonical_json_v1(snapshot), 'hex') from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')), 'stored snapshot bytes reproduce from canonical serializer');
insert into s1_values values
  ('sealed_snapshot_bytes_before_issue', (select encode(canonical_snapshot, 'hex') from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id'))),
  ('sealed_snapshot_hash_before_issue', (select snapshot_hash::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')));
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$update public.quote_revisions set snapshot_hash = repeat('0',64) where id=(select value::uuid from s1_values where key='revision_id')$$,
  '42501', null, 'authenticated caller cannot mutate revision authority');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$
  select public.update_organization_settings(
    organization.id,
    organization.version,
    jsonb_build_object(
      'name', organization.name,
      'default_currency_code', organization.default_currency_code,
      'default_locale', organization.default_locale,
      'approval_threshold_bps', organization.approval_threshold_bps,
      'seller_legal_name', 'Tender Demonstration Company Changed After Submission'
    ),
    'b1000000-0000-4000-8000-000000000099'
  )
  from public.organizations organization
  where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
$$, 'supported seller-settings update succeeds after revision submission');
select ok(
  (select revision.snapshot#>>'{seller,legal_name}' is distinct from organization.seller_legal_name
   from public.quote_revisions revision
   join public.organizations organization on organization.id = revision.organization_id
   where revision.id=(select value::uuid from s1_values where key='revision_id')),
  'sealed revision seller identity remains distinct from changed live organization identity'
);
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$select public.issue_quote_revision(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='revision_id'), 3,
  'b1000000-0000-4000-8000-000000000004')$$, 'approved revision issues');
reset role;
select is(
  (select encode(canonical_snapshot, 'hex') from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')),
  (select value from s1_values where key='sealed_snapshot_bytes_before_issue'),
  'issuance preserves the sealed canonical revision bytes after seller-settings change'
);
select is(
  (select snapshot_hash::text from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id')),
  (select value from s1_values where key='sealed_snapshot_hash_before_issue'),
  'issuance preserves the sealed revision hash after seller-settings change'
);
select is(
  (
    select jsonb_build_object(
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
    )::text
    from public.quotes quote
    where quote.id=(select value::uuid from s1_values where key='quote_id')
  ),
  (select snapshot->'seller' from public.quote_revisions where id=(select value::uuid from s1_values where key='revision_id'))::text,
  'authenticated issued-print seller snapshot equals the sealed revision seller identity'
);
insert into s1_values values (
  'authenticated_issued_seller_document',
  (
    select jsonb_build_object(
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
    )::text
    from public.quotes quote
    where quote.id=(select value::uuid from s1_values where key='quote_id')
  )
);
select ok(
  (
    select jsonb_build_object(
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
    ) is distinct from jsonb_build_object(
      'legal_name', organization.seller_legal_name,
      'address_line1', organization.seller_address_line1,
      'address_line2', coalesce(organization.seller_address_line2, ''),
      'city', organization.seller_city,
      'region', coalesce(organization.seller_region, ''),
      'postal_code', coalesce(organization.seller_postal_code, ''),
      'country_code', organization.seller_country_code,
      'tax_identifier', organization.seller_tax_identifier,
      'contact_email', organization.seller_contact_email,
      'contact_phone', organization.seller_contact_phone
    )
    from public.quotes quote
    join public.organizations organization on organization.id = quote.organization_id
    where quote.id=(select value::uuid from s1_values where key='quote_id')
  ),
  'authenticated issued-print seller snapshot does not use changed live organization identity'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

with shared as (
  select public.create_quote_share_link(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='revision_id'), 4,
    'buyer@example.test', '2026-09-01T00:00:00Z',
    'b1000000-0000-4000-8000-000000000005'
  ) result
)
insert into s1_values values
  ('link_id', (select result->>'link_id' from shared)),
  ('selector', (select result->>'selector' from shared)),
  ('secret', (select result->>'secret' from shared));
select ok((select value <> '' from s1_values where key='secret'), 'raw share secret is returned once');
reset role;
select is((select encode(token_hash, 'hex') from public.quote_share_links where id=(select value::uuid from s1_values where key='link_id')),
  (select encode(extensions.digest(convert_to(value,'UTF8'),'sha256'),'hex') from s1_values where key='secret'), 'only SHA-256 share token digest is stored');
select is((select token_format_version from public.quote_share_links where id=(select value::uuid from s1_values where key='link_id')), 1::smallint, 'share token format version is frozen');
select is((select token_hash_algorithm from public.quote_share_links where id=(select value::uuid from s1_values where key='link_id')), 'sha256', 'share token hash algorithm is explicit');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((public.create_quote_share_link(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='revision_id'), 4,
    'buyer@example.test', '2026-09-01T00:00:00Z',
    'b1000000-0000-4000-8000-000000000005')->>'status'),
  'replayed_without_secret', 'share command replay creates no second secret');
select is((select count(*)::integer from public.quote_share_links where quote_id=(select value::uuid from s1_values where key='quote_id')), 1, 'share replay creates one link');
with shared as (
  select public.create_quote_share_link(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='revision_id'), 4,
    'second@example.test', '2026-09-01T00:00:00Z',
    'b1000000-0000-4000-8000-000000000009'
  ) result
)
insert into s1_values values
  ('second_link_id', (select result->>'link_id' from shared)),
  ('second_selector', (select result->>'selector' from shared)),
  ('second_secret', (select result->>'secret' from shared));
with shared as (
  select public.create_quote_share_link(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='revision_id'), 4,
    'revoke@example.test', '2026-09-01T00:00:00Z',
    'b1000000-0000-4000-8000-000000000011'
  ) result
)
insert into s1_values values
  ('revoke_link_id', (select result->>'link_id' from shared)),
  ('revoke_selector', (select result->>'selector' from shared)),
  ('revoke_secret', (select result->>'secret' from shared));
select is((public.revoke_quote_share_link(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='revoke_link_id'), 4,
  'b1000000-0000-4000-8000-000000000012')->>'disabled_reason'), 'revoked', 'seller can revoke an active link');
select is((public.revoke_quote_share_link(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='revoke_link_id'), 4,
  'b1000000-0000-4000-8000-000000000012')->>'disabled_reason'), 'revoked', 'revocation exact replay is stable');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::integer from public.quote_revisions where quote_id=(select value::uuid from s1_values where key='quote_id')), 0, 'revision RLS hides another organization');
select throws_ok($$select public.create_quote_share_link(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='revision_id'), 4,
  'attacker@example.test', '2026-09-01T00:00:00Z', extensions.gen_random_uuid())$$,
  '42501', 'quote_share_forbidden', 'cross-organization share creation is denied');
reset role;
set local role service_role;
select is((public.broker_open_quote(
  (select value::uuid from s1_values where key='selector'), (select value from s1_values where key='secret'),
  extensions.digest(convert_to('test-subject-open','UTF8'),'sha256'))->>'status'), 'ok', 'service broker opens a valid issued revision');
select is(
  (public.broker_open_quote(
    (select value::uuid from s1_values where key='selector'), (select value from s1_values where key='secret'),
    extensions.digest(convert_to('test-subject-open-seller','UTF8'),'sha256'))#>'{value,snapshot,seller}')::text,
  (select value from s1_values where key='authenticated_issued_seller_document'),
  'broker recipient projection seller identity matches authenticated issued-print seller snapshot'
);
select is((public.broker_open_quote(
  (select value::uuid from s1_values where key='selector'), 'wrong-secret',
  extensions.digest(convert_to('test-subject-wrong','UTF8'),'sha256'))->>'status'), 'invalid_link', 'wrong token reveals no link state');
do $$
begin
  for index in 1..10 loop
    perform public.broker_verify_quote('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      extensions.digest(convert_to('test-subject-rate','UTF8'),'sha256'));
  end loop;
end;
$$;
select is((public.broker_verify_quote('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  extensions.digest(convert_to('test-subject-rate','UTF8'),'sha256'))->>'status'),
  'rate_limited', 'database rate limit is atomic and enforced inside the service broker');
select is((public.broker_record_quote_event('change_requested',
  (select value::uuid from s1_values where key='selector'), (select value from s1_values where key='secret'),
  extensions.digest(convert_to('test-subject-change','UTF8'),'sha256'),
  'b1000000-0000-4000-8000-000000000006', 'Please change delivery terms')->>'status'), 'ok', 'buyer change request records through broker');
reset role;
select is((select count(*)::integer from public.quote_revisions where quote_id=(select value::uuid from s1_values where key='quote_id')), 1, 'change request creates no successor revision');
select is((select event_type::text from public.quote_recipient_events where share_link_id=(select value::uuid from s1_values where key='link_id')), 'change_requested', 'change request is an event only');
select is((select disabled_reason::text from public.quote_share_links where id=(select value::uuid from s1_values where key='link_id')), null, 'change request does not disable its share link');
set local role service_role;
select is((public.broker_open_quote(
  (select value::uuid from s1_values where key='selector'),
  (select value from s1_values where key='secret'),
  extensions.digest(convert_to('test-subject-open-after-change','UTF8'),'sha256'))#>>'{value,response_type}'),
  'change_requested', 'changed revision remains viewable with revision-scoped response');
select is((public.broker_open_quote(
  (select value::uuid from s1_values where key='selector'),
  (select value from s1_values where key='secret'),
  extensions.digest(convert_to('test-subject-open-after-change-2','UTF8'),'sha256'))#>>'{value,acceptance_allowed}'),
  'false', 'changed revision is no longer acceptance-authorized');
select is((public.broker_open_quote(
  (select value::uuid from s1_values where key='revoke_selector'),
  (select value from s1_values where key='revoke_secret'),
  extensions.digest(convert_to('test-subject-revoked','UTF8'),'sha256'))->>'status'), 'revoked', 'revoked token cannot open revision');
select is((public.broker_accept_quote(
  (select value::uuid from s1_values where key='second_selector'),
  (select value from s1_values where key='second_secret'),
  extensions.digest(convert_to('test-subject-blocked-accept','UTF8'),'sha256'),
  'b1000000-0000-4000-8000-000000000010', 'Bypass Buyer', null, 1::smallint)->>'status'),
  'already_responded', 'a second link cannot accept the unchanged revision after a change request');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with begun as (
  select public.begin_quote_revision(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='revision_id'), 4,
    'b1000000-0000-4000-8000-000000000013'
  ) result
)
insert into s1_values values ('successor_revision_id', (select result->>'current_revision_id' from begun));
select is((select revision_number from public.quote_revisions where id=(select value::uuid from s1_values where key='successor_revision_id')), 2, 'seller explicitly starts successor revision 2');
select lives_ok($$select public.submit_quote_revision(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='successor_revision_id'), 5,
  'b1000000-0000-4000-8000-000000000014')$$, 'successor submit reruns approval');
select is((select state::text from public.quote_revisions where id=(select value::uuid from s1_values where key='successor_revision_id')), 'waiting', 'successor requires manual reapproval');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$select public.approve_quote_revision(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='successor_revision_id'), 6,
  'b1000000-0000-4000-8000-000000000015')$$, 'manager approves successor');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$select public.issue_quote_revision(
  (select value::uuid from s1_values where key='quote_id'),
  (select value::uuid from s1_values where key='successor_revision_id'), 7,
  'b1000000-0000-4000-8000-000000000016')$$, 'seller issues successor');
with shared as (
  select public.create_quote_share_link(
    (select value::uuid from s1_values where key='quote_id'),
    (select value::uuid from s1_values where key='successor_revision_id'), 8,
    'accept@example.test', '2026-09-01T00:00:00Z',
    'b1000000-0000-4000-8000-000000000017'
  ) result
)
insert into s1_values values
  ('accept_link_id', (select result->>'link_id' from shared)),
  ('accept_selector', (select result->>'selector' from shared)),
  ('accept_secret', (select result->>'secret' from shared));
reset role;
set local role service_role;
insert into s1_values
select
  'accept_statement_pre',
  public.broker_open_quote(
    (select value::uuid from s1_values where key='accept_selector'),
    (select value from s1_values where key='accept_secret'),
    extensions.digest(convert_to('test-subject-accept-open','UTF8'),'sha256')
  )#>>'{value,acceptance_statement}';
select is(
  (select value from s1_values where key='accept_statement_pre'),
  'I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.',
  'open projection returns the database-owned version-1 acceptance statement'
);
select is((public.broker_accept_quote(
  (select value::uuid from s1_values where key='accept_selector'),
  (select value from s1_values where key='accept_secret'),
  extensions.digest(convert_to('test-subject-accept','UTF8'),'sha256'),
  'b1000000-0000-4000-8000-000000000018', U&'  Cafe\0301 Buyer  ',
  '  Procurement Lead  ', 1::smallint)->>'status'), 'ok', 'successor acceptance commits through broker');
select is((public.broker_accept_quote(
  (select value::uuid from s1_values where key='accept_selector'),
  (select value from s1_values where key='accept_secret'),
  extensions.digest(convert_to('test-subject-accept','UTF8'),'sha256'),
  'b1000000-0000-4000-8000-000000000018', U&'  Cafe\0301 Buyer  ',
  '  Procurement Lead  ', 1::smallint)#>>'{value,replayed}'), 'true', 'acceptance exact replay returns immutable evidence');
reset role;
select is((select accepted_revision_id from public.quotes where id=(select value::uuid from s1_values where key='quote_id')),
  (select value::uuid from s1_values where key='successor_revision_id'), 'quote pointer binds to exactly the accepted successor revision');
select is((select version from public.quotes where id=(select value::uuid from s1_values where key='quote_id')), 9, 'acceptance advances quote concurrency version');
select is((select acceptance.snapshot_hash::text from public.quote_acceptances acceptance where quote_id=(select value::uuid from s1_values where key='quote_id')),
  (select revision.snapshot_hash::text from public.quote_revisions revision where id=(select value::uuid from s1_values where key='successor_revision_id')), 'acceptance copies the immutable snapshot hash atomically');
select is((select acceptance.calculation_fingerprint::text from public.quote_acceptances acceptance where quote_id=(select value::uuid from s1_values where key='quote_id')),
  (select revision.calculation_fingerprint::text from public.quote_revisions revision where id=(select value::uuid from s1_values where key='successor_revision_id')), 'acceptance copies the calculation fingerprint atomically');
select is((select recipient_email_snapshot from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  'accept@example.test', 'acceptance freezes addressed recipient email');
select is((select buyer_asserted_name from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  'Café Buyer', 'acceptance freezes trimmed NFC buyer-asserted name');
select is((select buyer_asserted_title from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  'Procurement Lead', 'acceptance freezes optional buyer-asserted title');
select is((select acceptance_statement_version from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  1::smallint, 'acceptance statement version is exact');
select is(
  (select acceptance_statement from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  (select value from s1_values where key='accept_statement_pre'),
  'statement shown before acceptance equals statement stored after acceptance'
);
select is((select acceptance_statement_hash::text from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  (select public.sha256_hex(canonical_acceptance_statement) from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')), 'acceptance statement hash covers exact canonical bytes');
select is((select recipient_event_id from public.quote_acceptances where quote_id=(select value::uuid from s1_values where key='quote_id')),
  (select id from public.quote_recipient_events where revision_id=(select value::uuid from s1_values where key='successor_revision_id') and event_type='accepted'), 'acceptance binds its originating terminal event');
select throws_ok($$update public.quote_acceptances set buyer_asserted_name='Changed' where quote_id=(select value::uuid from s1_values where key='quote_id')$$,
  '55000', 'quote_acceptance_immutable', 'acceptance evidence is immutable');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with invalid_seller as (
  select public.create_verified_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', '2026-08-14', '2026-09-14',
    'b1000000-0000-4000-8000-000000000081'
  ) result
)
insert into s1_values values
  ('invalid_seller_quote_id', (select result->>'id' from invalid_seller)),
  ('invalid_seller_revision_id', (select result->>'current_revision_id' from invalid_seller));
select lives_ok($$select public.save_quote_draft(
  (select value::uuid from s1_values where key='invalid_seller_quote_id'), 1,
  'b1000000-0000-4000-8000-000000000082',
  jsonb_build_object(
    'customer_id', 'a3000000-0000-4000-8000-000000000001', 'currency_code', 'INR',
    'locale', 'en-IN', 'tax_label', 'GST 18%', 'tax_mode', 'exclusive',
    'discount_bps', 0, 'issue_date', '2026-08-14', 'valid_until', '2026-09-14',
    'notes', 'Invalid sealed seller structure test', 'items', jsonb_build_array(jsonb_build_object(
      'line_id', null, 'product_id', 'a2000000-0000-4000-8000-000000000001',
      'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
    )), 'charges', '[]'::jsonb
  ))$$, 'invalid-seller regression draft prepares through the existing calculator boundary');
select lives_ok($$select public.submit_quote_revision(
  (select value::uuid from s1_values where key='invalid_seller_quote_id'),
  (select value::uuid from s1_values where key='invalid_seller_revision_id'), 2,
  'b1000000-0000-4000-8000-000000000083')$$, 'invalid-seller regression revision seals before corruption');
reset role;
alter table public.quote_revisions disable trigger quote_revisions_authority_immutable;
with invalid_snapshot as (
  select revision.id,
    jsonb_set(revision.snapshot, '{seller}', (revision.snapshot -> 'seller') - 'contact_phone') snapshot
  from public.quote_revisions revision
  where revision.id=(select value::uuid from s1_values where key='invalid_seller_revision_id')
)
update public.quote_revisions revision
set snapshot = invalid_snapshot.snapshot,
  canonical_snapshot = public.canonical_json_v1(invalid_snapshot.snapshot),
  snapshot_hash = public.sha256_hex(public.canonical_json_v1(invalid_snapshot.snapshot))
from invalid_snapshot
where revision.id = invalid_snapshot.id;
alter table public.quote_revisions enable trigger quote_revisions_authority_immutable;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.issue_quote_revision(
  (select value::uuid from s1_values where key='invalid_seller_quote_id'),
  (select value::uuid from s1_values where key='invalid_seller_revision_id'), 3,
  'b1000000-0000-4000-8000-000000000084')$$,
  '55000', 'sealed_seller_snapshot_invalid', 'issuance fails safely when the required sealed seller structure is missing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with legacy as (
  select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', '2026-08-14', '2026-09-14',
    'b1000000-0000-4000-8000-000000000007'
  ) result
)
insert into s1_values values ('legacy_quote_id', (select result->>'id' from legacy));
select lives_ok($$select public.save_quote_draft(
  (select value::uuid from s1_values where key='legacy_quote_id'), 1,
  'b1000000-0000-4000-8000-000000000019',
  jsonb_build_object(
    'customer_id', 'a3000000-0000-4000-8000-000000000001', 'currency_code', 'INR',
    'locale', 'en-IN', 'tax_label', 'GST 18%', 'tax_mode', 'exclusive',
    'discount_bps', 0, 'issue_date', '2026-08-14', 'valid_until', '2026-09-14',
    'notes', 'Issued legacy evidence', 'items', jsonb_build_array(jsonb_build_object(
      'line_id', null, 'product_id', 'a2000000-0000-4000-8000-000000000001',
      'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
    )), 'charges', '[]'::jsonb
  ))$$, 'legacy quote can be prepared before adoption');
select lives_ok($$select public.submit_quote(
  (select value::uuid from s1_values where key='legacy_quote_id'), 2,
  'b1000000-0000-4000-8000-000000000020')$$, 'legacy quote can be submitted before adoption');
select lives_ok($$select public.issue_quote(
  (select value::uuid from s1_values where key='legacy_quote_id'), 3,
  'b1000000-0000-4000-8000-000000000021')$$, 'legacy quote can be issued before adoption');
with adopted as (
  select public.start_verified_revision_from_legacy_quote(
    (select value::uuid from s1_values where key='legacy_quote_id'), 4,
    'b1000000-0000-4000-8000-000000000008'
  ) result
)
insert into s1_values values
  ('legacy_capture_id', (select result->>'legacy_capture_id' from adopted)),
  ('legacy_revision_id', (select result->>'current_revision_id' from adopted));
select is((select record_kind::text from public.quote_revisions where id=(select value::uuid from s1_values where key='legacy_capture_id')), 'legacy_capture', 'legacy adoption creates explicit capture record');
select is((select snapshot_hash::text from public.quote_revisions where id=(select value::uuid from s1_values where key='legacy_capture_id')), null, 'legacy capture fabricates no verification hash');
select is((select legacy_snapshot->>'evidence_status' from public.quote_revisions where id=(select value::uuid from s1_values where key='legacy_capture_id')), 'unverified_legacy_capture', 'legacy evidence is labeled unverified');
select is((select revision_number from public.quote_revisions where id=(select value::uuid from s1_values where key='legacy_revision_id')), 1, 'legacy adoption starts a separate verified revision 1');
select throws_ok($$select public.start_verified_revision_from_legacy_quote(
  (select value::uuid from s1_values where key='legacy_quote_id'), 5, extensions.gen_random_uuid())$$,
  '55000', 'quote_already_revisioned', 'legacy adoption is one guarded transition');

select * from finish();
rollback;
