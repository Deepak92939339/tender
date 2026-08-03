import {
  archiveTaxProfile,
  createTaxProfile,
  updateTaxProfile,
} from "@/app/(application)/settings/organization/actions";

export type TaxProfileSettingsValue = {
  active: boolean;
  code: string;
  id: string;
  jurisdictionCountryCode: string | null;
  label: string;
  rateBps: number;
  treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
  version: number;
};

const treatmentOptions = [
  ["standard", "Standard"],
  ["exempt", "Exempt"],
  ["zero_rated", "Zero-rated"],
  ["reverse_charge", "Reverse charge"],
] as const;

function TaxProfileFields({ profile }: { profile?: TaxProfileSettingsValue }) {
  return (
    <div className="form-grid">
      <label>
        Code
        <input
          name="code"
          defaultValue={profile?.code}
          required
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
          autoCapitalize="characters"
        />
      </label>
      <label className="span-2">
        Label
        <input
          name="label"
          defaultValue={profile?.label}
          required
          maxLength={120}
        />
      </label>
      <label>
        Rate (basis points)
        <input
          name="rateBps"
          type="number"
          inputMode="numeric"
          defaultValue={profile?.rateBps ?? 0}
          required
          min={0}
          max={10_000}
          step={1}
        />
      </label>
      <label>
        Treatment
        <select
          name="treatment"
          defaultValue={profile?.treatment ?? "standard"}
          required
        >
          {treatmentOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Jurisdiction country code
        <input
          name="jurisdictionCountryCode"
          defaultValue={profile?.jurisdictionCountryCode ?? ""}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          autoCapitalize="characters"
        />
      </label>
    </div>
  );
}

function CreateTaxProfile() {
  return (
    <details className="settings-create">
      <summary className="button">Create tax profile</summary>
      <form action={createTaxProfile} className="settings-card-form">
        <input type="hidden" name="commandId" value={crypto.randomUUID()} />
        <fieldset className="settings-fieldset">
          <legend>Create tax profile</legend>
          <p>
            Quote tax mode remains the price-basis authority. A tax profile
            defines rate, treatment and jurisdiction only.
          </p>
          <TaxProfileFields />
          <button className="button button-primary" type="submit">
            Create tax profile
          </button>
        </fieldset>
      </form>
    </details>
  );
}

function TaxProfileCard({
  profile,
  activeProfiles,
}: {
  profile: TaxProfileSettingsValue;
  activeProfiles: TaxProfileSettingsValue[];
}) {
  const titleId = `tax-profile-title-${profile.id}`;
  const replacementProfiles = activeProfiles.filter(
    (candidate) => candidate.id !== profile.id,
  );

  return (
    <article
      className="tax-profile-card"
      aria-labelledby={titleId}
      data-testid={`tax-profile-${profile.id}`}
      data-profile-state={profile.active ? "active" : "archived"}
    >
      <header>
        <div>
          <h3 id={titleId}>
            {profile.code} — {profile.label}
          </h3>
          <p>
            {profile.rateBps} basis points ·{" "}
            {profile.treatment.replaceAll("_", " ")}
            {profile.jurisdictionCountryCode
              ? ` · ${profile.jurisdictionCountryCode}`
              : ""}
          </p>
        </div>
        <span className="state-label">
          {profile.active ? "Active" : "Archived"}
        </span>
      </header>

      {profile.active && (
        <div className="tax-profile-actions">
          <details>
            <summary className="button">Edit {profile.code}</summary>
            <form action={updateTaxProfile} className="settings-card-form">
              <input type="hidden" name="taxProfileId" value={profile.id} />
              <input
                type="hidden"
                name="expectedVersion"
                value={profile.version}
              />
              <input
                type="hidden"
                name="commandId"
                value={crypto.randomUUID()}
              />
              <fieldset className="settings-fieldset">
                <legend>Edit {profile.code} tax profile</legend>
                <TaxProfileFields profile={profile} />
                <button className="button button-primary" type="submit">
                  Save {profile.code} tax profile
                </button>
              </fieldset>
            </form>
          </details>

          <details>
            <summary className="button">Archive {profile.code}</summary>
            <form action={archiveTaxProfile} className="settings-card-form">
              <input type="hidden" name="taxProfileId" value={profile.id} />
              <input
                type="hidden"
                name="expectedVersion"
                value={profile.version}
              />
              <input
                type="hidden"
                name="commandId"
                value={crypto.randomUUID()}
              />
              <fieldset className="settings-fieldset">
                <legend>Archive {profile.code} tax profile</legend>
                <p>
                  Choose a different active profile when active products use
                  this tax profile. Quote snapshots are never rewritten.
                </p>
                <label>
                  Replacement tax profile
                  <select name="replacementTaxProfileId" defaultValue="">
                    <option value="">
                      No replacement (only if the profile is unused)
                    </option>
                    {replacementProfiles.map((replacement) => (
                      <option key={replacement.id} value={replacement.id}>
                        {replacement.code} — {replacement.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button" type="submit">
                  Archive {profile.code} tax profile
                </button>
              </fieldset>
            </form>
          </details>
        </div>
      )}
    </article>
  );
}

export function TaxProfileSettings({
  profiles,
}: {
  profiles: TaxProfileSettingsValue[];
}) {
  const activeProfiles = profiles.filter((profile) => profile.active);

  return (
    <section className="settings-panel" aria-labelledby="tax-profile-heading">
      <header className="settings-panel-header">
        <div>
          <h2 id="tax-profile-heading">Tax profiles</h2>
          <p>
            Configure organization-specific calculation treatments without
            changing issued quote snapshots.
          </p>
        </div>
        <CreateTaxProfile />
      </header>
      <div className="tax-profile-list">
        {profiles.map((profile) => (
          <TaxProfileCard
            key={profile.id}
            profile={profile}
            activeProfiles={activeProfiles}
          />
        ))}
      </div>
    </section>
  );
}
