# Tender

Tender is a multi-tenant commercial quotation application for preparing priced offers, routing discount decisions, and issuing an accountable customer-facing record. It demonstrates how a compact B2B workflow can keep tenant isolation, exact money, approval policy, lifecycle transitions, and audit activity inside one coherent system.

> Live demo: **[tender-eta-orpin.vercel.app](https://tender-eta-orpin.vercel.app)**

## Release-candidate status

The current public-release candidate is local only: branch `feat/issuer-share-link-ui`, checkpoint `4f8686e60f976769dd154fee2eea226ebf7bcfc0`. No Supabase project or Vercel deployment has been created or changed from this repository state. The application currently has 13 App Router pages, 29 ordered migrations, 23 pgTAP files, 22 unit-test files, and 22 Playwright spec files.

## What it demonstrates

- Authenticated organizations with role/capability checks and tenant-scoped row-level security (RLS).
- Catalog, customer, draft quote, approval/rejection, issuance, and issued-only print flows.
- Integer minor-unit money, basis-point rates, and scaled integer quantities.
- Optimistic concurrency, idempotent command receipts, immutable submission/issuance snapshots, and append-only quote activity.
- Exact parity checks between the PostgreSQL commercial calculator and the TypeScript preview calculator.
- Issuer controls to create, list, and revoke recipient capability links for issued revisions; recipients see only the authorized public projection and recorded acceptance evidence.

## Architecture

Tender is a Next.js 16 App Router application using React 19, strict TypeScript, Supabase Auth, PostgreSQL, and the Supabase Data API. Server Components and Server Actions use the browser-safe Supabase URL and publishable/anon key with the signed-in user's session. PostgreSQL RLS and capability-aware functions enforce the tenant and authorization boundary.

Authoritative commercial enforcement is implemented in PostgreSQL because writes can arrive from more than one UI path and must be checked atomically with stored state. The TypeScript calculator makes editing responsive, but the database recalculates and validates persisted totals, currencies, quantities, discounts, taxes, versions, actors, and lifecycle transitions. See [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md).

## Local development

Prerequisites:

- Node.js 24 and npm 11
- Docker Desktop (or another working Docker engine)
- Chrome for the configured Playwright projects

```bash
npm ci
npm run db:start
npm run env:local
npm run db:reset
npm run dev
```

Open `http://127.0.0.1:3000`. `npm run env:local` writes an ignored `.env.local` containing only the local browser-safe Supabase URL and anon key. The local reset seed is synthetic and exists only for automated verification; never apply `supabase/seed.sql` to a hosted project.

## Verification

Run the complete gate only against the repository's disposable local Supabase project:

```bash
npm run verify
```

The complete local gate resets the disposable database, applies migrations and the local seed, runs pgTAP, regenerates database types, runs lint, typecheck, unit and parity checks, concurrency runners, a production build, bounded Playwright shards, and tracked/client-asset secret scans. The final Stage 3 public-candidate evidence recorded:

- Unit: **156/156 passed across 22 files**
- pgTAP: **23 files, 642 assertions passed**
- Calculator parity: **5,000/5,000 deterministic cases matched exactly**
- Concurrency: **40/40 unique quote numbers; one-winner approval decision; commitment races passed**
- Playwright: **all 96 desktop/mobile assignments covered sequentially; 87 passed and 9 intentional project skips**
- Production build: **passed with 13 App Router pages; formatting, ESLint, and TypeScript passed**
- Security and UX: **signed transport, secret scans, clean-demo isolation, and authenticated responsive audit passed**

Individual checks are available as `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:auth`, `npm run test:db`, `npm run test:parity`, `npm run test:concurrency`, `npm run test:decisions`, `npm run build`, `npm run test:e2e`, and `npm run test:secrets`.

## Demo access

Normal local behavior keeps self-service signup enabled. Set the server-only variable `TENDER_DEMO_MODE=true` for a public portfolio deployment. In that mode Tender:

- removes signup calls to action;
- redirects `/create-account` to sign-in;
- rejects the signup Server Action before calling Supabase Auth;
- keeps sign-in available for an invitation-only demo account.

Hosted Supabase email signup must also be disabled in Auth settings. Create a dedicated demo user with a strong unique password outside the repository, seed the fictional dataset using that user's UUID, and share access privately. The cloud seed downgrades the account to the non-admin `manager` role after provisioning. No hosted password belongs in source, documentation, Vercel, or deployment logs.

The cloud demo dataset is separate from the local test seed and never runs during migration deployment. Its allowlist is pinned to the dedicated disposable portfolio-demo project, while application remains a deliberate, guarded, idempotent operator action. See [Demo data](docs/DEMO_DATA.md).

## Deployment

The intended deployment is Vercel for Next.js plus one dedicated Supabase project. Application runtime needs:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `TENDER_DEMO_MODE=true` for the public invitation-only demo
- `TENDER_EDGE_BROKER_TRANSPORT_SECRET` for the server-to-server public broker envelope
- `TENDER_PUBLIC_SESSION_ENCRYPTION_KEY` for the short-lived encrypted recipient session

The transport and session secrets are server-only Next.js runtime values; `TENDER_DEMO_MODE` is a server-only non-secret flag. No service-role key or database URL is used by Next.js or browser runtime. The isolated Supabase Edge broker alone receives the service-role credential for its four fixed RPC calls. The database URL is needed only in the operator's local environment for the deliberately invoked cloud demo-data command. No `vercel.json` is required for the current Next.js deployment. Full preparation, migration dry-run, Auth URL settings, smoke checks, and rollback assumptions are in [Deployment](docs/DEPLOYMENT.md); the verified public release is recorded in [Production deployment evidence](docs/DEPLOYMENT_EVIDENCE.md).

## Current limitations

- This is a portfolio-grade quotation workflow, not a tax, accounting, ERP, or legal-compliance system.
- Issued means the commercial snapshot was finalized; it does not mean delivered to a customer.
- There is no email delivery, generated immutable PDF asset, outbox, retry/DLQ, webhook automation, or external integration layer.
- The demo has one active organization context per user and no membership administration UI.
- Signup mode is deployment configuration; changing it requires a rebuild/redeploy.
- Migrations are forward-only: rollback is a forward fix or a backup-and-restore/recreated-demo decision, not a down-migration command.
- Command receipts retain command payload/result evidence until an operator adopts and documents a retention policy.
- `tax_profiles.price_basis` remains a deprecated compatibility field; quote calculations use the saved quote tax mode and line snapshots.
- Some command functions intentionally lock their aggregate before later authorization/state guards, so rejected contenders can briefly wait rather than bypass serialization.
- Cloud deployment and independent penetration testing have not yet occurred.

## Repository map

| Path                   | Purpose                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `app/`                 | App Router pages and Server Actions                                                |
| `components/`          | Application, auth, quote, settings, and UI components                              |
| `lib/`                 | Auth context, Supabase clients, validation, formatting, and preview calculation    |
| `supabase/migrations/` | Ordered database source of truth                                                   |
| `supabase/tests/`      | pgTAP authorization and invariant tests                                            |
| `supabase/demo/`       | Guarded, deliberately invoked fictional cloud dataset                              |
| `tests/unit/`          | Unit and focused auth-policy tests                                                 |
| `tests/e2e/`           | Desktop/mobile Playwright workflows                                                |
| `scripts/`             | Local environment, parity/concurrency, secret, full-gate, and guarded demo tooling |
| `docs/`                | Architecture, security, deployment, and demo-data guidance                         |

## Security and advisories

This repository is a demonstration application and has not been independently penetration-tested. Do not use it for real commercial or personal data without a separate security, privacy, tax, and operational review. After publication, report suspected vulnerabilities through a private GitHub Security Advisory rather than a public issue. Dependency advisory results are reported from the final local release verification and should not be interpreted as proof that every transitive package is unreachable.

Stage 4 updated the direct Next.js and matching ESLint integration to `16.3.2`, with normal compatible lockfile updates for PostCSS, Sharp, Nanoid, js-yaml, and undici. The final read-only `npm audit --omit=dev` and full `npm audit` both reported **zero vulnerabilities**. This result is point-in-time evidence, not a substitute for reviewing future advisories before deployment.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). No open-source license has been selected. Until the owner chooses one, copyright remains reserved and reuse permission is not granted. Realistic choices include MIT for broad permissive reuse, Apache-2.0 for permissive reuse with an explicit patent grant, or a source-available/custom license when portfolio visibility should not imply unrestricted reuse.
