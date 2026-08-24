import type { TransportBrokerAction } from "./transport.ts";
import { isCanonicalBase64url } from "./base64url.ts";

export const NEXT_PUBLIC_REQUEST_MAX_BYTES = 8 * 1024;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFICATION_CODE = /^[A-F0-9]{32}$/;
const FORBIDDEN_IDENTITY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const FORBIDDEN_MESSAGE_CONTROL =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export class PublicRouteError extends Error {
  constructor(
    readonly code:
      | "origin_required"
      | "origin_mismatch"
      | "content_type_required"
      | "body_too_large"
      | "invalid_json"
      | "invalid_body"
      | "unknown_field"
      | "unsupported_action"
      | "invalid_selector"
      | "invalid_secret"
      | "invalid_idempotency_key"
      | "invalid_event_type"
      | "invalid_message"
      | "invalid_identity"
      | "invalid_acceptance_statement_version"
      | "invalid_verification_code",
  ) {
    super("The public quote request is invalid.");
    this.name = "PublicRouteError";
  }
}

type Row = Record<string, unknown>;

function exact(value: unknown, required: string[], optional: string[] = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteError("invalid_body");
  }
  const row = value as Row;
  for (const key of required) {
    if (!Object.hasOwn(row, key)) throw new PublicRouteError("invalid_body");
  }
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(row).some((key) => !allowed.has(key))) {
    throw new PublicRouteError("unknown_field");
  }
  return row;
}

function string(value: unknown, code: PublicRouteError["code"]) {
  if (typeof value !== "string") throw new PublicRouteError(code);
  return value;
}

function selector(value: unknown) {
  const candidate = string(value, "invalid_selector");
  if (!UUID_V4.test(candidate)) throw new PublicRouteError("invalid_selector");
  return candidate.toLowerCase();
}

function secret(value: unknown) {
  const candidate = string(value, "invalid_secret");
  if (!isCanonicalBase64url(candidate, 32))
    throw new PublicRouteError("invalid_secret");
  return candidate;
}

function idempotencyKey(value: unknown) {
  const candidate = string(value, "invalid_idempotency_key");
  if (!UUID_V4.test(candidate)) {
    throw new PublicRouteError("invalid_idempotency_key");
  }
  return candidate.toLowerCase();
}

function identity(value: unknown, optional: boolean) {
  if (value === null && optional) return null;
  const candidate = string(value, "invalid_identity").normalize("NFC").trim();
  const length = Array.from(candidate).length;
  if (
    length < 1 ||
    length > 200 ||
    FORBIDDEN_IDENTITY_CONTROL.test(candidate)
  ) {
    throw new PublicRouteError("invalid_identity");
  }
  return candidate;
}

function jsonContentType(value: string | null) {
  if (value === null) return false;
  const parts = value
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return (
    parts[0] === "application/json" &&
    (parts.length === 1 || (parts.length === 2 && parts[1] === "charset=utf-8"))
  );
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new PublicRouteError("origin_required");
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw new PublicRouteError("origin_mismatch");
  }
  if (origin !== expected) throw new PublicRouteError("origin_mismatch");
}

export async function readBoundedJson(request: Request) {
  if (!jsonContentType(request.headers.get("content-type"))) {
    throw new PublicRouteError("content_type_required");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new PublicRouteError("invalid_body");
    if (Number(declared) > NEXT_PUBLIC_REQUEST_MAX_BYTES) {
      throw new PublicRouteError("body_too_large");
    }
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > NEXT_PUBLIC_REQUEST_MAX_BYTES) {
    throw new PublicRouteError("body_too_large");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new PublicRouteError("invalid_json");
  }
}

export function parseSessionRequest(value: unknown) {
  const row = exact(value, ["selector", "secret"]);
  return { selector: selector(row.selector), secret: secret(row.secret) };
}

export type NextActionRequest =
  | {
      action: "record_event";
      eventType: "viewed" | "declined";
      idempotencyKey: string;
    }
  | {
      action: "record_event";
      eventType: "change_requested";
      idempotencyKey: string;
      message: string;
    }
  | {
      action: "accept";
      idempotencyKey: string;
      buyerAssertedName: string;
      buyerAssertedTitle: string | null;
      acceptanceStatementVersion: 1;
    };

export function parseActionRequest(value: unknown): NextActionRequest {
  const base = exact(
    value,
    ["action", "idempotencyKey"],
    [
      "eventType",
      "message",
      "buyerAssertedName",
      "buyerAssertedTitle",
      "acceptanceStatementVersion",
    ],
  );
  const key = idempotencyKey(base.idempotencyKey);
  if (base.action === "record_event") {
    if (
      base.eventType !== "viewed" &&
      base.eventType !== "change_requested" &&
      base.eventType !== "declined"
    ) {
      throw new PublicRouteError("invalid_event_type");
    }
    const required = ["action", "eventType", "idempotencyKey"];
    if (base.eventType === "change_requested") required.push("message");
    const row = exact(value, required);
    if (base.eventType === "change_requested") {
      const message = string(row.message, "invalid_message")
        .normalize("NFC")
        .trim();
      const length = Array.from(message).length;
      if (
        length < 1 ||
        length > 2_000 ||
        FORBIDDEN_MESSAGE_CONTROL.test(message)
      ) {
        throw new PublicRouteError("invalid_message");
      }
      return {
        action: "record_event",
        eventType: base.eventType,
        idempotencyKey: key,
        message,
      };
    }
    return {
      action: "record_event",
      eventType: base.eventType,
      idempotencyKey: key,
    };
  }
  if (base.action === "accept") {
    const row = exact(
      value,
      [
        "action",
        "idempotencyKey",
        "buyerAssertedName",
        "acceptanceStatementVersion",
      ],
      ["buyerAssertedTitle"],
    );
    if (row.acceptanceStatementVersion !== 1) {
      throw new PublicRouteError("invalid_acceptance_statement_version");
    }
    return {
      action: "accept",
      idempotencyKey: key,
      buyerAssertedName: identity(row.buyerAssertedName, false)!,
      buyerAssertedTitle: Object.hasOwn(row, "buyerAssertedTitle")
        ? identity(row.buyerAssertedTitle, true)
        : null,
      acceptanceStatementVersion: 1,
    };
  }
  throw new PublicRouteError("unsupported_action");
}

export function parseVerifyRequest(value: unknown) {
  const row = exact(value, ["verificationCode"]);
  const verificationCode = string(
    row.verificationCode,
    "invalid_verification_code",
  ).toUpperCase();
  if (!VERIFICATION_CODE.test(verificationCode)) {
    throw new PublicRouteError("invalid_verification_code");
  }
  return { verificationCode };
}

export function brokerActionName(
  value: NextActionRequest,
): TransportBrokerAction {
  return value.action;
}
