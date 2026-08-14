export const BROKER_TRANSPORT_VERSION = "1";
export const BROKER_TRANSPORT_AUDIENCE = "trusted-public-broker:v1";
export const BROKER_TRANSPORT_MAX_AGE_SECONDS = 60;
export const BROKER_TRANSPORT_MAX_FUTURE_SECONDS = 5;

export const BROKER_TRANSPORT_HEADERS = {
  version: "x-tender-broker-version",
  audience: "x-tender-broker-audience",
  action: "x-tender-broker-action",
  bodyHash: "x-tender-broker-body-sha256",
  issuedAt: "x-tender-broker-issued-at",
  requestId: "x-tender-broker-request-id",
  clientAddress: "x-tender-broker-client-address",
  signature: "x-tender-broker-signature",
} as const;

export const BROKER_ACTIONS = [
  "open",
  "record_event",
  "accept",
  "verify",
] as const;

export type TransportBrokerAction = (typeof BROKER_ACTIONS)[number];
export type TrustedClientAddress = `vercel-ip:v1:${string}` | "unattributed:v1";

export type VerifiedBrokerTransport = {
  action: TransportBrokerAction;
  bodyBytes: Uint8Array;
  clientAddress: TrustedClientAddress;
  requestId: string;
};

export type TransportFailureCode =
  | "transport_missing"
  | "transport_malformed"
  | "transport_expired"
  | "transport_future_dated"
  | "transport_wrong_audience"
  | "transport_authentication_failed";

export class TransportAuthenticationError extends Error {
  constructor(readonly code: TransportFailureCode) {
    super("The broker transport could not be authenticated.");
    this.name = "TransportAuthenticationError";
  }
}

const encoder = new TextEncoder();
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const IPV6 = /^[0-9a-f:.]{2,64}$/i;
const MAX_CLIENT_ADDRESS_BYTES = 96;
const MAX_HEADER_BYTES = 160;

function assertTransportSecret(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error(
      "The broker transport secret must contain at least 32 bytes.",
    );
  }
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string) {
  if (!SHA256_HEX.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left[index % Math.max(left.byteLength, 1)] ?? 0) ^
      (right[index % Math.max(right.byteLength, 1)] ?? 0);
  }
  return difference === 0;
}

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
}

async function hmac(secret: string, value: string) {
  assertTransportSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function isBrokerAction(value: string): value is TransportBrokerAction {
  return (BROKER_ACTIONS as readonly string[]).includes(value);
}

function canonicalEnvelope(input: {
  method: string;
  action: TransportBrokerAction;
  bodyHash: string;
  issuedAt: string;
  requestId: string;
  clientAddress: TrustedClientAddress;
}) {
  return [
    "tender-broker-hmac-sha256-v1",
    `version:${BROKER_TRANSPORT_VERSION}`,
    `method:${input.method}`,
    `audience:${BROKER_TRANSPORT_AUDIENCE}`,
    `action:${input.action}`,
    `body-sha256:${input.bodyHash}`,
    `issued-at:${input.issuedAt}`,
    `request-id:${input.requestId}`,
    `client-address:${input.clientAddress}`,
  ].join("\n");
}

function normalizeIpv4(value: string) {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    !parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  ) {
    return null;
  }
  return parts.map((part) => String(Number(part))).join(".");
}

export function normalizeIpAddress(raw: string) {
  const value = raw.trim();
  const ipv4 = normalizeIpv4(value);
  if (ipv4) return ipv4;
  const unbracketed =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!unbracketed.includes(":") || !IPV6.test(unbracketed)) return null;
  try {
    const hostname = new URL(`http://[${unbracketed}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function trustedClientAddressFromNext(
  headers: Headers,
  isVercelRuntime: boolean,
): TrustedClientAddress {
  if (!isVercelRuntime) return "unattributed:v1";
  const raw = headers.get("x-forwarded-for");
  if (
    raw === null ||
    raw.includes(",") ||
    encoder.encode(raw).byteLength > 64
  ) {
    return "unattributed:v1";
  }
  const address = normalizeIpAddress(raw);
  return address ? `vercel-ip:v1:${address}` : "unattributed:v1";
}

function validTrustedClientAddress(
  value: string,
): value is TrustedClientAddress {
  if (value === "unattributed:v1") return true;
  if (!value.startsWith("vercel-ip:v1:")) return false;
  return normalizeIpAddress(value.slice("vercel-ip:v1:".length)) !== null;
}

export async function createSignedBrokerHeaders(input: {
  action: TransportBrokerAction;
  body: string;
  secret: string;
  clientAddress: TrustedClientAddress;
  method?: "POST";
  issuedAt?: number;
  requestId?: string;
}) {
  const method = input.method ?? "POST";
  const issuedAt = String(input.issuedAt ?? Math.floor(Date.now() / 1_000));
  const requestId = (input.requestId ?? crypto.randomUUID()).toLowerCase();
  if (
    !UUID_V4.test(requestId) ||
    !validTrustedClientAddress(input.clientAddress)
  ) {
    throw new Error("The broker transport metadata is invalid.");
  }
  const bodyHash = bytesToHex(await sha256(encoder.encode(input.body)));
  const signature = bytesToHex(
    await hmac(
      input.secret,
      canonicalEnvelope({
        method,
        action: input.action,
        bodyHash,
        issuedAt,
        requestId,
        clientAddress: input.clientAddress,
      }),
    ),
  );
  return new Headers({
    [BROKER_TRANSPORT_HEADERS.version]: BROKER_TRANSPORT_VERSION,
    [BROKER_TRANSPORT_HEADERS.audience]: BROKER_TRANSPORT_AUDIENCE,
    [BROKER_TRANSPORT_HEADERS.action]: input.action,
    [BROKER_TRANSPORT_HEADERS.bodyHash]: bodyHash,
    [BROKER_TRANSPORT_HEADERS.issuedAt]: issuedAt,
    [BROKER_TRANSPORT_HEADERS.requestId]: requestId,
    [BROKER_TRANSPORT_HEADERS.clientAddress]: input.clientAddress,
    [BROKER_TRANSPORT_HEADERS.signature]: signature,
  });
}

function boundedHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null)
    throw new TransportAuthenticationError("transport_missing");
  if (encoder.encode(value).byteLength > MAX_HEADER_BYTES) {
    throw new TransportAuthenticationError("transport_malformed");
  }
  return value;
}

export async function verifySignedBrokerTransport(input: {
  method: string;
  headers: Headers;
  bodyBytes: Uint8Array;
  secret: string;
  now?: number;
}): Promise<VerifiedBrokerTransport> {
  const version = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.version,
  );
  const audience = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.audience,
  );
  const action = boundedHeader(input.headers, BROKER_TRANSPORT_HEADERS.action);
  const bodyHash = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.bodyHash,
  );
  const issuedAt = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.issuedAt,
  );
  const requestId = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.requestId,
  );
  const clientAddress = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.clientAddress,
  );
  const signature = boundedHeader(
    input.headers,
    BROKER_TRANSPORT_HEADERS.signature,
  );

  if (version !== BROKER_TRANSPORT_VERSION || !isBrokerAction(action)) {
    throw new TransportAuthenticationError("transport_malformed");
  }
  if (audience !== BROKER_TRANSPORT_AUDIENCE) {
    throw new TransportAuthenticationError("transport_wrong_audience");
  }
  if (
    input.method !== "POST" ||
    !SHA256_HEX.test(bodyHash) ||
    !/^\d{10}$/.test(issuedAt) ||
    !UUID_V4.test(requestId) ||
    encoder.encode(clientAddress).byteLength > MAX_CLIENT_ADDRESS_BYTES ||
    !validTrustedClientAddress(clientAddress)
  ) {
    throw new TransportAuthenticationError("transport_malformed");
  }

  const current = input.now ?? Math.floor(Date.now() / 1_000);
  const issued = Number(issuedAt);
  if (issued > current + BROKER_TRANSPORT_MAX_FUTURE_SECONDS) {
    throw new TransportAuthenticationError("transport_future_dated");
  }
  if (current - issued > BROKER_TRANSPORT_MAX_AGE_SECONDS) {
    throw new TransportAuthenticationError("transport_expired");
  }

  const observedBodyHash = bytesToHex(await sha256(input.bodyBytes));
  const providedSignature = hexToBytes(signature);
  const expectedSignature = await hmac(
    input.secret,
    canonicalEnvelope({
      method: input.method,
      action,
      bodyHash,
      issuedAt,
      requestId: requestId.toLowerCase(),
      clientAddress,
    }),
  );
  if (
    observedBodyHash !== bodyHash ||
    providedSignature === null ||
    !constantTimeEqual(expectedSignature, providedSignature)
  ) {
    throw new TransportAuthenticationError("transport_authentication_failed");
  }
  return {
    action,
    bodyBytes: input.bodyBytes,
    clientAddress,
    requestId: requestId.toLowerCase(),
  };
}
