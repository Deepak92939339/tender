import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { Brand } from "@/components/ui/brand";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireUser } from "@/lib/auth/context";

export default async function OnboardingPage() {
  const context = await requireUser();
  if (context.membership) redirect("/quotes");
  return (
    <main id="main-content" className="onboarding-shell">
      <section className="onboarding-card">
        <Brand />
        <p className="eyebrow">Organization</p>
        <h1>Establish your commercial workspace.</h1>
        <p>
          Create the organization that will own customers, catalog records and
          quotations. You will begin as its organization admin.
        </p>
        <OnboardingForm commandId={randomUUID()} />
      </section>
    </main>
  );
}
