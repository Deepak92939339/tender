import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { AuthForm } from "./auth-form";

export function AuthCard({
  mode,
  returnTo,
  signUpEnabled,
}: {
  mode: "sign-in" | "create-account";
  returnTo?: string;
  signUpEnabled: boolean;
}) {
  const creating = mode === "create-account";
  return (
    <main id="main-content" className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <Brand />
        <div className="auth-heading">
          <p className="eyebrow">
            {creating ? "Start with Tender" : "Welcome back"}
          </p>
          <h1 id="auth-heading">
            {creating ? "Create your account" : "Sign in"}
          </h1>
          <p>
            {creating
              ? "Create an account, then establish your organization."
              : "Continue to your commercial workspace."}
          </p>
        </div>
        <AuthForm mode={mode} returnTo={returnTo} />
        {creating || signUpEnabled ? (
          <p className="auth-switch">
            {creating ? "Already have an account?" : "New to Tender?"}{" "}
            <Link href={creating ? "/sign-in" : "/create-account"}>
              {creating ? "Sign in" : "Create account"}
            </Link>
          </p>
        ) : (
          <p className="auth-switch">
            This public demo is invitation-only. Demo access is supplied
            privately by the project owner.
          </p>
        )}
      </section>
      <aside className="auth-context">
        <div className="auth-context-copy">
          <p className="eyebrow">Quiet commercial utility</p>
          <h2>
            One document. One decision rule. A clear record of what happened.
          </h2>
          <p>
            Tender keeps preparation, approval and issuance distinct without
            turning commercial work into a dashboard.
          </p>
        </div>
      </aside>
    </main>
  );
}
