import { z } from "zod";
import {
  calculateQuote,
  type QuoteCalculationInput,
  type UnitCode,
} from "@/lib/quotes/calculate";
import { parseDecimalMinor } from "@/lib/formatting/money";
import type { SupportedCurrencyCode } from "@/lib/formatting/currency";

export const publicMarkets = [
  {
    id: "india",
    label: "India",
    currency: "INR",
    country: "IN",
    locale: "en-IN",
    taxIdLabel: "GSTIN",
    postalLabel: "PIN code",
    rate: "18",
  },
  {
    id: "canada",
    label: "Canada",
    currency: "CAD",
    country: "CA",
    locale: "en-CA",
    taxIdLabel: "Business no.",
    postalLabel: "Postal code",
    rate: "13",
  },
  {
    id: "kuwait",
    label: "Kuwait",
    currency: "KWD",
    country: "KW",
    locale: "en-KW",
    taxIdLabel: "TRN",
    postalLabel: "Postal code",
    rate: "5",
  },
  {
    id: "japan",
    label: "Japan",
    currency: "JPY",
    country: "JP",
    locale: "ja-JP",
    taxIdLabel: "Corporate no.",
    postalLabel: "Postal code",
    rate: "10",
  },
  {
    id: "united-states",
    label: "United States",
    currency: "USD",
    country: "US",
    locale: "en-US",
    taxIdLabel: "EIN",
    postalLabel: "ZIP code",
    rate: "0",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  currency: SupportedCurrencyCode;
  country: string;
  locale: string;
  taxIdLabel: string;
  postalLabel: string;
  rate: string;
}[];

export type PublicMarket = (typeof publicMarkets)[number];
export type TaxPresentation =
  | "india-intra"
  | "india-inter"
  | "canada-on"
  | "canada-bc"
  | "kuwait-vat"
  | "japan-consumption"
  | "us-none"
  | "export-zero";

const decimal = z.string().trim().min(1).max(15);
const lineSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1, "Add a description.").max(160),
  quantity: decimal,
  unit: z.enum(["EA", "M", "KG", "L", "BOX"]),
  unitPrice: decimal,
  taxRate: decimal,
});

export const sampleQuoteSchema = z.object({
  marketId: z.enum(["india", "canada", "kuwait", "japan", "united-states"]),
  taxPresentation: z.enum([
    "india-intra",
    "india-inter",
    "canada-on",
    "canada-bc",
    "kuwait-vat",
    "japan-consumption",
    "us-none",
    "export-zero",
  ]),
  taxMode: z.enum(["exclusive", "inclusive"]),
  customerName: z.string().trim().min(1, "Add a customer name.").max(120),
  discount: z
    .string()
    .trim()
    .regex(/^\d{1,3}(?:\.\d{1,2})?$/, "Enter a discount from 0 to 100."),
  items: z.array(lineSchema).min(1, "Add at least one line item.").max(20),
});
export type SampleQuoteState = z.infer<typeof sampleQuoteSchema>;

export function marketFor(id: SampleQuoteState["marketId"]): PublicMarket {
  return publicMarkets.find((market) => market.id === id) ?? publicMarkets[0];
}

function asMinor(value: string, currency: string, label: string) {
  const minor = parseDecimalMinor(value, currency);
  if (minor === null)
    throw new RangeError(`${label} is invalid for ${currency} or too large.`);
  return minor;
}

function quantity(value: string, unit: UnitCode) {
  const minor = parseDecimalMinor(value, "INR");
  if (minor === null || minor === 0)
    throw new RangeError("Quantity must be greater than zero.");
  if ((unit === "EA" || unit === "BOX") && minor % 100 !== 0)
    throw new RangeError(`${unit} quantities must be whole numbers.`);
  return unit === "EA" || unit === "BOX"
    ? { scaled: minor / 100, scale: 1, precision: 0 }
    : { scaled: minor, scale: 100, precision: 2 };
}

function taxRateFor(state: SampleQuoteState, itemRate: string) {
  if (
    state.taxPresentation === "export-zero" ||
    state.taxPresentation === "us-none"
  )
    return 0;
  const rate = asMinor(itemRate, "INR", "Tax rate");
  if (rate > 10_000) throw new RangeError("Tax rate cannot exceed 100%.");
  return rate;
}

export function sampleQuoteInput(
  state: SampleQuoteState,
): QuoteCalculationInput {
  const parsed = sampleQuoteSchema.parse(state);
  const market = marketFor(parsed.marketId);
  const discountBps = asMinor(parsed.discount, "INR", "Discount");
  if (discountBps > 10_000)
    throw new RangeError("Discount cannot exceed 100%.");
  const zeroRated = parsed.taxPresentation === "export-zero";
  return {
    currency_code: market.currency,
    tax_mode: parsed.taxMode,
    discount_bps: discountBps,
    charges: [],
    items: parsed.items.map((item, index) => {
      const q = quantity(item.quantity, item.unit);
      const taxBps = taxRateFor(parsed, item.taxRate);
      return {
        position: index + 1,
        product_id: `sample-${item.id}`,
        sku_snapshot: `S-${index + 1}`,
        description_snapshot: item.description,
        unit_code_snapshot: item.unit,
        quantity_precision_snapshot: q.precision,
        unit_price_minor_snapshot: asMinor(
          item.unitPrice,
          market.currency,
          "Unit price",
        ),
        currency_code: market.currency,
        quantity_scaled: q.scaled,
        quantity_scale: q.scale,
        tax_code_snapshot: taxBps === 0 ? "ZERO" : "STANDARD",
        tax_bps_snapshot: taxBps,
        tax_price_basis_snapshot: parsed.taxMode,
        tax_treatment_snapshot:
          zeroRated || taxBps === 0 ? "zero_rated" : "standard",
      };
    }),
  };
}

export function calculateSampleQuote(state: SampleQuoteState) {
  return calculateQuote(sampleQuoteInput(state));
}

export function taxPresentationOptions(marketId: SampleQuoteState["marketId"]) {
  switch (marketId) {
    case "india":
      return [
        { value: "india-intra", label: "Within state — CGST + SGST" },
        { value: "india-inter", label: "Across states — IGST" },
        { value: "export-zero", label: "Export — zero-rated specimen" },
      ] as const;
    case "canada":
      return [
        { value: "canada-on", label: "Ontario — HST" },
        { value: "canada-bc", label: "British Columbia — GST + PST" },
        { value: "export-zero", label: "Export — zero-rated specimen" },
      ] as const;
    case "kuwait":
      return [
        { value: "kuwait-vat", label: "VAT" },
        { value: "export-zero", label: "Export — zero-rated specimen" },
      ] as const;
    case "japan":
      return [
        { value: "japan-consumption", label: "Consumption tax" },
        { value: "export-zero", label: "Export — zero-rated specimen" },
      ] as const;
    case "united-states":
      return [
        { value: "us-none", label: "No automatic sales tax" },
        { value: "export-zero", label: "Export — zero-rated specimen" },
      ] as const;
  }
}

export function taxLabels(presentation: TaxPresentation, rate: string) {
  switch (presentation) {
    case "india-intra":
      return [
        `CGST ${(Number(rate) / 2).toString()}%`,
        `SGST ${(Number(rate) / 2).toString()}%`,
      ];
    case "india-inter":
      return [`IGST ${rate}%`];
    case "canada-on":
      return [`HST ${rate}%`];
    case "canada-bc":
      return ["GST 5%", "PST 7%"];
    case "kuwait-vat":
      return [`VAT ${rate}%`];
    case "japan-consumption":
      return [`Consumption tax ${rate}%`];
    default:
      return [];
  }
}
