import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/auth/return-to";

describe("protected return targets", () => {
  it("preserves canonical quote and customer deep links", () => {
    expect(safeReturnTo("/quotes/TND-2026-0041")).toBe("/quotes/TND-2026-0041");
    expect(
      safeReturnTo("/customers/7cb3d19f-4f04-4f4d-a04f-47975d687a6b"),
    ).toBe("/customers/7cb3d19f-4f04-4f4d-a04f-47975d687a6b");
  });

  it("rejects external, protocol-relative, malformed and unknown destinations", () => {
    expect(safeReturnTo("https://example.test/steal")).toBe("/quotes");
    expect(safeReturnTo("//example.test/steal")).toBe("/quotes");
    expect(safeReturnTo("/operations")).toBe("/quotes");
  });
});
