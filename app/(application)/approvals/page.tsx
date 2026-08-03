import Link from "next/link";
import { formatMinor } from "@/lib/formatting/money";
import { dateInTimeZone } from "@/lib/quotes/effective-state";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function ApprovalsPage() {
  const context = await requireApplicationContext();
  const supabase = await createClient();
  const organizationToday = dateInTimeZone(
    new Date(),
    context.membership.organization.timezone,
  );
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select(
      "id, number, customer_name_snapshot, discount_bps, approval_threshold_bps_snapshot, currency_code, locale, total_minor, submitted_at",
    )
    .eq("organization_id", context.membership.organizationId)
    .eq("state", "waiting")
    .gte("valid_until", organizationToday)
    .order("submitted_at");
  if (error) throw new Error("Unable to load the tenant approval queue.");
  const canDecide =
    context.capabilities.includes("quote.approve") ||
    context.capabilities.includes("quote.reject");
  return (
    <section className="destination-page approvals-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Decision queue</p>
          <h1>Approvals</h1>
          <p>
            Quotations above their submission-time approval threshold wait here.
          </p>
        </div>
      </header>
      {!canDecide && (
        <div className="quiet-notice">
          This account can see its organization’s commercial state but cannot
          approve or reject. Decision controls appear only for capable signed
          users.
        </div>
      )}
      <div
        className="table-region"
        tabIndex={0}
        role="region"
        aria-label="Approvals queue table"
      >
        <table>
          <thead>
            <tr>
              <th>Quotation</th>
              <th>Customer</th>
              <th>Discount</th>
              <th>Submission threshold</th>
              <th>Total</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {(quotes ?? []).map((quote) => (
              <tr key={quote.id}>
                <td>
                  <Link
                    className="record-link mono"
                    href={`/quotes/${encodeURIComponent(quote.number)}`}
                  >
                    {quote.number}
                  </Link>
                </td>
                <td>{quote.customer_name_snapshot}</td>
                <td>{(quote.discount_bps / 100).toFixed(2)}%</td>
                <td>
                  {quote.approval_threshold_bps_snapshot === null
                    ? "—"
                    : `${(quote.approval_threshold_bps_snapshot / 100).toFixed(2)}%`}
                </td>
                <td className="money">
                  {formatMinor(
                    quote.total_minor,
                    quote.currency_code,
                    quote.locale,
                  )}
                </td>
                <td>
                  {canDecide ? (
                    <Link
                      className="button"
                      href={`/quotes/${encodeURIComponent(quote.number)}`}
                    >
                      Inspect decision
                    </Link>
                  ) : (
                    "Manager decision required"
                  )}
                </td>
              </tr>
            ))}
            {!quotes?.length && (
              <tr>
                <td className="table-empty" colSpan={6}>
                  No quotations are waiting for approval.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
