import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ApplicationContext = Awaited<
  ReturnType<typeof getApplicationContext>
>;

export const getApplicationContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships, error }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, default_locale")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("organization_memberships")
      .select("organization_id, role_id, status, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  if (error) {
    console.error("auth_context_membership_query_failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Unable to load the authenticated organization context.");
  }
  const membershipRow = memberships?.[0] ?? null;
  let membership = null;
  let capabilities: string[] = [];
  if (membershipRow) {
    const [roleResult, organizationResult, capabilityResult] =
      await Promise.all([
        supabase
          .from("roles")
          .select("key, label")
          .eq("id", membershipRow.role_id)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select(
            "id, slug, name, default_currency_code, default_locale, approval_threshold_bps, timezone",
          )
          .eq("id", membershipRow.organization_id)
          .maybeSingle(),
        supabase
          .from("role_capabilities")
          .select("capability_key")
          .eq("role_id", membershipRow.role_id),
      ]);

    if (
      roleResult.error ||
      organizationResult.error ||
      capabilityResult.error ||
      !roleResult.data ||
      !organizationResult.data
    ) {
      console.error("auth_context_relationship_query_failed", {
        roleCode: roleResult.error?.code,
        organizationCode: organizationResult.error?.code,
        capabilityCode: capabilityResult.error?.code,
        roleFound: Boolean(roleResult.data),
        organizationFound: Boolean(organizationResult.data),
      });
      throw new Error("Unable to load the authenticated organization context.");
    }

    membership = {
      organizationId: membershipRow.organization_id,
      status: membershipRow.status,
      createdAt: membershipRow.created_at,
      role: roleResult.data,
      organization: organizationResult.data,
    };
    capabilities = capabilityResult.data.map((row) => row.capability_key);
  }

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile: {
      displayName:
        profile?.display_name ?? user.email?.split("@")[0] ?? "Tender user",
      locale: profile?.default_locale ?? "en-IN",
    },
    membership,
    capabilities,
  };
});

export async function requireUser() {
  const context = await getApplicationContext();
  if (!context) redirect("/sign-in");
  return context;
}

export async function requireApplicationContext() {
  const context = await requireUser();
  if (!context.membership) redirect("/onboarding");
  return { ...context, membership: context.membership };
}
