import { Brand } from "@/components/ui/brand";
import { AppNav } from "./app-nav";
import { signOut } from "@/app/(auth)/actions";
import Link from "next/link";

type ShellContext = {
  canManageOrganization: boolean;
  displayName: string;
  roleLabel: string;
  organizationName: string;
};

export function AppShell({
  context,
  children,
}: {
  context: ShellContext;
  children: React.ReactNode;
}) {
  return (
    <div className="application-shell">
      <header className="app-header">
        <Brand />
        <AppNav />
        <div className="account-block">
          <span>
            <strong>{context.displayName}</strong>
            <small>{context.roleLabel}</small>
          </span>
          <div className="account-actions">
            {context.canManageOrganization && (
              <Link href="/settings/organization">Organization settings</Link>
            )}
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="org-strip">
        <span className="threshold-mark" aria-hidden="true" />
        <span>{context.organizationName}</span>
        <span className="org-role">{context.roleLabel}</span>
        <nav className="org-strip-actions" aria-label="Product support">
          <Link href="/help">Help</Link>
          <Link href="/whats-new">What&apos;s new</Link>
        </nav>
      </div>
      <main id="main-content" className="app-main">
        {children}
      </main>
    </div>
  );
}
