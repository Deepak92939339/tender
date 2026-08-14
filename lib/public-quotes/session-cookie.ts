const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const PUBLIC_QUOTE_COOKIE_NAME = "tender-public-quote-v1";
export const PUBLIC_QUOTE_COOKIE_PATH = "/api/public-quotes";
export const PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS = 5 * 60;
export const PUBLIC_QUOTE_COOKIE_MAX_BYTES = 1_024;

const COOKIE_AAD = `${PUBLIC_QUOTE_COOKIE_NAME}\0${PUBLIC_QUOTE_COOKIE_PATH}\0v1`;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_SECRET = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type PublicQuoteCapability = {
  version: 1;
  selector: string;
  secret: string;
  expiresAt: number;
};

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(value: string) {
  if (!BASE64URL.test(value)) throw new Error("Invalid encrypted session.");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error(
      "The public session encryption key must contain at least 32 bytes.",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function validateCapability(
  value: unknown,
  now: number,
): PublicQuoteCapability {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid encrypted session.");
  }
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "expiresAt,secret,selector,version" ||
    row.version !== 1 ||
    typeof row.selector !== "string" ||
    !UUID_V4.test(row.selector) ||
    typeof row.secret !== "string" ||
    !SHARE_SECRET.test(row.secret) ||
    typeof row.expiresAt !== "number" ||
    !Number.isSafeInteger(row.expiresAt) ||
    row.expiresAt <= now ||
    row.expiresAt > now + PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS
  ) {
    throw new Error("Invalid encrypted session.");
  }
  return {
    version: 1,
    selector: row.selector.toLowerCase(),
    secret: row.secret,
    expiresAt: row.expiresAt,
  };
}

export async function encryptPublicQuoteCapability(
  capability: PublicQuoteCapability,
  secret: string,
) {
  validateCapability(
    capability,
    capability.expiresAt - PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS,
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: encoder.encode(COOKIE_AAD),
      },
      await encryptionKey(secret),
      encoder.encode(JSON.stringify(capability)),
    ),
  );
  const token = `v1.${base64url(nonce)}.${base64url(ciphertext)}`;
  if (encoder.encode(token).byteLength > PUBLIC_QUOTE_COOKIE_MAX_BYTES) {
    throw new Error("The encrypted session is too large.");
  }
  return token;
}

export async function decryptPublicQuoteCapability(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
) {
  if (encoder.encode(token).byteLength > PUBLIC_QUOTE_COOKIE_MAX_BYTES) {
    throw new Error("Invalid encrypted session.");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    throw new Error("Invalid encrypted session.");
  }
  try {
    const nonce = fromBase64url(parts[1]);
    const ciphertext = fromBase64url(parts[2]);
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new Error("Invalid encrypted session.");
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: encoder.encode(COOKIE_AAD),
      },
      await encryptionKey(secret),
      ciphertext,
    );
    return validateCapability(
      JSON.parse(decoder.decode(plaintext)) as unknown,
      now,
    );
  } catch {
    throw new Error("Invalid encrypted session.");
  }
}

export function readPublicQuoteCookie(headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie || encoder.encode(cookie).byteLength > 8_192) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === PUBLIC_QUOTE_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function publicQuoteCookieHeader(
  token: string,
  expiresAt: number,
  secure: boolean,
) {
  const attributes = [
    `${PUBLIC_QUOTE_COOKIE_NAME}=${token}`,
    `Path=${PUBLIC_QUOTE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.min(
      PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS,
      Math.max(0, expiresAt - Math.floor(Date.now() / 1_000)),
    )}`,
    `Expires=${new Date(expiresAt * 1_000).toUTCString()}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearPublicQuoteCookieHeader(secure: boolean) {
  return [
    `${PUBLIC_QUOTE_COOKIE_NAME}=`,
    `Path=${PUBLIC_QUOTE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
