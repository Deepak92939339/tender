import { getPublicSupabaseEnv } from "../supabase/public-env.ts";
import {
  createSignedBrokerHeaders,
  trustedClientAddressFromNext,
  type TransportBrokerAction,
} from "./transport.ts";

const MAX_EDGE_RESPONSE_BYTES = 2_500_000;
const SAFE_ERROR_STATUSES = new Set([
  "rate_limited",
  "invalid_link",
  "message_invalid",
  "idempotency_conflict",
  "not_found",
  "revoked",
  "superseded",
  "expired",
  "accepted",
  "already_responded",
  "already_accepted",
  "acceptance_evidence_invalid",
  "stale",
]);

export type BrokerCall = {
  httpStatus: number;
  result: { status: "ok"; value: Record<string, unknown> } | { status: string };
};

export type PublicBrokerInvoker = (
  action: TransportBrokerAction,
  body: Record<string, unknown>,
  requestHeaders: Headers,
) => Promise<BrokerCall>;

export class EdgeBrokerTransportError extends Error {
  constructor(
    readonly code: "configuration" | "signing" | "network" | "response",
  ) {
    super("The Edge broker transport is unavailable.");
    this.name = "EdgeBrokerTransportError";
  }
}

function requiredTransportSecret() {
  const value = process.env.TENDER_EDGE_BROKER_TRANSPORT_SECRET;
  if (!value) throw new EdgeBrokerTransportError("configuration");
  return value;
}

const PROJECTION_FIELDS: Record<TransportBrokerAction, readonly string[]> = {
  open: [
    "linkId",
    "revisionId",
    "quoteNumber",
    "revisionNumber",
    "effectiveState",
    "snapshotHash",
    "calculationFingerprint",
    "snapshot",
    "responseType",
    "acceptanceAllowed",
  ],
  record_event: [
    "eventId",
    "revisionId",
    "linkId",
    "type",
    "message",
    "createdAt",
  ],
  accept: [
    "acceptanceId",
    "quoteId",
    "revisionId",
    "shareLinkId",
    "recipientEventId",
    "acceptedAt",
    "snapshotHash",
    "calculationFingerprint",
    "recipientEmailSnapshot",
    "buyerAssertedName",
    "buyerAssertedTitle",
    "acceptanceStatementVersion",
    "acceptanceStatement",
    "acceptanceStatementHash",
    "replayed",
  ],
  verify: [
    "verified",
    "quoteNumber",
    "revisionNumber",
    "sellerLegalName",
    "currencyCode",
    "totalMinor",
    "issuedAt",
    "acceptedAt",
    "snapshotHash",
    "calculationFingerprint",
  ],
};

function boundedProjection(action: TransportBrokerAction, value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const fields = PROJECTION_FIELDS[action];
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  ) {
    return null;
  }
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function safeBrokerResult(action: TransportBrokerAction, value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const row = value as Record<string, unknown>;
  if (row.status === "ok") {
    const projection = boundedProjection(action, row.value);
    if (projection === null) return null;
    return {
      status: "ok" as const,
      value: projection,
    };
  }
  if (typeof row.status === "string" && SAFE_ERROR_STATUSES.has(row.status)) {
    return { status: row.status };
  }
  return null;
}

export function createPublicBrokerInvoker(
  input: {
    supabaseUrl?: string;
    anonKey?: string;
    transportSecret?: string;
    isVercelRuntime?: boolean;
    fetchImplementation?: typeof fetch;
  } = {},
): PublicBrokerInvoker {
  const publicEnvironment =
    input.supabaseUrl && input.anonKey
      ? { url: input.supabaseUrl, anonKey: input.anonKey }
      : getPublicSupabaseEnv();
  const endpoint = new URL(
    "/functions/v1/trusted-public-broker",
    publicEnvironment.url,
  );
  if (
    endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(endpoint.hostname)
    )
  ) {
    throw new EdgeBrokerTransportError("configuration");
  }
  const transportSecret = input.transportSecret ?? requiredTransportSecret();
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const isVercelRuntime = input.isVercelRuntime ?? process.env.VERCEL === "1";

  return async (action, body, requestHeaders) => {
    let stage: "signing" | "network" | "response" = "signing";
    try {
      const rawBody = JSON.stringify(body);
      const signedHeaders = await createSignedBrokerHeaders({
        action,
        body: rawBody,
        secret: transportSecret,
        clientAddress: trustedClientAddressFromNext(
          requestHeaders,
          isVercelRuntime,
        ),
      });
      signedHeaders.set("apikey", publicEnvironment.anonKey);
      signedHeaders.set("content-type", "application/json");
      signedHeaders.set("accept", "application/json");
      stage = "network";
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: signedHeaders,
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      stage = "response";
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) > MAX_EDGE_RESPONSE_BYTES) {
        throw new EdgeBrokerTransportError("response");
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_EDGE_RESPONSE_BYTES) {
        throw new EdgeBrokerTransportError("response");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new EdgeBrokerTransportError("response");
      }
      const result = safeBrokerResult(action, parsed);
      if (!result || response.ok !== (result.status === "ok")) {
        throw new EdgeBrokerTransportError("response");
      }
      return { httpStatus: response.status, result };
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        (error as { name?: unknown }).name === "EdgeBrokerTransportError"
      ) {
        console.info(
          JSON.stringify({
            component: "public-quote-edge-transport",
            outcome: "internal_error",
            status: `edge_transport_${stage}`,
          }),
        );
        throw error;
      }
      console.info(
        JSON.stringify({
          component: "public-quote-edge-transport",
          outcome: "internal_error",
          status: `edge_transport_${stage}`,
        }),
      );
      throw new EdgeBrokerTransportError(stage);
    }
  };
}
