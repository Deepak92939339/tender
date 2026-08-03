begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

create temporary table r2_customer as
select (
  public.create_customer(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{
      "name":"R2 Archived Customer",
      "contact_name":"R2 Contact",
      "email":"r2@example.test",
      "phone":"",
      "billing_address_line1":"2 Recovery Road",
      "billing_address_line2":"",
      "billing_city":"Pune",
      "billing_region":"Maharashtra",
      "billing_postal_code":"411001",
      "billing_country_code":"IN",
      "locale":"en-IN",
      "preferred_currency_code":"INR",
      "tax_treatment":"standard",
      "tax_identifier":"",
      "active":true
    }'::jsonb,
    'd2000000-0000-4000-8000-000000000001'
  ) ->> 'id'
)::uuid as id;

select is(
  (select active from public.customers where id = (select id from r2_customer)),
  true,
  'R2 fixture customer starts active'
);

create temporary table r2_quote as
select result ->> 'number' as number, (result ->> 'id')::uuid as id
from (
  select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select id from r2_customer),
    'INR',
    'en-IN',
    'Configured tax',
    'exclusive',
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ),
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ) + 30,
    'd2000000-0000-4000-8000-000000000002'
  ) as result
) created;

select ok(
  (select id is not null from r2_quote),
  'an active customer can be bound to a new draft'
);

select lives_ok(
  $$select public.archive_customer(
    (select id from r2_customer),
    1,
    'd2000000-0000-4000-8000-000000000003'
  )$$,
  'the bound customer can later be archived non-destructively'
);

select throws_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select id from r2_customer),
    'INR',
    'en-IN',
    'Configured tax',
    'exclusive',
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ),
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ) + 30,
    'd2000000-0000-4000-8000-000000000004'
  )$$,
  '55000',
  'CUSTOMER_ARCHIVED',
  'create_draft_with_archived_customer_is_denied'
);

select is(
  (
    select quote.customer_id
    from public.quotes quote
    where quote.id = (select id from r2_quote)
  ),
  (select id from r2_customer),
  'existing draft retains its historically bound archived customer'
);

select is(
  public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select id from r2_customer),
    'INR',
    'en-IN',
    'Configured tax',
    'exclusive',
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ),
    public.organization_local_date(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement_timestamp()
    ) + 30,
    'd2000000-0000-4000-8000-000000000002'
  ) ->> 'id',
  (select id::text from r2_quote),
  'exact create replay remains stable after customer archival'
);

select * from finish();
rollback;
