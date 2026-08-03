import { describe, expect, it } from "vitest";
import {
  dateInTimeZone,
  effectiveQuoteState,
  quoteStateLabel,
} from "@/lib/quotes/effective-state";

describe("organization-timezone quote expiry", () => {
  it("derives the organization-local ISO date", () => {
    expect(
      dateInTimeZone(new Date("2026-07-23T18:29:59Z"), "Asia/Kolkata"),
    ).toBe("2026-07-23");
    expect(
      dateInTimeZone(new Date("2026-07-23T18:30:00Z"), "Asia/Kolkata"),
    ).toBe("2026-07-24");
  });

  it("keeps a quotation valid through the end of valid_until", () => {
    expect(
      effectiveQuoteState(
        "draft",
        "2026-07-23",
        "Asia/Kolkata",
        new Date("2026-07-23T18:29:59Z"),
      ),
    ).toBe("draft");
  });

  it.each(["draft", "waiting", "approved"] as const)(
    "derives expired from stored %s after the local boundary",
    (state) => {
      expect(
        effectiveQuoteState(
          state,
          "2026-07-23",
          "Asia/Kolkata",
          new Date("2026-07-23T18:30:00Z"),
        ),
      ).toBe("expired");
    },
  );

  it.each(["issued", "rejected"] as const)(
    "never expires stored %s",
    (state) => {
      expect(
        effectiveQuoteState(
          state,
          "2001-01-01",
          "UTC",
          new Date("2026-07-23T00:00:00Z"),
        ),
      ).toBe(state);
    },
  );

  it("uses one semantic state label", () => {
    expect(quoteStateLabel("waiting")).toBe("Waiting for approval");
    expect(quoteStateLabel("expired")).toBe("Expired");
  });
});
