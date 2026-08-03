-- Synthetic local-only identities. Operator, manager and outsider use the
-- local test password referenced by the automated tests. The organization
-- admin has no published reusable password.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'operator@tender.local', crypt('TenderLocal1!', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"display_name":"Aarav Operator"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'manager@tender.local', crypt('TenderLocal1!', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"display_name":"Mira Manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'admin@tender.local', crypt(gen_random_uuid()::text, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"display_name":"Anika Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'outsider@tender.local', crypt('TenderLocal1!', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"display_name":"Omar Outsider"}', now(), now())
on conflict (id) do nothing;

-- Supabase password sign-in requires an email identity as well as an auth user.
-- Keep these rows explicit so a clean local reset produces browser-usable demo accounts.
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  seeded_user.id::text,
  seeded_user.id,
  jsonb_build_object(
    'sub', seeded_user.id::text,
    'email', seeded_user.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users seeded_user
where seeded_user.id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
)
on conflict (provider_id, provider) do nothing;

insert into public.organizations (
  id, slug, name, timezone, created_by,
  seller_legal_name, seller_address_line1, seller_address_line2, seller_city,
  seller_region, seller_postal_code, seller_country_code,
  seller_tax_identifier, seller_contact_email, seller_contact_phone
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'tender-demo',
    'Tender Demonstration Company',
    'Asia/Kolkata',
    '33333333-3333-4333-8333-333333333333',
    'Tender Demonstration Company',
    '14 Commerce Avenue',
    'Industrial District',
    'Pune',
    'Maharashtra',
    '411001',
    'IN',
    'GSTIN-DEMO-TENDER',
    'sales@tender.local',
    '+91 20 5550 0100'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'other-demo',
    'Other Demonstration Company',
    'UTC',
    '44444444-4444-4444-8444-444444444444',
    'Other Demonstration Company',
    '9 Boundary Street',
    null,
    'Bengaluru',
    'Karnataka',
    '560001',
    'IN',
    'GSTIN-DEMO-OTHER',
    'finance@other.tender.local',
    '+91 80 5550 0199'
  )
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, user_id, role_id, status)
select membership.organization_id, membership.user_id, role.id, 'active'::public.membership_status
from (values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'operator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'manager'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'organization_admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'organization_admin')
) membership(organization_id, user_id, role_key)
join public.roles role on role.key = membership.role_key
on conflict (organization_id, user_id) do nothing;

insert into public.tax_profiles (
  id, organization_id, code, label, jurisdiction_country_code, rate_bps,
  price_basis, treatment, active, created_by
) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'IN_GST18', 'India GST 18% — demo configuration', 'IN', 1800, 'exclusive', 'standard', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US_EXAMPLE', 'US sales tax 8.25% — demo configuration', 'US', 825, 'exclusive', 'standard', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DE_VAT19_EX', 'Germany VAT 19% exclusive — demo configuration', 'DE', 1900, 'exclusive', 'standard', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DE_VAT19_IN', 'Germany VAT 19% inclusive — demo configuration', 'DE', 1900, 'inclusive', 'standard', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'UK_VAT20', 'UK VAT 20% — demo configuration', 'GB', 2000, 'exclusive', 'standard', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ZERO', 'Zero-rated — demo configuration', null, 0, 'exclusive', 'zero_rated', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'EXEMPT', 'Exempt — demo configuration', null, 0, 'exclusive', 'exempt', true, '33333333-3333-4333-8333-333333333333'),
  ('a1000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'REVERSE', 'Reverse charge — demo configuration', null, 0, 'exclusive', 'reverse_charge', true, '33333333-3333-4333-8333-333333333333'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'OTHER_TAX', 'Other organization tax — demo', null, 500, 'exclusive', 'standard', true, '44444444-4444-4444-8444-444444444444')
on conflict (organization_id, code) do nothing;

insert into public.products (
  id, organization_id, sku, description, unit_code, quantity_precision,
  unit_price_minor, currency_code, tax_profile_id, active, created_by
) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PCA-220', 'Precision coupling assembly', 'EA', 0, 1120000, 'INR', 'a1000000-0000-4000-8000-000000000001', true, '33333333-3333-4333-8333-333333333333'),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SFR-310', 'Stainless feed rail', 'M', 3, 390000, 'INR', 'a1000000-0000-4000-8000-000000000001', true, '33333333-3333-4333-8333-333333333333'),
  ('a2000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'KIT-008', 'Installation hardware box', 'BOX', 0, 185000, 'INR', 'a1000000-0000-4000-8000-000000000006', true, '33333333-3333-4333-8333-333333333333')
on conflict (organization_id, sku) do nothing;

insert into public.customers (
  id, organization_id, name, contact_name, email, phone,
  billing_address_line1, billing_city, billing_region, billing_postal_code,
  billing_country_code, locale, preferred_currency_code, tax_treatment,
  tax_identifier, created_by
) values
  ('a3000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Asha Engineering Works', 'Priya Mehta', 'procurement@asha.example', '+91 22 5550 0142', '18 Industrial Estate Road', 'Pune', 'Maharashtra', '411001', 'IN', 'en-IN', 'INR', 'standard', 'GSTIN-DEMO-18ASHA', '33333333-3333-4333-8333-333333333333'),
  ('a3000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Helio Fabrication GmbH', 'Lena Fischer', 'einkauf@helio.example', '+49 30 5550 0189', '48 Werkstraße', 'Berlin', 'Berlin', '10115', 'DE', 'de-DE', 'EUR', 'standard', 'DE-DEMO-HELIO', '33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;
