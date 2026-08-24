import { formatMinor } from "@/lib/formatting/money";
import {
  marketFor,
  type SampleQuoteState,
} from "@/lib/demo/sample-quote-adapter";
import { calculateSampleQuote } from "@/lib/demo/sample-quote-adapter";

export function SampleDocumentPreview({
  state,
  quote,
}: {
  state: SampleQuoteState;
  quote: ReturnType<typeof calculateSampleQuote>;
}) {
  const market = marketFor(state.marketId);
  const taxIsIncluded = state.taxMode === "inclusive" && quote.tax_minor > 0;
  return (
    <article
      className="sample-document"
      aria-label="Live sample quotation document"
    >
      <header>
        <div>
          <span>Quotation</span>
          <strong>TND-SPECIMEN-01</strong>
        </div>
        <em>Specimen — not issued</em>
      </header>
      <section className="sample-document-meta">
        <div>
          <span>From</span>
          <strong>{market.label} demonstration business</strong>
          <small>{market.taxIdLabel}: DEMO-ONLY</small>
        </div>
        <div>
          <span>For</span>
          <strong>{state.customerName}</strong>
          <small>Anonymous workspace</small>
        </div>
        <div>
          <span>Document status</span>
          <strong>Not issued</strong>
          <small>No validity period</small>
        </div>
      </section>
      <div className="sample-document-lines">
        <div className="sample-line-heading">
          <span>#</span>
          <span>Description</span>
          <span>Quantity</span>
          <span>Unit price</span>
          <span>Amount</span>
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
              {formatMinor(
                item.unit_price_minor_snapshot,
                market.currency,
                market.locale,
              )}
            </span>
            <strong>
              {formatMinor(
                item.extended_line_amount_minor,
                market.currency,
                market.locale,
              )}
            </strong>
          </div>
        ))}
      </div>
      <dl className="sample-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>
            {formatMinor(quote.subtotal_minor, market.currency, market.locale)}
          </dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>
            −{" "}
            {formatMinor(quote.discount_minor, market.currency, market.locale)}
          </dd>
        </div>
        {state.taxPresentation === "export-zero" ? (
          <div>
            <dt>Export supply — zero-rated specimen</dt>
            <dd>
              {formatMinor(quote.tax_minor, market.currency, market.locale)}
            </dd>
          </div>
        ) : null}
        {quote.tax_components.map((component) => (
          <div key={`${component.label}:${component.rateBps}`}>
            <dt>{component.label}</dt>
            <dd>
              {formatMinor(
                component.amountMinor,
                market.currency,
                market.locale,
              )}
            </dd>
          </div>
        ))}
        {taxIsIncluded ? (
          <div>
            <dt>Tax included</dt>
            <dd>
              {formatMinor(quote.tax_minor, market.currency, market.locale)}
            </dd>
          </div>
        ) : null}
        <div className="sample-total">
          <dt>Total</dt>
          <dd>
            {formatMinor(quote.total_minor, market.currency, market.locale)}
          </dd>
        </div>
      </dl>
      <p className="sample-tax-disclaimer">
        Tax treatment is a configurable specimen, not a tax-compliance
        determination.
      </p>
      <footer>
        TND-SPECIMEN-01 · sample workspace · not issued · nothing is saved
      </footer>
    </article>
  );
}
