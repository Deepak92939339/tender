export const protectedPaths = [
  "/quotes",
  "/approvals",
  "/catalog",
  "/customers",
  "/onboarding",
  "/settings",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return protectedPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
