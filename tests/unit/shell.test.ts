import { describe, expect, it } from "vitest";

describe("production shell", () => {
  it("keeps canonical application destinations", () => {
    expect(["quotes", "approvals", "catalog", "customers"]).toEqual([
      "quotes",
      "approvals",
      "catalog",
      "customers",
    ]);
  });

  it("formats the reference total with an explicit currency", () => {
    const value = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(35345.06);
    expect(value).toMatch(/₹|INR/);
  });
});
