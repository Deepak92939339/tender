import { describe, expect, it } from "vitest";
import { SAMPLE_QUOTE_FIXTURES } from "@/lib/demo/sample-quote-fixtures";
import { calculateQuote } from "@/lib/quotes/calculate";

describe("public decision-room fixtures", () => {
  it.each(["INR", "USD"] as const)(
    "%s has internally consistent displayed amounts",
    (currency) => {
      const result = calculateQuote(SAMPLE_QUOTE_FIXTURES[currency]);
      expect(result.items.map((item) => item.line_total_minor)).toEqual(
        currency === "INR" ? [2326016, 1214928] : [369484, 21929],
      );
      expect(result).toMatchObject(
        currency === "INR"
          ? {
              subtotal_minor: 3410000,
              discount_minor: 409200,
              tax_minor: 540144,
              total_minor: 3540944,
            }
          : {
              subtotal_minor: 390900,
              discount_minor: 29317,
              tax_minor: 29830,
              total_minor: 391413,
            },
      );
      expect(result.total_minor).toBe(
        result.subtotal_minor - result.discount_minor + result.tax_minor,
      );
      expect(result.discount_minor).toBeGreaterThan(0);
      expect(result.tax_minor).toBeGreaterThan(0);
    },
  );
});
