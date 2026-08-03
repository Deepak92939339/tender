"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseDecimalMinor } from "@/lib/formatting/money";
import { productSchema } from "@/lib/validation/catalog";
import {
  logMutationFailure,
  withReference,
} from "@/lib/errors/mutation-failure";

export type MutationState = { error?: string; message?: string };
export type ImportPreviewState = MutationState & {
  preview?: {
    batchId: string;
    rowCount: number;
    validCount: number;
    invalidCount: number;
    rows: Array<{
      rowNumber: number;
      status: string;
      sku: string;
      description: string;
      errors: string[];
      fields: string[];
    }>;
  };
};

export async function createProduct(
  _: MutationState,
  formData: FormData,
): Promise<MutationState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("catalog.manage"))
    return {
      error:
        "Product creation failed. Nothing changed. Your role cannot manage the catalog.",
    };
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  const commandId = z.string().uuid().safeParse(formData.get("commandId"));
  const unitPriceMinor = parsed.success
    ? parseDecimalMinor(parsed.data.unitPrice)
    : null;
  if (!parsed.success || !commandId.success || unitPriceMinor === null)
    return {
      error:
        "Product creation failed. Nothing was saved. Correct the highlighted commercial fields and try again.",
    };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_product", {
    p_organization_id: context.membership.organizationId,
    p_payload: {
      sku: parsed.data.sku,
      description: parsed.data.description,
      unit_code: parsed.data.unitCode,
      quantity_precision: parsed.data.quantityPrecision,
      unit_price_minor: unitPriceMinor,
      currency_code: parsed.data.currencyCode,
      tax_profile_id: parsed.data.taxProfileId,
      active: parsed.data.active === "true",
    },
    p_command_id: commandId.data,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string"
  ) {
    const reference = logMutationFailure(
      "catalog.product_create",
      error ?? undefined,
    );
    return {
      error: withReference(
        "Product creation failed. No catalog row was changed. Check that the SKU is unique and the tax profile belongs to this organization.",
        reference,
      ),
    };
  }
  revalidatePath("/catalog");
  return { message: `Product ${parsed.data.sku} was created.` };
}

export async function prepareCatalogImport(
  _: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("catalog.import"))
    return {
      error:
        "CSV review failed. No data changed. Your role cannot import catalog records.",
    };
  const filename = z
    .string()
    .trim()
    .min(1)
    .max(255)
    .safeParse(formData.get("filename"));
  const payload = z.string().max(1_048_576).safeParse(formData.get("payload"));
  if (!filename.success || !payload.success)
    return {
      error:
        "CSV review failed. No batch was created. Select a CSV no larger than 1 MB and try again.",
    };

  let rows: unknown;
  try {
    rows = JSON.parse(payload.data);
  } catch {
    return {
      error:
        "CSV review failed. No batch was created. The parsed rows were invalid.",
    };
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000)
    return {
      error:
        "CSV review failed. No batch was created. Use between 1 and 1,000 data rows.",
    };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_catalog_import", {
    p_organization_id: context.membership.organizationId,
    p_filename: filename.data,
    p_rows: rows as never,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    const reference = logMutationFailure(
      "catalog.import_prepare",
      error ?? undefined,
    );
    return {
      error: withReference(
        "CSV review failed. No product was imported. Check the file fields and try again.",
        reference,
      ),
    };
  }

  const result = data as Record<string, unknown>;
  const batchId = typeof result.batch_id === "string" ? result.batch_id : "";
  if (!batchId) {
    const reference = logMutationFailure(
      "catalog.import_prepare_acknowledgement",
    );
    return {
      error: withReference(
        "CSV review failed. No product was imported. The server returned an incomplete batch reference.",
        reference,
      ),
    };
  }
  const { data: reviewedRows, error: rowError } = await supabase
    .from("catalog_import_rows")
    .select("row_number, status, normalized_payload, error_codes, error_fields")
    .eq("batch_id", batchId)
    .order("row_number");
  if (rowError) {
    const reference = logMutationFailure(
      "catalog.import_review_load",
      rowError,
    );
    return {
      error: withReference(
        "CSV rows were reviewed, but the safe review could not be loaded. No product was imported; reload and retry.",
        reference,
      ),
    };
  }

  return {
    message: "CSV review complete. No products have been imported yet.",
    preview: {
      batchId,
      rowCount: Number(result.row_count ?? reviewedRows.length),
      validCount: Number(result.valid_count ?? 0),
      invalidCount: Number(result.invalid_count ?? 0),
      rows: reviewedRows.map((row) => {
        const normalized = row.normalized_payload as Record<string, unknown>;
        return {
          rowNumber: row.row_number,
          status: row.status,
          sku: String(normalized.sku ?? ""),
          description: String(normalized.description ?? ""),
          errors: row.error_codes,
          fields: row.error_fields,
        };
      }),
    },
  };
}

export async function commitCatalogImport(
  _: MutationState,
  formData: FormData,
): Promise<MutationState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("catalog.import"))
    return {
      error:
        "Catalog import failed. Nothing changed. Your role cannot import products.",
    };
  const input = z
    .object({
      batchId: z.string().uuid(),
      commandId: z.string().uuid(),
      allowPartial: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!input.success)
    return {
      error:
        "Catalog import failed. Nothing changed. Reload the review and try again.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commit_catalog_import", {
    p_batch_id: input.data.batchId,
    p_allow_partial: input.data.allowPartial === "true",
    p_command_id: input.data.commandId,
  });
  if (error) {
    const reference = logMutationFailure("catalog.import_commit", error);
    const advice = error.message.includes("partial_confirmation_required")
      ? "Confirm partial import or correct every invalid row."
      : "Your reviewed batch is preserved; reload it and try again.";
    return {
      error: withReference(
        `Catalog import failed. No product was imported. ${advice}`,
        reference,
      ),
    };
  }
  revalidatePath("/catalog");
  const result = data as Record<string, unknown>;
  return {
    message: `Imported ${Number(result.imported_count ?? 0)} product rows; skipped ${Number(result.skipped_count ?? 0)} invalid rows.`,
  };
}
