begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

select has_column('public', 'organizations', 'timezone', 'organizations carry a configured timezone');
select ok(to_regprocedure('public.is_valid_iana_timezone(text)') is not null, 'IANA timezone validator exists');
select ok(public.is_valid_iana_timezone('UTC'), 'UTC is accepted');
select ok(public.is_valid_iana_timezone('Asia/Kolkata'), 'a bounded IANA region timezone is accepted');
select ok(not public.is_valid_iana_timezone('Mars/Olympus'), 'unknown timezone is rejected');
select ok(to_regprocedure('public.quote_effective_state(quote_state,date,text,timestamp with time zone)') is not null, 'effective-state function exists');
select is(
  public.quote_effective_state('draft', '2026-07-23', 'UTC', '2026-07-23 23:59:59+00')::text,
  'draft',
  'quote remains valid through the final instant of valid_until'
);
select is(
  public.quote_effective_state('draft', '2026-07-23', 'UTC', '2026-07-24 00:00:00+00')::text,
  'expired',
  'quote expires after the UTC local-day boundary'
);
select is(
  public.quote_effective_state('approved', '2026-07-23', 'Asia/Kolkata', '2026-07-23 18:29:59+00')::text,
  'approved',
  'quote remains valid before the organization-local Kolkata boundary'
);
select is(
  public.quote_effective_state('approved', '2026-07-23', 'Asia/Kolkata', '2026-07-23 18:30:00+00')::text,
  'expired',
  'quote expires at the organization-local Kolkata boundary'
);
select is(
  public.quote_effective_state('issued', '2001-01-01', 'UTC', '2026-07-23 00:00:00+00')::text,
  'issued',
  'issued quote never derives expired'
);
select is(
  public.quote_effective_state('rejected', '2001-01-01', 'UTC', '2026-07-23 00:00:00+00')::text,
  'rejected',
  'rejected quote never derives expired'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'quotes_stored_state_not_expired_check'),
  'legacy expired enum value is reserved and not directly writable'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.organizations'::regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
        like '%is_valid_iana_timezone%'
  ),
  0,
  'organization table has no catalog-dependent timezone CHECK'
);

create or replace function pg_temp.make_expiry_quote(p_valid_until date, p_discount_bps integer)
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
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR',
    'en-IN',
    'GST',
    'exclusive',
    p_valid_until - 1,
    p_valid_until,
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
      'issue_date', p_valid_until - 1,
      'valid_until', p_valid_until,
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

create temporary table expiry_quotes (label text primary key, id uuid not null);
grant all on expiry_quotes to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into expiry_quotes values
  ('expired_draft', pg_temp.make_expiry_quote('2001-01-02', 0)),
  ('current_draft', pg_temp.make_expiry_quote(
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ),
    0
  )),
  ('expired_waiting', pg_temp.make_expiry_quote('2001-01-02', 1200)),
  ('expired_approved', pg_temp.make_expiry_quote('2001-01-02', 0));

select throws_ok(
  $$select public.submit_quote(
    (select id from expiry_quotes where label = 'expired_draft'),
    (select version from public.quotes where id = (select id from expiry_quotes where label = 'expired_draft')),
    'c2200000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'QUOTE_EXPIRED',
  'submit rejects an expired draft'
);
select is(
  (select state::text from public.quotes where id = (select id from expiry_quotes where label = 'expired_draft')),
  'draft',
  'failed expired submit leaves stored draft state unchanged'
);
select lives_ok(
  $$select public.submit_quote(
    (select id from expiry_quotes where label = 'current_draft'),
    (select version from public.quotes where id = (select id from expiry_quotes where label = 'current_draft')),
    'c2200000-0000-4000-8000-000000000002'
  )$$,
  'a quote remains submittable throughout its organization-local valid_until date'
);
select is(
  (select state::text from public.quotes where id = (select id from expiry_quotes where label = 'current_draft')),
  'approved',
  'current-day quote follows the normal approval rule'
);

reset role;
update public.quotes quote
set state = case
  when fixture.label = 'expired_waiting' then 'waiting'::public.quote_state
  else 'approved'::public.quote_state
end,
  submitted_by = '11111111-1111-4111-8111-111111111111',
  submitted_at = statement_timestamp(),
  approved_by = case
    when fixture.label = 'expired_approved'
      then '11111111-1111-4111-8111-111111111111'::uuid
    else null
  end,
  approved_at = case
    when fixture.label = 'expired_approved' then statement_timestamp()
    else null
  end,
  customer_name_snapshot = customer.name,
  contact_name_snapshot = customer.contact_name,
  email_snapshot = customer.email,
  billing_address_line1_snapshot = customer.billing_address_line1,
  billing_address_line2_snapshot = customer.billing_address_line2,
  billing_city_snapshot = customer.billing_city,
  billing_region_snapshot = customer.billing_region,
  billing_postal_code_snapshot = customer.billing_postal_code,
  billing_country_code_snapshot = customer.billing_country_code,
  tax_identifier_snapshot = customer.tax_identifier,
  approval_threshold_bps_snapshot = organization.approval_threshold_bps
from expiry_quotes fixture,
  public.customers customer,
  public.organizations organization
where quote.id = fixture.id
  and fixture.label in ('expired_waiting', 'expired_approved')
  and customer.organization_id = quote.organization_id
  and customer.id = quote.customer_id
  and organization.id = quote.organization_id;

select throws_ok(
  $$update public.quotes set state = 'expired' where id = (select id from expiry_quotes where label = 'expired_draft')$$,
  '23514',
  null,
  'stored expired state is forbidden'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$select public.approve_quote(
    (select id from expiry_quotes where label = 'expired_waiting'),
    (select version from public.quotes where id = (select id from expiry_quotes where label = 'expired_waiting')),
    'c2200000-0000-4000-8000-000000000003'
  )$$,
  '22023',
  'QUOTE_EXPIRED',
  'approve rejects an expired waiting quote'
);
select is(
  (select state::text from public.quotes where id = (select id from expiry_quotes where label = 'expired_waiting')),
  'waiting',
  'failed expired approval leaves stored waiting state unchanged'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$select public.issue_quote(
    (select id from expiry_quotes where label = 'expired_approved'),
    (select version from public.quotes where id = (select id from expiry_quotes where label = 'expired_approved')),
    'c2200000-0000-4000-8000-000000000004'
  )$$,
  '22023',
  'QUOTE_EXPIRED',
  'issue rejects an expired approved quote'
);
select is(
  (select state::text from public.quotes where id = (select id from expiry_quotes where label = 'expired_approved')),
  'approved',
  'failed expired issue leaves stored approved state unchanged'
);
select is(
  (
    select count(*)::integer
    from public.quotes quote
    join expiry_quotes fixture on fixture.id = quote.id
    join public.organizations organization on organization.id = quote.organization_id
    where fixture.label = 'expired_waiting'
      and public.quote_effective_state(
        quote.state,
        quote.valid_until,
        organization.timezone,
        statement_timestamp()
      ) = 'waiting'
  ),
  0,
  'expired stored-waiting quote is absent from the effective approval queue'
);

select * from finish();
rollback;
