import { describe, expect, it } from "vitest";
import { parseDecimalMinor } from "@/lib/formatting/money";
import { productSchema } from "@/lib/validation/catalog";

describe("catalog commercial input", () => {
  it("parses decimal input to exact integer minor units", () => {
    expect(parseDecimalMinor("0")).toBe(0);
    expect(parseDecimalMinor("12.34")).toBe(1234);
    expect(parseDecimalMinor("90071992547409.92")).toBeNull();
    expect(parseDecimalMinor("1.234")).toBeNull();
  });

  it("enforces UoM quantity precision", () => {
    const base = {
      sku: "SKU",
      description: "Item",
      unitPrice: "1.00",
      currencyCode: "INR",
      taxProfileId: "a1000000-0000-4000-8000-000000000001",
      active: "true",
    };
    expect(
      productSchema.safeParse({
        ...base,
        unitCode: "EA",
        quantityPrecision: "3",
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        ...base,
        unitCode: "KG",
        quantityPrecision: "3",
      }).success,
    ).toBe(true);
  });
});
