"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApplicationContext } from "@/lib/auth/context";
import { logMutationFailure } from "@/lib/errors/mutation-failure";
import { isSupportedCurrency } from "@/lib/formatting/currency";
import type { OrganizationSettingsResultCode } from "@/lib/settings/organization-result";
import { createClient } from "@/lib/supabase/server";

const controlCharacter = /[\u0000-\u001f\u007f]/;

const boundedRequiredText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !controlCharacter.test(value));

const boundedOptionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !controlCharacter.test(value))
    .transform((value) => value || null);

const basisPoints = z
  .string()
  .regex(/^[0-9]{1,5}$/)
  .transform(Number)
  .refine((value) => value >= 0 && value <= 10_000);

const organizationSettingsSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  commandId: z.string().uuid(),
  name: boundedRequiredText(120),
  defaultCurrencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isSupportedCurrency),
  defaultLocale: z
    .string()
    .trim()
    .max(35)
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  timezone: boundedRequiredText(64),
  approvalThresholdBps: basisPoints,
  sellerLegalName: boundedRequiredText(160),
  sellerAddressLine1: boundedRequiredText(160),
  sellerAddressLine2: boundedOptionalText(160),
  sellerCity: boundedRequiredText(100),
  sellerRegion: boundedOptionalText(100),
  sellerPostalCode: boundedOptionalText(24),
  sellerCountryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  sellerTaxIdentifier: boundedOptionalText(80),
  sellerContactEmail: z
    .string()
    .trim()
    .max(254)
    .refine((value) => !controlCharacter.test(value))
    .refine((value) => value === "" || z.email().safeParse(value).success)
    .transform((value) => value || null),
  sellerContactPhone: boundedOptionalText(40),
});

const taxProfileFieldsSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
    label: boundedRequiredText(120),
    jurisdictionCountryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => value === "" || /^[A-Z]{2}$/.test(value))
      .transform((value) => value || null),
    rateBps: basisPoints,
    treatment: z.enum(["standard", "exempt", "zero_rated", "reverse_charge"]),
  })
  .refine((value) => value.treatment === "standard" || value.rateBps === 0, {
    path: ["rateBps"],
  });

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function resultUrl(result: OrganizationSettingsResultCode) {
  return `/settings/organization?result=${encodeURIComponent(result)}`;
}

function finish(result: OrganizationSettingsResultCode): never {
  revalidatePath("/settings/organization");
  redirect(resultUrl(result));
}

function classifyMutationFailure(error: {
  code?: string | null;
  message?: string | null;
}): OrganizationSettingsResultCode {
  const message = error.message ?? "";

  if (error.code === "42501") return "forbidden";
  if (message.includes("version_stale")) return "stale_record";
  if (
    message.includes("replacement_required") ||
    message.includes("safe_replacement") ||
    message.includes("replacement_profile_required")
  ) {
    return "replacement_required";
  }
  if (
    error.code === "22023" ||
    error.code === "23505" ||
    error.code === "23514" ||
    message.includes("payload_invalid") ||
    message.includes("replacement_invalid")
  ) {
    return "invalid_input";
  }
  return "mutation_failed";
}

function ensureManager(capabilities: string[]) {
  if (!capabilities.includes("organization.manage")) finish("forbidden");
}

export async function updateOrganizationSettings(formData: FormData) {
  const context = await requireApplicationContext();
  ensureManager(context.capabilities);

  const parsed = organizationSettingsSchema.safeParse({
    expectedVersion: field(formData, "expectedVersion"),
    commandId: field(formData, "commandId"),
    name: field(formData, "name"),
    defaultCurrencyCode: field(formData, "defaultCurrencyCode"),
    defaultLocale: field(formData, "defaultLocale"),
    timezone: field(formData, "timezone"),
    approvalThresholdBps: field(formData, "approvalThresholdBps"),
    sellerLegalName: field(formData, "sellerLegalName"),
    sellerAddressLine1: field(formData, "sellerAddressLine1"),
    sellerAddressLine2: field(formData, "sellerAddressLine2"),
    sellerCity: field(formData, "sellerCity"),
    sellerRegion: field(formData, "sellerRegion"),
    sellerPostalCode: field(formData, "sellerPostalCode"),
    sellerCountryCode: field(formData, "sellerCountryCode"),
    sellerTaxIdentifier: field(formData, "sellerTaxIdentifier"),
    sellerContactEmail: field(formData, "sellerContactEmail"),
    sellerContactPhone: field(formData, "sellerContactPhone"),
  });
  if (!parsed.success) finish("invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_organization_settings", {
    p_organization_id: context.membership.organizationId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: {
      name: parsed.data.name,
      default_currency_code: parsed.data.defaultCurrencyCode,
      default_locale: parsed.data.defaultLocale,
      timezone: parsed.data.timezone,
      approval_threshold_bps: parsed.data.approvalThresholdBps,
      seller_legal_name: parsed.data.sellerLegalName,
      seller_address_line1: parsed.data.sellerAddressLine1,
      seller_address_line2: parsed.data.sellerAddressLine2,
      seller_city: parsed.data.sellerCity,
      seller_region: parsed.data.sellerRegion,
      seller_postal_code: parsed.data.sellerPostalCode,
      seller_country_code: parsed.data.sellerCountryCode,
      seller_tax_identifier: parsed.data.sellerTaxIdentifier,
      seller_contact_email: parsed.data.sellerContactEmail,
      seller_contact_phone: parsed.data.sellerContactPhone,
    },
    p_command_id: parsed.data.commandId,
  });
  if (error) {
    logMutationFailure("organization.settings_update", error);
    finish(classifyMutationFailure(error));
  }

  finish("organization_saved");
}

export async function createTaxProfile(formData: FormData) {
  const context = await requireApplicationContext();
  ensureManager(context.capabilities);

  const parsed = taxProfileFieldsSchema.safeParse({
    code: field(formData, "code"),
    label: field(formData, "label"),
    jurisdictionCountryCode: field(formData, "jurisdictionCountryCode"),
    rateBps: field(formData, "rateBps"),
    treatment: field(formData, "treatment"),
  });
  const commandId = z.string().uuid().safeParse(field(formData, "commandId"));
  if (!parsed.success || !commandId.success) finish("invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_tax_profile", {
    p_organization_id: context.membership.organizationId,
    p_payload: {
      code: parsed.data.code,
      label: parsed.data.label,
      jurisdiction_country_code: parsed.data.jurisdictionCountryCode,
      rate_bps: parsed.data.rateBps,
      treatment: parsed.data.treatment,
      active: true,
    },
    p_command_id: commandId.data,
  });
  if (error) {
    logMutationFailure("organization.tax_profile_create", error);
    finish(classifyMutationFailure(error));
  }

  finish("tax_profile_created");
}

export async function updateTaxProfile(formData: FormData) {
  const context = await requireApplicationContext();
  ensureManager(context.capabilities);

  const parsed = taxProfileFieldsSchema.safeParse({
    code: field(formData, "code"),
    label: field(formData, "label"),
    jurisdictionCountryCode: field(formData, "jurisdictionCountryCode"),
    rateBps: field(formData, "rateBps"),
    treatment: field(formData, "treatment"),
  });
  const metadata = z
    .object({
      taxProfileId: z.string().uuid(),
      expectedVersion: z.coerce.number().int().positive(),
      commandId: z.string().uuid(),
    })
    .safeParse({
      taxProfileId: field(formData, "taxProfileId"),
      expectedVersion: field(formData, "expectedVersion"),
      commandId: field(formData, "commandId"),
    });
  if (!parsed.success || !metadata.success) finish("invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_tax_profile", {
    p_tax_profile_id: metadata.data.taxProfileId,
    p_expected_version: metadata.data.expectedVersion,
    p_payload: {
      code: parsed.data.code,
      label: parsed.data.label,
      jurisdiction_country_code: parsed.data.jurisdictionCountryCode,
      rate_bps: parsed.data.rateBps,
      treatment: parsed.data.treatment,
      active: true,
    },
    p_command_id: metadata.data.commandId,
  });
  if (error) {
    logMutationFailure("organization.tax_profile_update", error);
    finish(classifyMutationFailure(error));
  }

  finish("tax_profile_updated");
}

export async function archiveTaxProfile(formData: FormData) {
  const context = await requireApplicationContext();
  ensureManager(context.capabilities);

  const parsed = z
    .object({
      taxProfileId: z.string().uuid(),
      expectedVersion: z.coerce.number().int().positive(),
      replacementTaxProfileId: z
        .union([z.string().uuid(), z.literal("")])
        .transform((value) => value || null),
      commandId: z.string().uuid(),
    })
    .safeParse({
      taxProfileId: field(formData, "taxProfileId"),
      expectedVersion: field(formData, "expectedVersion"),
      replacementTaxProfileId: field(formData, "replacementTaxProfileId"),
      commandId: field(formData, "commandId"),
    });
  if (!parsed.success) finish("invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_tax_profile", {
    p_tax_profile_id: parsed.data.taxProfileId,
    p_expected_version: parsed.data.expectedVersion,
    p_replacement_tax_profile_id: parsed.data.replacementTaxProfileId,
    p_command_id: parsed.data.commandId,
  } as never);
  if (error) {
    logMutationFailure("organization.tax_profile_archive", error);
    finish(classifyMutationFailure(error));
  }

  finish("tax_profile_archived");
}
