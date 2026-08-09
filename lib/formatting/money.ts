import {
  currencyMinorUnitExponent,
  currencyMinorUnitScale,
  normalizeSupportedCurrency,
} from "./currency";

export function formatMinor(
  amountMinor: number,
  currencyCode: string,
  locale = "en-IN",
) {
  if (!Number.isSafeInteger(amountMinor))
    throw new Error("Money amount must be a safe integer.");
  const supportedCurrency = normalizeSupportedCurrency(currencyCode);
  const exponent = currencyMinorUnitExponent(supportedCurrency);
  const scale = currencyMinorUnitScale(supportedCurrency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: supportedCurrency,
      currencyDisplay: "code",
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amountMinor / scale);
  } catch {
    return `${supportedCurrency} ${(amountMinor / scale).toFixed(exponent)}`;
  }
}

export function formatMinorDecimal(amountMinor: number, currencyCode: string) {
  if (!Number.isSafeInteger(amountMinor))
    throw new Error("Money amount must be a safe integer.");
  const exponent = currencyMinorUnitExponent(currencyCode);
  return (amountMinor / currencyMinorUnitScale(currencyCode)).toFixed(exponent);
}

export function parseDecimalMinor(value: string, currencyCode = "INR") {
  const normalized = value.trim();
  const exponent = currencyMinorUnitExponent(currencyCode);
  const pattern =
    exponent === 0
      ? /^\d{1,15}$/
      : new RegExp(`^\\d{1,${15 - exponent}}(?:\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const scale = BigInt(currencyMinorUnitScale(currencyCode));
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(exponent, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
