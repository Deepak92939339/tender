# Architecture

Tender is a Next.js App Router application backed by Supabase Auth, PostgreSQL, and the Supabase Data API.

## Request and trust boundaries

1. Browser components collect user intent and may calculate a responsive preview.
2. Server Components and Server Actions use the signed-in user's Supabase session with the public URL and anon key.
3. PostgreSQL RLS scopes reads to active organization membership.
4. Security-definer command functions resolve the signed-in actor, check explicit capabilities, validate payload shape and bounds, lock relevant records, enforce optimistic versions, recalculate commercial values, mutate state, and write command/activity records atomically.

Client-supplied organization, role, actor, totals, state, version outcome, tax, currency consistency, thresholds, and snapshots are never treated as authority.

## Commercial model

- Money is stored as integer minor units.
- Discounts and tax rates use basis points.
- Quantities use a scaled integer plus an allowed scale.
- Quote item/customer/seller values are snapshotted at the relevant workflow boundary.
- The database calculator is authoritative; the TypeScript kernel is a preview and is parity-tested with 5,000 deterministic cases.

Draft creation and saving are distinct from submission. Submission either enters `waiting` when the discount exceeds the organization threshold or becomes `approved` through the automatic rule. A capable manager may approve or reject a waiting quote. Issuance is a separate command that captures seller identity. Expiry is derived from `valid_until` in the organization's IANA timezone; `expired` is not persisted as a workflow mutation.

## Data ownership

Every organization-owned relationship includes `organization_id`, with composite foreign keys where a child points to another tenant-owned record. Exposed application tables use RLS. Role/capability dictionaries are explicit, and page-level checks complement—not replace—database enforcement.

## Concurrency and auditability

Commands use UUID identifiers and scoped request hashes for safe replay. Version checks prevent stale overwrites, while transaction/advisory locks serialize conflicting decisions. Quote activity records successful commercial transitions and is append-only to application roles.
