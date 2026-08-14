import type { TrustedClientAddress } from "../../../lib/public-quotes/transport.ts";

const encoder = new TextEncoder();

export async function deriveRateLimitSubject(
  clientAddress: TrustedClientAddress,
  hmacSecret: string,
) {
  if (encoder.encode(hmacSecret).byteLength < 32) {
    throw new Error(
      "The Edge rate-limit HMAC secret is not configured safely.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`trusted-public-broker:v2\0${clientAddress}`),
  );
  return new Uint8Array(digest);
}
