import { describe, expect, it, vi } from "vitest";
import { canonicalV1Vectors } from "../fixtures/canonical-v1-vectors.ts";
import { createBrokerHandler } from "../../supabase/functions/trusted-public-broker/handler.ts";
import { deriveRateLimitSubject } from "../../supabase/functions/trusted-public-broker/rate-subject.ts";
import {
  createRestBrokerDatabase,
  type BrokerDatabase,
} from "../../supabase/functions/trusted-public-broker/rpc.ts";
import {
  MAX_REQUEST_BODY_BYTES,
  parseBrokerAction,
} from "../../supabase/functions/trusted-public-broker/validation.ts";

const selector = "10000000-0000-4000-8000-000000000001";
const idempotencyKey = "20000000-0000-4000-8000-000000000001";
const secret = "a".repeat(43);
const hmacSecret = "local-unit-test-material-with-at-least-32-bytes";
const hash = "a".repeat(64);
const timestamp = "2026-08-14T12:00:00Z";

function request(
  body: unknown,
  init: { method?: string; contentType?: string; headers?: HeadersInit } = {},
) {
  return new Request("http://127.0.0.1/functions/v1/trusted-public-broker", {
    method: init.method ?? "POST",
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-forwarded-for": "192.0.2.10",
      ...init.headers,
    },
    body: init.method === "GET" ? undefined : JSON.stringify(body),
  });
}

function databaseResult(action: string) {
  switch (action) {
    case "open":
      return {
        status: "ok",
        organization_id: "must-not-escape",
        value: {
          link_id: selector,
          revision_id: idempotencyKey,
          quote_number: "TND-2026-0001",
          revision_number: 1,
          effective_state: "issued",
          snapshot: canonicalV1Vectors[0]!.snapshot,
          snapshot_hash: hash,
          calculation_fingerprint: hash,
          valid_until: "2099-01-01",
          response_type: null,
          acceptance_allowed: true,
          organization_id: "must-not-escape",
        },
      };
    case "record_event":
      return {
        status: "ok",
        value: {
          event_id: selector,
          revision_id: idempotencyKey,
          link_id: selector,
          type: "viewed",
          message: null,
          created_at: timestamp,
          replayed: false,
        },
      };
    case "accept":
      return {
        status: "ok",
        value: {
          acceptance_id: selector,
          quote_id: idempotencyKey,
          revision_id: selector,
          share_link_id: idempotencyKey,
          recipient_event_id: selector,
          snapshot_hash: hash,
          calculation_fingerprint: hash,
          recipient_email_snapshot: "buyer@example.test",
          buyer_asserted_name: "Buyer",
          buyer_asserted_title: null,
          acceptance_statement_version: 1,
          acceptance_statement: "Accepted.",
          acceptance_statement_hash: hash,
          accepted_at: timestamp,
          replayed: false,
          organization_id: "must-not-escape",
        },
      };
    case "verify":
      return {
        status: "ok",
        value: {
          verified: true,
          quote_number: "TND-2026-0001",
          revision_number: 1,
          seller_legal_name: "Tender Seller",
          currency_code: "USD",
          total_minor: 100,
          issued_at: timestamp,
          accepted_at: null,
          snapshot_hash: hash,
          calculation_fingerprint: hash,
          organization_id: "must-not-escape",
        },
      };
    default:
      throw new Error("unexpected action");
  }
}

function handlerWith(
  database: BrokerDatabase = {
    invoke: vi.fn(async (action) => databaseResult(action.action)),
  },
) {
  const logs: unknown[] = [];
  const handler = createBrokerHandler({
    database,
    hmacSecret,
    log: (entry) => logs.push(entry),
    randomId: () => "request-id",
  });
  return { handler, logs, database };
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("trusted public broker request boundary", () => {
  it("accepts only the fixed action allowlist", () => {
    const bodies = [
      { action: "open", selector, secret },
      {
        action: "record_event",
        eventType: "viewed",
        selector,
        secret,
        idempotencyKey,
      },
      {
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer",
        acceptanceStatementVersion: 1,
      },
      { action: "verify", verificationCode: "A".repeat(32) },
    ];
    expect(bodies.map((body) => parseBrokerAction(body).action)).toEqual([
      "open",
      "record_event",
      "accept",
      "verify",
    ]);
    expect(() =>
      parseBrokerAction({ action: "rpc", functionName: "broker_open_quote" }),
    ).toThrow(/not supported/i);
    expect(() =>
      parseBrokerAction({
        action: "open",
        selector,
        secret,
        organizationId: selector,
      }),
    ).toThrow(/unsupported field/i);
    expect(() =>
      parseBrokerAction({
        action: "open",
        selector,
        secret,
        rateLimitSubject: "caller-controlled",
      }),
    ).toThrow(/unsupported field/i);
  });

  it.each([
    ["selector", { action: "open", selector: "not-a-uuid", secret }],
    ["secret", { action: "open", selector, secret: "too-short" }],
    [
      "idempotency key",
      {
        action: "record_event",
        eventType: "viewed",
        selector,
        secret,
        idempotencyKey: "not-a-uuid",
      },
    ],
    [
      "event type",
      {
        action: "record_event",
        eventType: "accepted",
        selector,
        secret,
        idempotencyKey,
      },
    ],
    [
      "change message",
      {
        action: "record_event",
        eventType: "change_requested",
        selector,
        secret,
        idempotencyKey,
        message: "",
      },
    ],
    [
      "buyer name",
      {
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer\u0000",
        acceptanceStatementVersion: 1,
      },
    ],
    [
      "buyer title",
      {
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer",
        buyerAssertedTitle: "x".repeat(201),
        acceptanceStatementVersion: 1,
      },
    ],
    [
      "statement version",
      {
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer",
        acceptanceStatementVersion: 2,
      },
    ],
    ["verification code", { action: "verify", verificationCode: "XYZ" }],
  ])("rejects malformed %s before database access", (_label, body) => {
    expect(() => parseBrokerAction(body)).toThrow();
  });

  it("requires POST and strict JSON", async () => {
    const { handler } = handlerWith();
    const get = await handler(request({}, { method: "GET" }));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const wrongType = await handler(
      request(
        { action: "verify", verificationCode: "A".repeat(32) },
        {
          contentType: "text/plain",
        },
      ),
    );
    expect(wrongType.status).toBe(415);

    const malformed = await handler(
      new Request("http://127.0.0.1/functions/v1/trusted-public-broker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
  });

  it("enforces declared and observed body-size limits", async () => {
    const { handler } = handlerWith();
    const declared = await handler(
      new Request("http://127.0.0.1/functions/v1/trusted-public-broker", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
        },
        body: "{}",
      }),
    );
    expect(declared.status).toBe(413);

    const observed = await handler(
      request({
        action: "verify",
        verificationCode: "A".repeat(32),
        padding: "x".repeat(MAX_REQUEST_BODY_BYTES),
      }),
    );
    expect(observed.status).toBe(413);
  });
});

describe("trusted public broker dispatch and output", () => {
  it.each([
    ["open", { action: "open", selector, secret }],
    [
      "record_event",
      {
        action: "record_event",
        eventType: "viewed",
        selector,
        secret,
        idempotencyKey,
      },
    ],
    [
      "accept",
      {
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer",
        acceptanceStatementVersion: 1,
      },
    ],
    ["verify", { action: "verify", verificationCode: "A".repeat(32) }],
  ])("returns a bounded %s projection", async (_action, body) => {
    const { handler } = handlerWith();
    const response = await handler(request(body));
    expect(response.status).toBe(200);
    const json = await response.text();
    expect(json).not.toContain("organization_id");
    expect(json).not.toContain("must-not-escape");
  });

  it.each([
    ["rate_limited", 429],
    ["invalid_link", 404],
    ["revoked", 410],
    ["idempotency_conflict", 409],
    ["acceptance_evidence_invalid", 400],
  ])(
    "maps database status %s without internal details",
    async (status, http) => {
      const { handler } = handlerWith({
        invoke: vi.fn(async () => ({ status })),
      });
      const response = await handler(
        request({ action: "verify", verificationCode: "A".repeat(32) }),
      );
      expect(response.status).toBe(http);
      expect(await responseJson(response)).toEqual({ status });
    },
  );

  it("normalizes database failures and never logs sensitive input", async () => {
    const sensitive = {
      token: secret,
      name: "Secret Buyer Name",
      title: "Secret Buyer Title",
      sql: "organization_id=private token_hash=private",
    };
    const { handler, logs } = handlerWith({
      invoke: vi.fn(async () => {
        throw new Error(JSON.stringify(sensitive));
      }),
    });
    const response = await handler(
      request({
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: sensitive.name,
        buyerAssertedTitle: sensitive.title,
        acceptanceStatementVersion: 1,
      }),
    );
    expect(response.status).toBe(503);
    const output = `${await response.text()}${JSON.stringify(logs)}`;
    for (const value of Object.values(sensitive))
      expect(output).not.toContain(value);
    expect(output).not.toContain(secret);
    expect(logs).toEqual([
      {
        component: "trusted-public-broker",
        requestId: "request-id",
        action: "accept",
        outcome: "internal_error",
        status: "broker_unavailable",
      },
    ]);
  });

  it("logs only the fixed safe schema after a successful sensitive action", async () => {
    const { handler, logs } = handlerWith();
    const response = await handler(
      request({
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Private Buyer",
        buyerAssertedTitle: "Private Title",
        acceptanceStatementVersion: 1,
      }),
    );
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("Private Buyer");
    expect(serialized).not.toContain("Private Title");
    expect(logs).toEqual([
      {
        component: "trusted-public-broker",
        requestId: "request-id",
        action: "accept",
        outcome: "completed",
        status: "ok",
      },
    ]);
  });
});

describe("trusted broker rate subject and RPC isolation", () => {
  it("derives an opaque 32-byte HMAC subject from Edge metadata", async () => {
    const first = await deriveRateLimitSubject(
      request({ action: "verify", verificationCode: "A".repeat(32) }),
      hmacSecret,
    );
    const replay = await deriveRateLimitSubject(
      request({ action: "verify", verificationCode: "A".repeat(32) }),
      hmacSecret,
    );
    const other = await deriveRateLimitSubject(
      request(
        { action: "verify", verificationCode: "A".repeat(32) },
        { headers: { "x-forwarded-for": "192.0.2.11" } },
      ),
      hmacSecret,
    );
    expect(first).toHaveLength(32);
    expect(first).toEqual(replay);
    expect(first).not.toEqual(other);
    expect(new TextDecoder().decode(first)).not.toContain("192.0.2.10");
  });

  it("does not accept arbitrary caller text as a client address", async () => {
    const invalid = await deriveRateLimitSubject(
      new Request("http://127.0.0.1", {
        headers: { "x-forwarded-for": "caller-authored-subject" },
      }),
      hmacSecret,
    );
    const absent = await deriveRateLimitSubject(
      new Request("http://127.0.0.1"),
      hmacSecret,
    );
    expect(invalid).toEqual(absent);
  });

  it("uses only fixed RPC names and keeps the service credential in Edge headers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ status: "not_found" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const database = createRestBrokerDatabase(
      "http://127.0.0.1:54321",
      "edge-only-test-credential",
      fakeFetch,
    );
    for (const action of [
      parseBrokerAction({ action: "open", selector, secret }),
      parseBrokerAction({
        action: "record_event",
        eventType: "declined",
        selector,
        secret,
        idempotencyKey,
      }),
      parseBrokerAction({
        action: "accept",
        selector,
        secret,
        idempotencyKey,
        buyerAssertedName: "Buyer",
        acceptanceStatementVersion: 1,
      }),
      parseBrokerAction({ action: "verify", verificationCode: "A".repeat(32) }),
    ]) {
      await database.invoke(action, new Uint8Array(32));
    }
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/rest/v1/rpc/broker_open_quote",
      "/rest/v1/rpc/broker_record_quote_event",
      "/rest/v1/rpc/broker_accept_quote",
      "/rest/v1/rpc/broker_verify_quote",
    ]);
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe(
        "Bearer edge-only-test-credential",
      );
    }
  });
});
