import { AppShell } from "@/components/application/app-shell";
import { requireApplicationContext } from "@/lib/auth/context";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireApplicationContext();
  return (
    <AppShell
      context={{
        canManageOrganization: context.capabilities.includes(
          "organization.manage",
        ),
        displayName: context.profile.displayName,
        roleLabel: context.membership.role.label,
        organizationName: context.membership.organization.name,
      }}
    >
      {children}
    </AppShell>
  );
}
