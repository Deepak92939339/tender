import { canonicalizeQuoteSnapshotV1 } from "../../../lib/quotes/canonical-snapshot.ts";
import type {
  AcceptanceProjection,
  BuyerQuoteProjection,
  BuyerResponseProjection,
  PublicBrokerResult,
  VerificationProjection,
} from "../../../lib/quotes/commitment-contracts.ts";
import type { BrokerActionName } from "./validation.ts";

type Projection =
  | BuyerQuoteProjection
  | BuyerResponseProjection
  | AcceptanceProjection
  | VerificationProjection;
type UnknownRecord = Record<string, unknown>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const errorStatuses = new Set([
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
] as const);

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object.`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, label: string, maxLength = 2_000) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maxLength = 2_000) {
  return value === null ? null : text(value, label, maxLength);
}

function uuid(value: unknown, label: string) {
  const candidate = text(value, label, 36);
  if (!UUID.test(candidate)) throw new TypeError(`${label} is invalid.`);
  return candidate;
}

function hash(value: unknown, label: string) {
  const candidate = text(value, label, 64);
  if (!SHA256.test(candidate)) throw new TypeError(`${label} is invalid.`);
  return candidate;
}

function integer(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string) {
  const candidate = text(value, label, 40);
  if (!TIMESTAMP.test(candidate)) throw new TypeError(`${label} is invalid.`);
  return candidate;
}

function nullableTimestamp(value: unknown, label: string) {
  return value === null ? null : timestamp(value, label);
}

function openProjection(value: unknown): BuyerQuoteProjection {
  const row = record(value, "open result");
  if (row.effective_state !== "issued") {
    throw new TypeError("open result effective state is invalid.");
  }
  canonicalizeQuoteSnapshotV1(row.snapshot);
  const responseType = row.response_type;
  if (
    responseType !== null &&
    responseType !== "viewed" &&
    responseType !== "change_requested" &&
    responseType !== "declined" &&
    responseType !== "accepted"
  ) {
    throw new TypeError("open result response type is invalid.");
  }
  return {
    linkId: uuid(row.link_id, "link_id"),
    revisionId: uuid(row.revision_id, "revision_id"),
    quoteNumber: text(row.quote_number, "quote_number", 100),
    revisionNumber: integer(row.revision_number, "revision_number"),
    effectiveState: "issued",
    snapshotHash: hash(row.snapshot_hash, "snapshot_hash"),
    calculationFingerprint: hash(
      row.calculation_fingerprint,
      "calculation_fingerprint",
    ),
    snapshot: row.snapshot,
    responseType,
    acceptanceAllowed: boolean(row.acceptance_allowed, "acceptance_allowed"),
  } as BuyerQuoteProjection;
}

function eventProjection(value: unknown): BuyerResponseProjection {
  const row = record(value, "event result");
  if (
    row.type !== "viewed" &&
    row.type !== "change_requested" &&
    row.type !== "declined"
  ) {
    throw new TypeError("event result type is invalid.");
  }
  return {
    eventId: uuid(row.event_id, "event_id"),
    revisionId: uuid(row.revision_id, "revision_id"),
    linkId: uuid(row.link_id, "link_id"),
    type: row.type,
    message: nullableText(row.message, "message"),
    createdAt: timestamp(row.created_at, "created_at"),
  };
}

function acceptanceProjection(value: unknown): AcceptanceProjection {
  const row = record(value, "acceptance result");
  if (row.acceptance_statement_version !== 1) {
    throw new TypeError("acceptance statement version is invalid.");
  }
  return {
    acceptanceId: uuid(row.acceptance_id, "acceptance_id"),
    quoteId: uuid(row.quote_id, "quote_id"),
    revisionId: uuid(row.revision_id, "revision_id"),
    shareLinkId: uuid(row.share_link_id, "share_link_id"),
    recipientEventId: uuid(row.recipient_event_id, "recipient_event_id"),
    acceptedAt: timestamp(row.accepted_at, "accepted_at"),
    snapshotHash: hash(row.snapshot_hash, "snapshot_hash"),
    calculationFingerprint: hash(
      row.calculation_fingerprint,
      "calculation_fingerprint",
    ),
    recipientEmailSnapshot: text(
      row.recipient_email_snapshot,
      "recipient_email_snapshot",
      254,
    ),
    buyerAssertedName: text(
      row.buyer_asserted_name,
      "buyer_asserted_name",
      200,
    ),
    buyerAssertedTitle: nullableText(
      row.buyer_asserted_title,
      "buyer_asserted_title",
      200,
    ),
    acceptanceStatementVersion: 1,
    acceptanceStatement: text(
      row.acceptance_statement,
      "acceptance_statement",
      1_000,
    ),
    acceptanceStatementHash: hash(
      row.acceptance_statement_hash,
      "acceptance_statement_hash",
    ),
    replayed: boolean(row.replayed, "replayed"),
  };
}

function verificationProjection(value: unknown): VerificationProjection {
  const row = record(value, "verification result");
  return {
    verified: boolean(row.verified, "verified"),
    quoteNumber: nullableText(row.quote_number, "quote_number", 100),
    revisionNumber:
      row.revision_number === null
        ? null
        : integer(row.revision_number, "revision_number"),
    sellerLegalName: nullableText(
      row.seller_legal_name,
      "seller_legal_name",
      300,
    ),
    currencyCode: nullableText(row.currency_code, "currency_code", 3),
    totalMinor:
      row.total_minor === null ? null : integer(row.total_minor, "total_minor"),
    issuedAt: nullableTimestamp(row.issued_at, "issued_at"),
    acceptedAt: nullableTimestamp(row.accepted_at, "accepted_at"),
    snapshotHash:
      row.snapshot_hash === null
        ? null
        : hash(row.snapshot_hash, "snapshot_hash"),
    calculationFingerprint:
      row.calculation_fingerprint === null
        ? null
        : hash(row.calculation_fingerprint, "calculation_fingerprint"),
  };
}

export function projectBrokerResult(
  action: BrokerActionName,
  result: unknown,
): PublicBrokerResult<Projection> {
  const envelope = record(result, "broker result");
  if (envelope.status !== "ok") {
    if (
      typeof envelope.status !== "string" ||
      !errorStatuses.has(envelope.status as never)
    ) {
      throw new TypeError("broker result status is invalid.");
    }
    return { status: envelope.status } as PublicBrokerResult<Projection>;
  }
  const value = envelope.value;
  switch (action) {
    case "open":
      return { status: "ok", value: openProjection(value) };
    case "record_event":
      return { status: "ok", value: eventProjection(value) };
    case "accept":
      return { status: "ok", value: acceptanceProjection(value) };
    case "verify":
      return { status: "ok", value: verificationProjection(value) };
  }
}
