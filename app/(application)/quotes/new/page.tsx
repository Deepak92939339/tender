import { randomUUID } from "node:crypto";
import Link from "next/link";
import { NewQuoteForm } from "@/components/quotes/new-quote-form";
import { requireApplicationContext } from "@/lib/auth/context";
import { addDaysToIsoDate, dateInTimeZone } from "@/lib/quotes/effective-state";
import { createClient } from "@/lib/supabase/server";

export default async function NewQuotePage() {
  const context = await requireApplicationContext();
  const supabase = await createClient();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, name, preferred_currency_code, locale")
    .eq("organization_id", context.membership.organizationId)
    .eq("active", true)
    .order("name");
  if (error)
    throw new Error("Unable to load tenant customers for a new quotation.");
  const issueDate = dateInTimeZone(
    new Date(),
    context.membership.organization.timezone,
  );
  const validUntil = addDaysToIsoDate(issueDate, 30);
  return (
    <section className="quote-new-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">New quotation</p>
          <h1>Prepare the offer</h1>
          <p>
            Start with the commercial header, then build the document on one
            surface.
          </p>
        </div>
        <Link className="button" href="/quotes">
          Back to quotes
        </Link>
      </header>
      <div className="quote-paper quote-create-paper">
        <NewQuoteForm
          commandId={randomUUID()}
          customers={(customers ?? []).map((customer) => ({
            id: customer.id,
            name: customer.name,
            preferredCurrencyCode: customer.preferred_currency_code,
            locale: customer.locale,
          }))}
          issueDate={issueDate}
          validUntil={validUntil}
          defaultLocale={context.membership.organization.default_locale}
          defaultCurrency={
            context.membership.organization.default_currency_code
          }
        />
      </div>
    </section>
  );
}
