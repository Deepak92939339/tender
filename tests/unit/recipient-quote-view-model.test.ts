import { describe, expect, it } from "vitest";
import { canonicalV1Vectors } from "../fixtures/canonical-v1-vectors";
import type { BuyerQuoteProjection } from "../../lib/quotes/commitment-contracts";
import { formatMinor } from "../../lib/formatting/money";
import {
  normalizeVerificationCode,
  recipientQuoteViewModel,
} from "../../lib/public-quotes/view-model";

const projection = (currencyVector = 0): BuyerQuoteProjection => ({
  linkId: "10000000-0000-4000-8000-000000000001",
  revisionId: "20000000-0000-4000-8000-000000000001",
  quoteNumber: "TND-2026-0001",
  revisionNumber: 1,
  effectiveState: "issued",
  snapshotHash: "a".repeat(64),
  calculationFingerprint: "b".repeat(64),
  snapshot: canonicalV1Vectors[currencyVector]!.snapshot,
  responseType: null,
  acceptanceAllowed: true,
  acceptanceStatementVersion: 1,
  acceptanceStatement:
    "I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.",
});

describe("recipient quote view model", () => {
  it("maps only the authoritative projection and preserves separate state and response", () => {
    const view = recipientQuoteViewModel(projection());
    expect(view.effectiveState).toBe("issued");
    expect(view.responseType).toBeNull();
    expect(view.quoteNumber).toBe("TND-2026-0001");
  });

  it.each([0, 1, 2])(
    "uses the shared currency exponent formatter for vector %i",
    (index) => {
      const view = recipientQuoteViewModel(projection(index));
      expect(view.totals.total).toContain(view.currencyCode);
      expect(view.totals.total).toBe(
        formatMinor(
          projection(index).snapshot.totals.total_minor,
          view.currencyCode,
          view.locale,
        ),
      );
    },
  );
});

describe("public verification normalization", () => {
  it("normalizes whitespace and lowercase hexadecimal to the contract form", () => {
    expect(
      normalizeVerificationCode("abcd ef01 2345 6789 abcd ef01 2345 6789"),
    ).toBe("ABCDEF0123456789ABCDEF0123456789");
  });

  it.each(["A".repeat(31), "G".repeat(32), "A".repeat(33)])(
    "rejects invalid verification input",
    (value) => {
      expect(normalizeVerificationCode(value)).toBeNull();
    },
  );
});
