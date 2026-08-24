import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const project = "tender-local-visual-study";
const container = `supabase_db_${project}`;

function run(command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
  });
}

const supabase = join(process.cwd(), "node_modules", ".bin", "supabase");
if (!existsSync(supabase))
  throw new Error("Local Supabase CLI is unavailable.");
const status = JSON.parse(run(supabase, ["status", "-o", "json"])) as {
  DB_URL?: string;
};
if (!status.DB_URL) throw new Error("Local database URL is unavailable.");
const database = new URL(status.DB_URL);
if (
  !["127.0.0.1", "localhost", "::1"].includes(database.hostname) ||
  database.port !== "54322"
) {
  throw new Error(
    "Isolation verification refuses a non-loopback database target.",
  );
}
const identity = run("docker", [
  "inspect",
  "--format",
  '{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}',
  container,
]).trim();
if (identity !== `/${container}|${project}`) {
  throw new Error(
    "Isolation verification local container identity is invalid.",
  );
}

const result = run("docker", [
  "exec",
  container,
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-AtX",
  "-v",
  "ON_ERROR_STOP=1",
  "-c",
  `select json_build_object(
    'organizations', (select count(*) from public.organizations),
    'customers', (select count(*) from public.customers),
    'products', (select count(*) from public.products),
    'quotes', (select count(*) from public.quotes),
    'e2e_markers', (
      select count(*)
      from public.customers
      where name ilike 'E2E %' or name ilike 'Northstar %' or name ilike 'Snapshot %'
    )
  )::text;`,
]).trim();
const counts = JSON.parse(result) as Record<string, number>;
if (
  counts.organizations !== 2 ||
  counts.customers !== 2 ||
  counts.products !== 3 ||
  counts.quotes !== 0 ||
  counts.e2e_markers !== 0
) {
  throw new Error(`Local reset did not restore the clean demo: ${result}`);
}
console.log(`PASS local E2E cleanup restored the seeded demo: ${result}`);
