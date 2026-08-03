"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  logMutationFailure,
  withReference,
} from "@/lib/errors/mutation-failure";

export type OnboardingState = { error?: string };

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  commandId: z.string().uuid(),
});

export async function createOrganization(
  _: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error:
        "Organization creation failed. Nothing was changed. Use a 3–64 character lowercase slug containing letters, numbers or hyphens.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_command_id: parsed.data.commandId,
  });
  if (error) {
    const reference = logMutationFailure("organization.create", error);
    const next = error.message.includes("organization_slug_taken")
      ? "Choose another organization URL and try again."
      : "Your account and data are preserved. Check the fields, then try again.";
    return {
      error: withReference(
        `Organization creation failed. No organization was created. ${next}`,
        reference,
      ),
    };
  }

  redirect("/quotes");
}
