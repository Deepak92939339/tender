const encoder = new TextEncoder();

function normalizedIpAddress(raw: string) {
  const value = raw.trim();
  const ipv4 = value.split(".");
  if (
    ipv4.length === 4 &&
    ipv4.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  ) {
    return ipv4.map((part) => String(Number(part))).join(".");
  }
  const unbracketed =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!unbracketed.includes(":") || !/^[0-9a-f:.]{2,64}$/i.test(unbracketed)) {
    return null;
  }
  try {
    const hostname = new URL(`http://[${unbracketed}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function trustedClientAddress(headers: Headers) {
  const candidates: Array<[string, string | null]> = [
    ["cf-connecting-ip", headers.get("cf-connecting-ip")],
    ["x-real-ip", headers.get("x-real-ip")],
    ["x-forwarded-for", headers.get("x-forwarded-for")?.split(",")[0] ?? null],
  ];
  for (const [source, raw] of candidates) {
    const value = raw ? normalizedIpAddress(raw) : null;
    if (value) return `${source}:${value}`;
  }
  return "edge:no-client-address";
}

export async function deriveRateLimitSubject(
  request: Request,
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
    encoder.encode(
      `trusted-public-broker:v1\0${trustedClientAddress(request.headers)}`,
    ),
  );
  return new Uint8Array(digest);
}
