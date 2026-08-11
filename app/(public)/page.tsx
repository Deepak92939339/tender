import Link from "next/link";
import Image from "next/image";
import { SampleQuoteBuilder } from "@/components/demo/sample-quote-builder";
import { Brand } from "@/components/ui/brand";

export default function LandingPage() {
  return (
    <main id="main-content" className="public-shell tender-public">
      <header className="public-header">
        <Brand />
        <nav aria-label="Public navigation">
          <a href="#sample-builder">Try the specimen</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>
      <section className="public-introduction" id="product">
        <div className="public-introduction-copy">
          <p className="eyebrow">
            Commercial quotations, held to a clear rule.
          </p>
          <h1>Priced once. Approved on the record. Issued unchanged.</h1>
          <p>
            Currency, tax, approval and history stay attached to the same
            document from catalog to issue.
          </p>
          <div className="button-row">
            <a className="button button-primary" href="#sample-builder">
              Try it — no account
            </a>
            <Link className="button" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
        <div className="public-illustration">
          <Image
            className="botanical-asset botanical-asset-hero"
            src="/brand/tender-botanical-plant.png"
            alt=""
            width={1024}
            height={1536}
            sizes="(max-width: 900px) 0px, (max-width: 1280px) 34vw, 430px"
          />
        </div>
      </section>
      <SampleQuoteBuilder />
      <section className="public-capabilities" aria-label="Tender principles">
        <article>
          <span>01</span>
          <h2>Exact commercial values</h2>
          <p>
            Currency, tax, quantity and charges remain explicit from catalog to
            issued document.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>A separate decision surface</h2>
          <p>
            Operators prepare the offer. Managers can decide without altering
            the document.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>History attached to the quote</h2>
          <p>
            Submission, approval, rejection and issuance stay visible as
            commercial activity.
          </p>
        </article>
      </section>
      <section className="public-workflow" id="workflow">
        <h2>A direct workflow</h2>
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
        <p>
          <Link href="/sign-in">Sign in</Link> to create, store, approve and
          issue quotations in your workspace.
        </p>
      </section>
    </main>
  );
}
