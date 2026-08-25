# Cloud demo data

`supabase/seed.sql` is the predictable local verification seed. It is configured only for local `supabase db reset` and must never be applied to a hosted project.

The separate `supabase/demo/seed-cloud-demo.sql` creates a one-time fictional dataset through Tender's command functions: 14 products, 6 customers, and 14 quotes with draft, submitted/waiting, automatic and manual approval, rejection, issuance, and date-derived expiry evidence. Quote lines, tax/discount calculations, submission snapshots, seller snapshots, command receipts, and activity are produced by the authoritative database workflow where practical.

## Guards

The wrapper `scripts/seed-cloud-demo.mjs`:

- defaults to a no-connection preview;
- requires a real 20-character reference present in `project-allowlist.json`;
- accepts only the direct `db.<project-ref>.supabase.co/postgres` target;
- requires the project reference a second time for `--apply`;
- requires a pre-created dedicated Auth user UUID;
- takes the database password only from `SUPABASE_DB_URL` in the operator environment;
- uses one transaction and performs no delete, truncate, or reset;
- makes no changes when its unique demo organization slug already exists;
- ends by assigning the demo user the `manager` role.

The committed allowlist contains only the dedicated disposable portfolio-demo project reference. Preview and apply refuse any other project; rotate that entry deliberately if the demo project is recreated.

## Deliberate invocation

After migrations are applied and the dedicated Auth user exists:

```bash
export TENDER_DEMO_PROJECT_REF=<PROJECT_REF>
export TENDER_DEMO_USER_ID=<AUTH_USER_UUID>
npm run demo:data -- --dry-run
```

Review the SQL and preview. For the one-time apply, set the database URL and repeated confirmation in the same trusted shell, then run:

```bash
export TENDER_DEMO_CONFIRM_PROJECT_REF=<PROJECT_REF>
read -r -s -p "Direct database URL: " SUPABASE_DB_URL
export SUPABASE_DB_URL
npm run demo:data -- --apply
unset SUPABASE_DB_URL
```

Do not store those exported values in repository files, shell history, deployment configuration, screenshots, or logs. Clear them from the shell after use. The script requires an already installed `psql`; it does not install or download tools.
