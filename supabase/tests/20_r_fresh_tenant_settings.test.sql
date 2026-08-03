begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(58);

select ok(
  to_regprocedure('public.archive_tax_profile(uuid,integer,uuid)') is not null,
  'legacy tax-profile archive RPC remains available'
);
select ok(
  to_regprocedure(
    'public.archive_tax_profile(uuid,integer,uuid,uuid)'
  ) is not null,
  'replacement-aware tax-profile archive RPC exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.archive_tax_profile(uuid,integer,uuid,uuid)',
    'execute'
  ),
  'authenticated may execute the replacement-aware archive boundary'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.archive_tax_profile(uuid,integer,uuid,uuid)',
    'execute'
  ),
  'anonymous callers cannot execute the archive boundary'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.provision_default_no_tax_profile()',
    'execute'
  ),
  'the organization provisioning trigger helper is private'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.guard_product_tax_profile_binding()',
    'execute'
  ),
  'the active tax-profile binding guard is private'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.organizations',
    'seller_legal_name',
    'update'
  ),
  'seller settings remain writable only through the controlled RPC'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.tax_profiles',
    'update'
  ),
  'tax profiles remain writable only through controlled RPCs'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  'c6000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'r6-fresh@example.test',
  crypt('TenderLocal1!', gen_salt('bf')),
  now(),
  '{}',
  '{"display_name":"R6 Fresh Admin"}',
  now(),
  now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.create_organization(
    'R6 Fresh Organization',
    'r6-fresh-organization',
    'c6000000-0000-4000-8000-000000000010'
  )$$,
  'fresh organization can be created through the guarded command'
);

select is(
  (
    public.create_organization(
      'R6 Fresh Organization',
      'r6-fresh-organization',
      'c6000000-0000-4000-8000-000000000010'
    ) ->> 'organization_id'
  ),
  (
    select organization.id::text
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  'duplicate organization command replays the exact organization'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.tax_profiles profile
    join public.organizations organization
      on organization.id = profile.organization_id
    where organization.slug = 'r6-fresh-organization'
      and profile.code = 'NO_TAX'
      and profile.label = 'No tax'
      and profile.rate_bps = 0
      and profile.treatment = 'exempt'
      and profile.active
  ),
  1,
  'new_org_gets_exactly_one_no_tax'
);

select is(
  (
    select concat_ws(
      ':',
      profile.jurisdiction_country_code,
      profile.rate_bps,
      profile.price_basis,
      profile.treatment,
      profile.active,
      profile.version,
      profile.created_by
    )
    from public.tax_profiles profile
    join public.organizations organization
      on organization.id = profile.organization_id
    where organization.slug = 'r6-fresh-organization'
      and profile.code = 'NO_TAX'
  ),
  '0:exclusive:exempt:t:1:c6000000-0000-4000-8000-000000000001',
  'default NO_TAX is the exact bounded internal record'
);

select is(
  (
    select count(*)::integer
    from public.tax_profiles profile
    join public.organizations organization
      on organization.id = profile.organization_id
    where organization.slug = 'r6-fresh-organization'
      and profile.code = 'NO_TAX'
  ),
  1,
  'duplicate_onboarding_does_not_duplicate_no_tax'
);

select is(
  (
    select count(*)::integer
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
    where organization.slug = 'r6-fresh-organization'
      and membership.user_id =
        'c6000000-0000-4000-8000-000000000001'
  ),
  1,
  'duplicate onboarding does not duplicate the administrator membership'
);

select is(
  (
    select
      organization.seller_legal_name
        || ':'
        || organization.version::text
        || ':'
        || organization.seller_profile_version::text
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  'R6 Fresh Organization:1:1',
  'fresh organization receives only the truthful R5 seller-name default'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.update_organization_settings(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    1,
    '{
      "name":"R6 Fresh Organization Updated",
      "default_currency_code":"USD",
      "default_locale":"de-DE",
      "timezone":"Europe/Berlin",
      "approval_threshold_bps":0,
      "seller_legal_name":"R6 Seller GmbH",
      "seller_address_line1":"1 Recovery Way",
      "seller_address_line2":"",
      "seller_city":"Berlin",
      "seller_region":"Berlin",
      "seller_postal_code":"10115",
      "seller_country_code":"de",
      "seller_tax_identifier":"R6-DEMO-TAX",
      "seller_contact_email":"seller@example.test",
      "seller_contact_phone":"+49 30 1000"
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000011'
  )$$,
  'admin_can_edit_org_settings'
);

reset role;

select is(
  (
    select
      organization.version::text
        || ':'
        || organization.seller_profile_version::text
        || ':'
        || organization.default_currency_code
        || ':'
        || organization.default_locale
        || ':'
        || organization.timezone
        || ':'
        || organization.approval_threshold_bps::text
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  '2:2:USD:de-DE:Europe/Berlin:0',
  'organization_settings_are_versioned'
);

select is(
  (
    select concat_ws(
      ':',
      organization.seller_legal_name,
      organization.seller_address_line1,
      coalesce(organization.seller_address_line2, '<null>'),
      organization.seller_city,
      organization.seller_region,
      organization.seller_postal_code,
      organization.seller_country_code,
      organization.seller_tax_identifier,
      organization.seller_contact_email,
      organization.seller_contact_phone
    )
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  'R6 Seller GmbH:1 Recovery Way:<null>:Berlin:Berlin:10115:DE:R6-DEMO-TAX:seller@example.test:+49 30 1000',
  'seller settings are normalized and persisted through the RPC'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (
    public.update_organization_settings(
      (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      ),
      1,
      '{
        "name":"R6 Fresh Organization Updated",
        "default_currency_code":"USD",
        "default_locale":"de-DE",
        "timezone":"Europe/Berlin",
        "approval_threshold_bps":0,
        "seller_legal_name":"R6 Seller GmbH",
        "seller_address_line1":"1 Recovery Way",
        "seller_address_line2":"",
        "seller_city":"Berlin",
        "seller_region":"Berlin",
        "seller_postal_code":"10115",
        "seller_country_code":"de",
        "seller_tax_identifier":"R6-DEMO-TAX",
        "seller_contact_email":"seller@example.test",
        "seller_contact_phone":"+49 30 1000"
      }'::jsonb,
      'c6000000-0000-4000-8000-000000000011'
    ) ->> 'version'
  ),
  '2',
  'exact settings replay is checked before the stale expected version'
);

reset role;

select is(
  (
    select
      organization.version::text
        || ':'
        || organization.seller_profile_version::text
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  '2:2',
  'exact settings replay performs no second mutation'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.update_organization_settings(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    2,
    '{
      "name":"R6 Fresh Organization Final",
      "default_currency_code":"USD",
      "default_locale":"de-DE",
      "approval_threshold_bps":2500
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000012'
  )$$,
  'seller keys are optional in a versioned core-settings update'
);

reset role;

select is(
  (
    select
      organization.version::text
        || ':'
        || organization.seller_profile_version::text
        || ':'
        || organization.seller_legal_name
        || ':'
        || organization.timezone
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  '3:2:R6 Seller GmbH:Europe/Berlin',
  'absent seller and timezone keys preserve their current values'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.update_organization_settings(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    3,
    '{
      "name":"R6 Fresh Organization Final",
      "default_currency_code":"USD",
      "default_locale":"de-DE",
      "approval_threshold_bps":2500,
      "seller_contact_email":"not-an-email"
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000013'
  )$$,
  '22023',
  'organization_settings_payload_invalid',
  'bounded seller settings reject an invalid contact email'
);

reset role;

select is(
  (
    select organization.version
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  ),
  3,
  'invalid seller settings change no organization state'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.update_organization_settings(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    3,
    '{
      "name":"R6 Fresh Organization Final",
      "default_currency_code":"USD",
      "default_locale":"de-DE",
      "timezone":"Not/A_Real_Zone",
      "approval_threshold_bps":2500
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000014'
  )$$,
  '22023',
  'organization_timezone_invalid',
  'controlled settings retain catalog-backed timezone validation'
);

select throws_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{
      "code":"R6_UNSAFE_BASIS",
      "label":"Unsafe public basis",
      "jurisdiction_country_code":"DE",
      "rate_bps":0,
      "price_basis":"inclusive",
      "treatment":"exempt",
      "active":true
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000020'
  )$$,
  '22023',
  'tax_profile_payload_invalid',
  'public tax-profile create payload rejects deprecated price basis'
);

select lives_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"code":"R6_TARGET","label":"R6 target tax","jurisdiction_country_code":"DE","rate_bps":1000,"treatment":"standard","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000021'
  )$$,
  'target tax profile can be created without a public price basis'
);

select lives_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"code":"R6_REPLACEMENT","label":"R6 replacement tax","jurisdiction_country_code":"DE","rate_bps":0,"treatment":"exempt","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000022'
  )$$,
  'safe replacement tax profile can be created'
);

select lives_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"code":"R6_LEGACY","label":"R6 legacy metadata","jurisdiction_country_code":"DE","rate_bps":1900,"treatment":"standard","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000023'
  )$$,
  'legacy-metadata preservation profile can be created'
);

select lives_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"code":"R6_UNUSED","label":"R6 unused tax","jurisdiction_country_code":null,"rate_bps":0,"treatment":"zero_rated","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000024'
  )$$,
  'unused tax profile can be created for legacy archive proof'
);

select lives_ok(
  $$select public.create_tax_profile(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"code":"R6_INACTIVE","label":"R6 inactive tax","jurisdiction_country_code":null,"rate_bps":0,"treatment":"exempt","active":false}'::jsonb,
    'c6000000-0000-4000-8000-000000000025'
  )$$,
  'inactive profile can be represented without becoming a safe replacement'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.tax_profiles profile
    join public.organizations organization
      on organization.id = profile.organization_id
    where organization.slug = 'r6-fresh-organization'
      and profile.code in (
        'R6_TARGET',
        'R6_REPLACEMENT',
        'R6_LEGACY',
        'R6_UNUSED',
        'R6_INACTIVE'
      )
      and profile.price_basis = 'exclusive'
  ),
  5,
  'new public profiles receive the fixed internal legacy basis'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (
    public.create_tax_profile(
      (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      ),
      '{"code":"R6_TARGET","label":"R6 target tax","jurisdiction_country_code":"DE","rate_bps":1000,"treatment":"standard","active":true}'::jsonb,
      'c6000000-0000-4000-8000-000000000021'
    ) ->> 'id'
  ),
  (
    select profile.id::text
    from public.tax_profiles profile
    where profile.code = 'R6_TARGET'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  'exact tax-profile create replay returns the original profile'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.tax_profiles profile
    where profile.code = 'R6_TARGET'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  1,
  'exact tax-profile create replay performs no duplicate insert'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.update_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_REPLACEMENT'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    '{"code":"R6_REPLACEMENT","label":"Unsafe basis update","jurisdiction_country_code":"DE","rate_bps":0,"price_basis":"inclusive","treatment":"exempt","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000026'
  )$$,
  '22023',
  'tax_profile_payload_invalid',
  'public tax-profile update payload rejects deprecated price basis'
);

reset role;

update public.tax_profiles profile
set price_basis = 'inclusive'
where profile.code = 'R6_LEGACY'
  and profile.organization_id = (
    select organization.id
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  );

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.update_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_LEGACY'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    2,
    '{"code":"R6_LEGACY","label":"R6 legacy metadata updated","jurisdiction_country_code":"DE","rate_bps":1900,"treatment":"standard","active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000027'
  )$$,
  'public tax-profile update preserves internal legacy metadata'
);

reset role;

select is(
  (
    select profile.price_basis::text || ':' || profile.version::text
    from public.tax_profiles profile
    where profile.code = 'R6_LEGACY'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  'inclusive:3',
  'tax-profile edit preserves the historical internal price basis'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.update_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_REPLACEMENT'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    '{"code":"R6_REPLACEMENT","label":"R6 replacement tax","jurisdiction_country_code":"DE","rate_bps":0,"treatment":"exempt","active":false}'::jsonb,
    'c6000000-0000-4000-8000-000000000028'
  )$$,
  '22023',
  'tax_profile_archive_required',
  'profile edit cannot bypass replacement-aware archive semantics'
);

select lives_ok(
  $$select public.create_customer(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    '{"name":"R6 Customer","contact_name":"R6 Buyer","email":"buyer@example.test","phone":"","billing_address_line1":"2 Customer Road","billing_address_line2":"","billing_city":"Berlin","billing_region":"Berlin","billing_postal_code":"10115","billing_country_code":"DE","locale":"de-DE","preferred_currency_code":"USD","tax_treatment":"standard","tax_identifier":null,"active":true}'::jsonb,
    'c6000000-0000-4000-8000-000000000030'
  )$$,
  'fresh organization can create its first customer'
);

select lives_ok(
  $$select public.create_product(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    jsonb_build_object(
      'sku', 'R6-PRODUCT',
      'description', 'R6 product bound to target profile',
      'unit_code', 'EA',
      'quantity_precision', 0,
      'unit_price_minor', 1000,
      'currency_code', 'USD',
      'tax_profile_id', (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_TARGET'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      'active', true
    ),
    'c6000000-0000-4000-8000-000000000031'
  )$$,
  'fresh organization can create a product using an active tax profile'
);

reset role;

insert into public.quotes (
  id,
  organization_id,
  number,
  customer_id,
  currency_code,
  locale,
  tax_label,
  tax_mode,
  customer_tax_treatment,
  issue_date,
  valid_until,
  subtotal_minor,
  item_tax_minor,
  total_minor,
  created_by
)
select
  'c6000000-0000-4000-8000-000000000040',
  organization.id,
  'TND-2099-0001',
  customer.id,
  'USD',
  'de-DE',
  'R6 tax',
  'exclusive',
  customer.tax_treatment,
  current_date,
  current_date + 30,
  1000,
  100,
  1100,
  'c6000000-0000-4000-8000-000000000001'
from public.organizations organization
join public.customers customer
  on customer.organization_id = organization.id
  and customer.name = 'R6 Customer'
where organization.slug = 'r6-fresh-organization';

insert into public.quote_items (
  organization_id,
  quote_id,
  product_id,
  position,
  sku_snapshot,
  description_snapshot,
  unit_code_snapshot,
  quantity_precision_snapshot,
  unit_price_minor_snapshot,
  currency_code,
  quantity_scaled,
  quantity_scale,
  tax_code_snapshot,
  tax_bps_snapshot,
  tax_price_basis_snapshot,
  tax_treatment_snapshot,
  base_minor,
  discount_minor,
  net_minor,
  tax_minor,
  line_total_minor
)
select
  product.organization_id,
  'c6000000-0000-4000-8000-000000000040',
  product.id,
  1,
  product.sku,
  product.description,
  product.unit_code,
  product.quantity_precision,
  product.unit_price_minor,
  product.currency_code,
  1,
  1,
  profile.code,
  profile.rate_bps,
  'exclusive',
  profile.treatment,
  1000,
  0,
  1000,
  100,
  1100
from public.products product
join public.tax_profiles profile
  on profile.organization_id = product.organization_id
  and profile.id = product.tax_profile_id
where product.sku = 'R6-PRODUCT'
  and profile.code = 'R6_TARGET';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    'c6000000-0000-4000-8000-000000000041'
  )$$,
  'P0001',
  'tax_profile_replacement_required',
  'tax_profile_archive_requires_safe_replacement'
);

reset role;

select is(
  (
    select profile.active::text || ':' || profile.version::text
    from public.tax_profiles profile
    where profile.code = 'R6_TARGET'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  'true:1',
  'failed archive without a replacement changes no profile state'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    'c6000000-0000-4000-8000-000000000042'
  )$$,
  '23503',
  'tax_profile_replacement_invalid',
  'an archived profile cannot replace itself'
);

select throws_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    'b1000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000047'
  )$$,
  '23503',
  'tax_profile_replacement_invalid',
  'a replacement profile must belong to the same organization'
);

select throws_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_INACTIVE'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    'c6000000-0000-4000-8000-000000000043'
  )$$,
  '23503',
  'tax_profile_replacement_invalid',
  'an inactive profile is not a safe archive replacement'
);

select lives_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_TARGET'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_REPLACEMENT'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    'c6000000-0000-4000-8000-000000000044'
  )$$,
  'same-organization active replacement archives atomically'
);

reset role;

select is(
  (
    select profile.active::text || ':' || profile.version::text
    from public.tax_profiles profile
    where profile.code = 'R6_TARGET'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  'false:2',
  'replacement-aware archive retains the historical profile row'
);

select is(
  (
    select
      replacement.code
        || ':'
        || product.version::text
        || ':'
        || product.active::text
    from public.products product
    join public.tax_profiles replacement
      on replacement.organization_id = product.organization_id
      and replacement.id = product.tax_profile_id
    where product.sku = 'R6-PRODUCT'
  ),
  'R6_REPLACEMENT:2:true',
  'active products are reassigned atomically to the safe replacement'
);

select is(
  (
    select
      item.tax_code_snapshot
        || ':'
        || item.tax_bps_snapshot::text
        || ':'
        || item.tax_price_basis_snapshot::text
    from public.quote_items item
    where item.quote_id =
      'c6000000-0000-4000-8000-000000000040'
  ),
  'R6_TARGET:1000:exclusive',
  'existing_quote_snapshots_unchanged'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (
    public.archive_tax_profile(
      (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_TARGET'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      1,
      (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_REPLACEMENT'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      'c6000000-0000-4000-8000-000000000044'
    ) ->> 'id'
  ),
  (
    select profile.id::text
    from public.tax_profiles profile
    where profile.code = 'R6_TARGET'
      and profile.organization_id = (
        select organization.id
        from public.organizations organization
        where organization.slug = 'r6-fresh-organization'
      )
  ),
  'exact replacement-aware archive replays after state and version changed'
);

reset role;

select is(
  (
    select product.version
    from public.products product
    where product.sku = 'R6-PRODUCT'
  ),
  2,
  'archive replay performs no second product reassignment'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.create_product(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    jsonb_build_object(
      'sku', 'R6-ARCHIVED-BIND',
      'description', 'Must not bind archived tax profile',
      'unit_code', 'EA',
      'quantity_precision', 0,
      'unit_price_minor', 1000,
      'currency_code', 'USD',
      'tax_profile_id', (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_TARGET'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      'active', true
    ),
    'c6000000-0000-4000-8000-000000000045'
  )$$,
  '23503',
  'product_tax_profile_invalid',
  'archived_profile_unavailable_for_new_product'
);

reset role;

select throws_ok(
  $$insert into public.products (
    organization_id,
    sku,
    description,
    unit_code,
    quantity_precision,
    unit_price_minor,
    currency_code,
    tax_profile_id,
    active,
    created_by
  )
  select
    organization.id,
    'R6-OWNER-RACE',
    'Owner-path race guard proof',
    'EA',
    0,
    1000,
    'USD',
    profile.id,
    true,
    'c6000000-0000-4000-8000-000000000001'
  from public.organizations organization
  join public.tax_profiles profile
    on profile.organization_id = organization.id
    and profile.code = 'R6_TARGET'
  where organization.slug = 'r6-fresh-organization'$$,
  '23503',
  'product_tax_profile_invalid',
  'private trigger closes owner-path product binding to an archived profile'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.archive_tax_profile(
    (
      select profile.id
      from public.tax_profiles profile
      where profile.code = 'R6_UNUSED'
        and profile.organization_id = (
          select organization.id
          from public.organizations organization
          where organization.slug = 'r6-fresh-organization'
        )
    ),
    1,
    'c6000000-0000-4000-8000-000000000046'
  )$$,
  'legacy three-argument archive remains functional when no replacement is needed'
);

select ok(
  not (
    public.archive_tax_profile(
      (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_UNUSED'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      1,
      'c6000000-0000-4000-8000-000000000046'
    ) ? 'replacement_tax_profile_id'
  ),
  'legacy archive result remains free of replacement-only fields'
);

reset role;

select is(
  (
    select receipt.request_hash
    from public.command_receipts receipt
    where receipt.command_id =
      'c6000000-0000-4000-8000-000000000046'
  ),
  public.command_request_hash(
    jsonb_build_object(
      'tax_profile_id',
      (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_UNUSED'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      'expected_version',
      1
    )
  ),
  'null replacement is omitted for legacy request-hash compatibility'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (
    public.archive_tax_profile(
      (
        select profile.id
        from public.tax_profiles profile
        where profile.code = 'R6_UNUSED'
          and profile.organization_id = (
            select organization.id
            from public.organizations organization
            where organization.slug = 'r6-fresh-organization'
          )
      ),
      1,
      'c6000000-0000-4000-8000-000000000046'
    ) ->> 'version'
  ),
  '2',
  'legacy exact archive replay succeeds after the profile is inactive'
);

reset role;

update public.organization_memberships membership
set role_id = (
  select role.id
  from public.roles role
  where role.key = 'operator'
)
where membership.user_id =
    'c6000000-0000-4000-8000-000000000001'
  and membership.organization_id = (
    select organization.id
    from public.organizations organization
    where organization.slug = 'r6-fresh-organization'
  );

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.update_organization_settings(
    (
      select organization.id
      from public.organizations organization
      where organization.slug = 'r6-fresh-organization'
    ),
    3,
    '{
      "name":"Operator overwrite",
      "default_currency_code":"USD",
      "default_locale":"de-DE",
      "timezone":"Europe/Berlin",
      "approval_threshold_bps":0
    }'::jsonb,
    'c6000000-0000-4000-8000-000000000050'
  )$$,
  '42501',
  'organization_settings_update_forbidden',
  'operator_cannot_edit_org_settings'
);

select * from finish();
rollback;
