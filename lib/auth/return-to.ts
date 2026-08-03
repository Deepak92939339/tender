const allowed = [
  /^\/quotes(?:\/new|\/[A-Za-z0-9-]+)?$/,
  /^\/approvals$/,
  /^\/catalog$/,
  /^\/customers(?:\/[A-Za-z0-9-]+)?$/,
  /^\/onboarding$/,
];

export function safeReturnTo(
  value: FormDataEntryValue | string | null | undefined,
) {
  if (
    typeof value !== "string" ||
    value.length > 300 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/quotes";
  }
  return allowed.some((pattern) => pattern.test(value)) ? value : "/quotes";
}
