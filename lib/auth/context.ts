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
      .select(
        "organization_id, status, created_at, roles!inner(key, label), organizations!inner(id, slug, name, default_currency_code, default_locale, approval_threshold_bps, timezone)",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  if (error)
    throw new Error("Unable to load the authenticated organization context.");
  const membershipRow = memberships?.[0] ?? null;
  const membership = membershipRow
    ? {
        organizationId: membershipRow.organization_id,
        status: membershipRow.status,
        createdAt: membershipRow.created_at,
        role: Array.isArray(membershipRow.roles)
          ? membershipRow.roles[0]
          : membershipRow.roles,
        organization: Array.isArray(membershipRow.organizations)
          ? membershipRow.organizations[0]
          : membershipRow.organizations,
      }
    : null;

  let capabilities: string[] = [];
  if (membership) {
    const { data } = await supabase
      .from("role_capabilities")
      .select("capability_key, roles!inner(key)")
      .eq("roles.key", membership.role.key);
    capabilities = data?.map((row) => row.capability_key) ?? [];
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
