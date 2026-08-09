import { z } from "zod";
import {
  calculateQuote,
  type QuoteCalculationInput,
  type UnitCode,
} from "@/lib/quotes/calculate";
import { parseDecimalMinor } from "@/lib/formatting/money";

const decimal = z
  .string()
  .trim()
  .regex(
    /^\d{1,13}(?:\.\d{1,2})?$/,
    "Enter a non-negative amount with up to two decimals.",
  );
const lineSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1, "Add a description.").max(160),
  quantity: decimal,
  unit: z.enum(["EA", "M", "KG", "L", "BOX"]),
  unitPrice: decimal,
  taxRate: z.enum(["0", "5", "18"]),
});
export const sampleQuoteSchema = z.object({
  currency: z.enum(["INR", "USD"]),
  taxMode: z.enum(["exclusive", "inclusive"]),
  customerName: z.string().trim().min(1, "Add a customer name.").max(120),
  discount: z
    .string()
    .trim()
    .regex(/^\d{1,3}(?:\.\d{1,2})?$/, "Enter a discount from 0 to 100."),
  items: z.array(lineSchema).min(1, "Add at least one line item.").max(20),
});
export type SampleQuoteState = z.infer<typeof sampleQuoteSchema>;

function asMinor(value: string, label: string) {
  const minor = parseDecimalMinor(value);
  if (minor === null) throw new RangeError(`${label} is invalid or too large.`);
  return minor;
}
function quantity(value: string, unit: UnitCode) {
  const minor = asMinor(value, "Quantity");
  if (minor === 0) throw new RangeError("Quantity must be greater than zero.");
  if ((unit === "EA" || unit === "BOX") && minor % 100 !== 0)
    throw new RangeError(`${unit} quantities must be whole numbers.`);
  return unit === "EA" || unit === "BOX"
    ? { scaled: minor / 100, scale: 1, precision: 0 }
    : { scaled: minor, scale: 100, precision: 2 };
}

export function sampleQuoteInput(
  state: SampleQuoteState,
): QuoteCalculationInput {
  const parsed = sampleQuoteSchema.parse(state);
  const discountMinor = asMinor(parsed.discount, "Discount");
  if (discountMinor > 10_000)
    throw new RangeError("Discount cannot exceed 100%.");
  return {
    currency_code: parsed.currency,
    tax_mode: parsed.taxMode,
    discount_bps: discountMinor,
    charges: [],
    items: parsed.items.map((item, index) => {
      const q = quantity(item.quantity, item.unit);
      return {
        position: index + 1,
        product_id: `sample-${item.id}`,
        sku_snapshot: `S-${index + 1}`,
        description_snapshot: item.description,
        unit_code_snapshot: item.unit,
        quantity_precision_snapshot: q.precision,
        unit_price_minor_snapshot: asMinor(item.unitPrice, "Unit price"),
        currency_code: parsed.currency,
        quantity_scaled: q.scaled,
        quantity_scale: q.scale,
        tax_code_snapshot: item.taxRate === "0" ? "ZERO" : "STANDARD",
        tax_bps_snapshot: Math.round(Number(item.taxRate) * 100),
        tax_price_basis_snapshot: parsed.taxMode,
        tax_treatment_snapshot:
          item.taxRate === "0" ? "zero_rated" : "standard",
      };
    }),
  };
}
export function calculateSampleQuote(state: SampleQuoteState) {
  return calculateQuote(sampleQuoteInput(state));
}
