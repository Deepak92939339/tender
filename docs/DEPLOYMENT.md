# Deployment preparation

This document prepares a Vercel + Supabase deployment; it does not authorize creating or changing remote resources.

## 1. Supabase project

Create a dedicated, disposable portfolio-demo project. Record its 20-character project reference without committing credentials. From a trusted operator machine:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
```

Review the dry-run migration list before applying it. `supabase/seed.sql` is for local reset only and is not deployed by `db push`; never run `npm run db:reset` against a linked or hosted project.

In Supabase Auth URL Configuration, set Site URL to the final HTTPS Vercel production URL. Add only the exact production callback/base URL actually needed; add explicit preview URLs only if preview authentication is intentionally supported. Disable email signup for the public demo, keep anonymous sign-in disabled, and disable unused providers.

## 2. Demo identity and data

Create one dedicated Auth user with a strong unique password stored outside source. Copy only its UUID into the invoking shell. Replace the placeholder in `supabase/demo/project-allowlist.json` with the real project reference and follow [Demo data](DEMO_DATA.md). Do not use a personal account.

## 3. Vercel application

Import the future public GitHub repository as a Next.js project. The Node 24 runtime is declared in `package.json` and `.nvmrc`; no `vercel.json` is required.

Set these runtime variables for Production (and Preview only if previews should work):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `TENDER_DEMO_MODE=true`

Do not add `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` to Vercel.

## 4. Isolated public broker Edge Function

The browser and Next.js/Vercel runtime remain limited to public Supabase configuration. Deploy `supabase/functions/trusted-public-broker` separately as a public Supabase Edge Function and configure its Edge-only secret:

- `PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET`

The Supabase Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role credential is permitted only inside this function and only for its fixed calls to `broker_open_quote`, `broker_record_quote_event`, `broker_accept_quote`, and `broker_verify_quote`. Never copy it into Vercel, Next.js, browser code, environment examples, build arguments, or logs. The deployment ingress must overwrite the trusted client-address headers used by the function before requests reach the Edge runtime.

Keep JWT verification disabled for this deliberately public function; the raw share secret or verification code is the public capability, while PostgreSQL remains authoritative for token validation, rate limits, idempotency, effective state, and revision-scoped terminal responses. Confirm after deployment that direct `anon` and `authenticated` PostgREST calls to all four broker RPCs remain denied.

## 5. Preflight and smoke test

Before deployment, run `npm ci`, `npm run verify`, and a production build with the intended demo flag. After deployment:

1. Confirm the landing page and sign-in page load over HTTPS.
2. Confirm signup calls to action are absent and `/create-account` redirects to sign-in.
3. Confirm unauthenticated `/quotes` and `/settings/organization` requests redirect with a safe local return target.
4. Sign in with the privately held demo credential and inspect quotes, customers, catalog, approvals, and settings denial for the manager role.
5. Open an issued quote and verify the issued-only print view and captured seller/customer snapshots.
6. Attempt a direct Auth signup and confirm hosted Supabase rejects it.
7. Review Vercel logs without recording credentials or database URLs.

## Rollback and recovery

This is a disposable portfolio demo. Roll back application code by promoting the prior known-good Vercel deployment. Database migrations are forward-only; before applying a new migration, use the hosted backup capability appropriate to the selected Supabase plan. For a release-candidate failure, prefer recreating a clean demo project, reapplying reviewed migrations, and deliberately reseeding rather than running a generic destructive reset against a hosted URL.
