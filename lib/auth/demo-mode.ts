type Environment = Readonly<Record<string, string | undefined>>;

export function isPublicDemoMode(
  environment: Environment = process.env,
): boolean {
  const value = environment.TENDER_DEMO_MODE?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error("TENDER_DEMO_MODE must be either true or false.");
}
