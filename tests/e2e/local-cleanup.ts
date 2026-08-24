import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { waitForLocalSupabaseReadiness } from "./local-readiness.ts";

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

function assertVerifiedLocalTarget() {
  const supabase = join(process.cwd(), "node_modules", ".bin", "supabase");
  if (!existsSync(supabase))
    throw new Error("Local Supabase CLI is unavailable.");

  const status = JSON.parse(run(supabase, ["status", "-o", "json"])) as {
    DB_URL?: string;
    API_URL?: string;
    ANON_KEY?: string;
  };
  if (!status.DB_URL) throw new Error("Local database URL is unavailable.");
  const database = new URL(status.DB_URL);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(database.hostname) ||
    database.port !== "54322"
  ) {
    throw new Error("E2E cleanup refuses a non-loopback database target.");
  }

  const identity = run("docker", [
    "inspect",
    "--format",
    '{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}',
    container,
  ]).trim();
  if (identity !== `/${container}|${project}`) {
    throw new Error("E2E cleanup local container identity is invalid.");
  }
  if (!status.API_URL || !status.ANON_KEY) {
    throw new Error("Local Supabase API values are unavailable.");
  }
  return { supabase, apiUrl: status.API_URL, anonKey: status.ANON_KEY };
}

export default async function cleanupLocalE2EData() {
  const { supabase, apiUrl, anonKey } = assertVerifiedLocalTarget();
  // The suite intentionally exercises lifecycle, XSS and CSV-injection records.
  // A guarded local reset is the only complete cleanup compatible with append-only
  // quote activity and issued-revision retention. It also runs after test failures.
  run(supabase, ["db", "reset", "--local"]);
  await waitForLocalSupabaseReadiness(apiUrl, anonKey);
}
