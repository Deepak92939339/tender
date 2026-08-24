import { isCanonicalBase64url } from "../../../lib/public-quotes/base64url.ts";

export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFICATION_CODE = /^[A-F0-9]{32}$/;
const FORBIDDEN_IDENTITY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const FORBIDDEN_MESSAGE_CONTROL =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

type UnknownRecord = Record<string, unknown>;

export type OpenAction = {
  action: "open";
  selector: string;
  secret: string;
};

export type RecordEventAction = {
  action: "record_event";
  eventType: "viewed" | "change_requested" | "declined";
  selector: string;
  secret: string;
  idempotencyKey: string;
  message: string | null;
};

export type AcceptAction = {
  action: "accept";
  selector: string;
  secret: string;
  idempotencyKey: string;
  buyerAssertedName: string;
  buyerAssertedTitle: string | null;
  acceptanceStatementVersion: 1;
};

export type VerifyAction = {
  action: "verify";
  verificationCode: string;
};

export type BrokerAction =
  OpenAction | RecordEventAction | AcceptAction | VerifyAction;

export type BrokerActionName = BrokerAction["action"];

export class RequestValidationError extends Error {
  constructor(
    readonly code:
      | "method_not_allowed"
      | "content_type_required"
      | "body_too_large"
      | "invalid_json"
      | "invalid_body"
      | "unsupported_action"
      | "unknown_field"
      | "invalid_selector"
      | "invalid_secret"
      | "invalid_idempotency_key"
      | "invalid_event_type"
      | "invalid_message"
      | "invalid_identity"
      | "invalid_acceptance_statement_version"
      | "invalid_verification_code",
    message: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function record(value: unknown): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(
      "invalid_body",
      "The request body must be a JSON object.",
    );
  }
  return value as UnknownRecord;
}

function exactFields(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  for (const field of required) {
    if (!Object.hasOwn(value, field)) {
      throw new RequestValidationError(
        "invalid_body",
        `A required field is missing: ${field}.`,
      );
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new RequestValidationError(
        "unknown_field",
        `The request contains an unsupported field: ${field}.`,
      );
    }
  }
}

function requiredString(
  value: unknown,
  code: RequestValidationError["code"],
  label: string,
) {
  if (typeof value !== "string") {
    throw new RequestValidationError(code, `${label} must be a string.`);
  }
  return value;
}

function selector(value: unknown) {
  const candidate = requiredString(value, "invalid_selector", "selector");
  if (!UUID_V4.test(candidate)) {
    throw new RequestValidationError(
      "invalid_selector",
      "selector must be a canonical version 4 UUID.",
    );
  }
  return candidate.toLowerCase();
}

function secret(value: unknown) {
  const candidate = requiredString(value, "invalid_secret", "secret");
  if (!isCanonicalBase64url(candidate, 32)) {
    throw new RequestValidationError(
      "invalid_secret",
      "secret must be an unpadded 32-byte base64url value.",
    );
  }
  return candidate;
}

function idempotencyKey(value: unknown) {
  const candidate = requiredString(
    value,
    "invalid_idempotency_key",
    "idempotencyKey",
  );
  if (!UUID_V4.test(candidate)) {
    throw new RequestValidationError(
      "invalid_idempotency_key",
      "idempotencyKey must be a canonical version 4 UUID.",
    );
  }
  return candidate.toLowerCase();
}

function normalizedIdentity(value: unknown, label: string, optional: boolean) {
  if (value === null && optional) return null;
  const candidate = requiredString(value, "invalid_identity", label)
    .normalize("NFC")
    .trim();
  if (
    Array.from(candidate).length < 1 ||
    Array.from(candidate).length > 200 ||
    FORBIDDEN_IDENTITY_CONTROL.test(candidate)
  ) {
    throw new RequestValidationError(
      "invalid_identity",
      `${label} must contain 1 to 200 non-control characters.`,
    );
  }
  return candidate;
}

function parseOpen(value: UnknownRecord): OpenAction {
  exactFields(value, ["action", "selector", "secret"]);
  return {
    action: "open",
    selector: selector(value.selector),
    secret: secret(value.secret),
  };
}

function parseRecordEvent(value: UnknownRecord): RecordEventAction {
  exactFields(
    value,
    ["action", "eventType", "selector", "secret", "idempotencyKey"],
    ["message"],
  );
  if (
    value.eventType !== "viewed" &&
    value.eventType !== "change_requested" &&
    value.eventType !== "declined"
  ) {
    throw new RequestValidationError(
      "invalid_event_type",
      "eventType is not allowed.",
    );
  }

  let message: string | null = null;
  if (value.eventType === "change_requested") {
    message = requiredString(value.message, "invalid_message", "message")
      .normalize("NFC")
      .trim();
    if (
      Array.from(message).length < 1 ||
      Array.from(message).length > 2000 ||
      FORBIDDEN_MESSAGE_CONTROL.test(message)
    ) {
      throw new RequestValidationError(
        "invalid_message",
        "message must contain 1 to 2000 supported characters.",
      );
    }
  } else if (Object.hasOwn(value, "message")) {
    throw new RequestValidationError(
      "invalid_message",
      "message is permitted only for change_requested.",
    );
  }

  return {
    action: "record_event",
    eventType: value.eventType,
    selector: selector(value.selector),
    secret: secret(value.secret),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    message,
  };
}

function parseAccept(value: UnknownRecord): AcceptAction {
  exactFields(
    value,
    [
      "action",
      "selector",
      "secret",
      "idempotencyKey",
      "buyerAssertedName",
      "acceptanceStatementVersion",
    ],
    ["buyerAssertedTitle"],
  );
  if (value.acceptanceStatementVersion !== 1) {
    throw new RequestValidationError(
      "invalid_acceptance_statement_version",
      "acceptanceStatementVersion must be 1.",
    );
  }
  return {
    action: "accept",
    selector: selector(value.selector),
    secret: secret(value.secret),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    buyerAssertedName: normalizedIdentity(
      value.buyerAssertedName,
      "buyerAssertedName",
      false,
    )!,
    buyerAssertedTitle: Object.hasOwn(value, "buyerAssertedTitle")
      ? normalizedIdentity(value.buyerAssertedTitle, "buyerAssertedTitle", true)
      : null,
    acceptanceStatementVersion: 1,
  };
}

function parseVerify(value: UnknownRecord): VerifyAction {
  exactFields(value, ["action", "verificationCode"]);
  const candidate = requiredString(
    value.verificationCode,
    "invalid_verification_code",
    "verificationCode",
  ).toUpperCase();
  if (!VERIFICATION_CODE.test(candidate)) {
    throw new RequestValidationError(
      "invalid_verification_code",
      "verificationCode must contain 32 hexadecimal characters.",
    );
  }
  return { action: "verify", verificationCode: candidate };
}

export function parseBrokerAction(value: unknown): BrokerAction {
  const body = record(value);
  if (typeof body.action !== "string") {
    throw new RequestValidationError(
      "unsupported_action",
      "A supported action is required.",
    );
  }
  switch (body.action) {
    case "open":
      return parseOpen(body);
    case "record_event":
      return parseRecordEvent(body);
    case "accept":
      return parseAccept(body);
    case "verify":
      return parseVerify(body);
    default:
      throw new RequestValidationError(
        "unsupported_action",
        "The requested action is not supported.",
      );
  }
}

function isJsonContentType(value: string | null) {
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

export async function readBrokerRequestBody(request: Request) {
  if (request.method !== "POST") {
    throw new RequestValidationError(
      "method_not_allowed",
      "Only POST is supported.",
    );
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new RequestValidationError(
      "content_type_required",
      "Content-Type must be application/json.",
    );
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestValidationError(
        "invalid_body",
        "Content-Length is invalid.",
      );
    }
    if (Number(declaredLength) > MAX_REQUEST_BODY_BYTES) {
      throw new RequestValidationError(
        "body_too_large",
        "The request body is too large.",
      );
    }
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestValidationError(
      "body_too_large",
      "The request body is too large.",
    );
  }
  return bytes;
}

export function parseBrokerActionBytes(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestValidationError(
      "invalid_json",
      "The request body must be valid UTF-8 JSON.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new RequestValidationError(
      "invalid_json",
      "The request body must be valid JSON.",
    );
  }
  return parseBrokerAction(value);
}

export async function readBrokerRequest(request: Request) {
  return parseBrokerActionBytes(await readBrokerRequestBody(request));
}
