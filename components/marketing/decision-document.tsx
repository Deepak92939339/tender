import { formatMinor } from "@/lib/formatting/money";
import {
  calculateExtendedLineAmountMinor,
  calculateQuote,
  type QuoteCalculationInput,
} from "@/lib/quotes/calculate";

export function DecisionDocument({
  input,
  number,
  label,
}: {
  input: QuoteCalculationInput;
  number: string;
  label: string;
}) {
  const quote = calculateQuote(input);
  return (
    <article className="decision-document" aria-label={label}>
      <header>
        <div>
          <span>Quotation</span>
          <strong>{number}</strong>
        </div>
        <em>{input.currency_code} specimen</em>
      </header>
      <div className="decision-parties">
        <div>
          <span>For</span>
          <strong>Asha Engineering Works</strong>
        </div>
        <div>
          <span>Validity</span>
          <strong>Demonstration only</strong>
        </div>
      </div>
      <div className="decision-lines">
        {quote.items.map((item) => (
          <div key={item.position}>
            <span>{item.description_snapshot}</span>
            <small>
              {item.quantity_scaled / item.quantity_scale}{" "}
              {item.unit_code_snapshot}
            </small>
            <strong>
              {formatMinor(
                calculateExtendedLineAmountMinor({
                  unitPriceMinor: item.unit_price_minor_snapshot,
                  quantityScaled: item.quantity_scaled,
                  quantityScale: item.quantity_scale,
                }),
                input.currency_code,
              )}
            </strong>
          </div>
        ))}
      </div>
      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMinor(quote.subtotal_minor, input.currency_code)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>− {formatMinor(quote.discount_minor, input.currency_code)}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>{formatMinor(quote.tax_minor, input.currency_code)}</dd>
        </div>
        <div className="decision-total">
          <dt>Total</dt>
          <dd>{formatMinor(quote.total_minor, input.currency_code)}</dd>
        </div>
      </dl>
    </article>
  );
}
