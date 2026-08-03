export const ORGANIZATION_SETTINGS_RESULTS = {
  organization_saved: "Organization settings were saved.",
  tax_profile_created: "Tax profile was created.",
  tax_profile_updated: "Tax profile was updated.",
  tax_profile_archived: "Tax profile was archived.",
  invalid_input:
    "Nothing changed. Correct the highlighted settings and try again.",
  stale_record:
    "Nothing changed. This record was updated elsewhere; reload and try again.",
  replacement_required:
    "Nothing changed. Choose an active replacement tax profile for products that use this profile.",
  forbidden: "Nothing changed. Your role cannot manage organization settings.",
  mutation_failed:
    "Nothing changed. The settings update could not be completed. Try again.",
} as const;

export type OrganizationSettingsResultCode =
  keyof typeof ORGANIZATION_SETTINGS_RESULTS;

const successResults = new Set<OrganizationSettingsResultCode>([
  "organization_saved",
  "tax_profile_created",
  "tax_profile_updated",
  "tax_profile_archived",
]);

export function organizationSettingsResultMessage(value: unknown) {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(ORGANIZATION_SETTINGS_RESULTS, value)
  ) {
    return null;
  }

  return ORGANIZATION_SETTINGS_RESULTS[value as OrganizationSettingsResultCode];
}

export function organizationSettingsResultTone(
  value: OrganizationSettingsResultCode,
) {
  return successResults.has(value) ? "success" : "error";
}
