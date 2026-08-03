import { SUPPORTED_CURRENCY_CODES } from "@/lib/formatting/currency";
import { updateOrganizationSettings } from "@/app/(application)/settings/organization/actions";

export type OrganizationSettingsValues = {
  approvalThresholdBps: number;
  defaultCurrencyCode: string;
  defaultLocale: string;
  name: string;
  sellerAddressLine1: string | null;
  sellerAddressLine2: string | null;
  sellerCity: string | null;
  sellerContactEmail: string | null;
  sellerContactPhone: string | null;
  sellerCountryCode: string | null;
  sellerLegalName: string | null;
  sellerPostalCode: string | null;
  sellerRegion: string | null;
  sellerTaxIdentifier: string | null;
  timezone: string;
  version: number;
};

function RequiredMarker() {
  return (
    <span className="required-marker" aria-hidden="true">
      Required
    </span>
  );
}

export function OrganizationSettingsForm({
  organization,
}: {
  organization: OrganizationSettingsValues;
}) {
  return (
    <form action={updateOrganizationSettings} className="settings-form">
      <input
        type="hidden"
        name="expectedVersion"
        value={organization.version}
      />
      <input type="hidden" name="commandId" value={crypto.randomUUID()} />

      <fieldset className="settings-fieldset">
        <legend>Organization defaults</legend>
        <p>
          These defaults seed new commercial records. Existing quote snapshots
          remain unchanged.
        </p>
        <div className="form-grid">
          <label className="span-2">
            Organization name
            <input
              name="name"
              defaultValue={organization.name}
              required
              maxLength={120}
            />
          </label>
          <label>
            Default currency
            <select
              name="defaultCurrencyCode"
              defaultValue={organization.defaultCurrencyCode}
              required
            >
              {SUPPORTED_CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default locale
            <input
              name="defaultLocale"
              defaultValue={organization.defaultLocale}
              required
              maxLength={35}
              pattern="[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
            />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue={organization.timezone}
              required
              maxLength={64}
              list="organization-timezones"
            />
          </label>
          <label>
            Approval threshold (basis points)
            <input
              name="approvalThresholdBps"
              type="number"
              inputMode="numeric"
              defaultValue={organization.approvalThresholdBps}
              required
              min={0}
              max={10_000}
              step={1}
            />
          </label>
        </div>
        <datalist id="organization-timezones">
          <option value="UTC" />
          <option value="Asia/Kolkata" />
          <option value="Europe/London" />
          <option value="America/New_York" />
        </datalist>
      </fieldset>

      <fieldset
        className="settings-fieldset"
        aria-describedby="seller-profile-help"
      >
        <legend>Seller commercial identity</legend>
        <p id="seller-profile-help">
          Required fields must be complete before a quote can be issued. Issued
          documents retain this identity as a snapshot.
        </p>
        <div className="form-grid">
          <label className="span-2">
            <span>
              Seller legal name <RequiredMarker />
            </span>
            <input
              name="sellerLegalName"
              defaultValue={organization.sellerLegalName ?? ""}
              required
              maxLength={160}
            />
          </label>
          <label className="span-2">
            <span>
              Seller address line 1 <RequiredMarker />
            </span>
            <input
              name="sellerAddressLine1"
              defaultValue={organization.sellerAddressLine1 ?? ""}
              required
              maxLength={160}
            />
          </label>
          <label className="span-2">
            Seller address line 2
            <input
              name="sellerAddressLine2"
              defaultValue={organization.sellerAddressLine2 ?? ""}
              maxLength={160}
            />
          </label>
          <label>
            <span>
              Seller city <RequiredMarker />
            </span>
            <input
              name="sellerCity"
              defaultValue={organization.sellerCity ?? ""}
              required
              maxLength={100}
            />
          </label>
          <label>
            Seller region
            <input
              name="sellerRegion"
              defaultValue={organization.sellerRegion ?? ""}
              maxLength={100}
            />
          </label>
          <label>
            Seller postal code
            <input
              name="sellerPostalCode"
              defaultValue={organization.sellerPostalCode ?? ""}
              maxLength={24}
            />
          </label>
          <label>
            <span>
              Seller country code <RequiredMarker />
            </span>
            <input
              name="sellerCountryCode"
              defaultValue={organization.sellerCountryCode ?? ""}
              required
              maxLength={2}
              pattern="[A-Za-z]{2}"
              autoCapitalize="characters"
            />
          </label>
          <label>
            Seller tax identifier
            <input
              name="sellerTaxIdentifier"
              defaultValue={organization.sellerTaxIdentifier ?? ""}
              maxLength={80}
            />
          </label>
          <label>
            Seller contact email
            <input
              name="sellerContactEmail"
              type="email"
              defaultValue={organization.sellerContactEmail ?? ""}
              maxLength={254}
            />
          </label>
          <label>
            Seller contact phone
            <input
              name="sellerContactPhone"
              type="tel"
              defaultValue={organization.sellerContactPhone ?? ""}
              maxLength={40}
            />
          </label>
        </div>
      </fieldset>

      <button className="button button-primary" type="submit">
        Save organization settings
      </button>
    </form>
  );
}
