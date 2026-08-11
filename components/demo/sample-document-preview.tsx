import { formatMinor } from "@/lib/formatting/money";
import {
  marketFor,
  taxLabels,
  type SampleQuoteState,
} from "@/lib/demo/sample-quote-adapter";
import { calculateSampleQuote } from "@/lib/demo/sample-quote-adapter";

function componentAmounts(totalMinor: number, labels: readonly string[]) {
  if (labels.length === 0) return [];
  if (labels.length === 1) return [totalMinor];
  // Presentation components partition the calculator's already-authoritative tax total.
  const total = BigInt(totalMinor);
  const first = total / 2n;
  return [Number(first), Number(total - first)];
}

export function SampleDocumentPreview({
  state,
  quote,
}: {
  state: SampleQuoteState;
  quote: ReturnType<typeof calculateSampleQuote>;
}) {
  const market = marketFor(state.marketId);
  const labels = taxLabels(
    state.taxPresentation,
    state.items[0]?.taxRate ?? market.rate,
  );
  const components = componentAmounts(quote.tax_minor, labels);
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
              {formatMinor(
                item.unit_price_minor_snapshot,
                market.currency,
                market.locale,
              )}
            </span>
            <strong>
              {formatMinor(
                item.line_total_minor,
                market.currency,
                market.locale,
              )}
            </strong>
          </div>
        ))}
      </div>
      <p className="sample-line-note">
        Final amount is the line result after the shared calculator applies the
        discount and applicable tax basis.
      </p>
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
        {components.map((amount, index) => (
          <div key={labels[index]}>
            <dt>{labels[index]}</dt>
            <dd>{formatMinor(amount, market.currency, market.locale)}</dd>
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
