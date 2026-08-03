import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  type QuoteCalculationInput,
} from "@/lib/quotes/calculate";

function input(
  taxMode: "exclusive" | "inclusive",
  legacyBasis: "exclusive" | "inclusive" = "exclusive",
): QuoteCalculationInput {
  return {
    currency_code: "INR",
    tax_mode: taxMode,
    discount_bps: 0,
    items: [
      {
        position: 1,
        product_id: "product-1",
        sku_snapshot: "TAX-MODE",
        description_snapshot: "Tax mode authority",
        unit_code_snapshot: "EA",
        quantity_precision_snapshot: 0,
        unit_price_minor_snapshot: 118,
        currency_code: "INR",
        quantity_scaled: 1,
        quantity_scale: 1,
        tax_code_snapshot: "T18",
        tax_bps_snapshot: 1800,
        tax_price_basis_snapshot: legacyBasis,
        tax_treatment_snapshot: "standard",
      },
    ],
    charges: [],
  };
}

describe("quote tax-mode authority", () => {
  it("produces the correct distinct exclusive and inclusive totals", () => {
    expect(calculateQuote(input("exclusive")).total_minor).toBe(139);
    expect(calculateQuote(input("inclusive")).total_minor).toBe(118);
  });

  it("ignores contradictory legacy line price-basis metadata", () => {
    expect(calculateQuote(input("exclusive", "inclusive"))).toEqual(
      calculateQuote(input("exclusive", "exclusive")),
    );
  });

  it("records the applied quote basis in the authoritative projection", () => {
    expect(
      calculateQuote(input("exclusive", "inclusive")).items[0]
        ?.tax_price_basis_snapshot,
    ).toBe("exclusive");
  });

  it("applies quote tax mode to charges and preserves zero collected treatments", () => {
    const quote = input("inclusive");
    quote.items = [];
    quote.charges = [
      {
        position: 1,
        charge_type: "freight",
        description_snapshot: "Freight",
        amount_minor: 118,
        currency_code: "INR",
        tax_code_snapshot: "T18",
        tax_bps_snapshot: 1800,
        tax_price_basis_snapshot: "exclusive",
        tax_treatment_snapshot: "exempt",
        discount_applies: false,
      },
    ];
    const result = calculateQuote(quote);
    expect(result.tax_minor).toBe(0);
    expect(result.charges[0]?.tax_price_basis_snapshot).toBe("inclusive");
  });
});
