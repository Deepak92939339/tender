import { describe, expect, it } from "vitest";
import {
  isOrganizationSlug,
  organizationSlugFromName,
  organizationSlugSchema,
} from "@/lib/validation/organization";

describe("organization workspace slug", () => {
  it.each([
    ["Landmark Industries", "landmark-industries"],
    ["  Landmark__Industries!  ", "landmark-industries"],
    ["North / South + West", "north-south-west"],
    ["---Landmark---", "landmark"],
  ])("generates %s as %s", (name, expected) => {
    expect(organizationSlugFromName(name)).toBe(expected);
  });

  it("accepts the server contract and rejects domains or email-like values", () => {
    expect(isOrganizationSlug("landmark-industries")).toBe(true);
    expect(organizationSlugSchema.safeParse("landmark-local-123").success).toBe(
      true,
    );
    expect(organizationSlugSchema.safeParse("landmark.org").success).toBe(
      false,
    );
    expect(
      organizationSlugSchema.safeParse("landmark@site123.com").success,
    ).toBe(false);
    expect(organizationSlugSchema.safeParse("Landmark").success).toBe(false);
  });
});
