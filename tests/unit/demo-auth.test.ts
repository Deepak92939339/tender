import { describe, expect, it } from "vitest";
import { isPublicDemoMode } from "@/lib/auth/demo-mode";
import { isProtectedPath } from "@/lib/auth/route-policy";

describe("public demo authentication policy", () => {
  it("keeps normal signup behavior unless demo mode is explicitly enabled", () => {
    expect(isPublicDemoMode({})).toBe(false);
    expect(isPublicDemoMode({ TENDER_DEMO_MODE: "false" })).toBe(false);
    expect(isPublicDemoMode({ TENDER_DEMO_MODE: " true " })).toBe(true);
  });

  it("fails closed on an invalid demo mode value", () => {
    expect(() => isPublicDemoMode({ TENDER_DEMO_MODE: "yes" })).toThrow(
      "TENDER_DEMO_MODE must be either true or false.",
    );
  });

  it("protects settings and the established application routes", () => {
    for (const path of [
      "/quotes",
      "/approvals/queue",
      "/catalog",
      "/customers/123",
      "/help",
      "/onboarding",
      "/settings",
      "/settings/organization",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/settings-public")).toBe(false);
  });
});
