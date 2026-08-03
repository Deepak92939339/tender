import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { isPublicDemoMode } from "@/lib/auth/demo-mode";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

export default function LandingPage() {
  const demoMode = isPublicDemoMode();
  return (
    <main id="main-content" className="public-shell">
      <header className="public-header">
        <Brand />
        <nav aria-label="Public navigation">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <Link href="/sign-in">Sign in</Link>
          <Link
            className="button button-primary"
            href={demoMode ? "/sign-in" : "/create-account"}
          >
            {demoMode ? "View demo" : "Create account"}
          </Link>
        </nav>
      </header>

      <section className="hero" id="product">
        <div className="hero-copy">
          <p className="eyebrow">
            Commercial quotations, held to a clear rule.
          </p>
          <h1>
            Prepare the offer.
            <br />
            Keep the decision precise.
          </h1>
          <p className="hero-lede">
            Tender gives commercial teams one quiet place to draft exact
            quotations, route discount decisions and issue an accountable
            document.
          </p>
          <div className="button-row">
            <Link
              className="button button-primary"
              href={demoMode ? "/sign-in" : "/create-account"}
            >
              {demoMode ? "View demo" : "Create account"}
            </Link>
            <Link className="button" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>

        <article
          className="quote-preview"
          aria-label="Quotation awaiting approval"
        >
          <header>
            <div>
              <p className="eyebrow">Quotation</p>
              <h2>TND-2026-0041</h2>
            </div>
            <p className="state">Waiting for approval</p>
          </header>
          <div className="quote-meta">
            <span>For</span>
            <strong>Asha Engineering Works</strong>
            <span>Valid until</span>
            <strong>21 Aug 2026</strong>
          </div>
          <div
            className="preview-table"
            role="table"
            aria-label="Quotation lines"
          >
            <div role="row">
              <span>Precision coupling assembly</span>
              <span>2 EA</span>
              <strong>{money.format(22400)}</strong>
            </div>
            <div role="row">
              <span>Stainless feed rail</span>
              <span>3 M</span>
              <strong>{money.format(11700)}</strong>
            </div>
          </div>
          <dl className="preview-totals">
            <div>
              <dt>Discount</dt>
              <dd>12%</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>INR 5,391.62</dd>
            </div>
            <div className="grand-total">
              <dt>Total</dt>
              <dd>INR 35,345.06</dd>
            </div>
          </dl>
          <div className="threshold">
            <span className="threshold-mark" aria-hidden="true" />
            <span>Manager review above 10%</span>
            <strong>12%</strong>
          </div>
        </article>
      </section>

      <section className="truths" aria-label="Product truths">
        <article>
          <p>01</p>
          <h2>Exact commercial values</h2>
          <p>
            Currency, tax, quantity and charges stay explicit from catalog to
            issued document.
          </p>
        </article>
        <article>
          <p>02</p>
          <h2>A separate decision surface</h2>
          <p>
            Operators prepare the offer. Managers see the threshold and decide
            without changing the document.
          </p>
        </article>
        <article>
          <p>03</p>
          <h2>History attached to the quote</h2>
          <p>
            Submission, approval, rejection and issuance remain visible as
            commercial Activity.
          </p>
        </article>
      </section>

      <section className="workflow" id="workflow">
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
