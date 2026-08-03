import Link from "next/link";
import { formatMinor } from "@/lib/formatting/money";
import {
  effectiveQuoteState,
  quoteStateLabel,
} from "@/lib/quotes/effective-state";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function QuotesPage() {
  const context = await requireApplicationContext();
  const supabase = await createClient();
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select(
      "id, number, state, customer_name_snapshot, issue_date, valid_until, currency_code, locale, total_minor, updated_at, customers!inner(name)",
    )
    .eq("organization_id", context.membership.organizationId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Unable to load tenant quotations.");
  return (
    <section className="destination-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Commercial work</p>
          <h1>Quotes</h1>
          <p>Draft, submit, decide and issue exact quotations.</p>
        </div>
        {context.capabilities.includes("quote.create") && (
          <Link className="button button-primary" href="/quotes/new">
            Create quote
          </Link>
        )}
      </header>
      <div
        className="table-region"
        tabIndex={0}
        role="region"
        aria-label="Quotes table"
      >
        <table>
          <thead>
            <tr>
              <th>Quotation</th>
              <th>Customer</th>
              <th>State</th>
              <th>Issue date</th>
              <th>Valid until</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {quotes?.map((quote) => {
              const customer = Array.isArray(quote.customers)
                ? quote.customers[0]
                : quote.customers;
              const state = effectiveQuoteState(
                quote.state,
                quote.valid_until,
                context.membership.organization.timezone,
              );
              const customerName =
                quote.state === "draft"
                  ? customer.name
                  : (quote.customer_name_snapshot ?? customer.name);
              return (
                <tr key={quote.id}>
                  <td>
                    <Link
                      className="record-link mono"
                      href={`/quotes/${encodeURIComponent(quote.number)}`}
                    >
                      {quote.number}
                    </Link>
                  </td>
                  <td>{customerName}</td>
                  <td>
                    <span className="state-label">
                      {quoteStateLabel(state)}
                    </span>
                  </td>
                  <td>{quote.issue_date}</td>
                  <td>{quote.valid_until}</td>
                  <td className="money">
                    {formatMinor(
                      quote.total_minor,
                      quote.currency_code,
                      quote.locale,
                    )}
                  </td>
                </tr>
              );
            })}
            {!quotes?.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No quotations yet. Create a draft to begin the commercial
                  record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
