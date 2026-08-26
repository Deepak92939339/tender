begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select is(
  (select label from public.roles where key = 'reviewer'),
  'Read-only reviewer',
  'reviewer role is installed'
);

select is(
  array(
    select capability.key
    from public.roles role
    join public.role_capabilities mapping on mapping.role_id = role.id
    join public.capabilities capability on capability.key = mapping.capability_key
    where role.key = 'reviewer'
    order by capability.key
  ),
  array['catalog.read', 'customer.read', 'organization.read', 'quote.read'],
  'reviewer receives only the four intended read capabilities'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select ok(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organization.read'), 'reviewer can read organization');
select ok(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'catalog.read'), 'reviewer can read catalog');
select ok(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'customer.read'), 'reviewer can read customers');
select ok(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'quote.read'), 'reviewer can read quotes');
select is(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'catalog.manage'), false, 'reviewer cannot manage catalog');
select is(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'customer.manage'), false, 'reviewer cannot manage customers');
select is(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'quote.create'), false, 'reviewer cannot create quotes');
select is(public.has_org_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'quote.approve'), false, 'reviewer cannot approve quotes');

select * from finish();
rollback;
