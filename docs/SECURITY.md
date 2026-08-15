# Security

Tender's primary boundaries are authenticated identity, organization membership, explicit capabilities, tenant-scoped RLS, constrained database grants, and transactional command functions.

## Runtime credentials

Browser code uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; both are designed for browser use and depend on RLS for safety. The Next.js runtime additionally holds only `TENDER_EDGE_BROKER_TRANSPORT_SECRET` and `TENDER_PUBLIC_SESSION_ENCRYPTION_KEY`; neither grants database access. `TENDER_DEMO_MODE` is a non-secret server configuration flag. `SUPABASE_SERVICE_ROLE_KEY` and a database URL must never be added to Next.js or browser runtime.

The isolated `trusted-public-broker` Supabase Edge Function is the sole runtime permitted to receive `SUPABASE_SERVICE_ROLE_KEY`. It authenticates the signed Next transport before using that credential for its four fixed broker RPCs; it must never be exposed through the browser, Next.js, build inputs, or logs.

The guarded cloud demo command accepts a database URL only from the invoking operator's environment. It does not print or persist it, requires an allowlisted direct project host plus a repeated confirmation value, performs no truncation, and is not part of migration deployment.

## Public demo access

For a public deployment, set `TENDER_DEMO_MODE=true` and disable email signup in hosted Supabase Auth. The application then removes signup entry points, redirects the signup page, and rejects the signup Server Action before it calls Auth. Demo credentials are created and distributed privately; no hosted credential belongs in this repository. The seeded demo user ends with the `manager` role, not organization admin.

## Reporting

This project has not been independently penetration-tested and is not approved for real personal or commercial data. After the GitHub repository exists, report suspected vulnerabilities with a private GitHub Security Advisory. Include affected routes/functions, reproduction steps, impact, and any suggested mitigation; do not include real secrets or customer data.

## Maintainer checks

- Review dependency advisories and exploit preconditions rather than assuming every transitive advisory is reachable.
- Run the tracked-file and built-client secret scan after every production build.
- Keep Supabase Auth site/redirect URLs exact and disable unused providers.
- Recheck table grants, RLS policies, function execution grants, and composite tenant keys after schema changes.
- Rotate and revoke any credential that reaches source, logs, screenshots, or issue content.
