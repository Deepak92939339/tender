begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(62);

select has_column('public', 'organizations', 'seller_legal_name', 'organization has seller legal name');
select has_column('public', 'organizations', 'seller_address_line1', 'organization has seller address line 1');
select has_column('public', 'organizations', 'seller_address_line2', 'organization has seller address line 2');
select has_column('public', 'organizations', 'seller_city', 'organization has seller city');
select has_column('public', 'organizations', 'seller_region', 'organization has seller region');
select has_column('public', 'organizations', 'seller_postal_code', 'organization has seller postal code');
select has_column('public', 'organizations', 'seller_country_code', 'organization has seller country code');
select has_column('public', 'organizations', 'seller_tax_identifier', 'organization has seller tax identifier');
select has_column('public', 'organizations', 'seller_contact_email', 'organization has seller contact email');
select has_column('public', 'organizations', 'seller_contact_phone', 'organization has seller contact phone');
select has_column('public', 'organizations', 'seller_profile_version', 'organization has seller profile version');

select has_column('public', 'quotes', 'seller_legal_name_snapshot', 'quote has seller legal-name snapshot');
select has_column('public', 'quotes', 'seller_address_line1_snapshot', 'quote has seller address-line-1 snapshot');
select has_column('public', 'quotes', 'seller_address_line2_snapshot', 'quote has seller address-line-2 snapshot');
select has_column('public', 'quotes', 'seller_city_snapshot', 'quote has seller city snapshot');
select has_column('public', 'quotes', 'seller_region_snapshot', 'quote has seller region snapshot');
select has_column('public', 'quotes', 'seller_postal_code_snapshot', 'quote has seller postal-code snapshot');
select has_column('public', 'quotes', 'seller_country_code_snapshot', 'quote has seller country-code snapshot');
select has_column('public', 'quotes', 'seller_tax_identifier_snapshot', 'quote has seller tax-identifier snapshot');
select has_column('public', 'quotes', 'seller_contact_email_snapshot', 'quote has seller contact-email snapshot');
select has_column('public', 'quotes', 'seller_contact_phone_snapshot', 'quote has seller contact-phone snapshot');

select is(
  (
    select count(*)::integer
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'quotes'
      and column_definition.column_name in (
        'seller_legal_name_snapshot',
        'seller_address_line1_snapshot',
        'seller_address_line2_snapshot',
        'seller_city_snapshot',
        'seller_region_snapshot',
        'seller_postal_code_snapshot',
        'seller_country_code_snapshot',
        'seller_tax_identifier_snapshot',
        'seller_contact_email_snapshot',
        'seller_contact_phone_snapshot'
      )
      and column_definition.is_nullable = 'YES'
  ),
  10,
  'pre-R legacy issued rows may retain null seller snapshots'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.organizations',
    'seller_address_line1',
    'UPDATE'
  ),
  'authenticated has no direct seller-profile column update'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.issue_quote_c0_impl(uuid,integer,uuid)',
    'EXECUTE'
  ),
  'private issue implementation remains revoked'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.issue_quote(uuid,integer,uuid)',
    'EXECUTE'
  ),
  'authenticated retains only the guarded public issue RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.maintain_organization_seller_profile()',
    'EXECUTE'
  ),
  'seller-profile trigger helper remains internal'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.prevent_quote_seller_snapshot_change()',
    'EXECUTE'
  ),
  'seller-snapshot trigger helper remains internal'
);

select throws_ok(
  $$update public.organizations
    set seller_country_code = 'in'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514',
  null,
  'seller country code rejects lowercase values'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select lives_ok(
  $$select public.create_organization(
    'R5 Fresh Seller',
    'r5-fresh-seller',
    'c5000000-0000-4000-8000-000000000001'
  )$$,
  'new organization is initialized through the guarded RPC'
);

reset role;

select is(
  (
    select organization.seller_legal_name
      || ':'
      || organization.seller_profile_version::text
    from public.organizations organization
    where organization.slug = 'r5-fresh-seller'
  ),
  'R5 Fresh Seller:1',
  'new organization initializes legal name from organization name at version one'
);

select is(
  (
    select organization.seller_profile_version
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  1,
  'seeded seller profile starts at version one'
);

create or replace function pg_temp.make_r5_approved_quote()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
  quote_id uuid;
  today date;
begin
  today := public.organization_local_date(
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
    today,
    today + 30,
    extensions.gen_random_uuid()
  );
  quote_id := (created ->> 'id')::uuid;
  perform public.save_quote_draft(
    quote_id,
    1,
    extensions.gen_random_uuid(),
    jsonb_build_object(
      'customer_id',
      'a3000000-0000-4000-8000-000000000001',
      'currency_code',
      'INR',
      'locale',
      'en-IN',
      'tax_label',
      'GST',
      'tax_mode',
      'exclusive',
      'discount_bps',
      0,
      'issue_date',
      today,
      'valid_until',
      today + 30,
      'notes',
      '',
      'items',
      jsonb_build_array(
        jsonb_build_object(
          'line_id',
          null,
          'product_id',
          'a2000000-0000-4000-8000-000000000001',
          'position',
          1,
          'quantity_scaled',
          1,
          'quantity_scale',
          1
        )
      ),
      'charges',
      '[]'::jsonb
    )
  );
  perform public.submit_quote(
    quote_id,
    2,
    extensions.gen_random_uuid()
  );
  return quote_id;
end;
$$;

create or replace function pg_temp.capture_r5_issue_error(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  error_state text;
  error_message text;
  error_detail text;
begin
  perform public.issue_quote(
    p_quote_id,
    p_expected_version,
    p_command_id
  );
  return null;
exception
  when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_detail = pg_exception_detail;
    return jsonb_build_object(
      'state',
      error_state,
      'message',
      error_message,
      'detail',
      error_detail
    );
end;
$$;

create temporary table r5_quotes (
  label text primary key,
  id uuid not null,
  issue_command uuid not null,
  issue_result jsonb
);
grant all on r5_quotes to authenticated;
grant execute on function pg_temp.make_r5_approved_quote() to authenticated;
grant execute on function
  pg_temp.capture_r5_issue_error(uuid, integer, uuid)
to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into r5_quotes (label, id, issue_command)
    values (
      'incomplete',
      pg_temp.make_r5_approved_quote(),
      'c5000000-0000-4000-8000-000000000010'
    )$$,
  'approved quote is prepared for incomplete-seller proof'
);

reset role;

select throws_ok(
  $$update public.quotes
    set
      state = 'issued',
      issued_by = '11111111-1111-4111-8111-111111111111',
      issued_at = now()
    where id = (select id from r5_quotes where label = 'incomplete')$$,
  '55000',
  'SELLER_PROFILE_INCOMPLETE',
  'new issued transition cannot omit required seller snapshots'
);

update public.organizations organization
set
  seller_legal_name = null,
  seller_address_line1 = null,
  seller_city = null,
  seller_country_code = null
where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (
    select organization.seller_profile_version
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  2,
  'required seller-field edit increments seller profile version exactly once'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  pg_temp.capture_r5_issue_error(
    (select id from r5_quotes where label = 'incomplete'),
    3,
    (select issue_command from r5_quotes where label = 'incomplete')
  ) ->> 'state',
  '55000',
  'issue_requires_minimum_seller_profile'
);

select is(
  pg_temp.capture_r5_issue_error(
    (select id from r5_quotes where label = 'incomplete'),
    3,
    (select issue_command from r5_quotes where label = 'incomplete')
  ) ->> 'message',
  'SELLER_PROFILE_INCOMPLETE',
  'incomplete seller profile returns the bounded domain code'
);

select is(
  pg_temp.capture_r5_issue_error(
    (select id from r5_quotes where label = 'incomplete'),
    3,
    (select issue_command from r5_quotes where label = 'incomplete')
  ) ->> 'detail',
  'missing_fields=seller_legal_name,seller_address_line1,seller_city,seller_country_code',
  'incomplete seller profile returns fixed-order bounded field guidance'
);

reset role;

select is(
  (
    select quote.state::text
      || ':'
      || quote.version::text
      || ':'
      || (quote.issued_at is null)::text
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'incomplete')
  ),
  'approved:3:true',
  'incomplete issue leaves quote state, version and issued time unchanged'
);

select is(
  (
    select num_nonnulls(
      quote.seller_legal_name_snapshot,
      quote.seller_address_line1_snapshot,
      quote.seller_address_line2_snapshot,
      quote.seller_city_snapshot,
      quote.seller_region_snapshot,
      quote.seller_postal_code_snapshot,
      quote.seller_country_code_snapshot,
      quote.seller_tax_identifier_snapshot,
      quote.seller_contact_email_snapshot,
      quote.seller_contact_phone_snapshot
    )
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'incomplete')
  ),
  0,
  'incomplete issue writes no seller snapshot'
);

select is(
  (
    select count(*)::integer
    from public.quote_activity activity
    where activity.quote_id = (
      select id from r5_quotes where label = 'incomplete'
    )
      and activity.event_type = 'quote.issued'
  ),
  0,
  'incomplete issue writes no issued Activity row'
);

select is(
  (
    select count(*)::integer
    from public.command_receipts receipt
    where receipt.command_id = (
      select issue_command from r5_quotes where label = 'incomplete'
    )
  ),
  0,
  'incomplete issue writes no command receipt'
);

update public.organizations organization
set
  seller_legal_name = 'Tender Demonstration Company',
  seller_address_line1 = '14 Commerce Avenue',
  seller_address_line2 = 'Industrial District',
  seller_city = 'Pune',
  seller_region = 'Maharashtra',
  seller_postal_code = '411001',
  seller_country_code = 'IN',
  seller_tax_identifier = 'GSTIN-DEMO-TENDER',
  seller_contact_email = 'sales@tender.local',
  seller_contact_phone = '+91 20 5550 0100'
where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (
    select organization.seller_profile_version
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  3,
  'restoring seller fields increments profile version exactly once'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into r5_quotes (label, id, issue_command)
    values (
      'issued',
      pg_temp.make_r5_approved_quote(),
      'c5000000-0000-4000-8000-000000000020'
    )$$,
  'approved quote is prepared for seller-snapshot proof'
);

select lives_ok(
  $$update r5_quotes
    set issue_result = public.issue_quote(id, 3, issue_command)
    where label = 'issued'$$,
  'complete seller profile permits issuance'
);

reset role;

select is(
  (
    select quote.state::text || ':' || quote.version::text
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  'issued:4',
  'issue transitions the quote atomically'
);

select is(
  (
    select jsonb_build_object(
      'legal_name',
      quote.seller_legal_name_snapshot,
      'address_line1',
      quote.seller_address_line1_snapshot,
      'address_line2',
      quote.seller_address_line2_snapshot,
      'city',
      quote.seller_city_snapshot,
      'region',
      quote.seller_region_snapshot,
      'postal_code',
      quote.seller_postal_code_snapshot,
      'country_code',
      quote.seller_country_code_snapshot,
      'tax_identifier',
      quote.seller_tax_identifier_snapshot,
      'contact_email',
      quote.seller_contact_email_snapshot,
      'contact_phone',
      quote.seller_contact_phone_snapshot
    )
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  jsonb_build_object(
    'legal_name',
    'Tender Demonstration Company',
    'address_line1',
    '14 Commerce Avenue',
    'address_line2',
    'Industrial District',
    'city',
    'Pune',
    'region',
    'Maharashtra',
    'postal_code',
    '411001',
    'country_code',
    'IN',
    'tax_identifier',
    'GSTIN-DEMO-TENDER',
    'contact_email',
    'sales@tender.local',
    'contact_phone',
    '+91 20 5550 0100'
  ),
  'issue_snapshots_seller_identity'
);

select is(
  (
    select count(*)::integer
    from public.quote_activity activity
    where activity.quote_id = (
      select id from r5_quotes where label = 'issued'
    )
      and activity.event_type = 'quote.issued'
  ),
  1,
  'successful issue writes one issued Activity row'
);

select is(
  (
    select count(*)::integer
    from public.command_receipts receipt
    where receipt.command_id = (
      select issue_command from r5_quotes where label = 'issued'
    )
  ),
  1,
  'successful issue writes one command receipt'
);

update public.organizations organization
set name = 'Tender Demonstration Company Live Rename'
where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (
    select organization.seller_profile_version
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  3,
  'organization-only rename does not change seller profile version'
);

select is(
  (
    select quote.seller_legal_name_snapshot
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  'Tender Demonstration Company',
  'organization_rename_after_issue_does_not_change_document'
);

update public.organizations organization
set
  seller_legal_name = 'Live Seller Changed',
  seller_address_line1 = '99 Live Seller Road',
  seller_tax_identifier = 'LIVE-TAX-CHANGED'
where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (
    select organization.seller_profile_version
    from public.organizations organization
    where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  4,
  'one multi-field seller edit increments profile version exactly once'
);

select is(
  (
    select quote.seller_address_line1_snapshot
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  '14 Commerce Avenue',
  'seller_address_change_after_issue_does_not_change_document'
);

select is(
  (
    select quote.seller_tax_identifier_snapshot
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  'GSTIN-DEMO-TENDER',
  'seller_tax_identifier_change_after_issue_does_not_change_document'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  public.issue_quote(
    (select id from r5_quotes where label = 'issued'),
    3,
    (select issue_command from r5_quotes where label = 'issued')
  ),
  (select issue_result from r5_quotes where label = 'issued'),
  'repeat_issue_command_does_not_resnapshot'
);

reset role;

select is(
  (
    select quote.seller_legal_name_snapshot
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'issued')
  ),
  'Tender Demonstration Company',
  'exact issue replay retains original seller snapshot'
);

select is(
  (
    select count(*)::integer
    from public.quote_activity activity
    where activity.quote_id = (
      select id from r5_quotes where label = 'issued'
    )
      and activity.event_type = 'quote.issued'
  ),
  1,
  'exact issue replay does not duplicate Activity'
);

select is(
  (
    select count(*)::integer
    from public.command_receipts receipt
    where receipt.command_id = (
      select issue_command from r5_quotes where label = 'issued'
    )
  ),
  1,
  'exact issue replay does not duplicate its receipt'
);

select throws_ok(
  $$update public.quotes
    set seller_tax_identifier_snapshot = 'FORGED'
    where id = (select id from r5_quotes where label = 'issued')$$,
  '55000',
  'quote_seller_snapshots_immutable',
  'issued seller snapshots cannot be rewritten'
);

update public.organizations organization
set
  seller_legal_name = 'Tender Demonstration Company',
  seller_address_line1 = '14 Commerce Avenue',
  seller_address_line2 = null,
  seller_city = 'Pune',
  seller_region = null,
  seller_postal_code = null,
  seller_country_code = 'IN',
  seller_tax_identifier = null,
  seller_contact_email = null,
  seller_contact_phone = null
where organization.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into r5_quotes (label, id, issue_command)
    values (
      'optional_null',
      pg_temp.make_r5_approved_quote(),
      'c5000000-0000-4000-8000-000000000030'
    )$$,
  'approved quote is prepared with optional seller fields null'
);

select lives_ok(
  $$update r5_quotes
    set issue_result = public.issue_quote(id, 3, issue_command)
    where label = 'optional_null'$$,
  'optional seller fields may be null at issuance'
);

reset role;

select is(
  (
    select num_nonnulls(
      quote.seller_address_line2_snapshot,
      quote.seller_region_snapshot,
      quote.seller_postal_code_snapshot,
      quote.seller_tax_identifier_snapshot,
      quote.seller_contact_email_snapshot,
      quote.seller_contact_phone_snapshot
    )
    from public.quotes quote
    where quote.id = (select id from r5_quotes where label = 'optional_null')
  ),
  0,
  'optional null seller fields remain null in the issue snapshot'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select throws_ok(
  $$update public.organizations
    set seller_address_line1 = 'Unauthorized overwrite'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'authenticated direct seller profile update is denied'
);

reset role;

select * from finish();
rollback;
