const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function encodeBase64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeCanonicalBase64url(
  value: string,
  expectedBytes?: number,
) {
  if (value.length === 0 || value.length % 4 === 1 || !BASE64URL.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(padded);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } catch {
    throw new Error("Invalid base64url value.");
  }
  if (
    (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) ||
    encodeBase64url(bytes) !== value
  ) {
    throw new Error("Invalid base64url value.");
  }
  return bytes;
}

export function isCanonicalBase64url(value: string, expectedBytes?: number) {
  try {
    decodeCanonicalBase64url(value, expectedBytes);
    return true;
  } catch {
    return false;
  }
}
