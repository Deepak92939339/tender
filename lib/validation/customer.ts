import { z } from "zod";
import { isSupportedCurrency } from "@/lib/formatting/currency";

const bounded = (max: number) => z.string().trim().max(max);

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: bounded(120),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]),
  phone: bounded(40),
  billingAddressLine1: bounded(160),
  billingAddressLine2: bounded(160),
  billingCity: bounded(100),
  billingRegion: bounded(100),
  billingPostalCode: bounded(24),
  billingCountryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  locale: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  preferredCurrencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isSupportedCurrency, "Unsupported currency."),
  taxTreatment: z.enum(["standard", "exempt", "zero_rated", "reverse_charge"]),
  taxIdentifier: bounded(80),
  expectedVersion: z.coerce.number().int().positive().optional(),
});
