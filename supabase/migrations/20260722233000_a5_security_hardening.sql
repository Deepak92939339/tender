begin;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Milestone A
-- uses an explicit allowlist so authorization checks and SQL grants agree.
revoke all on function
  public.set_updated_at(),
  public.handle_new_auth_user(),
  public.is_active_org_member(uuid),
  public.has_org_capability(uuid, text),
  public.create_organization(text, text, uuid),
  public.bump_record_version(),
  public.prepare_catalog_import(uuid, text, jsonb),
  public.commit_catalog_import(uuid, boolean, uuid),
  public.round_nonnegative_ratio(numeric, numeric, numeric),
  public.validate_quantity(text, integer, bigint, bigint),
  public.calculate_quote_payload(jsonb),
  public.calculate_quote_payloads(jsonb),
  public.next_quote_number(uuid, date),
  public.quote_actor(uuid),
  public.create_quote_draft(uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid),
  public.save_quote_draft(uuid, integer, uuid, jsonb),
  public.recalculate_quote(uuid, uuid),
  public.submit_quote(uuid, integer, uuid),
  public.approve_quote(uuid, integer, uuid),
  public.reject_quote(uuid, integer, uuid, text),
  public.issue_quote(uuid, integer, uuid)
from public, anon, authenticated;

grant execute on function
  public.is_active_org_member(uuid),
  public.has_org_capability(uuid, text),
  public.create_organization(text, text, uuid),
  public.prepare_catalog_import(uuid, text, jsonb),
  public.commit_catalog_import(uuid, boolean, uuid),
  public.round_nonnegative_ratio(numeric, numeric, numeric),
  public.validate_quantity(text, integer, bigint, bigint),
  public.calculate_quote_payload(jsonb),
  public.calculate_quote_payloads(jsonb),
  public.create_quote_draft(uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid),
  public.save_quote_draft(uuid, integer, uuid, jsonb),
  public.submit_quote(uuid, integer, uuid),
  public.approve_quote(uuid, integer, uuid),
  public.reject_quote(uuid, integer, uuid, text),
  public.issue_quote(uuid, integer, uuid)
to authenticated;

-- Mutable record provenance and tenant keys are insert-only authority. Routine
-- editors can change commercial fields, never organization/creator/version.
revoke insert, update on public.tax_profiles, public.products, public.customers from authenticated;

grant insert (
  organization_id, code, label, jurisdiction_country_code, rate_bps,
  price_basis, treatment, active
) on public.tax_profiles to authenticated;
grant update (
  code, label, jurisdiction_country_code, rate_bps, price_basis, treatment, active
) on public.tax_profiles to authenticated;

grant insert (
  organization_id, sku, description, unit_code, quantity_precision,
  unit_price_minor, currency_code, tax_profile_id, active, created_by
) on public.products to authenticated;
grant update (
  sku, description, unit_code, quantity_precision, unit_price_minor,
  currency_code, tax_profile_id, active
) on public.products to authenticated;

grant insert (
  organization_id, name, contact_name, email, phone, billing_address_line1,
  billing_address_line2, billing_city, billing_region, billing_postal_code,
  billing_country_code, locale, preferred_currency_code, tax_treatment,
  tax_identifier, created_by
) on public.customers to authenticated;
grant update (
  name, contact_name, email, phone, billing_address_line1,
  billing_address_line2, billing_city, billing_region, billing_postal_code,
  billing_country_code, locale, preferred_currency_code, tax_treatment,
  tax_identifier
) on public.customers to authenticated;

commit;
