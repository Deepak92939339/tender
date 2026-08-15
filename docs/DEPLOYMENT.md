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
- `TENDER_EDGE_BROKER_TRANSPORT_SECRET`
- `TENDER_PUBLIC_SESSION_ENCRYPTION_KEY`

The two `TENDER_` values are server-only. The transport secret authenticates only the fixed Next-to-Edge broker envelope and does not grant database access. The session key encrypts and authenticates the short-lived capability cookie. Do not expose either with a `NEXT_PUBLIC_` prefix. Do not add `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, or `PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET` to Vercel.

## 4. Isolated public broker Edge Function

The browser remains limited to public Supabase configuration. Next calls this function only through its signed server-to-server transport. Deploy `supabase/functions/trusted-public-broker` separately and configure these function secrets:

- `TENDER_EDGE_BROKER_TRANSPORT_SECRET` (shared only with the Next server runtime)
- `PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET`

The Supabase Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role credential is permitted only inside this function and only for its fixed calls to `broker_open_quote`, `broker_record_quote_event`, `broker_accept_quote`, and `broker_verify_quote`. Never copy it into Vercel, Next.js, browser code, environment examples, build arguments, or logs. The Edge handler does not read public forwarding headers. It accepts a normalized client-address representation only after authenticating the HMAC envelope from Next.

Keep JWT verification disabled at the Supabase gateway so the HMAC-authenticated service-to-service request can reach the handler. Supabase documents that this makes the gateway route publicly invocable, so the function's signed-envelope check is mandatory and direct unsigned requests must return `401` before database dispatch. PostgreSQL remains authoritative for token validation, selector/code rate buckets, idempotency, effective state, and revision-scoped terminal responses. Confirm after deployment that direct `anon` and `authenticated` PostgREST calls to all four broker RPCs remain denied. See [Supabase Authorization headers](https://supabase.com/docs/guides/functions/auth-headers) and [Function configuration](https://supabase.com/docs/guides/functions/function-configuration).

### Trusted client address

On a direct Vercel deployment, the Next runtime may normalize `x-forwarded-for` only when the documented `VERCEL=1` system marker is present. Vercel documents `x-forwarded-for` as the client's public IP and says it overwrites the header to prevent spoofing. A proxy in front of Vercel changes that guarantee unless Vercel Trusted Proxy is deliberately configured. See [Vercel request headers](https://vercel.com/docs/headers/request-headers) and [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

Local, self-hosted, missing, multi-valued, or malformed address input becomes `unattributed:v1`; the implementation does not fall back to `x-real-ip`, `cf-connecting-ip`, or an arbitrary forwarding chain. Next signs the normalized representation, and Edge uses it only after signature verification. PostgreSQL's selector- and verification-code-specific buckets remain active when the non-IP fallback is used.

### Capability session

The same-origin session exchange stores only the selector, raw share secret, version, and a five-minute absolute expiry in an AES-256-GCM cookie. The cookie is `HttpOnly`, host-only, `SameSite=Strict`, `Secure` in production, and scoped to `/api/public-quotes`. It is not independent authority: every use is revalidated by the broker, so revoked, superseded, expired, accepted, or otherwise terminal link authority stops working immediately and causes the cookie to be cleared. The committed Stage 1 open projection does not expose the link's exact timestamp, so the browser cookie uses the short fixed storage lifetime while PostgreSQL enforces the exact earlier authority cutoff. Current recipient document reloads require reopening the original fragment capability link; cookie-backed document restoration is a documented non-blocking follow-up.

## 5. Preflight and smoke test

Before deployment, run `npm ci`, `npm run verify`, and a production build with the intended demo flag. After deployment:

1. Confirm the landing page and sign-in page load over HTTPS.
2. Confirm signup calls to action are absent and `/create-account` redirects to sign-in.
3. Confirm unauthenticated `/quotes` and `/settings/organization` requests redirect with a safe local return target.
4. Sign in with the privately held demo credential and inspect quotes, customers, catalog, approvals, and settings denial for the manager role.
5. Open an issued quote and verify the issued-only print view and captured seller/customer snapshots.
6. Open a newly created public capability link. Confirm its fragment is removed, the recipient document matches the issued snapshot, and no secret reaches the query string or browser storage.
7. Confirm the exact database-projected acceptance statement appears before acceptance, record one acceptance, and replay its idempotency key without creating duplicate evidence.
8. Verify a valid normalized verification code returns bounded public evidence and invalid codes do not reveal internal data.
9. Confirm direct `anon` and `authenticated` calls to each broker RPC are denied, and an unsigned request to the Edge function returns `401` before database dispatch.
10. Attempt a direct Auth signup and confirm hosted Supabase rejects it.
11. Review Vercel and Edge logs without recording credentials, capability secrets, or database URLs.

## Rollback and recovery

This is a disposable portfolio demo. Roll back application code by promoting the prior known-good Vercel deployment. Database migrations are forward-only; before applying a new migration, use the hosted backup capability appropriate to the selected Supabase plan. For a release-candidate failure, prefer recreating a clean demo project, reapplying reviewed migrations, and deliberately reseeding rather than running a generic destructive reset against a hosted URL.
