import { z } from "zod";
import {
  calculateExtendedLineAmountMinor,
  calculateQuote,
  calculateTaxAmountMinor,
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
  return taxComponentDefinitions(state.taxPresentation, itemRate).reduce(
    (total, component) => total + component.rateBps,
    0,
  );
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
  const input = sampleQuoteInput(state);
  const calculated = calculateQuote(input);
  const components = new Map<string, SampleTaxComponent>();
  let taxableBaseMinor = 0;
  let itemTaxMinor = 0;
  const items = calculated.items.map((item, index) => {
    const definitions = taxComponentDefinitions(
      state.taxPresentation,
      state.items[index]?.taxRate ?? "0",
    );
    const amounts = componentAmountsForItem(
      item.net_minor,
      item.tax_minor,
      input.tax_mode,
      definitions,
    );
    const structuralTaxMinor = amounts.reduce(
      (total, amount) => total + amount,
      0,
    );
    taxableBaseMinor += item.net_minor;
    itemTaxMinor += structuralTaxMinor;
    definitions.forEach((definition, componentIndex) => {
      const key = `${definition.label}:${definition.rateBps}`;
      const existing = components.get(key);
      components.set(key, {
        ...definition,
        taxableBaseMinor: (existing?.taxableBaseMinor ?? 0) + item.net_minor,
        amountMinor: (existing?.amountMinor ?? 0) + amounts[componentIndex]!,
      });
    });
    return {
      ...item,
      tax_minor: structuralTaxMinor,
      line_total_minor:
        input.tax_mode === "exclusive"
          ? item.net_minor + structuralTaxMinor
          : item.line_total_minor,
      extended_line_amount_minor: calculateExtendedLineAmountMinor({
        unitPriceMinor: item.unit_price_minor_snapshot,
        quantityScaled: item.quantity_scaled,
        quantityScale: item.quantity_scale,
      }),
    };
  });
  const totalMinor =
    calculated.subtotal_minor -
    calculated.discount_minor +
    itemTaxMinor +
    calculated.charge_net_minor +
    calculated.charge_tax_minor;
  if (![taxableBaseMinor, itemTaxMinor, totalMinor].every(Number.isSafeInteger))
    throw new RangeError("Sample calculation exceeds the safe integer range.");
  return {
    ...calculated,
    items,
    taxable_base_minor: taxableBaseMinor,
    tax_components: [...components.values()],
    item_tax_minor: itemTaxMinor,
    tax_minor: itemTaxMinor + calculated.charge_tax_minor,
    total_minor: totalMinor,
  };
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

type TaxComponentDefinition = { label: string; rateBps: number };

export type SampleTaxComponent = TaxComponentDefinition & {
  taxableBaseMinor: number;
  amountMinor: number;
};

function ratePercent(rateBps: number) {
  const whole = Math.floor(rateBps / 100);
  const fractional = rateBps % 100;
  return fractional === 0
    ? `${whole}`
    : `${whole}.${fractional.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export function taxComponentDefinitions(
  presentation: TaxPresentation,
  rate: string,
): TaxComponentDefinition[] {
  if (presentation === "export-zero" || presentation === "us-none") return [];
  if (presentation === "canada-on")
    return [{ label: "HST 13%", rateBps: 1300 }];
  if (presentation === "canada-bc")
    return [
      { label: "GST 5%", rateBps: 500 },
      { label: "PST 7%", rateBps: 700 },
    ];
  const parsedRate = asMinor(rate, "INR", "Tax rate");
  if (parsedRate > 10_000) throw new RangeError("Tax rate cannot exceed 100%.");
  switch (presentation) {
    case "india-intra": {
      if (parsedRate % 2 !== 0)
        throw new RangeError(
          "Intra-state GST must split into equal whole basis-point rates.",
        );
      const componentRate = parsedRate / 2;
      return [
        {
          label: `CGST ${ratePercent(componentRate)}%`,
          rateBps: componentRate,
        },
        {
          label: `SGST ${ratePercent(componentRate)}%`,
          rateBps: componentRate,
        },
      ];
    }
    case "india-inter":
      return [
        { label: `IGST ${ratePercent(parsedRate)}%`, rateBps: parsedRate },
      ];
    case "kuwait-vat":
      return [
        { label: `VAT ${ratePercent(parsedRate)}%`, rateBps: parsedRate },
      ];
    case "japan-consumption":
      return [
        {
          label: `Consumption tax ${ratePercent(parsedRate)}%`,
          rateBps: parsedRate,
        },
      ];
    default:
      return [];
  }
}

function componentAmountsForItem(
  taxableBaseMinor: number,
  authoritativeTaxMinor: number,
  taxMode: "exclusive" | "inclusive",
  definitions: TaxComponentDefinition[],
) {
  if (taxMode === "exclusive")
    return definitions.map(({ rateBps }) =>
      calculateTaxAmountMinor(taxableBaseMinor, rateBps),
    );
  if (definitions.length === 0) return [];
  const base = BigInt(taxableBaseMinor);
  const floors = definitions.map(({ rateBps }) =>
    Number((base * BigInt(rateBps)) / 10_000n),
  );
  let remaining = authoritativeTaxMinor - floors.reduce((a, b) => a + b, 0);
  const allocationOrder = definitions
    .map(({ rateBps }, index) => ({
      index,
      remainder: Number((base * BigInt(rateBps)) % 10_000n),
      rateBps,
    }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder ||
        right.rateBps - left.rateBps ||
        left.index - right.index,
    );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    floors[allocationOrder[index % allocationOrder.length]!.index]! += 1;
  }
  if (remaining < 0)
    throw new RangeError("Inclusive tax component allocation is invalid.");
  return floors;
}

export function displayedTaxRate(
  presentation: TaxPresentation,
  itemRate: string,
) {
  if (presentation === "canada-on") return "13";
  if (presentation === "canada-bc") return "12";
  if (presentation === "export-zero" || presentation === "us-none") return "0";
  return itemRate;
}

export function taxRateIsFixed(presentation: TaxPresentation) {
  return ["canada-on", "canada-bc", "export-zero", "us-none"].includes(
    presentation,
  );
}

export function taxLabels(presentation: TaxPresentation, rate: string) {
  return taxComponentDefinitions(presentation, rate).map(
    (component) => component.label,
  );
}
