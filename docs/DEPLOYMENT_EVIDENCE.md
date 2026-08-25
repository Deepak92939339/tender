# Production deployment evidence

Verified on 25 August 2026 against the dedicated disposable portfolio-demo environment.

## Release identity

- Public URL: <https://tender-eta-orpin.vercel.app>
- GitHub repository: `Deepak92939339/tender`
- Deployment source commit: `db48eb74fd0ba585bbc6813c98fc9e058f7824ec`
- Stage 4 release-candidate commit: `04b3732e3f73652363f8d96e7d22f8803b4e1a41`
- Supabase project reference: `tjrwqnusxnkcnswbydtn`
- Vercel production deployment reached `READY` and the public alias returned HTTPS `200` without Deployment Protection.

## Hosted backend

- All 29 reviewed migrations were applied to the dedicated project.
- `trusted-public-broker` was deployed with gateway JWT verification disabled as required by the signed server-to-server envelope.
- The transport and rate-limit secret names were present in the Edge environment; no secret value was copied into source or this evidence.
- Hosted email signup is disabled.
- Anonymous and phone sign-in are disabled; email remains enabled for the invitation-only account.
- Auth Site URL and the redirect allowlist contain only `https://tender-eta-orpin.vercel.app`.
- A direct signup probe returned `422` with `Signups not allowed for this instance`.
- An unsigned broker request returned `401` before database dispatch.
- Direct anonymous and authenticated PostgREST calls to all four broker RPC names returned `404`, confirming that neither role receives an exposed RPC route.

## Demo identity and data

- The only hosted Auth identity is the dedicated fictional `demo.manager@tender.example.test` account.
- Its strong random password is stored outside the repository in macOS Keychain under service `Tender Portfolio Demo`; it is absent from source, Vercel, documentation, screenshots, and command output.
- The guarded allowlist and dry-run checks passed before the one-time transactional seed was applied.
- Hosted dataset verification returned one `northstar-industrial-demo` organization, 14 products, 6 customers, and 14 quotes.
- The demo membership ends with the non-admin `manager` role.

## Production smoke

- Public landing and sign-in pages returned `200` over HTTPS.
- `/create-account` redirected to `/sign-in?signup=disabled`.
- Unauthenticated `/quotes` and `/settings/organization` requests redirected to sign-in with safe local return targets.
- The public landing page exposed no signup call to action and no placeholder owner/footer text.
- The Keychain credential signed into the live application and reached `/quotes`.
- Quotes displayed the 14 fictional lifecycle examples without test-fixture or injection-marker records.
- Approvals displayed the two intended waiting-for-decision quotations.
- Catalog displayed 14 plausible products; Customers displayed 6 plausible fictional companies.
- The manager account could open the settings route but received the explicit capability denial instead of editable organization settings.
- Issued quote `TND-2026-0012` displayed the captured customer snapshot and authoritative total of `INR 1,44,963.00`; its print/save action was enabled.
- At a 390 x 844 viewport, Quotes, Catalog, Customers, and Approvals had no page-level horizontal overflow and used the mobile card presentation.

## Release gates inherited from Stage 4

- Unit: 156/156 passed.
- pgTAP: 23 files and 642 assertions passed.
- Calculator parity: 5,000/5,000 passed.
- Sequential Playwright matrix: 96 assignments, 87 passed, 9 intentional project skips.
- Formatting, ESLint, TypeScript, concurrency, signed transport, normal/demo production builds, and secret scans passed.
- Production and full npm audits reported zero vulnerabilities after the exact Next.js 16.3.2 reconciliation.

This remains a disposable portfolio demonstration, not an independently penetration-tested production service. The documented Stage 4 operational limitations remain unchanged.
