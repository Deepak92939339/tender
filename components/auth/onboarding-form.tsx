"use client";

import { useActionState, useId, useState } from "react";
import {
  createOrganization,
  type OnboardingState,
} from "@/app/(onboarding)/onboarding/actions";
import {
  isOrganizationSlug,
  organizationSlugFromName,
} from "@/lib/validation/organization";

export function OnboardingForm({ commandId }: { commandId: string }) {
  const [state, action, pending] = useActionState(
    createOrganization,
    {} as OnboardingState,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const slugHelpId = useId();
  const slugValid = isOrganizationSlug(slug);
  const updateName = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(organizationSlugFromName(value));
  };
  return (
    <form action={action} className="onboarding-form" noValidate>
      {state.error && (
        <div className="form-error" role="alert" tabIndex={-1}>
          {state.error}
        </div>
      )}
      <input type="hidden" name="commandId" value={commandId} />
      <label>
        Organization name
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          value={name}
          onChange={(event) => updateName(event.target.value)}
        />
      </label>
      <label>
        Workspace URL slug
        <input
          name="slug"
          required
          minLength={3}
          maxLength={64}
          pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          aria-describedby={slugHelpId}
          aria-invalid={slug.length > 0 && !slugValid}
        />
      </label>
      <p id={slugHelpId} className="field-help">
        Lowercase letters, numbers and hyphens only — for example,
        <strong> landmark-industries</strong>. This is a workspace identifier,
        not a domain or email address.
      </p>
      {slug.length > 0 && !slugValid ? (
        <p className="field-validation" role="status">
          Use 3–64 lowercase letters, numbers or hyphens; begin and end with a
          letter or number.
        </p>
      ) : null}
      <button
        className="button button-primary"
        type="submit"
        disabled={pending || !name.trim() || !slugValid}
      >
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
