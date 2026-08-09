import { formatMinor } from "@/lib/formatting/money";
import type { SampleQuoteState } from "@/lib/demo/sample-quote-adapter";
import { calculateSampleQuote } from "@/lib/demo/sample-quote-adapter";

export function SampleDocumentPreview({
  state,
  quote,
}: {
  state: SampleQuoteState;
  quote: ReturnType<typeof calculateSampleQuote>;
}) {
  return (
    <article
      className="sample-document"
      aria-label="Live sample quotation document"
    >
      <header>
        <div>
          <span>Quotation</span>
          <strong>TND-SAMPLE-01</strong>
        </div>
        <em>Specimen — not issued</em>
      </header>
      <section className="sample-document-meta">
        <div>
          <span>From</span>
          <strong>Sudarshan Precision Works</strong>
          <small>Mumbai, India</small>
        </div>
        <div>
          <span>For</span>
          <strong>{state.customerName}</strong>
          <small>Sample workspace</small>
        </div>
        <div>
          <span>Date</span>
          <strong>9 Aug 2026</strong>
          <small>Valid until 21 Aug 2026</small>
        </div>
      </section>
      <div className="sample-document-lines">
        <div className="sample-line-heading">
          <span>#</span>
          <span>Description</span>
          <span>Quantity</span>
          <span>Unit price</span>
          <span>Final amount</span>
        </div>
        {quote.items.map((item, index) => (
          <div className="sample-line" key={item.product_id}>
            <span>{index + 1}</span>
            <strong>{item.description_snapshot}</strong>
            <span>
              {item.quantity_scaled / item.quantity_scale}{" "}
              {item.unit_code_snapshot}
            </span>
            <span>
              {formatMinor(item.unit_price_minor_snapshot, state.currency)}
            </span>
            <strong>
              {formatMinor(item.line_total_minor, state.currency)}
            </strong>
          </div>
        ))}
      </div>
      <p className="sample-line-note">
        Final amounts include the line discount and tax.
      </p>
      <dl className="sample-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMinor(quote.subtotal_minor, state.currency)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>− {formatMinor(quote.discount_minor, state.currency)}</dd>
        </div>
        <div>
          <dt>{state.taxMode === "inclusive" ? "Tax included" : "Tax"}</dt>
          <dd>{formatMinor(quote.tax_minor, state.currency)}</dd>
        </div>
        <div className="sample-total">
          <dt>Total</dt>
          <dd>{formatMinor(quote.total_minor, state.currency)}</dd>
        </div>
      </dl>
      <footer>Sample workspace · nothing is saved · TND-SAMPLE-01</footer>
    </article>
  );
}
