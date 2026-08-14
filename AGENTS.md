# Automated contributor guide

- Treat `supabase/migrations/` as the database source of truth and preserve migration order.
- Preserve tenant-scoped RLS, composite organization foreign keys, capability checks, and PostgreSQL commercial invariants.
- Use integer minor money, basis points, and scaled integer quantities. The TypeScript calculator is preview-only and must stay parity-tested against PostgreSQL.
- Never trust client totals, role, organization, actor, version, snapshot, tax, threshold, state, or currency consistency.
- Keep Approved, Issued, and Delivered semantically distinct. Quote activity is append-only.
- Never expose a service-role key or database URL to browser or Next.js code. Browser/Next.js runtime uses only the public Supabase URL/key and an optional server-only demo-mode flag. The isolated `trusted-public-broker` Supabase Edge Function may read the service-role credential only to invoke its four fixed broker RPCs; it must derive rate-limit subjects with its Edge-only HMAC secret.
- Never run `supabase/seed.sql` or the cloud demo seed against an unverified target. The cloud seed must retain its allowlist, direct-host, confirmation, and one-time guards.
- Run formatting, lint, typecheck, unit tests, build, and focused tests for changed behavior. Run `npm run verify` only against the confirmed disposable local Supabase project.
