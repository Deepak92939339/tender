begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

select is((public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":1000,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Exclusive","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"INR","quantity_scaled":3,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb)->>'total_minor')::bigint, 319::bigint, 'exclusive line calculation is exact');
select is((public.calculate_quote_payload('{"currency_code":"EUR","tax_mode":"inclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Inclusive","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":118,"currency_code":"EUR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T18","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb)->>'subtotal_minor')::bigint, 100::bigint, 'inclusive line extracts exact net subtotal');
select is((public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Exempt","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"EX","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"exempt"}],"charges":[]}'::jsonb)->>'tax_minor')::bigint, 0::bigint, 'exempt treatment collects zero tax');
select is((public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Zero","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"ZERO","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"zero_rated"}],"charges":[]}'::jsonb)->>'tax_minor')::bigint, 0::bigint, 'zero-rated treatment collects zero tax');
select is((public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Reverse","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"INR","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"RC","tax_bps_snapshot":1800,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"reverse_charge"}],"charges":[]}'::jsonb)->>'tax_minor')::bigint, 0::bigint, 'reverse-charge treatment collects zero tax');
select is((public.calculate_quote_payload('{"currency_code":"GBP","tax_mode":"exclusive","discount_bps":5000,"items":[],"charges":[{"position":1,"charge_type":"freight","description_snapshot":"Freight","amount_minor":100,"currency_code":"GBP","tax_code_snapshot":"T5","tax_bps_snapshot":500,"tax_price_basis_snapshot":"inclusive","tax_treatment_snapshot":"standard","discount_applies":false}]}'::jsonb)->>'total_minor')::bigint, 105::bigint, 'freight charge has independent tax and no default discount');
select throws_ok($$select public.calculate_quote_payload('{"currency_code":"INR","tax_mode":"exclusive","discount_bps":0,"items":[{"position":1,"product_id":"p1","sku_snapshot":"P1","description_snapshot":"Mixed","unit_code_snapshot":"EA","quantity_precision_snapshot":0,"unit_price_minor_snapshot":100,"currency_code":"USD","quantity_scaled":1,"quantity_scale":1,"tax_code_snapshot":"T0","tax_bps_snapshot":0,"tax_price_basis_snapshot":"exclusive","tax_treatment_snapshot":"standard"}],"charges":[]}'::jsonb)$$, '22023', null, 'mixed item currency is blocked');
select is(public.validate_quantity('EA', 0, 1500, 1000), false, 'fractional EA quantity is rejected');
select is(public.validate_quantity('M', 3, 1500, 1000), true, 'fractional metre quantity is accepted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$select public.create_quote_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-4000-8000-000000000001','INR','en-IN','GST 18%','exclusive','2026-07-22','2026-08-22','a4000000-0000-4000-8000-000000000001')$$, 'operator can create a draft through the command RPC');
select matches((select number from public.quotes where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by created_at limit 1), '^TND-2026-[0-9]{4,}$', 'draft receives immutable organization/year sequence format');
select is((public.create_quote_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-4000-8000-000000000001','INR','en-IN','GST 18%','exclusive','2026-07-22','2026-08-22','a4000000-0000-4000-8000-000000000001')->>'id')::uuid, (select id from public.quotes where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by created_at limit 1), 'duplicate create command returns original quote');
select is((select count(*)::integer from public.quotes where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'duplicate create command creates one quote');
select is((select count(*)::integer from public.quote_activity where event_type = 'draft.created'), 1, 'duplicate create command creates one Activity row');
select is((select state::text from public.quotes where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by created_at limit 1), 'draft', 'new quotation remains Draft and is not auto-issued');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.create_quote_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-4000-8000-000000000099','INR','en-IN','GST','exclusive','2026-07-22','2026-08-22','a4000000-0000-4000-8000-000000000098')$$, '23503', null, 'customer outside the organization is rejected by create RPC');
select lives_ok($$select public.create_quote_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-4000-8000-000000000001','INR','en-IN','GST 18%','exclusive','2026-07-22','2026-08-22','a4000000-0000-4000-8000-000000000002')$$, 'second draft receives next sequence value');
select is((select count(distinct number)::integer from public.quotes where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2, 'organization/year sequence numbers are unique');

select lives_ok($$
  select public.save_quote_draft(
    (select id from public.quotes where number like 'TND-2026-%' order by number limit 1), 1,
    'a4000000-0000-4000-8000-000000000010',
    '{"customer_id":"a3000000-0000-4000-8000-000000000001","currency_code":"INR","locale":"en-IN","tax_label":"GST 18%","tax_mode":"exclusive","discount_bps":1000,"issue_date":"2026-07-22","valid_until":"2026-08-22","notes":"Safe <script>note</script>","subtotal_minor":999999999,"items":[{"line_id":null,"product_id":"a2000000-0000-4000-8000-000000000001","position":1,"quantity_scaled":2,"quantity_scale":1}],"charges":[{"charge_id":null,"position":1,"charge_type":"freight","description":"Road freight","amount_minor":10000,"tax_profile_id":"a1000000-0000-4000-8000-000000000001","discount_applies":false}]}'::jsonb
  )
$$, 'save command accepts valid commercial payload');
select is((select total_minor from public.quotes order by number limit 1), 2390680::bigint, 'server calculates exact item and freight total');
select is((select subtotal_minor from public.quotes order by number limit 1), 2240000::bigint, 'server ignores client-supplied total fields');
select is((select count(*)::integer from public.quote_items item join public.quotes quote on quote.id = item.quote_id where quote.number = (select min(number) from public.quotes)), 1, 'save writes one snapshot item');
select is((select count(*)::integer from public.quote_charges charge join public.quotes quote on quote.id = charge.quote_id where quote.number = (select min(number) from public.quotes)), 1, 'save writes one snapshot charge');
select is((select count(*)::integer from public.quote_activity activity join public.quotes quote on quote.id = activity.quote_id where quote.number = (select min(number) from public.quotes)), 2, 'first commercial preparation appends one bounded Activity row');
select is((public.save_quote_draft(
  (select id from public.quotes order by number limit 1),
  1,
  'a4000000-0000-4000-8000-000000000010',
  '{"customer_id":"a3000000-0000-4000-8000-000000000001","currency_code":"INR","locale":"en-IN","tax_label":"GST 18%","tax_mode":"exclusive","discount_bps":1000,"issue_date":"2026-07-22","valid_until":"2026-08-22","notes":"Safe <script>note</script>","subtotal_minor":999999999,"items":[{"line_id":null,"product_id":"a2000000-0000-4000-8000-000000000001","position":1,"quantity_scaled":2,"quantity_scale":1}],"charges":[{"charge_id":null,"position":1,"charge_type":"freight","description":"Road freight","amount_minor":10000,"tax_profile_id":"a1000000-0000-4000-8000-000000000001","discount_applies":false}]}'::jsonb
)->>'version')::integer, 2, 'exact duplicate save returns original safe result before stale check');
select is((select count(*)::integer from public.quote_items item join public.quotes quote on quote.id = item.quote_id where quote.number = (select min(number) from public.quotes)), 1, 'duplicate save does not duplicate items');
select is((select count(*)::integer from public.quote_activity activity join public.quotes quote on quote.id = activity.quote_id where quote.number = (select min(number) from public.quotes)), 2, 'duplicate save does not duplicate Activity');

do $$
begin
  perform public.update_product(
    'a2000000-0000-4000-8000-000000000001',
    1,
    '{"sku":"PCA-220","description":"Precision coupling assembly","unit_code":"EA","quantity_precision":0,"unit_price_minor":1,"currency_code":"INR","tax_profile_id":"a1000000-0000-4000-8000-000000000001","active":true}'::jsonb,
    'a4000000-0000-4000-8000-000000000015'
  );
end
$$;
select is((select unit_price_minor_snapshot from public.quote_items item join public.quotes quote on quote.id = item.quote_id where quote.number = (select min(number) from public.quotes)), 1120000::bigint, 'product price changes do not mutate saved snapshots');
select throws_ok($$select public.save_quote_draft((select id from public.quotes order by number limit 1), 1, 'a4000000-0000-4000-8000-000000000011', '{}'::jsonb)$$, 'P0001', null, 'stale expected version is rejected without transaction retries');
select throws_ok($$select public.save_quote_draft((select id from public.quotes order by number limit 1), 2, 'a4000000-0000-4000-8000-000000000012', '{"customer_id":"a3000000-0000-4000-8000-000000000001","currency_code":"USD","locale":"en-IN","tax_label":"Tax","tax_mode":"exclusive","discount_bps":0,"issue_date":"2026-07-22","valid_until":"2026-08-22","notes":"","items":[{"line_id":null,"product_id":"a2000000-0000-4000-8000-000000000001","position":1,"quantity_scaled":1,"quantity_scale":1}],"charges":[]}'::jsonb)$$, '22023', null, 'mixed currency save fails atomically');
select is((select version from public.quotes order by number limit 1), 2, 'failed save leaves quote version unchanged');
select throws_ok($$select public.save_quote_draft((select id from public.quotes order by number limit 1), 2, 'a4000000-0000-4000-8000-000000000013', '{"customer_id":"a3000000-0000-4000-8000-000000000001","currency_code":"INR","locale":"en-IN","tax_label":"Tax","tax_mode":"exclusive","discount_bps":0,"issue_date":"2026-07-22","valid_until":"2026-08-22","notes":"","items":[{"line_id":null,"product_id":"b2000000-0000-4000-8000-000000000001","position":1,"quantity_scaled":1,"quantity_scale":1}],"charges":[]}'::jsonb)$$, '23503', null, 'cross-organization product is rejected');
select lives_ok($$select public.save_quote_draft((select id from public.quotes order by number limit 1), 2, 'a4000000-0000-4000-8000-000000000014', '{"customer_id":"a3000000-0000-4000-8000-000000000001","currency_code":"INR","locale":"en-IN","tax_label":"GST","tax_mode":"exclusive","discount_bps":0,"issue_date":"2026-07-22","valid_until":"2026-08-22","notes":"<img src=x onerror=alert(1)>","items":[],"charges":[]}'::jsonb)$$, 'bounded malicious-looking note remains ordinary data');
select is((select notes from public.quotes order by number limit 1), '<img src=x onerror=alert(1)>', 'malicious-looking note round-trips as inert text');
select throws_ok($$update public.quotes set state = 'issued' where id = (select id from public.quotes order by number limit 1)$$, '42501', null, 'browser role cannot directly change quote state');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::integer from public.quotes), 0, 'other organization cannot read quotes');

reset role;
select throws_ok($$
  insert into public.quotes (organization_id, number, customer_id, currency_code, locale, tax_label, tax_mode, customer_tax_treatment, issue_date, valid_until, created_by)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TND-2026-9999','a3000000-0000-4000-8000-000000000099','INR','en-IN','Tax','exclusive','standard','2026-07-22','2026-08-22','11111111-1111-4111-8111-111111111111')
$$, '23503', null, 'customer organization mismatch is structurally impossible');

select * from finish();
rollback;
