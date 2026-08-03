\set ON_ERROR_STOP on

-- One-time fictional portfolio data. This file is deliberately outside the
-- migration and local seed paths. Invoke it only through scripts/seed-cloud-demo.mjs.
begin;

create temporary table tender_demo_seed_input (user_id uuid not null) on commit drop;
insert into tender_demo_seed_input values (:'demo_user_id'::uuid);
select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from tender_demo_seed_input),
  true
);

do $demo$
declare
  demo_user uuid := (select user_id from tender_demo_seed_input);
  organization_result jsonb;
  demo_org_id uuid;
  profile_result jsonb;
  gst_profile_id uuid;
  zero_profile_id uuid;
  product_ids uuid[] := array[]::uuid[];
  customer_ids uuid[] := array[]::uuid[];
  item jsonb;
  result jsonb;
  quote_result jsonb;
  saved_result jsonb;
  decision_result jsonb;
  quote_id uuid;
  quote_version integer;
  quote_discount integer;
  quote_issue_date date;
  quote_valid_until date;
  quote_index integer;
  organization_version integer;
begin
  if not exists (select 1 from auth.users where id = demo_user) then
    raise exception 'demo_user_not_found';
  end if;
  if not exists (select 1 from public.profiles where user_id = demo_user) then
    raise exception 'demo_user_profile_not_found';
  end if;
  if exists (
    select 1 from public.organizations where slug = 'northstar-industrial-demo'
  ) then
    raise notice 'Demo organization already exists; one-time seed made no changes.';
    return;
  end if;

  organization_result := public.create_organization(
    'Northstar Industrial Supply',
    'northstar-industrial-demo',
    gen_random_uuid()
  );
  demo_org_id := (organization_result ->> 'organization_id')::uuid;
  select version into organization_version
  from public.organizations where id = demo_org_id;

  perform public.update_organization_settings(
    demo_org_id,
    organization_version,
    jsonb_build_object(
      'name', 'Northstar Industrial Supply',
      'default_currency_code', 'INR',
      'default_locale', 'en-IN',
      'timezone', 'Asia/Kolkata',
      'approval_threshold_bps', 1000,
      'seller_legal_name', 'Northstar Industrial Supply Private Limited',
      'seller_address_line1', '27 Foundry Park',
      'seller_address_line2', 'Unit 4',
      'seller_city', 'Pune',
      'seller_region', 'Maharashtra',
      'seller_postal_code', '411019',
      'seller_country_code', 'IN',
      'seller_tax_identifier', 'DEMO-GSTIN-NORTHSTAR',
      'seller_contact_email', 'sales@northstar.example.test',
      'seller_contact_phone', '+91 20 5550 0160'
    ),
    gen_random_uuid()
  );

  profile_result := public.create_tax_profile(
    demo_org_id,
    jsonb_build_object(
      'code', 'GST18',
      'label', 'GST 18% — fictional demo',
      'jurisdiction_country_code', 'IN',
      'rate_bps', 1800,
      'treatment', 'standard',
      'active', true
    ),
    gen_random_uuid()
  );
  gst_profile_id := (profile_result ->> 'id')::uuid;
  profile_result := public.create_tax_profile(
    demo_org_id,
    jsonb_build_object(
      'code', 'ZERO',
      'label', 'Zero-rated — fictional demo',
      'jurisdiction_country_code', null,
      'rate_bps', 0,
      'treatment', 'zero_rated',
      'active', true
    ),
    gen_random_uuid()
  );
  zero_profile_id := (profile_result ->> 'id')::uuid;

  for item in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('sku','DRV-220','description','Variable frequency drive, 22 kW','unit_code','EA','price',28450000,'tax','gst'),
      jsonb_build_object('sku','MTR-075','description','IE3 induction motor, 7.5 kW','unit_code','EA','price',12800000,'tax','gst'),
      jsonb_build_object('sku','PLC-440','description','Compact process controller','unit_code','EA','price',9650000,'tax','gst'),
      jsonb_build_object('sku','SNS-118','description','Photoelectric sensor assembly','unit_code','EA','price',1850000,'tax','gst'),
      jsonb_build_object('sku','VLV-304','description','Stainless pneumatic valve','unit_code','EA','price',2425000,'tax','gst'),
      jsonb_build_object('sku','PNL-600','description','Powder-coated control enclosure','unit_code','EA','price',7350000,'tax','gst'),
      jsonb_build_object('sku','CAB-025','description','Shielded instrumentation cable kit','unit_code','BOX','price',1640000,'tax','gst'),
      jsonb_build_object('sku','BRG-210','description','Sealed bearing service pack','unit_code','BOX','price',980000,'tax','gst'),
      jsonb_build_object('sku','PMP-032','description','Sanitary transfer pump','unit_code','EA','price',18750000,'tax','gst'),
      jsonb_build_object('sku','FLT-090','description','Inline filtration housing','unit_code','EA','price',6250000,'tax','gst'),
      jsonb_build_object('sku','HMI-156','description','Industrial touch operator panel','unit_code','EA','price',11200000,'tax','gst'),
      jsonb_build_object('sku','UPS-003','description','DIN-rail backup power module','unit_code','EA','price',3150000,'tax','gst'),
      jsonb_build_object('sku','SAF-410','description','Machine safety relay set','unit_code','BOX','price',2750000,'tax','gst'),
      jsonb_build_object('sku','DOC-001','description','Commissioning documentation pack','unit_code','EA','price',450000,'tax','zero')
    ))
  loop
    result := public.create_product(
      demo_org_id,
      jsonb_build_object(
        'sku', item ->> 'sku',
        'description', item ->> 'description',
        'unit_code', item ->> 'unit_code',
        'quantity_precision', 0,
        'unit_price_minor', (item ->> 'price')::bigint,
        'currency_code', 'INR',
        'tax_profile_id', case when item ->> 'tax' = 'zero' then zero_profile_id else gst_profile_id end,
        'active', true
      ),
      gen_random_uuid()
    );
    product_ids := array_append(product_ids, (result ->> 'id')::uuid);
  end loop;

  for item in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('name','Aster Process Systems','contact','Nila Rao','city','Pune','region','Maharashtra','postal','411045'),
      jsonb_build_object('name','Blueforge Components','contact','Kabir Shah','city','Nashik','region','Maharashtra','postal','422010'),
      jsonb_build_object('name','Cedarline Packaging','contact','Meera Iyer','city','Bengaluru','region','Karnataka','postal','560048'),
      jsonb_build_object('name','Delta Waterworks','contact','Rohan Sen','city','Ahmedabad','region','Gujarat','postal','380015'),
      jsonb_build_object('name','Evergreen Food Equipment','contact','Tara Menon','city','Kochi','region','Kerala','postal','682030'),
      jsonb_build_object('name','Frontier Automation Works','contact','Vikram Das','city','Hyderabad','region','Telangana','postal','500081')
    ))
  loop
    result := public.create_customer(
      demo_org_id,
      jsonb_build_object(
        'name', item ->> 'name',
        'contact_name', item ->> 'contact',
        'email', lower(replace(item ->> 'name', ' ', '.')) || '@example.test',
        'phone', '',
        'billing_address_line1', '100 Demonstration Business Park',
        'billing_address_line2', '',
        'billing_city', item ->> 'city',
        'billing_region', item ->> 'region',
        'billing_postal_code', item ->> 'postal',
        'billing_country_code', 'IN',
        'locale', 'en-IN',
        'preferred_currency_code', 'INR',
        'tax_treatment', 'standard',
        'tax_identifier', 'FICTIONAL-DEMO',
        'active', true
      ),
      gen_random_uuid()
    );
    customer_ids := array_append(customer_ids, (result ->> 'id')::uuid);
  end loop;

  for quote_index in 1..14 loop
    quote_discount := case
      when quote_index between 6 and 11 then 1500
      when quote_index between 12 and 13 then 500
      else quote_index * 75
    end;
    if quote_index = 14 then
      quote_issue_date := current_date - 45;
      quote_valid_until := current_date - 15;
    else
      quote_issue_date := current_date - quote_index;
      quote_valid_until := current_date + (30 - quote_index);
    end if;

    quote_result := public.create_quote_draft(
      demo_org_id,
      customer_ids[((quote_index - 1) % 6) + 1],
      'INR',
      'en-IN',
      'GST 18%',
      'exclusive'::public.tax_price_basis,
      quote_issue_date,
      quote_valid_until,
      gen_random_uuid()
    );
    quote_id := (quote_result ->> 'id')::uuid;
    quote_version := (quote_result ->> 'version')::integer;

    saved_result := public.save_quote_draft(
      quote_id,
      quote_version,
      gen_random_uuid(),
      jsonb_build_object(
        'customer_id', customer_ids[((quote_index - 1) % 6) + 1],
        'currency_code', 'INR',
        'locale', 'en-IN',
        'tax_label', 'GST 18%',
        'tax_mode', 'exclusive',
        'discount_bps', quote_discount,
        'issue_date', quote_issue_date,
        'valid_until', quote_valid_until,
        'notes', 'Fictional portfolio quotation. No real customer or transaction.',
        'items', jsonb_build_array(
          jsonb_build_object(
            'line_id', null,
            'product_id', product_ids[((quote_index - 1) % 14) + 1],
            'position', 1,
            'quantity_scaled', (quote_index % 4) + 1,
            'quantity_scale', 1
          ),
          jsonb_build_object(
            'line_id', null,
            'product_id', product_ids[((quote_index + 4) % 14) + 1],
            'position', 2,
            'quantity_scaled', (quote_index % 3) + 1,
            'quantity_scale', 1
          )
        ),
        'charges', case when quote_index % 2 = 0 then jsonb_build_array(
          jsonb_build_object(
            'charge_id', null,
            'position', 1,
            'charge_type', 'freight',
            'description', 'Insured regional freight',
            'amount_minor', 125000,
            'tax_profile_id', gst_profile_id,
            'discount_applies', false
          )
        ) else '[]'::jsonb end
      )
    );
    quote_version := (saved_result ->> 'version')::integer;

    if quote_index between 4 and 13 then
      decision_result := public.submit_quote(
        quote_id,
        quote_version,
        gen_random_uuid()
      );
      quote_version := (decision_result ->> 'version')::integer;
    end if;
    if quote_index between 8 and 9 then
      decision_result := public.approve_quote(
        quote_id,
        quote_version,
        gen_random_uuid()
      );
    elsif quote_index between 10 and 11 then
      decision_result := public.reject_quote(
        quote_id,
        quote_version,
        gen_random_uuid(),
        'Budget timing changed for this fictional customer.'
      );
    elsif quote_index between 12 and 13 then
      decision_result := public.issue_quote(
        quote_id,
        quote_version,
        gen_random_uuid()
      );
    end if;
  end loop;

  if (select count(*) from public.products product where product.organization_id = demo_org_id) <> 14
    or (select count(*) from public.customers customer where customer.organization_id = demo_org_id) <> 6
    or (select count(*) from public.quotes quote where quote.organization_id = demo_org_id) <> 14 then
    raise exception 'demo_dataset_count_mismatch';
  end if;

  update public.organization_memberships membership
  set role_id = role.id
  from public.roles role
  where membership.organization_id = demo_org_id
    and membership.user_id = demo_user
    and role.key = 'manager';
end;
$demo$;

commit;
