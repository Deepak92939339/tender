import Link from "next/link";
import { PublicHeader } from "@/components/marketing/public-header";

export default function WhatsNewPage() {
  return (
    <main id="main-content" className="public-shell guide-public">
      <PublicHeader />
      <header className="guide-hero compact">
        <p className="eyebrow">Release notes</p>
        <h1>What&apos;s new in Tender</h1>
        <p>
          A plain-language record of visible product changes, why they matter
          and what remains deliberately outside this portfolio release.
        </p>
        <Link className="button button-primary" href="/sign-in">
          Open reviewer demo
        </Link>
      </header>

      <section className="release-entry current">
        <header>
          <div>
            <p className="eyebrow">26 August 2026</p>
            <h2>Public reviewer release</h2>
          </div>
          <span>Current</span>
        </header>
        <ul>
          <li>
            Added a published fictional reviewer account with one-click entry.
          </li>
          <li>
            Added a dedicated database role containing only organization,
            catalog, customer and quotation read capabilities.
          </li>
          <li>
            Added this public fail-safe guide, release notes and support links
            in the authenticated organization bar.
          </li>
          <li>
            Added explicit recovery pages so a server failure does not strand a
            newcomer on an unexplained framework error.
          </li>
        </ul>
      </section>

      <section className="release-entry">
        <header>
          <div>
            <p className="eyebrow">24–25 August 2026</p>
            <h2>Production release and interface repair</h2>
          </div>
        </header>
        <ul>
          <li>
            Deployed the dedicated Vercel and Supabase portfolio environment
            with 29 reviewed migrations, signed public transport and fictional
            seed data.
          </li>
          <li>
            Corrected British Columbia GST 5% and PST 7% as structurally
            separate tax components.
          </li>
          <li>
            Restored quantity × unit price as the visible line amount instead of
            folding document discount and tax into each line.
          </li>
          <li>
            Replaced authenticated mobile tables with readable card layouts and
            hardened long-name wrapping.
          </li>
          <li>
            Removed browser-test fixtures from the final demo and seeded 14
            products, 6 customers and 14 lifecycle quotations.
          </li>
        </ul>
      </section>

      <section className="release-entry limitations">
        <header>
          <div>
            <p className="eyebrow">Known boundaries</p>
            <h2>Not claimed by this release</h2>
          </div>
        </header>
        <ul>
          <li>
            No email delivery, immutable generated PDF store or accounting
            integration.
          </li>
          <li>
            No membership-administration interface or multi-organization
            switcher.
          </li>
          <li>
            No claim of universal tax compliance or independent penetration
            testing.
          </li>
          <li>
            Forward-only migrations require a forward fix or backup/recreation
            strategy.
          </li>
        </ul>
        <p>
          For the full product walkthrough, read the{" "}
          <Link href="/help">reviewer guide</Link>.
        </p>
      </section>
    </main>
  );
}
