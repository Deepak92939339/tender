import Link from "next/link";
import { SampleQuoteBuilder } from "@/components/demo/sample-quote-builder";
import { DecisionRoomHero } from "@/components/marketing/decision-room-hero";
import { Brand } from "@/components/ui/brand";

export default function LandingPage() {
  return (
    <main id="main-content" className="public-shell decision-room">
      <header className="public-header">
        <Brand />
        <nav aria-label="Public navigation">
          <a href="#product">Product</a>
          <a href="#sample-builder">Sample builder</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>
      <DecisionRoomHero />
      <section className="decision-truths" aria-label="Tender principles">
        <article>
          <span>01</span>
          <h2>Exact commercial values</h2>
          <p>
            Currency, tax, quantity and charges stay explicit from catalog to
            issued document.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>A separate decision surface</h2>
          <p>
            Operators prepare the offer. Managers see the threshold and decide
            without changing the document.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>History attached to the quote</h2>
          <p>
            Submission, approval, rejection and issuance remain visible as
            commercial activity.
          </p>
        </article>
      </section>
      <SampleQuoteBuilder />
      <section className="decision-workflow" id="workflow">
        <p className="eyebrow">A direct workflow</p>
        <ol>
          <li>
            <span>1</span>Draft
          </li>
          <li>
            <span>2</span>Submit
          </li>
          <li>
            <span>3</span>Approve when required
          </li>
          <li>
            <span>4</span>Issue
          </li>
        </ol>
      </section>
    </main>
  );
}
