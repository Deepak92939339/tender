begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test', crypt('TenderLocal1!', gen_salt('bf')), now(), '{}', '{"display_name":"RLS User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test', crypt('TenderLocal1!', gen_salt('bf')), now(), '{}', '{"display_name":"RLS User B"}', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.create_organization('RLS Alpha', 'rls-alpha', '90000000-0000-4000-8000-000000000011')$$,
  'authenticated user can atomically create an organization'
);
select is(
  (select public.create_organization('RLS Alpha', 'rls-alpha', '90000000-0000-4000-8000-000000000011')->>'slug'),
  'rls-alpha',
  'duplicate onboarding command returns original result'
);
select is((select count(*)::integer from public.organizations where slug = 'rls-alpha'), 1, 'duplicate command creates one organization');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.create_organization('RLS Beta', 'rls-beta', '90000000-0000-4000-8000-000000000012')$$,
  'second user can create an isolated organization'
);

reset role;
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok(
  $$select count(*) from public.organizations$$,
  '42501', null,
  'anonymous cannot read organizations'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from public.organizations where slug = 'rls-beta'), 0, 'user A cannot read organization B');
select is((select count(*)::integer from public.organization_memberships membership join public.organizations organization on organization.id = membership.organization_id where organization.slug = 'rls-beta'), 0, 'user A cannot read membership B');

reset role;
update public.organization_memberships
set role_id = (select id from public.roles where key = 'operator')
where user_id = '90000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.organization_memberships set status = 'suspended' where user_id = '90000000-0000-4000-8000-000000000002'$$,
  '42501', null,
  'operator cannot manage memberships'
);
select throws_ok(
  $$update public.organization_memberships set role_id = (select id from public.roles where key = 'manager') where user_id = auth.uid()$$,
  '42501', null,
  'client cannot assign itself manager or admin'
);
select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role_id) select organization.id, auth.uid(), role.id from public.organizations organization cross join public.roles role where organization.slug = 'rls-beta' and role.key = 'operator'$$,
  '42501', null,
  'client cannot create a cross-organization membership reference'
);
select throws_ok($$update public.roles set label = 'Owner' where key = 'operator'$$, '42501', null, 'client cannot mutate roles');
select throws_ok($$update public.capabilities set label = 'Everything' where key = 'quote.read'$$, '42501', null, 'client cannot mutate capabilities');

reset role;
update public.organization_memberships set status = 'suspended' where user_id = '90000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from public.organizations), 0, 'suspended user cannot read organization data');
select is(public.has_org_capability((select id from public.organizations where slug = 'rls-alpha'), 'quote.read'), false, 'suspended user has no capability');

select * from finish();
rollback;
