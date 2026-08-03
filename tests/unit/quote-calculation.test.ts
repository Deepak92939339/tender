import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  type QuoteCalculationInput,
  type TaxTreatment,
} from "../../lib/quotes/calculate";

function input(
  treatment: TaxTreatment = "standard",
  basis: "exclusive" | "inclusive" = "exclusive",
): QuoteCalculationInput {
  return {
    currency_code: "INR",
    tax_mode: basis,
    discount_bps: 1250,
    items: [
      {
        position: 1,
        product_id: "product-1",
        sku_snapshot: "P-1",
        description_snapshot: "Measured line",
        unit_code_snapshot: "M",
        quantity_precision_snapshot: 3,
        unit_price_minor_snapshot: 101,
        currency_code: "INR",
        quantity_scaled: 1555,
        quantity_scale: 1000,
        tax_code_snapshot: "TAX",
        tax_bps_snapshot: 1800,
        tax_price_basis_snapshot: basis,
        tax_treatment_snapshot: treatment,
      },
    ],
    charges: [],
  };
}

describe("authoritative preview calculation", () => {
  it("reconciles exclusive and inclusive line-authoritative amounts", () => {
    const exclusive = calculateQuote(input());
    expect(exclusive.total_minor).toBe(
      exclusive.subtotal_minor - exclusive.discount_minor + exclusive.tax_minor,
    );
    const inclusive = calculateQuote(input("standard", "inclusive"));
    expect(inclusive.total_minor).toBe(
      inclusive.subtotal_minor - inclusive.discount_minor + inclusive.tax_minor,
    );
    const inclusiveLine = inclusive.items[0]!;
    expect(inclusiveLine.line_total_minor).toBe(
      inclusiveLine.net_minor + inclusiveLine.tax_minor,
    );
  });

  it.each(["exempt", "zero_rated", "reverse_charge"] as const)(
    "collects zero tax for %s",
    (treatment) => {
      expect(calculateQuote(input(treatment)).tax_minor).toBe(0);
    },
  );

  it("calculates an independently taxed freight charge", () => {
    const quote = input();
    quote.charges.push({
      position: 1,
      charge_type: "freight",
      description_snapshot: "Road freight",
      amount_minor: 999,
      currency_code: "INR",
      tax_code_snapshot: "FREIGHT",
      tax_bps_snapshot: 500,
      tax_price_basis_snapshot: "exclusive",
      tax_treatment_snapshot: "standard",
      discount_applies: false,
    });
    const result = calculateQuote(quote);
    expect(result.charges[0]).toMatchObject({
      net_minor: 999,
      tax_minor: 50,
      charge_total_minor: 1049,
    });
    expect(result.total_minor).toBe(
      result.subtotal_minor -
        result.discount_minor +
        result.item_tax_minor +
        result.charge_net_minor +
        result.charge_tax_minor,
    );
  });

  it("blocks mixed currency and fractional each quantities", () => {
    const mixed = input();
    mixed.items[0]!.currency_code = "USD";
    expect(() => calculateQuote(mixed)).toThrow(/mixed currency/);
    const fractionalEach = input();
    const firstLine = fractionalEach.items[0]!;
    fractionalEach.items[0] = {
      ...firstLine,
      unit_code_snapshot: "EA",
      quantity_precision_snapshot: 0,
      quantity_scale: 1000,
    };
    expect(() => calculateQuote(fractionalEach)).toThrow(/quantity precision/);
  });
});
