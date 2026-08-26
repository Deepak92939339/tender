import Link from "next/link";
import { requireApplicationContext } from "@/lib/auth/context";

const routes = [
  [
    "Quotes",
    "/quotes",
    "Open prepared, waiting, approved and issued examples.",
  ],
  [
    "Approvals",
    "/approvals",
    "See which quotations require a manager decision.",
  ],
  [
    "Catalog",
    "/catalog",
    "Inspect products, exact unit prices and tax profiles.",
  ],
  [
    "Customers",
    "/customers",
    "Inspect fictional commercial parties and locale settings.",
  ],
] as const;

export default async function HelpPage() {
  const context = await requireApplicationContext();
  const readOnly = ![
    "catalog.manage",
    "customer.manage",
    "quote.create",
    "quote.edit",
    "quote.approve",
    "quote.issue",
  ].some((capability) => context.capabilities.includes(capability));

  return (
    <section className="destination-page help-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Start here</p>
          <h1>How to review Tender</h1>
          <p>
            A short route through the fictional workspace and the commercial
            controls it demonstrates.
          </p>
        </div>
        {readOnly && <span className="access-badge">Read-only account</span>}
      </header>

      <div className="quiet-notice">
        All companies, people and values in this portfolio environment are
        fictional. Reviewer access cannot create, edit, approve, reject, issue
        or delete commercial records.
      </div>

      <div className="help-grid">
        {routes.map(([label, href, description], index) => (
          <article key={href}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>
              <Link href={href}>{label}</Link>
            </h2>
            <p>{description}</p>
          </article>
        ))}
      </div>

      <section className="help-explanation">
        <h2>What to look for</h2>
        <ul>
          <li>
            Money is stored as integer minor units and calculated
            authoritatively in PostgreSQL.
          </li>
          <li>
            Draft, submitted, approved, rejected, issued and delivered states
            remain distinct.
          </li>
          <li>
            Issued quotations retain customer and seller snapshots instead of
            silently changing later.
          </li>
          <li>
            Tenant isolation and capability checks are enforced by Supabase Row
            Level Security and guarded RPCs.
          </li>
        </ul>
      </section>
    </section>
  );
}
