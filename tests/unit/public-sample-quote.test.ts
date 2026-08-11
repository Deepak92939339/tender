import { describe, expect, it } from "vitest";
import {
  calculateSampleQuote,
  marketFor,
  publicMarkets,
  type SampleQuoteState,
} from "@/lib/demo/sample-quote-adapter";
import { formatMinor } from "@/lib/formatting/money";

const specimen = (marketId: SampleQuoteState["marketId"]): SampleQuoteState => {
  const market = marketFor(marketId);
  return {
    marketId,
    taxPresentation:
      marketId === "india"
        ? "india-intra"
        : marketId === "canada"
          ? "canada-on"
          : marketId === "kuwait"
            ? "kuwait-vat"
            : marketId === "japan"
              ? "japan-consumption"
              : "us-none",
    taxMode: "exclusive",
    customerName: "Sample customer",
    discount: "0",
    items: [
      {
        id: "one",
        description: "Sample line",
        quantity: "1",
        unit: "EA",
        unitPrice: marketId === "kuwait" ? "1.001" : "1",
        taxRate: market.rate,
      },
    ],
  };
};

describe("public five-market quotation specimen", () => {
  it("exposes only the five requested public markets", () => {
    expect(
      publicMarkets.map((market) => [market.label, market.currency]),
    ).toEqual([
      ["India", "INR"],
      ["Canada", "CAD"],
      ["Kuwait", "KWD"],
      ["Japan", "JPY"],
      ["United States", "USD"],
    ]);
  });

  it.each(["india", "canada", "kuwait", "japan", "united-states"] as const)(
    "calculates %s through the shared integer kernel",
    (marketId) => {
      const result = calculateSampleQuote(specimen(marketId));
      expect(result.total_minor).toBe(
        result.subtotal_minor - result.discount_minor + result.tax_minor,
      );
      expect(formatMinor(result.total_minor, result.currency_code)).toMatch(
        marketId === "kuwait"
          ? /\.\d{3}/
          : marketId === "japan"
            ? /\d(?!\.\d)/
            : /\.\d{2}/,
      );
    },
  );

  it("uses zero-rated treatment for the explicitly labelled export specimen", () => {
    const state = specimen("india");
    state.taxPresentation = "export-zero";
    const result = calculateSampleQuote(state);
    expect(result.tax_minor).toBe(0);
  });
});
