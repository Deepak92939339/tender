import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeCalculationDocumentV1,
  canonicalizeQuoteSnapshotV1,
} from "../../lib/quotes/canonical-snapshot";
import { canonicalV1Vectors } from "../fixtures/canonical-v1-vectors";

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("canonical commercial documents v1", () => {
  for (const vector of canonicalV1Vectors) {
    it(vector.name, () => {
      const calculation = canonicalizeCalculationDocumentV1(vector.calculation);
      const snapshot = canonicalizeQuoteSnapshotV1(vector.snapshot);
      expect(hash(calculation)).toBe(vector.expectedCalculationHash);
      expect(vector.snapshot.calculation.fingerprint).toBe(
        vector.expectedCalculationHash,
      );
      expect(hash(snapshot)).toBe(vector.expectedSnapshotHash);
      expect(Buffer.from(snapshot, "utf8").toString("utf8")).toBe(snapshot);
    });
  }

  it("rejects non-integer and unsafe numeric authority", () => {
    expect(() =>
      canonicalizeCalculationDocumentV1({
        ...canonicalV1Vectors[0]!.calculation,
        discount_bps: 0.5,
      }),
    ).toThrow("safe integer");
    expect(() =>
      canonicalizeCalculationDocumentV1({
        ...canonicalV1Vectors[0]!.calculation,
        discount_bps: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow("safe integer");
  });

  it("rejects missing, unknown, unsupported, and invalid-version fields", () => {
    const missing = structuredClone(canonicalV1Vectors[0]!.snapshot) as Record<
      string,
      unknown
    >;
    delete missing.totals;
    expect(() => canonicalizeQuoteSnapshotV1(missing)).toThrow(
      "snapshot.totals is required",
    );

    const unknown = {
      ...canonicalV1Vectors[0]!.calculation,
      browser_total: 1,
    };
    expect(() => canonicalizeCalculationDocumentV1(unknown)).toThrow(
      "calculation.browser_total is not supported",
    );

    const unsupported = structuredClone(canonicalV1Vectors[0]!.snapshot);
    (unsupported.commercial as Record<string, unknown>).notes = undefined;
    expect(() => canonicalizeQuoteSnapshotV1(unsupported)).toThrow(
      "snapshot.commercial.notes must be a string",
    );

    expect(() =>
      canonicalizeCalculationDocumentV1({
        ...canonicalV1Vectors[0]!.calculation,
        format_version: 2,
      }),
    ).toThrow("unsupported format version");
  });

  it("rejects duplicate NFC-normalized keys and duplicate positions", () => {
    const normalizedCollision = {
      ...canonicalV1Vectors[0]!.snapshot,
      "cafe\u0301": true,
      café: false,
    };
    expect(() => canonicalizeQuoteSnapshotV1(normalizedCollision)).toThrow(
      "duplicate object keys after NFC normalization",
    );

    const duplicatePosition = structuredClone(
      canonicalV1Vectors[3]!.calculation,
    );
    duplicatePosition.items[1]!.position = duplicatePosition.items[0]!.position;
    expect(() => canonicalizeCalculationDocumentV1(duplicatePosition)).toThrow(
      "positions must be positive and unique",
    );
  });
});
