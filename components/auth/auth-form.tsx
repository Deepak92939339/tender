"use client";

import { useActionState, useEffect, useRef } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/(auth)/actions";

const initialState: AuthFormState = {};

export function AuthForm({
  mode,
  returnTo,
}: {
  mode: "sign-in" | "create-account";
  returnTo?: string;
}) {
  const action = mode === "sign-in" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorRef = useRef<HTMLDivElement>(null);
  const creating = mode === "create-account";

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state.error]);

  return (
    <form action={formAction} noValidate>
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
