"use client";

import { useActionState, useEffect, useRef } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/(auth)/actions";
import { reviewerAccess } from "@/lib/auth/reviewer-access";

const initialState: AuthFormState = {};

export function AuthForm({
  mode,
  returnTo,
  showReviewerAccess = false,
}: {
  mode: "sign-in" | "create-account";
  returnTo?: string;
  showReviewerAccess?: boolean;
}) {
  const action = mode === "sign-in" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const creating = mode === "create-account";

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state.error]);

  return (
    <form ref={formRef} action={formAction} noValidate>
      {state.error && (
        <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
          {state.error}
        </div>
      )}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {creating && (
        <label>
          Full name
          <input name="name" autoComplete="name" required maxLength={100} />
        </label>
      )}
      <label>
        Email address
        <input
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          ref={passwordRef}
          name="password"
          type="password"
          autoComplete={creating ? "new-password" : "current-password"}
          required
          minLength={8}
          maxLength={128}
          aria-describedby={creating ? "password-help" : undefined}
        />
      </label>
      {creating && (
        <p id="password-help" className="field-help">
          8–128 characters with at least one letter and one number.
        </p>
      )}
      {!creating && showReviewerAccess && (
        <section className="reviewer-access" aria-labelledby="reviewer-heading">
          <div>
            <p className="eyebrow">Portfolio demo</p>
            <h2 id="reviewer-heading">Read-only reviewer access</h2>
            <p>
              Browse the seeded workspace. Creating, editing, approving and
              issuing are blocked by database permissions.
            </p>
          </div>
          <dl>
            <div>
              <dt>Email</dt>
              <dd className="mono">{reviewerAccess.email}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd className="mono">{reviewerAccess.password}</dd>
            </div>
          </dl>
          <button
            className="button reviewer-button"
            type="button"
            disabled={pending}
            onClick={() => {
              if (!emailRef.current || !passwordRef.current) return;
              emailRef.current.value = reviewerAccess.email;
              passwordRef.current.value = reviewerAccess.password;
              formRef.current?.requestSubmit();
            }}
          >
            {pending ? "Opening workspace…" : "Enter reviewer workspace"}
          </button>
        </section>
      )}
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "Working…" : creating ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
