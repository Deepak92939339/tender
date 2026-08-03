import { z } from "zod";
import { isSupportedCurrency } from "@/lib/formatting/currency";

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
      .regex(/^\d{1,13}(?:\.\d{1,2})?$/),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isSupportedCurrency, "Unsupported currency."),
    taxProfileId: z.string().uuid(),
    active: z.enum(["true", "false"]).default("true"),
  })
  .superRefine((value, context) => {
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
