# Contributing

Thank you for considering a contribution to Tender.

## Before starting

Open an issue for substantial behavior or schema changes so the intended workflow and security boundary are clear. Small bug fixes and documentation corrections can go directly to a focused pull request.

Use Node.js 24 and npm 11. Install the locked dependencies with `npm ci`; do not hand-edit `package-lock.json`.

## Development workflow

1. Create a branch from the current default branch.
2. Keep changes focused and add tests for changed behavior.
3. Preserve RLS, tenant keys, database invariants, capability checks, and optimistic concurrency.
4. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build`.
5. If database or end-to-end behavior changed, confirm the disposable local Supabase/Docker target and run `npm run verify`.

Do not commit environment files, passwords, service-role keys, database URLs, generated build/test output, real customer information, or screenshots containing private data. Never use the local seed or reset commands against a hosted database.

## Pull requests

Explain the problem, the chosen approach, affected security or data boundaries, and the exact checks run. Keep formatting-only work separate from functional changes where practical. A pull request should not weaken a failing test or authorization check to obtain a green result.

## Security reports

Do not disclose a suspected vulnerability in a public issue. Once the repository is hosted, use a private GitHub Security Advisory.

## License

No contribution license or open-source license has been selected yet. Discuss licensing with the repository owner before contributing material that depends on a particular licensing model.
