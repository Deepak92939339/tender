import { OrganizationSettingsForm } from "@/components/settings/organization-settings-form";
import { SettingsResultStatus } from "@/components/settings/settings-result-status";
import { TaxProfileSettings } from "@/components/settings/tax-profile-settings";
import { requireApplicationContext } from "@/lib/auth/context";
import {
  organizationSettingsResultMessage,
  organizationSettingsResultTone,
  type OrganizationSettingsResultCode,
} from "@/lib/settings/organization-result";
import { createClient } from "@/lib/supabase/server";

export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const context = await requireApplicationContext();

  if (!context.capabilities.includes("organization.manage")) {
    return (
      <section className="destination-page settings-page">
        <header className="destination-header">
          <div>
            <p className="eyebrow">Account and identity</p>
            <h1>Organization settings</h1>
            <p>Manage commercial defaults, seller identity and tax profiles.</p>
          </div>
        </header>
        <p className="quiet-notice">
          Your explicit capability map does not grant access to organization
          settings.
        </p>
      </section>
    );
  }

  const query = await searchParams;
  const result = Array.isArray(query.result) ? null : query.result;
  const statusMessage = organizationSettingsResultMessage(result);
  const statusTone = statusMessage
    ? organizationSettingsResultTone(result as OrganizationSettingsResultCode)
    : null;
  const supabase = await createClient();
  const [{ data: organization, error: organizationError }, taxProfileResult] =
    await Promise.all([
      supabase
        .from("organizations")
        .select(
          "name, default_currency_code, default_locale, timezone, approval_threshold_bps, version, seller_legal_name, seller_address_line1, seller_address_line2, seller_city, seller_region, seller_postal_code, seller_country_code, seller_tax_identifier, seller_contact_email, seller_contact_phone",
        )
        .eq("id", context.membership.organizationId)
        .single(),
      supabase
        .from("tax_profiles")
        .select(
          "id, code, label, jurisdiction_country_code, rate_bps, treatment, active, version",
        )
        .eq("organization_id", context.membership.organizationId)
        .order("active", { ascending: false })
        .order("code"),
    ]);

  if (organizationError || !organization || taxProfileResult.error) {
    throw new Error("Unable to load tenant-scoped organization settings.");
  }

  return (
    <section className="destination-page settings-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Account and identity</p>
          <h1>Organization settings</h1>
          <p>Manage commercial defaults, seller identity and tax profiles.</p>
        </div>
      </header>

      {statusMessage && statusTone && (
        <SettingsResultStatus message={statusMessage} tone={statusTone} />
      )}

      <section
        className="settings-panel"
        aria-labelledby="organization-settings-heading"
      >
        <header className="settings-panel-header">
          <div>
            <h2 id="organization-settings-heading">Commercial identity</h2>
            <p>
              Organization defaults and the seller details captured when a
              quotation is issued.
            </p>
          </div>
        </header>
        <OrganizationSettingsForm
          organization={{
            approvalThresholdBps: organization.approval_threshold_bps,
            defaultCurrencyCode: organization.default_currency_code,
            defaultLocale: organization.default_locale,
            name: organization.name,
            sellerAddressLine1: organization.seller_address_line1,
            sellerAddressLine2: organization.seller_address_line2,
            sellerCity: organization.seller_city,
            sellerContactEmail: organization.seller_contact_email,
            sellerContactPhone: organization.seller_contact_phone,
            sellerCountryCode: organization.seller_country_code,
            sellerLegalName: organization.seller_legal_name,
            sellerPostalCode: organization.seller_postal_code,
            sellerRegion: organization.seller_region,
            sellerTaxIdentifier: organization.seller_tax_identifier,
            timezone: organization.timezone,
            version: organization.version,
          }}
        />
      </section>

      <TaxProfileSettings
        profiles={(taxProfileResult.data ?? []).map((profile) => ({
          active: profile.active,
          code: profile.code,
          id: profile.id,
          jurisdictionCountryCode: profile.jurisdiction_country_code,
          label: profile.label,
          rateBps: profile.rate_bps,
          treatment: profile.treatment,
          version: profile.version,
        }))}
      />
    </section>
  );
}
