import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireApplicationContext = vi.fn();
const createClient = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireApplicationContext: () => requireApplicationContext(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

import {
  createQuoteShareLinkAction,
  revokeQuoteShareLinkAction,
} from "@/app/(application)/quotes/actions";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const quoteId = "10000000-0000-4000-8000-000000000001";
const revisionId = "20000000-0000-4000-8000-000000000001";
const commandId = "30000000-0000-4000-8000-000000000001";
const shareLinkId = "40000000-0000-4000-8000-000000000001";
const selector = "50000000-0000-4000-8000-000000000001";
const secret = "A".repeat(43);

const authorized = {
  capabilities: ["quote.share"],
  membership: {
    organizationId,
    organization: { timezone: "Asia/Kolkata" },
  },
};

const validInput = {
  quoteId,
  revisionId,
  expectedVersion: 4,
  commandId,
  recipientEmail: "buyer@example.test",
  expiresAt: "2026-08-20T12:00:00.000Z",
};

type QueryRecord = {
  table: string;
  filters: Array<[string, unknown]>;
};

function clientWith(input: {
  quote?: Record<string, unknown> | null;
  revision?: Record<string, unknown> | null;
  rpcResult?: {
    data: unknown;
    error: { code?: string; message: string } | null;
  };
}) {
  const queries: QueryRecord[] = [];
  const rpc = vi.fn(async () => input.rpcResult ?? { data: null, error: null });
  return {
    queries,
    rpc,
    from(table: string) {
      const query: QueryRecord = { table, filters: [] };
      queries.push(query);
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          return {
            data:
              table === "quotes"
                ? (input.quote ?? null)
                : (input.revision ?? null),
            error: null,
          };
        },
      };
      return builder;
    },
  };
}

describe("issuer share-link actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T08:00:00.000Z"));
    requireApplicationContext.mockReset();
    createClient.mockReset();
    revalidatePath.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("refuses create and revoke without quote.share", async () => {
    requireApplicationContext.mockResolvedValue({
      capabilities: ["quote.read"],
      membership: authorized.membership,
    });
    await expect(createQuoteShareLinkAction(validInput)).resolves.toMatchObject(
      {
        status: "failed",
        message: expect.stringContaining("cannot share"),
      },
    );
    await expect(
      revokeQuoteShareLinkAction({
        quoteId,
        shareLinkId,
        expectedVersion: 4,
        commandId,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("cannot share"),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses create when the current revision is not issued", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({
      quote: {
        id: quoteId,
        number: "TND-2026-0001",
        current_revision_id: revisionId,
        valid_until: "2026-08-20",
      },
      revision: {
        id: revisionId,
        state: "approved",
        valid_until: "2026-08-20",
      },
    });
    createClient.mockResolvedValue(client);
    await expect(createQuoteShareLinkAction(validInput)).resolves.toMatchObject(
      {
        status: "failed",
        message: expect.stringContaining("current issued revision"),
      },
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses expiry after the revision validity limit", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({
      quote: {
        id: quoteId,
        number: "TND-2026-0001",
        current_revision_id: revisionId,
        valid_until: "2026-08-20",
      },
      revision: {
        id: revisionId,
        state: "issued",
        valid_until: "2026-08-20",
      },
    });
    createClient.mockResolvedValue(client);
    await expect(
      createQuoteShareLinkAction({
        ...validInput,
        expiresAt: "2026-08-20T18:30:01.000Z",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("validity period"),
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("creates a one-time fragment link after tenant and revision scoping", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({
      quote: {
        id: quoteId,
        number: "TND/2026 0001",
        current_revision_id: revisionId,
        valid_until: "2026-08-20",
      },
      revision: {
        id: revisionId,
        state: "issued",
        valid_until: "2026-08-20",
      },
      rpcResult: {
        data: {
          status: "created",
          link_id: shareLinkId,
          selector,
          secret,
          revision_id: revisionId,
          expires_at: validInput.expiresAt,
        },
        error: null,
      },
    });
    createClient.mockResolvedValue(client);
    await expect(createQuoteShareLinkAction(validInput)).resolves.toEqual({
      status: "created",
      linkId: shareLinkId,
      url: `/quote/${selector}#secret=${secret}`,
      message: expect.stringContaining("cannot show this secret again"),
    });
    expect(client.queries).toEqual([
      {
        table: "quotes",
        filters: [
          ["organization_id", organizationId],
          ["id", quoteId],
        ],
      },
      {
        table: "quote_revisions",
        filters: [
          ["organization_id", organizationId],
          ["quote_id", quoteId],
          ["id", revisionId],
        ],
      },
    ]);
    expect(client.rpc).toHaveBeenCalledWith("create_quote_share_link", {
      p_quote_id: quoteId,
      p_revision_id: revisionId,
      p_expected_version: 4,
      p_recipient_email: "buyer@example.test",
      p_expires_at: validInput.expiresAt,
      p_command_id: commandId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/quotes/TND%2F2026%200001");
  });

  it("returns no secret URL for an idempotent create replay", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({
      quote: {
        id: quoteId,
        number: "TND-2026-0001",
        current_revision_id: revisionId,
        valid_until: "2026-08-20",
      },
      revision: {
        id: revisionId,
        state: "issued",
        valid_until: "2026-08-20",
      },
      rpcResult: {
        data: {
          status: "replayed_without_secret",
          link_id: shareLinkId,
          selector,
          secret: null,
          revision_id: revisionId,
          expires_at: validInput.expiresAt,
        },
        error: null,
      },
    });
    createClient.mockResolvedValue(client);
    const result = await createQuoteShareLinkAction(validInput);
    expect(result).toMatchObject({ status: "replayed", linkId: shareLinkId });
    expect(result).not.toHaveProperty("url");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("refuses a cross-organization or invisible quote before revoke RPC", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({ quote: null });
    createClient.mockResolvedValue(client);
    await expect(
      revokeQuoteShareLinkAction({
        quoteId,
        shareLinkId,
        expectedVersion: 4,
        commandId,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("tenant-scoped quotation"),
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("revokes through the authoritative RPC and revalidates a server-derived path", async () => {
    requireApplicationContext.mockResolvedValue(authorized);
    const client = clientWith({
      quote: { id: quoteId, number: "TND-2026-0001" },
      rpcResult: {
        data: {
          id: shareLinkId,
          quote_id: quoteId,
          revision_id: revisionId,
          disabled_reason: "revoked",
          disabled_at: "2026-08-15T09:00:00.000Z",
        },
        error: null,
      },
    });
    createClient.mockResolvedValue(client);
    await expect(
      revokeQuoteShareLinkAction({
        quoteId,
        shareLinkId,
        expectedVersion: 4,
        commandId,
      }),
    ).resolves.toEqual({ status: "ok", message: "Recipient link revoked." });
    expect(client.rpc).toHaveBeenCalledWith("revoke_quote_share_link", {
      p_quote_id: quoteId,
      p_share_link_id: shareLinkId,
      p_expected_version: 4,
      p_command_id: commandId,
    });
    expect(client.queries[0]?.filters).toEqual([
      ["organization_id", organizationId],
      ["id", quoteId],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/quotes/TND-2026-0001");
  });
});
