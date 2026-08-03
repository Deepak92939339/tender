import { normalizeSupportedCurrency } from "./currency";

export function formatMinor(
  amountMinor: number,
  currencyCode: string,
  locale = "en-IN",
) {
  if (!Number.isSafeInteger(amountMinor))
    throw new Error("Money amount must be a safe integer.");
  const supportedCurrency = normalizeSupportedCurrency(currencyCode);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: supportedCurrency,
      currencyDisplay: "code",
    }).format(amountMinor / 100);
  } catch {
    return `${supportedCurrency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function parseDecimalMinor(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
