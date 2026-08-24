import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  calculateSampleQuote,
  type SampleQuoteState,
  type TaxPresentation,
} from "@/lib/demo/sample-quote-adapter";

function exactSpecimen(
  marketId: "canada" | "india",
  taxPresentation: TaxPresentation,
  unitPrice = "100.00",
): SampleQuoteState {
  return {
    marketId,
    taxPresentation,
    taxMode: "exclusive",
    customerName: "Fixed Test Customer",
    discount: "0",
    items: [
      {
        id: "fixed-line",
        description: "Fixed exact-money input",
        quantity: "1",
        unit: "EA",
        unitPrice,
        taxRate: marketId === "canada" ? "13" : "18",
      },
    ],
  };
}

describe("public specimen exact tax components", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T04:00:00.000Z"));
  });

  afterAll(() => vi.useRealTimers());

  it.each([
    {
      name: "British Columbia GST and PST",
      market: "canada" as const,
      presentation: "canada-bc" as const,
      expectedComponents: [
        {
          label: "GST 5%",
          rateBps: 500,
          taxableBaseMinor: 10_000,
          amountMinor: 500,
        },
        {
          label: "PST 7%",
          rateBps: 700,
          taxableBaseMinor: 10_000,
          amountMinor: 700,
        },
      ],
      taxMinor: 1_200,
      totalMinor: 11_200,
    },
    {
      name: "Ontario HST",
      market: "canada" as const,
      presentation: "canada-on" as const,
      expectedComponents: [
        {
          label: "HST 13%",
          rateBps: 1_300,
          taxableBaseMinor: 10_000,
          amountMinor: 1_300,
        },
      ],
      taxMinor: 1_300,
      totalMinor: 11_300,
    },
    {
      name: "India intra-state CGST and SGST",
      market: "india" as const,
      presentation: "india-intra" as const,
      expectedComponents: [
        {
          label: "CGST 9%",
          rateBps: 900,
          taxableBaseMinor: 10_000,
          amountMinor: 900,
        },
        {
          label: "SGST 9%",
          rateBps: 900,
          taxableBaseMinor: 10_000,
          amountMinor: 900,
        },
      ],
      taxMinor: 1_800,
      totalMinor: 11_800,
    },
    {
      name: "India inter-state IGST",
      market: "india" as const,
      presentation: "india-inter" as const,
      expectedComponents: [
        {
          label: "IGST 18%",
          rateBps: 1_800,
          taxableBaseMinor: 10_000,
          amountMinor: 1_800,
        },
      ],
      taxMinor: 1_800,
      totalMinor: 11_800,
    },
    {
      name: "zero-rated export",
      market: "india" as const,
      presentation: "export-zero" as const,
      expectedComponents: [],
      taxMinor: 0,
      totalMinor: 10_000,
    },
  ])(
    "calculates $name from fixed taxable bases and component rates",
    ({ market, presentation, expectedComponents, taxMinor, totalMinor }) => {
      const result = calculateSampleQuote(exactSpecimen(market, presentation));
      expect(result.taxable_base_minor).toBe(10_000);
      expect(result.tax_components).toEqual(expectedComponents);
      expect(result.tax_minor).toBe(taxMinor);
      expect(result.total_minor).toBe(totalMinor);
    },
  );

  it("rounds each BC component independently at the minor-unit boundary", () => {
    const result = calculateSampleQuote(
      exactSpecimen("canada", "canada-bc", "0.11"),
    );
    expect(result.taxable_base_minor).toBe(11);
    expect(result.tax_components).toEqual([
      {
        label: "GST 5%",
        rateBps: 500,
        taxableBaseMinor: 11,
        amountMinor: 1,
      },
      {
        label: "PST 7%",
        rateBps: 700,
        taxableBaseMinor: 11,
        amountMinor: 1,
      },
    ]);
    expect(result.tax_minor).toBe(2);
    expect(result.total_minor).toBe(13);
  });

  it("keeps quantity-times-unit-price separate from discount and tax", () => {
    const state = exactSpecimen("canada", "canada-bc");
    state.discount = "10";
    state.items[0]!.quantity = "2";
    const result = calculateSampleQuote(state);
    expect(result.items[0]).toMatchObject({
      extended_line_amount_minor: 20_000,
      net_minor: 18_000,
      tax_minor: 2_160,
      line_total_minor: 20_160,
    });
    expect(result.subtotal_minor).toBe(20_000);
    expect(result.discount_minor).toBe(2_000);
    expect(result.tax_minor).toBe(2_160);
    expect(result.total_minor).toBe(20_160);
  });
});
