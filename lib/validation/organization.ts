import { z } from "zod";

export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export const organizationSlugSchema = z
  .string()
  .trim()
  .regex(
    ORGANIZATION_SLUG_PATTERN,
    "Use 3–64 lowercase letters, numbers or hyphens.",
  );

export function organizationSlugFromName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function isOrganizationSlug(value: string) {
  return ORGANIZATION_SLUG_PATTERN.test(value);
}
