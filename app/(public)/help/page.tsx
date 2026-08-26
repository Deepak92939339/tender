import Link from "next/link";
import { PublicHeader } from "@/components/marketing/public-header";

const pages = [
  {
    name: "Quotes",
    href: "/quotes",
    purpose: "The complete commercial record",
    lookFor:
      "Document number, customer, lifecycle state, validity dates, currency and authoritative total.",
  },
  {
    name: "Approvals",
    href: "/approvals",
    purpose: "The manager decision queue",
    lookFor:
      "Quotes waiting because their submitted discount crossed the captured approval threshold.",
  },
  {
    name: "Catalog",
    href: "/catalog",
    purpose: "The priced product source",
    lookFor:
      "SKU, unit, integer-safe unit price, tax profile, quantity precision and active state.",
  },
  {
    name: "Customers",
    href: "/customers",
    purpose: "Tenant-scoped commercial parties",
    lookFor:
      "Contact, billing location, preferred currency, locale and tax treatment.",
  },
] as const;

const states = [
  [
    "Draft",
    "Editable working document; no commercial decision has been requested.",
  ],
  [
    "Waiting",
    "Submitted above the approval threshold and awaiting a manager decision.",
  ],
  ["Approved", "Accepted internally but not yet issued to the customer."],
  [
    "Rejected",
    "Manager declined the submitted version; the activity record remains.",
  ],
  ["Issued", "Commercial values and seller/customer snapshots are sealed."],
  ["Delivered", "Recipient delivery is recorded separately from issuance."],
  ["Expired", "Validity ended according to the organization timezone."],
] as const;

export default function HelpPage() {
  return (
    <main id="main-content" className="public-shell guide-public">
      <PublicHeader />

      <header className="guide-hero">
        <p className="eyebrow">Fail-safe reviewer guide</p>
        <h1>Understand Tender without guessing.</h1>
        <p>
          Tender is a quotation workflow demonstration. It keeps product
          pricing, customer context, approval decisions and the issued document
          attached to one traceable commercial record.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/sign-in">
            Enter reviewer workspace
          </Link>
          <Link className="button" href="/whats-new">
            See what&apos;s new
          </Link>
        </div>
      </header>

      <nav className="guide-toc" aria-label="Guide contents">
        <strong>In this guide</strong>
        <a href="#quick-start">Quick start</a>
        <a href="#pages">Pages</a>
        <a href="#workflow">Workflow</a>
        <a href="#features">Features</a>
        <a href="#permissions">Permissions</a>
        <a href="#troubleshooting">Troubleshooting</a>
      </nav>

      <section className="guide-section" id="quick-start">
        <p className="eyebrow">Five-minute path</p>
        <h2>Quick start</h2>
        <ol className="guide-steps">
          <li>
            <span>01</span>
            <div>
              <h3>Open Reviewer access</h3>
              <p>
                The sign-in page publishes the fictional reviewer email and
                password. Select <strong>Enter reviewer workspace</strong>;
                there is nothing to copy.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Start with Quotes</h3>
              <p>
                Compare draft, waiting, rejected, approved, issued and expired
                examples. Open quotation numbers to inspect their line items,
                totals and activity.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Open Approvals</h3>
              <p>
                Notice that the reviewer can see why a decision is required but
                receives no approve or reject controls.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Trace the source data</h3>
              <p>
                Use Catalog and Customers to see where draft values begin, then
                compare them with the immutable snapshots on an issued quote.
              </p>
            </div>
          </li>
          <li>
            <span>05</span>
            <div>
              <h3>Try the anonymous specimen</h3>
              <p>
                Return home and change market, tax presentation, price basis,
                quantities and discount. This specimen calculates in the tab and
                stores nothing.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="guide-section" id="pages">
        <p className="eyebrow">Page by page</p>
        <h2>Where to go and what to inspect</h2>
        <div className="guide-card-grid">
          {pages.map((page) => (
            <article key={page.href}>
              <p>{page.purpose}</p>
              <h3>
                <Link href={page.href}>{page.name}</Link>
              </h3>
              <p>{page.lookFor}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section" id="workflow">
        <p className="eyebrow">Commercial state</p>
        <h2>The workflow is a controlled state machine</h2>
        <div className="state-guide">
          {states.map(([name, description]) => (
            <div key={name}>
              <strong>{name}</strong>
              <p>{description}</p>
            </div>
          ))}
        </div>
        <div className="guide-callout">
          <strong>The important distinction</strong>
          <p>
            Approved is not Issued, and Issued is not Delivered. Tender keeps
            each event separate so a reviewer can tell what actually happened
            instead of interpreting one overloaded status.
          </p>
        </div>
      </section>

      <section className="guide-section" id="features">
        <p className="eyebrow">Feature map</p>
        <h2>What the software demonstrates</h2>
        <div className="feature-list">
          <article>
            <h3>Exact-money calculation</h3>
            <p>
              Money uses integer minor units, percentage rates use basis points,
              and scaled quantities avoid floating-point drift. PostgreSQL is
              authoritative; TypeScript previews are parity tested against it.
            </p>
          </article>
          <article>
            <h3>Captured commercial snapshots</h3>
            <p>
              Submission captures approval conditions. Issuance captures the
              customer and seller identity, preventing later profile edits from
              silently rewriting an issued document.
            </p>
          </article>
          <article>
            <h3>Tenant and capability boundaries</h3>
            <p>
              Organization membership, Row Level Security and guarded database
              commands decide who may read or mutate. Hiding a button is not
              treated as authorization.
            </p>
          </article>
          <article>
            <h3>Append-only activity</h3>
            <p>
              Submission, decisions, issuance and recipient events remain
              attached to the quotation as evidence rather than being replaced
              by only the latest state.
            </p>
          </article>
          <article>
            <h3>Recipient capability links</h3>
            <p>
              Issuers can create bounded share links. Signed transport, short
              sessions, verification codes and database checks keep recipient
              access separate from employee authentication.
            </p>
          </article>
          <article>
            <h3>Responsive commercial documents</h3>
            <p>
              Tables become readable mobile cards, long legal names wrap, and
              issued documents retain print-oriented presentation without
              changing their amounts.
            </p>
          </article>
        </div>
      </section>

      <section className="guide-section" id="permissions">
        <p className="eyebrow">Reviewer safety</p>
        <h2>What this account can and cannot do</h2>
        <div className="permission-grid">
          <article>
            <h3>Reviewer can</h3>
            <ul>
              <li>Read the fictional organization context</li>
              <li>Browse quotes and their history</li>
              <li>Inspect the approval queue</li>
              <li>Search products and customers</li>
              <li>Use this guide and What&apos;s new</li>
            </ul>
          </article>
          <article>
            <h3>Reviewer cannot</h3>
            <ul>
              <li>Create or edit quotations</li>
              <li>Create, import or edit catalog records</li>
              <li>Create or edit customers</li>
              <li>Approve, reject, issue or share quotations</li>
              <li>Change organization settings or memberships</li>
            </ul>
          </article>
        </div>
        <p className="legal-note">
          All organizations, customers, people, identifiers and quotation data
          are fictional. This is a portfolio demonstration, not a tax,
          accounting, ERP or legal-compliance service.
        </p>
      </section>

      <section className="guide-section" id="troubleshooting">
        <p className="eyebrow">Recovery</p>
        <h2>If something does not behave as expected</h2>
        <div className="troubleshooting-list">
          <details>
            <summary>The reviewer workspace does not open</summary>
            <p>
              Reload once, return to{" "}
              <Link href="/sign-in">Reviewer access</Link>, and use the
              one-click button again. Do not create a personal account; public
              signup is intentionally disabled.
            </p>
          </details>
          <details>
            <summary>A create or decision button is missing</summary>
            <p>
              That is expected for the read-only reviewer. The interface hides
              mutation controls and the database independently refuses those
              capabilities.
            </p>
          </details>
          <details>
            <summary>A quote amount looks surprising</summary>
            <p>
              Check quantity × unit price first, then discount, price basis, tax
              presentation and charges. Line amount never folds document
              discount and tax into quantity × unit price.
            </p>
          </details>
          <details>
            <summary>
              The anonymous specimen changed but nothing was saved
            </summary>
            <p>
              Correct: the home-page specimen is deliberately ephemeral. The
              authenticated workspace contains the stored fictional records.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
