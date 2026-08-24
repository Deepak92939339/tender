"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  logMutationFailure,
  withReference,
} from "@/lib/errors/mutation-failure";
import { isSupportedCurrency } from "@/lib/formatting/currency";
import {
  canCreateShareLink,
  createShareLinkPresentation,
  isShareExpiryWithinRevision,
  parseCreateShareLinkResult,
} from "@/lib/quotes/share-link";

const supportedCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isSupportedCurrency, "Unsupported currency.");
const safeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const taxTreatmentSchema = z.enum([
  "standard",
  "exempt",
  "zero_rated",
  "reverse_charge",
]);
const unitCodeSchema = z.enum(["EA", "M", "KG", "L", "BOX"]);
const chargeTypeSchema = z.enum([
  "freight",
  "shipping",
  "handling",
  "insurance",
  "packaging",
  "customs_duties",
  "other",
]);

const createSchema = z
  .object({
    customerId: z.string().uuid(),
    currencyCode: supportedCurrencySchema,
    locale: z.string().min(2).max(35),
    taxLabel: z.string().trim().min(1).max(80),
    taxMode: z.enum(["exclusive", "inclusive"]),
    issueDate: z.iso.date(),
    validUntil: z.iso.date(),
    commandId: z.string().uuid(),
  })
  .refine((value) => value.validUntil >= value.issueDate, {
    message: "validity",
  });

const savePayloadSchema = z
  .object({
    customer_id: z.string().uuid(),
    currency_code: supportedCurrencySchema,
    locale: z.string().min(2).max(35),
    tax_label: z.string().trim().min(1).max(80),
    tax_mode: z.enum(["exclusive", "inclusive"]),
    discount_bps: z.number().int().min(0).max(10_000),
    issue_date: z.iso.date(),
    valid_until: z.iso.date(),
    notes: z.string().max(5000),
    subtotal_minor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    discount_minor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    tax_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    charges_minor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    total_minor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    items: z
      .array(
        z
          .object({
            line_id: z.string().uuid().nullable(),
            product_id: z.string().uuid(),
            position: z.number().int().positive().max(100),
            quantity_scaled: z
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER),
            quantity_scale: z.union([
              z.literal(1),
              z.literal(10),
              z.literal(100),
              z.literal(1000),
            ]),
          })
          .strict(),
      )
      .max(100),
    charges: z
      .array(
        z
          .object({
            charge_id: z.string().uuid().nullable(),
            position: z.number().int().positive().max(25),
            charge_type: chargeTypeSchema,
            description: z.string().trim().min(1).max(300),
            amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
            tax_profile_id: z.string().uuid(),
            discount_applies: z.boolean(),
          })
          .strict(),
      )
      .max(25),
  })
  .strict()
  .refine((value) => value.valid_until >= value.issue_date, {
    message: "validity",
  })
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144,
    { message: "payload_size" },
  );

const quoteItemProjectionSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  product_id: z.string().uuid().nullable(),
  sku_snapshot: z.string(),
  description_snapshot: z.string(),
  unit_code_snapshot: unitCodeSchema,
  quantity_precision_snapshot: z.number().int().min(0).max(3),
  unit_price_minor_snapshot: safeIntegerSchema,
  currency_code: supportedCurrencySchema,
  quantity_scaled: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quantity_scale: z.union([
    z.literal(1),
    z.literal(10),
    z.literal(100),
    z.literal(1000),
  ]),
  tax_code_snapshot: z.string(),
  tax_bps_snapshot: z.number().int().min(0).max(10_000),
  tax_price_basis_snapshot: z.enum(["exclusive", "inclusive"]),
  tax_treatment_snapshot: taxTreatmentSchema,
  base_minor: safeIntegerSchema,
  discount_minor: safeIntegerSchema,
  net_minor: safeIntegerSchema,
  tax_minor: safeIntegerSchema,
  line_total_minor: safeIntegerSchema,
});

const quoteChargeProjectionSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  charge_type: chargeTypeSchema,
  description_snapshot: z.string(),
  amount_minor: safeIntegerSchema,
  currency_code: supportedCurrencySchema,
  tax_code_snapshot: z.string(),
  tax_bps_snapshot: z.number().int().min(0).max(10_000),
  tax_price_basis_snapshot: z.enum(["exclusive", "inclusive"]),
  tax_treatment_snapshot: taxTreatmentSchema,
  discount_applies: z.boolean(),
  discount_minor: safeIntegerSchema,
  net_minor: safeIntegerSchema,
  tax_minor: safeIntegerSchema,
  charge_total_minor: safeIntegerSchema,
});

const quoteDraftProjectionSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  state: z.literal("draft"),
  version: z.number().int().positive(),
  customer_id: z.string().uuid(),
  currency_code: supportedCurrencySchema,
  locale: z.string(),
  tax_label: z.string(),
  tax_mode: z.enum(["exclusive", "inclusive"]),
  customer_tax_treatment: taxTreatmentSchema,
  discount_bps: z.number().int().min(0).max(10_000),
  issue_date: z.iso.date(),
  valid_until: z.iso.date(),
  notes: z.string(),
  subtotal_minor: safeIntegerSchema,
  discount_minor: safeIntegerSchema,
  tax_minor: safeIntegerSchema,
  charges_minor: safeIntegerSchema,
  total_minor: safeIntegerSchema,
  items: z.array(quoteItemProjectionSchema).max(100),
  charges: z.array(quoteChargeProjectionSchema).max(25),
});

export type QuoteDraftProjection = z.infer<typeof quoteDraftProjectionSchema>;

export type CreateQuoteState = { error?: string; href?: string };

export async function createQuoteDraft(
  _: CreateQuoteState,
  formData: FormData,
): Promise<CreateQuoteState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("quote.create"))
    return {
      error:
        "Draft creation failed. Nothing changed. Your role cannot create quotations.",
    };
  const parsed = createSchema.safeParse({
    customerId: formData.get("customerId"),
    currencyCode: formData.get("currencyCode"),
    locale: formData.get("locale"),
    taxLabel: formData.get("taxLabel"),
    taxMode: formData.get("taxMode"),
    issueDate: formData.get("issueDate"),
    validUntil: formData.get("validUntil"),
    commandId: formData.get("commandId"),
  });
  if (!parsed.success)
    return {
      error:
        "Draft creation failed. Nothing was saved. Check the customer, dates, currency, locale and tax fields.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_verified_quote_draft", {
    p_organization_id: context.membership.organizationId,
    p_customer_id: parsed.data.customerId,
    p_currency_code: parsed.data.currencyCode,
    p_locale: parsed.data.locale,
    p_tax_label: parsed.data.taxLabel,
    p_tax_mode: parsed.data.taxMode,
    p_issue_date: parsed.data.issueDate,
    p_valid_until: parsed.data.validUntil,
    p_command_id: parsed.data.commandId,
  });
  if (error || !data || typeof data !== "object" || !("number" in data)) {
    const reference = logMutationFailure(
      "quote.create_draft",
      error ?? undefined,
    );
    if (error?.message === "CUSTOMER_ARCHIVED") {
      return {
        error: withReference(
          "Draft creation failed. The selected customer is archived. Choose an active customer.",
          reference,
        ),
      };
    }
    return {
      error: withReference(
        "Draft creation failed. No quotation was created. Reload customer data and try again.",
        reference,
      ),
    };
  }
  revalidatePath("/quotes");
  return { href: `/quotes/${encodeURIComponent(String(data.number))}` };
}

export type SaveQuoteInput = {
  quoteId: string;
  expectedVersion: number;
  commandId: string;
  payload: unknown;
};
export type SaveQuoteResult = {
  status: "saved" | "stale" | "failed";
  message: string;
  version?: number;
  totals?: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    chargesMinor: number;
    totalMinor: number;
  };
  projection?: QuoteDraftProjection;
};

export async function saveQuoteDraftAction(
  input: SaveQuoteInput,
): Promise<SaveQuoteResult> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("quote.edit"))
    return {
      status: "failed",
      message:
        "Save failed. Nothing changed. Your role cannot edit draft quotations.",
    };
  const quoteId = z.string().uuid().safeParse(input.quoteId);
  const commandId = z.string().uuid().safeParse(input.commandId);
  const version = z.number().int().positive().safeParse(input.expectedVersion);
  const payload = savePayloadSchema.safeParse(input.payload);
  if (
    !quoteId.success ||
    !commandId.success ||
    !version.success ||
    !payload.success
  )
    return {
      status: "failed",
      message:
        "Save failed. Nothing changed. Correct the highlighted commercial fields and try again.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_quote_draft", {
    p_quote_id: quoteId.data,
    p_expected_version: version.data,
    p_command_id: commandId.data,
    p_payload: payload.data,
  });
  if (error) {
    const reference = logMutationFailure("quote.save_draft", error);
    if (error.code === "40001" || error.message.includes("quote_version_stale"))
      return {
        status: "stale",
        message: withReference(
          "Save failed because this draft changed in another session. Reload before editing again; newer server data was not overwritten.",
          reference,
        ),
      };
    return {
      status: "failed",
      message: withReference(
        "Save failed. The transaction changed nothing. Check currencies, quantities, dates and current catalog records, then try again.",
        reference,
      ),
    };
  }
  const projection = quoteDraftProjectionSchema.safeParse(data);
  if (!projection.success) {
    const reference = logMutationFailure("quote.save_draft_acknowledgement");
    return {
      status: "failed",
      message: withReference(
        "Save failed without a valid server acknowledgement. Nothing should be assumed saved; reload and try again.",
        reference,
      ),
    };
  }
  const value = projection.data;
  return {
    status: "saved",
    message: "Saved to Tender.",
    version: value.version,
    totals: {
      subtotalMinor: value.subtotal_minor,
      discountMinor: value.discount_minor,
      taxMinor: value.tax_minor,
      chargesMinor: value.charges_minor,
      totalMinor: value.total_minor,
    },
    projection: value,
  };
}

const refreshLineSchema = z.object({
  quoteId: z.string().uuid(),
  lineId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.string().uuid(),
});

export async function refreshQuoteLineAction(
  input: unknown,
): Promise<SaveQuoteResult> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("quote.edit")) {
    return {
      status: "failed",
      message:
        "Refresh failed. Nothing changed. Your role cannot edit draft quotations.",
    };
  }
  const parsed = refreshLineSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: "failed",
      message:
        "Refresh failed. Nothing changed. Reload the draft and try again.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "refresh_quote_line_from_catalog",
    {
      p_quote_id: parsed.data.quoteId,
      p_line_id: parsed.data.lineId,
      p_expected_version: parsed.data.expectedVersion,
      p_command_id: parsed.data.commandId,
    },
  );
  if (error) {
    const reference = logMutationFailure("quote.line.refresh", error);
    if (
      error.code === "40001" ||
      error.message.includes("quote_version_stale")
    ) {
      return {
        status: "stale",
        message: withReference(
          "Refresh failed because this draft changed in another session. Your local work remains visible; reload to reconcile with Tender.",
          reference,
        ),
      };
    }
    return {
      status: "failed",
      message: withReference(
        "Refresh failed transactionally. The line and quotation remain unchanged.",
        reference,
      ),
    };
  }
  const projection = quoteDraftProjectionSchema.safeParse(data);
  if (!projection.success) {
    const reference = logMutationFailure("quote.line.refresh_acknowledgement");
    return {
      status: "failed",
      message: withReference(
        "Refresh returned no valid server projection. Reload before continuing.",
        reference,
      ),
    };
  }
  return {
    status: "saved",
    message: "Line pricing refreshed from catalog.",
    version: projection.data.version,
    projection: projection.data,
    totals: {
      subtotalMinor: projection.data.subtotal_minor,
      discountMinor: projection.data.discount_minor,
      taxMinor: projection.data.tax_minor,
      chargesMinor: projection.data.charges_minor,
      totalMinor: projection.data.total_minor,
    },
  };
}

const workflowSchema = z.object({
  quoteId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.string().uuid(),
  action: z.enum(["submit", "approve", "reject", "issue"]),
  reason: z.string().max(1000).optional(),
});

export type WorkflowResult = {
  status: "ok" | "stale" | "failed";
  message: string;
  state?: string;
  version?: number;
};

export async function runQuoteWorkflowAction(
  input: unknown,
): Promise<WorkflowResult> {
  const context = await requireApplicationContext();
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: "failed",
      message: "The commercial action was not valid. Nothing changed.",
    };
  const capability = `quote.${parsed.data.action}`;
  if (!context.capabilities.includes(capability))
    return {
      status: "failed",
      message: `This account cannot ${parsed.data.action} the quotation. Nothing changed.`,
    };
  if (
    parsed.data.action === "reject" &&
    (!parsed.data.reason || parsed.data.reason.trim().length < 3)
  )
    return {
      status: "failed",
      message:
        "Rejection needs a meaningful reason of at least three characters. Nothing changed.",
    };
  const supabase = await createClient();
  const { data: quoteRow, error: quoteLookupError } = await supabase
    .from("quotes")
    .select("id, current_revision_id")
    .eq("organization_id", context.membership.organizationId)
    .eq("id", parsed.data.quoteId)
    .maybeSingle();
  if (quoteLookupError || !quoteRow) {
    const reference = logMutationFailure(
      "quote.workflow_lookup",
      quoteLookupError ?? undefined,
    );
    return {
      status: "failed",
      message: withReference(
        "The quotation could not be resolved inside this organization. Nothing changed.",
        reference,
      ),
    };
  }
  let result: {
    data: unknown;
    error: { code?: string; message: string } | null;
  };
  if (quoteRow?.current_revision_id) {
    result = await callRevisionWorkflow(
      supabase as unknown as RevisionRpcClient,
      parsed.data.action,
      {
        quoteId: parsed.data.quoteId,
        revisionId: quoteRow.current_revision_id,
        expectedVersion: parsed.data.expectedVersion,
        commandId: parsed.data.commandId,
        reason: parsed.data.reason,
      },
    );
  } else if (parsed.data.action === "submit")
    result = await supabase.rpc("submit_quote", {
      p_quote_id: parsed.data.quoteId,
      p_expected_version: parsed.data.expectedVersion,
      p_command_id: parsed.data.commandId,
    });
  else if (parsed.data.action === "approve")
    result = await supabase.rpc("approve_quote", {
      p_quote_id: parsed.data.quoteId,
      p_expected_version: parsed.data.expectedVersion,
      p_command_id: parsed.data.commandId,
    });
  else if (parsed.data.action === "reject")
    result = await supabase.rpc("reject_quote", {
      p_quote_id: parsed.data.quoteId,
      p_expected_version: parsed.data.expectedVersion,
      p_command_id: parsed.data.commandId,
      p_reason: parsed.data.reason!,
    });
  else
    result = await supabase.rpc("issue_quote", {
      p_quote_id: parsed.data.quoteId,
      p_expected_version: parsed.data.expectedVersion,
      p_command_id: parsed.data.commandId,
    });
  if (result.error) {
    const reference = logMutationFailure(
      `quote.${parsed.data.action}`,
      result.error,
    );
    if (result.error.message.includes("QUOTE_EXPIRED"))
      return {
        status: "failed",
        message: withReference(
          "This quotation is expired in the organization timezone. Nothing changed.",
          reference,
        ),
      };
    if (result.error.message.includes("SELLER_PROFILE_INCOMPLETE"))
      return {
        status: "failed",
        message: withReference(
          "Issue failed. An organization administrator must complete the seller legal name, address line 1, city and country code. Nothing changed.",
          reference,
        ),
      };
    if (
      result.error.message.includes("quote_version_stale") ||
      result.error.message.includes("quote_not_")
    )
      return {
        status: "stale",
        message: withReference(
          "The quotation changed or was already decided. Reload to use the current commercial state; nothing was overwritten.",
          reference,
        ),
      };
    return {
      status: "failed",
      message: withReference(
        "The commercial action failed transactionally. Nothing changed; reload and try again.",
        reference,
      ),
    };
  }
  const data = result.data as Record<string, unknown>;
  revalidatePath("/quotes");
  revalidatePath("/approvals");
  return {
    status: "ok",
    message: `${parsed.data.action[0]!.toUpperCase()}${parsed.data.action.slice(1)} completed.`,
    state: String(data.state),
    version: Number(data.version),
  };
}

type RevisionRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

async function callRevisionWorkflow(
  supabase: RevisionRpcClient,
  action: "submit" | "approve" | "reject" | "issue",
  input: {
    quoteId: string;
    revisionId: string;
    expectedVersion: number;
    commandId: string;
    reason?: string;
  },
) {
  const args: Record<string, unknown> = {
    p_quote_id: input.quoteId,
    p_revision_id: input.revisionId,
    p_expected_version: input.expectedVersion,
    p_command_id: input.commandId,
  };
  if (action === "reject") args.p_reason = input.reason;
  return supabase.rpc(`${action}_quote_revision`, args);
}

const shareCreateSchema = z.object({
  quoteId: z.string().uuid(),
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.string().uuid(),
  recipientEmail: z.string().trim().email().min(3).max(254),
  expiresAt: z.iso.datetime(),
});

export type CreateShareLinkActionResult = {
  status: "created" | "replayed" | "stale" | "failed";
  message: string;
  linkId?: string;
  url?: string;
};

export async function createQuoteShareLinkAction(
  input: unknown,
): Promise<CreateShareLinkActionResult> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("quote.share")) {
    return {
      status: "failed",
      message:
        "Recipient link creation failed. Nothing changed. Your role cannot share quotations.",
    };
  }
  const parsed = shareCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "failed",
      message:
        "Recipient link creation failed. Check the recipient email and expiry, then try again.",
    };
  }
  const supabase = await createClient();
  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .select("id, number, current_revision_id, valid_until")
    .eq("organization_id", context.membership.organizationId)
    .eq("id", parsed.data.quoteId)
    .maybeSingle();
  const { data: revision, error: revisionError } = quoteRow?.current_revision_id
    ? await supabase
        .from("quote_revisions")
        .select("id, state, valid_until")
        .eq("organization_id", context.membership.organizationId)
        .eq("quote_id", parsed.data.quoteId)
        .eq("id", parsed.data.revisionId)
        .maybeSingle()
    : { data: null, error: null };
  if (quoteError || revisionError) {
    const reference = logMutationFailure(
      "quote.create_share_link_lookup",
      quoteError ?? revisionError ?? undefined,
    );
    return {
      status: "failed",
      message: withReference(
        "Recipient link creation failed because the tenant-scoped quotation could not be verified. Nothing changed.",
        reference,
      ),
    };
  }
  if (
    !canCreateShareLink({
      currentRevisionId: quoteRow?.current_revision_id,
      revisionId: parsed.data.revisionId,
      revisionState: revision?.state,
    })
  ) {
    return {
      status: "failed",
      message:
        "Recipient link creation failed. A link can be created only for the current issued revision.",
    };
  }
  const expiresAt = new Date(parsed.data.expiresAt);
  const validUntil = revision?.valid_until ?? quoteRow?.valid_until;
  if (
    !validUntil ||
    !isShareExpiryWithinRevision({
      expiresAt,
      now: new Date(),
      validUntil,
      timeZone: context.membership.organization.timezone,
    })
  ) {
    return {
      status: "failed",
      message:
        "Recipient link creation failed. Expiry must be after now and no later than the quotation validity period.",
    };
  }
  const { data, error } = await supabase.rpc("create_quote_share_link", {
    p_quote_id: parsed.data.quoteId,
    p_revision_id: parsed.data.revisionId,
    p_expected_version: parsed.data.expectedVersion,
    p_recipient_email: parsed.data.recipientEmail,
    p_expires_at: parsed.data.expiresAt,
    p_command_id: parsed.data.commandId,
  });
  if (error) {
    const reference = logMutationFailure("quote.create_share_link", error);
    if (error.message.includes("revision_stale") || error.code === "40001") {
      return {
        status: "stale",
        message: withReference(
          "Recipient link creation failed because the quotation changed. Reload and try again.",
          reference,
        ),
      };
    }
    if (error.message.includes("share_expiry_invalid")) {
      return {
        status: "failed",
        message: withReference(
          "Recipient link creation failed. Expiry must stay inside the quotation validity period.",
          reference,
        ),
      };
    }
    if (error.message.includes("quote_share_forbidden")) {
      return {
        status: "failed",
        message: withReference(
          "Recipient link creation failed. Your role cannot share quotations.",
          reference,
        ),
      };
    }
    return {
      status: "failed",
      message: withReference(
        "Recipient link creation failed. Nothing changed.",
        reference,
      ),
    };
  }
  const parsedResult = parseCreateShareLinkResult(data);
  if (!parsedResult) {
    const reference = logMutationFailure(
      "quote.create_share_link_acknowledgement",
    );
    return {
      status: "failed",
      message: withReference(
        "Recipient link creation returned no usable acknowledgement. Nothing should be assumed created.",
        reference,
      ),
    };
  }
  const presented = createShareLinkPresentation(parsedResult);
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${encodeURIComponent(quoteRow!.number)}`);
  if (presented.status === "replayed_without_secret") {
    return {
      status: "replayed",
      linkId: presented.linkId,
      message:
        "This create request was already recorded. The original recipient secret cannot be recovered.",
    };
  }
  return {
    status: "created",
    linkId: presented.linkId,
    url: presented.url ?? undefined,
    message:
      "Recipient link created. Copy or open it now. Tender cannot show this secret again after you leave this page.",
  };
}

const shareRevokeSchema = z.object({
  quoteId: z.string().uuid(),
  shareLinkId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.string().uuid(),
});

const shareRevokeResultSchema = z
  .object({
    id: z.string().uuid(),
    quote_id: z.string().uuid(),
    revision_id: z.string().uuid(),
    disabled_reason: z.literal("revoked"),
    disabled_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type RevokeShareLinkActionResult = {
  status: "ok" | "stale" | "failed";
  message: string;
};

export async function revokeQuoteShareLinkAction(
  input: unknown,
): Promise<RevokeShareLinkActionResult> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("quote.share")) {
    return {
      status: "failed",
      message:
        "Revocation failed. Nothing changed. Your role cannot share quotations.",
    };
  }
  const parsed = shareRevokeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "failed",
      message: "Revocation failed. Reload the quotation and try again.",
    };
  }
  const supabase = await createClient();
  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .select("id, number")
    .eq("organization_id", context.membership.organizationId)
    .eq("id", parsed.data.quoteId)
    .maybeSingle();
  if (quoteError || !quoteRow) {
    const reference = logMutationFailure(
      "quote.revoke_share_link_lookup",
      quoteError ?? undefined,
    );
    return {
      status: "failed",
      message: withReference(
        "Revocation failed because the tenant-scoped quotation could not be verified. Nothing changed.",
        reference,
      ),
    };
  }
  const { data, error } = await supabase.rpc("revoke_quote_share_link", {
    p_quote_id: parsed.data.quoteId,
    p_share_link_id: parsed.data.shareLinkId,
    p_expected_version: parsed.data.expectedVersion,
    p_command_id: parsed.data.commandId,
  });
  if (error) {
    const reference = logMutationFailure("quote.revoke_share_link", error);
    if (
      error.message.includes("quote_version_stale") ||
      error.code === "40001"
    ) {
      return {
        status: "stale",
        message: withReference(
          "Revocation failed because the quotation changed. Reload and try again.",
          reference,
        ),
      };
    }
    if (error.message.includes("quote_share_forbidden")) {
      return {
        status: "failed",
        message: withReference(
          "Revocation failed. Your role cannot share quotations.",
          reference,
        ),
      };
    }
    return {
      status: "failed",
      message: withReference("Revocation failed. Nothing changed.", reference),
    };
  }
  const acknowledgement = shareRevokeResultSchema.safeParse(data);
  if (
    !acknowledgement.success ||
    acknowledgement.data.id !== parsed.data.shareLinkId ||
    acknowledgement.data.quote_id !== parsed.data.quoteId
  ) {
    const reference = logMutationFailure(
      "quote.revoke_share_link_acknowledgement",
    );
    return {
      status: "failed",
      message: withReference(
        "Revocation returned no acknowledgement. Reload before continuing.",
        reference,
      ),
    };
  }
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${encodeURIComponent(quoteRow.number)}`);
  return { status: "ok", message: "Recipient link revoked." };
}
