export type QuoteState =
  "draft" | "waiting" | "approved" | "rejected" | "issued" | "expired";

export function dateInTimeZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day)
    throw new RangeError("Unable to derive the organization-local date.");
  return `${year}-${month}-${day}`;
}

export function addDaysToIsoDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(days)) {
    throw new RangeError("ISO date and integer day offset are required.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function effectiveQuoteState(
  storedState: QuoteState,
  validUntil: string,
  timeZone: string,
  instant = new Date(),
): QuoteState {
  if (
    (storedState === "draft" ||
      storedState === "waiting" ||
      storedState === "approved") &&
    dateInTimeZone(instant, timeZone) > validUntil
  ) {
    return "expired";
  }
  return storedState;
}

export function quoteStateLabel(state: QuoteState) {
  if (state === "waiting") return "Waiting for approval";
  return `${state[0]!.toUpperCase()}${state.slice(1)}`;
}
