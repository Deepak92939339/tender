begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select ok(
  not has_function_privilege('authenticated', 'public.calculate_quote_payloads(jsonb)', 'execute'),
  'authenticated cannot execute the batch calculation helper'
);
select throws_ok(
  $$select public.calculate_quote_payloads('[]'::jsonb)$$,
  '42501',
  null,
  'an authenticated batch calculation call is denied'
);

select lives_ok(
  $$select public.create_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR',
    'en-IN',
    'GST',
    'exclusive',
    '2026-07-23',
    '2026-08-23',
    'c1000000-0000-4000-8000-000000000001'
  )$$,
  'bounded-payload subject draft is created'
);

create temporary table c1_subject as
select id, version
from public.quotes
where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and created_by = auth.uid()
  and issue_date = '2026-07-23'
order by created_at desc
limit 1;

select throws_ok(
  $test$
  do $block$
  declare
    oversized_note text;
  begin
    select string_agg(md5(value::text), '') into oversized_note
    from generate_series(1, 10000) value;
    perform public.save_quote_draft(
      (select id from c1_subject),
      (select version from c1_subject),
      'c1000000-0000-4000-8000-000000000002',
      jsonb_build_object(
        'customer_id', 'a3000000-0000-4000-8000-000000000001',
        'currency_code', 'INR',
        'locale', 'en-IN',
        'tax_label', 'GST',
        'tax_mode', 'exclusive',
        'discount_bps', 0,
        'issue_date', '2026-07-23',
        'valid_until', '2026-08-23',
        'notes', oversized_note,
        'items', '[]'::jsonb,
        'charges', '[]'::jsonb
      )
    );
    raise exception using errcode = 'ZX001', message = 'unexpected_success';
  end
  $block$
  $test$,
  '22023',
  'quote_payload_too_large',
  'a draft payload larger than 256 KiB is rejected before mutation'
);

select throws_ok(
  $test$
  do $block$
  begin
    perform public.save_quote_draft(
      (select id from c1_subject),
      (select version from c1_subject),
      'c1000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'customer_id', 'a3000000-0000-4000-8000-000000000001',
        'currency_code', 'INR',
        'locale', 'en-IN',
        'tax_label', 'GST',
        'tax_mode', 'exclusive',
        'discount_bps', 0,
        'issue_date', '2026-07-23',
        'valid_until', '2026-08-23',
        'notes', '',
        'items', (
          select jsonb_agg(jsonb_build_object(
            'product_id', 'a2000000-0000-4000-8000-000000000001',
            'quantity_scaled', 1
          ))
          from generate_series(1, 101)
        ),
        'charges', '[]'::jsonb
      )
    );
    raise exception using errcode = 'ZX001', message = 'unexpected_success';
  end
  $block$
  $test$,
  '22023',
  'quote_item_limit',
  'a 101-item draft payload is rejected before mutation'
);

select throws_ok(
  $test$
  do $block$
  begin
    perform public.save_quote_draft(
      (select id from c1_subject),
      (select version from c1_subject),
      'c1000000-0000-4000-8000-000000000004',
      jsonb_build_object(
        'customer_id', 'a3000000-0000-4000-8000-000000000001',
        'currency_code', 'INR',
        'locale', 'en-IN',
        'tax_label', 'GST',
        'tax_mode', 'exclusive',
        'discount_bps', 0,
        'issue_date', '2026-07-23',
        'valid_until', '2026-08-23',
        'notes', '',
        'items', '[]'::jsonb,
        'charges', (
          select jsonb_agg(jsonb_build_object(
            'charge_type', 'freight',
            'description', 'Bounded charge',
            'amount_minor', 100,
            'tax_profile_id', 'a1000000-0000-4000-8000-000000000001',
            'discount_applies', false
          ))
          from generate_series(1, 26)
        )
      )
    );
    raise exception using errcode = 'ZX001', message = 'unexpected_success';
  end
  $block$
  $test$,
  '22023',
  'quote_charge_limit',
  'a 26-charge draft payload is rejected before mutation'
);

select throws_ok(
  $test$
  do $block$
  begin
    perform public.save_quote_draft(
      (select id from c1_subject),
      (select version from c1_subject),
      'c1000000-0000-4000-8000-000000000005',
      jsonb_build_object(
        'customer_id', 'a3000000-0000-4000-8000-000000000001',
        'currency_code', 'INR',
        'locale', 'en-IN',
        'tax_label', 'GST',
        'tax_mode', 'exclusive',
        'discount_bps', 0,
        'issue_date', '2026-07-23',
        'valid_until', '2026-08-23',
        'notes', repeat('n', 5001),
        'items', '[]'::jsonb,
        'charges', '[]'::jsonb
      )
    );
    raise exception using errcode = 'ZX001', message = 'unexpected_success';
  end
  $block$
  $test$,
  '22023',
  'quote_notes_too_long',
  'overlong commercial notes are rejected before mutation'
);

select is(
  (select version from public.quotes where id = (select id from c1_subject)),
  (select version from c1_subject),
  'failed bounded-payload commands leave the draft version unchanged'
);
select is(
  (select count(*)::integer from public.quote_items where quote_id = (select id from c1_subject)),
  0,
  'failed bounded-payload commands leave draft items unchanged'
);
select is(
  (select count(*)::integer from public.quote_charges where quote_id = (select id from c1_subject)),
  0,
  'failed bounded-payload commands leave draft charges unchanged'
);

select * from finish();
rollback;
