begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);

create or replace function pg_temp.make_prepared_quote(p_discount_bps integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
  quote_id uuid;
begin
  created := public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', '2026-07-22', '2026-08-22', extensions.gen_random_uuid()
  );
  quote_id := (created->>'id')::uuid;
  perform public.save_quote_draft(quote_id, 1, extensions.gen_random_uuid(), jsonb_build_object(
    'customer_id', 'a3000000-0000-4000-8000-000000000001', 'currency_code', 'INR',
    'locale', 'en-IN', 'tax_label', 'GST 18%', 'tax_mode', 'exclusive',
    'discount_bps', p_discount_bps, 'issue_date', '2026-07-22', 'valid_until', '2026-08-22',
    'notes', '', 'items', jsonb_build_array(jsonb_build_object(
      'line_id', null,
      'product_id', 'a2000000-0000-4000-8000-000000000001',
      'position', 1,
      'quantity_scaled', 1,
      'quantity_scale', 1
    )),
    'charges', '[]'::jsonb
  ));
  return quote_id;
end;
$$;

create temporary table workflow_quotes (label text primary key, id uuid not null);
grant all on workflow_quotes to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into workflow_quotes values
  ('boundary', pg_temp.make_prepared_quote(1000)),
  ('waiting_approve', pg_temp.make_prepared_quote(1001)),
  ('waiting_reject', pg_temp.make_prepared_quote(1200)),
  ('waiting_stale', pg_temp.make_prepared_quote(1500));

select lives_ok($$select public.submit_quote((select id from workflow_quotes where label='boundary'), 2, 'a6000000-0000-4000-8000-000000000001')$$, 'operator submits 1000 bps boundary quote');
select is((select state::text from public.quotes where id=(select id from workflow_quotes where label='boundary')), 'approved', '1000 bps boundary becomes Approved');
select is((select issued_at from public.quotes where id=(select id from workflow_quotes where label='boundary')), null, 'automatic approval does not issue');
select is((select count(*)::integer from public.quote_activity where quote_id=(select id from workflow_quotes where label='boundary') and event_type='quote.submitted'), 1, 'submit appends one Submitted Activity');
select is((select actor_name_snapshot from public.quote_activity where quote_id=(select id from workflow_quotes where label='boundary') and event_type='quote.approved'), 'Approval rule', 'automatic approval is attributed to Approval rule');
select is((public.submit_quote((select id from workflow_quotes where label='boundary'), 2, 'a6000000-0000-4000-8000-000000000001')->>'version')::integer, 3, 'duplicate submit returns original result');
select is((select count(*)::integer from public.quote_activity where quote_id=(select id from workflow_quotes where label='boundary') and event_type in ('quote.submitted','quote.approved')), 2, 'duplicate submit adds no Activity');
select throws_ok($$select public.submit_quote((select id from workflow_quotes where label='boundary'), 3, extensions.gen_random_uuid())$$, 'P0001', null, 'only Draft can submit');

select lives_ok($$select public.submit_quote((select id from workflow_quotes where label='waiting_approve'), 2, 'a6000000-0000-4000-8000-000000000002')$$, 'operator submits above-threshold quote');
select is((select state::text from public.quotes where id=(select id from workflow_quotes where label='waiting_approve')), 'waiting', '1001 bps becomes Waiting for approval');
select throws_ok($$select public.approve_quote((select id from workflow_quotes where label='waiting_approve'), 3, extensions.gen_random_uuid())$$, '42501', null, 'operator cannot approve');
select throws_ok($$select public.reject_quote((select id from workflow_quotes where label='waiting_approve'), 3, extensions.gen_random_uuid(), 'Operator spoof')$$, '42501', null, 'operator cannot reject');
select throws_ok($$select public.issue_quote((select id from workflow_quotes where label='waiting_approve'), 3, extensions.gen_random_uuid())$$, 'P0001', null, 'only Approved can issue');
select is((select actor_user_id from public.quote_activity where quote_id=(select id from workflow_quotes where label='waiting_approve') and event_type='quote.submitted'), '11111111-1111-4111-8111-111111111111'::uuid, 'submit actor is server-derived signed user');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$select public.approve_quote((select id from workflow_quotes where label='waiting_approve'), 3, 'a6000000-0000-4000-8000-000000000003')$$, 'manager can approve Waiting quote');
select is((select state::text from public.quotes where id=(select id from workflow_quotes where label='waiting_approve')), 'approved', 'manager decision becomes Approved');
select is((select actor_name_snapshot from public.quote_activity where quote_id=(select id from workflow_quotes where label='waiting_approve') and event_type='quote.approved'), 'Mira Manager', 'manager actor snapshot is server-derived');
select is((public.approve_quote((select id from workflow_quotes where label='waiting_approve'), 3, 'a6000000-0000-4000-8000-000000000003')->>'version')::integer, 4, 'duplicate approval returns original result');
select is((select count(*)::integer from public.quote_activity where quote_id=(select id from workflow_quotes where label='waiting_approve') and event_type='quote.approved'), 1, 'duplicate approval adds no Activity');
select throws_ok($$select public.approve_quote((select id from workflow_quotes where label='waiting_approve'), 4, extensions.gen_random_uuid())$$, 'P0001', null, 'only Waiting can approve');
select throws_ok($$select public.reject_quote((select id from workflow_quotes where label='waiting_approve'), 4, extensions.gen_random_uuid(), 'Already approved')$$, 'P0001', null, 'only Waiting can reject');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$select public.approve_quote((select id from workflow_quotes where label='waiting_stale'), 3, extensions.gen_random_uuid())$$, '42501', null, 'other organization cannot decide quote');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$select public.issue_quote((select id from workflow_quotes where label='boundary'), 3, 'a6000000-0000-4000-8000-000000000004')$$, 'operator can issue Approved quote');
select is((select state::text from public.quotes where id=(select id from workflow_quotes where label='boundary')), 'issued', 'Issued is a distinct state');
select matches((select message from public.quote_activity where quote_id=(select id from workflow_quotes where label='boundary') and event_type='quote.issued'), 'Delivery has not occurred', 'issuance explicitly does not claim delivery');
select is(to_regclass('public.domain_events'), null, 'Milestone A creates no domain events table');
select is(to_regclass('public.outbox_events'), null, 'Milestone A creates no outbox table');
select throws_ok($$select public.issue_quote((select id from workflow_quotes where label='waiting_reject'), 2, extensions.gen_random_uuid())$$, 'P0001', null, 'Draft cannot issue');

select lives_ok($$select public.submit_quote((select id from workflow_quotes where label='waiting_reject'), 2, 'a6000000-0000-4000-8000-000000000005')$$, 'rejection fixture submits to Waiting');
select lives_ok($$select public.submit_quote((select id from workflow_quotes where label='waiting_stale'), 2, 'a6000000-0000-4000-8000-000000000006')$$, 'stale fixture submits to Waiting');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$select public.reject_quote((select id from workflow_quotes where label='waiting_reject'), 3, 'a6000000-0000-4000-8000-000000000007', '<img src=x onerror=alert(1)> Commercial risk is too high.')$$, 'manager can reject with bounded untrusted reason');
select is((select rejected_reason from public.quotes where id=(select id from workflow_quotes where label='waiting_reject')), '<img src=x onerror=alert(1)> Commercial risk is too high.', 'rejection reason is preserved as data');
select is((select safe_metadata->>'reason' from public.quote_activity where quote_id=(select id from workflow_quotes where label='waiting_reject') and event_type='quote.rejected'), '<img src=x onerror=alert(1)> Commercial risk is too high.', 'Activity safely records rejection reason');
select throws_ok($$select public.issue_quote((select id from workflow_quotes where label='waiting_reject'), 4, extensions.gen_random_uuid())$$, 'P0001', null, 'Rejected quote cannot issue');
select throws_ok($$update public.quote_activity set message='spoofed' where quote_id=(select id from workflow_quotes where label='waiting_reject')$$, '42501', null, 'Activity update is denied');
select throws_ok($$delete from public.quote_activity where quote_id=(select id from workflow_quotes where label='waiting_reject')$$, '42501', null, 'Activity delete is denied');
select throws_ok($$insert into public.quote_activity (organization_id,quote_id,event_type,actor_user_id,actor_name_snapshot,actor_role_snapshot,actor_source,message) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(select id from workflow_quotes limit 1),'quote.approved',auth.uid(),'Spoofed actor','Manager','signed_user','Spoofed')$$, '42501', null, 'client cannot spoof Activity actor');
select throws_ok($$update public.quotes set total_minor=1 where id=(select id from workflow_quotes limit 1)$$, '42501', null, 'client cannot spoof totals');
select throws_ok($$select public.approve_quote((select id from workflow_quotes where label='waiting_stale'), 2, extensions.gen_random_uuid())$$, 'P0001', null, 'stale decision version is rejected');
select is((select state::text from public.quotes where id=(select id from workflow_quotes where label='waiting_stale')), 'waiting', 'stale decision leaves Waiting state unchanged');
select is((select approved_by from public.quotes where id=(select id from workflow_quotes where label='boundary')), null, 'automatic threshold approval does not spoof a signed approver');
select is((select actor_source::text from public.quote_activity where quote_id=(select id from workflow_quotes where label='boundary') and event_type='quote.approved'), 'automatic_rule', 'automatic approval provenance remains structured');

select * from finish();
rollback;
