import { describe, expect, it } from "vitest";
import { newQuoteDefaultsForCustomer } from "@/lib/quotes/new-quote-defaults";

const customers = [
  {
    id: "customer-a",
    preferredCurrencyCode: "USD",
    locale: "en-US",
  },
  {
    id: "customer-b",
    preferredCurrencyCode: "EUR",
    locale: "de-DE",
  },
];

describe("new-quote customer defaults", () => {
  it("selected_customer_controls_currency_and_locale", () => {
    expect(
      newQuoteDefaultsForCustomer(customers, "customer-b", "INR", "en-IN"),
    ).toEqual({ currencyCode: "EUR", locale: "de-DE" });
  });

  it("organization_defaults_used_when_customer_preferences_null", () => {
    expect(newQuoteDefaultsForCustomer(customers, "", "INR", "en-IN")).toEqual({
      currencyCode: "INR",
      locale: "en-IN",
    });
    expect(
      newQuoteDefaultsForCustomer(
        [
          {
            id: "customer-null",
            preferredCurrencyCode: null,
            locale: null,
          },
        ],
        "customer-null",
        "INR",
        "en-IN",
      ),
    ).toEqual({ currencyCode: "INR", locale: "en-IN" });
    expect(
      newQuoteDefaultsForCustomer(
        [
          {
            id: "customer-partial",
            preferredCurrencyCode: "JPY",
            locale: null,
          },
        ],
        "customer-partial",
        "INR",
        "en-IN",
      ),
    ).toEqual({ currencyCode: "JPY", locale: "en-IN" });
  });

  it("changing_customer_recomputes_defaults", () => {
    expect(
      newQuoteDefaultsForCustomer(customers, "customer-a", "INR", "en-IN"),
    ).toEqual({ currencyCode: "USD", locale: "en-US" });
    expect(
      newQuoteDefaultsForCustomer(customers, "customer-b", "INR", "en-IN"),
    ).toEqual({ currencyCode: "EUR", locale: "de-DE" });
  });
});
