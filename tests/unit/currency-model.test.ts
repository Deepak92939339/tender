import { describe, expect, it } from "vitest";
import {
  normalizeSupportedCurrency,
  SUPPORTED_CURRENCY_CODES,
} from "@/lib/formatting/currency";
import { formatMinor } from "@/lib/formatting/money";
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

describe("supported two-decimal currency model", () => {
  it("defines the complete implemented allowlist", () => {
    expect(SUPPORTED_CURRENCY_CODES).toEqual([
      "INR",
      "USD",
      "EUR",
      "GBP",
      "RUB",
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

  it.each(["JPY", "KWD"])(
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

  it("rejects unsupported product and customer currencies", () => {
    expect(
      productSchema.safeParse({ ...product, currencyCode: "JPY" }).success,
    ).toBe(false);
    expect(
      customerSchema.safeParse({ ...customer, preferredCurrencyCode: "KWD" })
        .success,
    ).toBe(false);
  });
});
