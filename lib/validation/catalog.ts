import { z } from "zod";
import { isSupportedCurrency } from "@/lib/formatting/currency";
import { parseDecimalMinor } from "@/lib/formatting/money";

export const unitCodes = ["EA", "M", "KG", "L", "BOX"] as const;

export const productSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    description: z.string().trim().min(1).max(500),
    unitCode: z.enum(unitCodes),
    quantityPrecision: z.coerce.number().int().min(0).max(3),
    unitPrice: z
      .string()
      .trim()
      .regex(/^\d{1,15}(?:\.\d{1,3})?$/),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isSupportedCurrency, "Unsupported currency."),
    taxProfileId: z.string().uuid(),
    active: z.enum(["true", "false"]).default("true"),
  })
  .superRefine((value, context) => {
    const parsedPrice = isSupportedCurrency(value.currencyCode)
      ? parseDecimalMinor(value.unitPrice, value.currencyCode)
      : null;
    if (parsedPrice === null) {
      context.addIssue({
        code: "custom",
        path: ["unitPrice"],
        message: "Unit price does not match the currency precision.",
      });
    }
    if (
      (value.unitCode === "EA" || value.unitCode === "BOX") &&
      value.quantityPrecision !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["quantityPrecision"],
        message: "EA and BOX require zero quantity precision.",
      });
    }
  });

export const catalogCsvHeaders = [
  "sku",
  "description",
  "unit_code",
  "quantity_precision",
  "unit_price",
  "currency_code",
  "tax_code",
  "active",
] as const;
