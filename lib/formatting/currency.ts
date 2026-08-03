export const SUPPORTED_CURRENCY_CODES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "RUB",
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export function isSupportedCurrency(
  value: string,
): value is SupportedCurrencyCode {
  return SUPPORTED_CURRENCY_CODES.includes(value as SupportedCurrencyCode);
}

export function normalizeSupportedCurrency(
  value: string,
): SupportedCurrencyCode {
  const normalized = value.trim().toUpperCase();
  if (!isSupportedCurrency(normalized)) {
    throw new RangeError(`Unsupported currency: ${normalized || "(empty)"}.`);
  }
  return normalized;
}
