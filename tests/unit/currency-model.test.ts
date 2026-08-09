import { describe, expect, it } from "vitest";
import {
  currencyMinorUnitExponent,
  normalizeSupportedCurrency,
  SUPPORTED_CURRENCY_CODES,
} from "@/lib/formatting/currency";
import { formatMinor, parseDecimalMinor } from "@/lib/formatting/money";
import {
  calculateQuote,
  type QuoteCalculationInput,
} from "@/lib/quotes/calculate";
import { productSchema } from "@/lib/validation/catalog";
import { customerSchema } from "@/lib/validation/customer";

const calculation = (currencyCode: string): QuoteCalculationInput => ({
  currency_code: currencyCode,
  tax_mode: "exclusive",
  discount_bps: 0,
  items: [],
  charges: [],
});

const product = {
  sku: "CURRENCY-1",
  description: "Currency boundary product",
  unitCode: "EA",
  quantityPrecision: "0",
  unitPrice: "1.00",
  currencyCode: "INR",
  taxProfileId: "a1000000-0000-4000-8000-000000000001",
  active: "true",
};

const customer = {
  name: "Currency boundary customer",
  contactName: "",
  email: "",
  phone: "",
  billingAddressLine1: "",
  billingAddressLine2: "",
  billingCity: "",
  billingRegion: "",
  billingPostalCode: "",
  billingCountryCode: "IN",
  locale: "en-IN",
  preferredCurrencyCode: "INR",
  taxTreatment: "standard",
  taxIdentifier: "",
};

describe("supported currency minor-unit model", () => {
  it("defines the complete implemented allowlist", () => {
    expect(SUPPORTED_CURRENCY_CODES).toEqual([
      "INR",
      "USD",
      "EUR",
      "GBP",
      "RUB",
      "CAD",
      "KWD",
      "JPY",
    ]);
  });

  it.each(SUPPORTED_CURRENCY_CODES)(
    "accepts %s in the calculation kernel",
    (currencyCode) => {
      expect(calculateQuote(calculation(currencyCode)).currency_code).toBe(
        currencyCode,
      );
    },
  );

  it.each(["AUD", "CHF"])(
    "rejects unsupported %s calculations and formatting",
    (currencyCode) => {
      expect(() => calculateQuote(calculation(currencyCode))).toThrow(
        /unsupported currency/i,
      );
      expect(() => formatMinor(100, currencyCode)).toThrow(
        /unsupported currency/i,
      );
    },
  );

  it("defines and applies explicit currency exponents", () => {
    expect(currencyMinorUnitExponent("INR")).toBe(2);
    expect(currencyMinorUnitExponent("CAD")).toBe(2);
    expect(currencyMinorUnitExponent("KWD")).toBe(3);
    expect(currencyMinorUnitExponent("JPY")).toBe(0);
    expect(parseDecimalMinor("12.34", "CAD")).toBe(1234);
    expect(parseDecimalMinor("12.345", "KWD")).toBe(12345);
    expect(parseDecimalMinor("1234", "JPY")).toBe(1234);
    expect(parseDecimalMinor("12.3", "JPY")).toBeNull();
    expect(formatMinor(12345, "KWD", "en-KW")).toContain("12.345");
    expect(formatMinor(1234, "JPY", "ja-JP")).toContain("1,234");
  });

  it("normalizes supported human-entry currency codes to uppercase", () => {
    expect(normalizeSupportedCurrency(" usd ")).toBe("USD");
    expect(
      productSchema.parse({ ...product, currencyCode: "eur" }).currencyCode,
    ).toBe("EUR");
    expect(
      customerSchema.parse({ ...customer, preferredCurrencyCode: "gbp" })
        .preferredCurrencyCode,
    ).toBe("GBP");
  });

  it("accepts newly supported product and customer currencies", () => {
    expect(
      productSchema.safeParse({
        ...product,
        currencyCode: "JPY",
        unitPrice: "1",
      }).success,
    ).toBe(true);
    expect(
      customerSchema.safeParse({ ...customer, preferredCurrencyCode: "KWD" })
        .success,
    ).toBe(true);
  });
});
