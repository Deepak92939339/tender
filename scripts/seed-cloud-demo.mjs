import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const allowlistPath = fileURLToPath(
  new URL("../supabase/demo/project-allowlist.json", import.meta.url),
);
const seedPath = fileURLToPath(
  new URL("../supabase/demo/seed-cloud-demo.sql", import.meta.url),
);
const args = new Set(process.argv.slice(2));

if ([...args].some((value) => !["--apply", "--dry-run"].includes(value))) {
  throw new Error("Usage: npm run demo:data -- [--dry-run|--apply]");
}
if (args.has("--apply") && args.has("--dry-run")) {
  throw new Error("Choose either --dry-run or --apply, not both.");
}

const projectRef = process.env.TENDER_DEMO_PROJECT_REF?.trim() ?? "";
const userId = process.env.TENDER_DEMO_USER_ID?.trim() ?? "";
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const allowedRefs = Array.isArray(allowlist.projectRefs)
  ? allowlist.projectRefs.filter(
      (value) =>
        typeof value === "string" &&
        !value.startsWith("REPLACE_") &&
        /^[a-z0-9]{20}$/.test(value),
    )
  : [];

if (!/^[a-z0-9]{20}$/.test(projectRef) || !allowedRefs.includes(projectRef)) {
  throw new Error(
    "Refusing demo data: TENDER_DEMO_PROJECT_REF is not a recognized entry in supabase/demo/project-allowlist.json.",
  );
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId,
  )
) {
  throw new Error(
    "TENDER_DEMO_USER_ID must identify the pre-created, dedicated demo Auth user.",
  );
}

console.log(`Demo project recognized: ${projectRef}.`);
console.log(
  "Preview: one fictional organization, 14 products, 6 customers, and 14 quotes; no deletes or truncation.",
);
console.log(
  "Quote lifecycle mix: draft, submitted/waiting, approved, rejected, issued, and date-derived expired.",
);

if (!args.has("--apply")) {
  console.log(
    "DRY RUN only. Re-run with --apply after reviewing the SQL and guard inputs.",
  );
  process.exit(0);
}

if (process.env.TENDER_DEMO_CONFIRM_PROJECT_REF !== projectRef) {
  throw new Error(
    "Refusing demo data: TENDER_DEMO_CONFIRM_PROJECT_REF must exactly match the allowlisted project reference.",
  );
}

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required only for --apply.");
}

let target;
try {
  target = new URL(databaseUrl);
} catch {
  throw new Error("SUPABASE_DB_URL is not a valid URL.");
}
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  target.hostname !== `db.${projectRef}.supabase.co` ||
  target.pathname !== "/postgres" ||
  target.search ||
  target.hash
) {
  throw new Error(
    "Refusing demo data: SUPABASE_DB_URL must be the direct database URL for the allowlisted project and database /postgres.",
  );
}

const psqlCheck = spawnSync("psql", ["--version"], { encoding: "utf8" });
if (psqlCheck.status !== 0) {
  throw new Error(
    "psql is required to apply cloud demo data; no tool was installed.",
  );
}

const result = spawnSync(
  "psql",
  [
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    `--set=demo_user_id=${userId}`,
    `--file=${seedPath}`,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PGHOST: target.hostname,
      PGPORT: target.port || "5432",
      PGUSER: decodeURIComponent(target.username),
      PGPASSWORD: decodeURIComponent(target.password),
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("PASS one-time cloud demo data transaction applied.");
