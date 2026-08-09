export const SUPPORTED_CURRENCY_CODES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "RUB",
  "CAD",
  "KWD",
  "JPY",
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const CURRENCY_MINOR_UNIT_EXPONENTS = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  RUB: 2,
  CAD: 2,
  KWD: 3,
  JPY: 0,
} as const satisfies Record<SupportedCurrencyCode, 0 | 2 | 3>;

export function isSupportedCurrency(
  value: string,
): value is SupportedCurrencyCode {
  return SUPPORTED_CURRENCY_CODES.includes(value as SupportedCurrencyCode);
}

export function currencyMinorUnitExponent(value: string) {
  return CURRENCY_MINOR_UNIT_EXPONENTS[normalizeSupportedCurrency(value)];
}

export function currencyMinorUnitScale(value: string) {
  return 10 ** currencyMinorUnitExponent(value);
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
