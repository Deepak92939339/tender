import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { Brand } from "@/components/ui/brand";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireUser } from "@/lib/auth/context";
import { signOut } from "@/app/(auth)/actions";
import Link from "next/link";

export default async function OnboardingPage() {
  const context = await requireUser();
  if (context.membership) redirect("/quotes");
  return (
    <main id="main-content" className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-heading">
        <Brand />
        <p className="eyebrow">Organization</p>
        <h1 id="onboarding-heading">Establish your commercial workspace.</h1>
        <p>
          Create the organization that will own customers, catalog records and
          quotations. You will begin as its organization admin.
        </p>
        <OnboardingForm commandId={randomUUID()} />
        <div className="onboarding-exits">
          <Link href="/#sample-builder">Return to public specimen</Link>
          <form action={signOut}>
            <button type="submit">Sign out / switch account</button>
          </form>
        </div>
      </section>
      <aside className="onboarding-context" aria-hidden="true" />
    </main>
  );
}
