begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select has_column('public', 'command_receipts', 'scope_type', 'receipts declare their scope type');
select has_column('public', 'command_receipts', 'scope_id', 'receipts declare their user or organization scope');
select has_column('public', 'command_receipts', 'request_hash', 'receipts retain a canonical command request hash');

create or replace function pg_temp.receipt_payload(
  p_issue_date date,
  p_valid_until date,
  p_notes text,
  p_quantity_scaled integer default 1
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'customer_id', 'a3000000-0000-4000-8000-000000000001',
    'currency_code', 'INR',
    'locale', 'en-IN',
    'tax_label', 'GST',
    'tax_mode', 'exclusive',
    'discount_bps', 0,
    'issue_date', p_issue_date,
    'valid_until', p_valid_until,
    'notes', p_notes,
    'items', jsonb_build_array(jsonb_build_object(
      'line_id', null,
      'product_id', 'a2000000-0000-4000-8000-000000000001',
      'position', 1,
      'quantity_scaled', p_quantity_scaled,
      'quantity_scale', 1
    )),
    'charges', '[]'::jsonb
  )
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.create_organization(
    'Receipt Operator Organization',
    'receipt-operator-organization',
    'c2000000-0000-4000-8000-000000000001'
  )$$,
  'onboarding creates a user-scoped receipt'
);
select is(
  public.create_organization(
    'Receipt Operator Organization',
    'receipt-operator-organization',
    'c2000000-0000-4000-8000-000000000001'
  ) ->> 'slug',
  'receipt-operator-organization',
  'an exact onboarding replay returns its original acknowledgement'
);
select throws_ok(
  $$select public.create_organization(
    'Changed command meaning',
    'changed-command-meaning',
    'c2000000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'command_id_collision',
  'a user-scoped onboarding command ID cannot be reused with changed semantics'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select lives_ok(
  $$select public.create_organization(
    'Receipt Outsider Organization',
    'receipt-outsider-organization',
    'c2000000-0000-4000-8000-000000000001'
  )$$,
  'the same command UUID remains independent in another user scope'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR',
    'en-IN',
    'GST',
    'exclusive',
    current_date,
    current_date + 30,
    'c2000000-0000-4000-8000-000000000010'
  )$$,
  'organization-scoped quote creation records its command'
);
select throws_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000002',
    'EUR',
    'de-DE',
    'VAT',
    'inclusive',
    current_date,
    current_date + 60,
    'c2000000-0000-4000-8000-000000000010'
  )$$,
  '22023',
  'command_id_collision',
  'a quote-create command ID cannot be reused with changed header semantics'
);

create temporary table receipt_quotes as
select id, number, version
from public.quotes
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and created_by = auth.uid()
  and issue_date = current_date
order by created_at desc
limit 1;

select lives_ok(
  $$select public.save_quote_draft(
    (select id from receipt_quotes limit 1),
    1,
    'c2000000-0000-4000-8000-000000000011',
    pg_temp.receipt_payload(current_date, current_date + 30, 'Receipt stable')
  )$$,
  'organization-scoped draft save records its command'
);
select is(
  (
    public.save_quote_draft(
      (select id from receipt_quotes limit 1),
      1,
      'c2000000-0000-4000-8000-000000000011',
      pg_temp.receipt_payload(current_date, current_date + 30, 'Receipt stable')
    ) ->> 'version'
  )::integer,
  2,
  'an exact save replay returns the original authoritative version'
);
select throws_ok(
  $$select public.save_quote_draft(
    (select id from receipt_quotes limit 1),
    1,
    'c2000000-0000-4000-8000-000000000011',
    pg_temp.receipt_payload(current_date, current_date + 30, 'Changed command meaning', 2)
  )$$,
  '22023',
  'command_id_collision',
  'a save command ID cannot be reused with changed version or payload semantics'
);

select lives_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR',
    'en-IN',
    'GST',
    'exclusive',
    current_date + 1,
    current_date + 31,
    'c2000000-0000-4000-8000-000000000012'
  )$$,
  'a second quote is available for aggregate-collision proof'
);

insert into receipt_quotes
select id, number, version
from public.quotes
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and created_by = auth.uid()
  and issue_date = current_date + 1
order by created_at desc
limit 1;

select lives_ok(
  $$select public.save_quote_draft(
    (select id from receipt_quotes where version = 1 order by number desc limit 1),
    1,
    'c2000000-0000-4000-8000-000000000013',
    pg_temp.receipt_payload(current_date + 1, current_date + 31, '')
  )$$,
  'the second quote is prepared'
);
select lives_ok(
  $$select public.submit_quote(
    (select id from receipt_quotes where version = 1 order by number asc limit 1),
    2,
    'c2000000-0000-4000-8000-000000000014'
  )$$,
  'the first workflow command records its aggregate'
);
select throws_ok(
  $$select public.submit_quote(
    (select id from receipt_quotes where version = 1 order by number desc limit 1),
    2,
    'c2000000-0000-4000-8000-000000000014'
  )$$,
  '22023',
  'command_id_collision',
  'a workflow command ID cannot be reused for another aggregate'
);

select * from finish();
rollback;
