"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/auth/return-to";
import { isPublicDemoMode } from "@/lib/auth/demo-mode";
import {
  logMutationFailure,
  withReference,
} from "@/lib/errors/mutation-failure";

export type AuthFormState = { error?: string };

const email = z.string().trim().email().max(254);
const password = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);
const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password,
});
const signInSchema = z.object({ email, password: z.string().min(1).max(128) });

export async function signIn(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error:
        "Sign-in failed. Nothing changed. Check the email and password fields, then try again.",
    };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword(
    parsed.data,
  );
  if (authError) {
    const reference = logMutationFailure("auth.sign_in", authError);
    return {
      error: withReference(
        "Sign-in failed. Nothing changed and your data is preserved. Check your credentials, then try again.",
        reference,
      ),
    };
  }

  redirect(safeReturnTo(formData.get("returnTo")));
}

export async function signUp(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (isPublicDemoMode()) {
    return {
      error:
        "Account creation is disabled for this public demo. Use demo access supplied privately by the project owner.",
    };
  }

  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error:
        "Account creation failed. No account was created. Use a valid email and an 8–128 character password containing a letter and number.",
    };
  }

  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.name } },
  });
  if (authError || !data.user) {
    const reference = logMutationFailure(
      "auth.sign_up",
      authError ?? undefined,
    );
    return {
      error: withReference(
        "Account creation failed. No organization or commercial data was created. Check the email, then try again.",
        reference,
      ),
    };
  }

  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
