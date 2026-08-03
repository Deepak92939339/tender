"use client";

import { useActionState } from "react";
import {
  createOrganization,
  type OnboardingState,
} from "@/app/(onboarding)/onboarding/actions";

export function OnboardingForm({ commandId }: { commandId: string }) {
  const [state, action, pending] = useActionState(
    createOrganization,
    {} as OnboardingState,
  );
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
        <input name="name" required maxLength={120} autoFocus />
      </label>
      <label>
        Organization URL
        <input
          name="slug"
          required
          minLength={3}
          maxLength={64}
          pattern="[a-z0-9][a-z0-9-]+[a-z0-9]"
          aria-describedby="slug-help"
        />
      </label>
      <p id="slug-help" className="field-help">
        Lowercase letters, numbers and hyphens; for example,
        northstar-industries.
      </p>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
