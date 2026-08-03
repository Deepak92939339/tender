import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cli = join(root, "node_modules", ".bin", "supabase");
const destination = join(root, ".env.local");

const output = execFileSync(cli, ["status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
});
const values = Object.fromEntries(
  output
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

if (!values.API_URL || !values.ANON_KEY) {
  throw new Error("Local Supabase is not ready; run npm run db:start first.");
}

const managed = [
  "# Generated from local Supabase. This ignored file contains browser-safe local values only.",
  `NEXT_PUBLIC_SUPABASE_URL=${values.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${values.ANON_KEY}`,
  "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000",
  "",
].join("\n");

if (existsSync(destination)) {
  const current = readFileSync(destination, "utf8");
  const unmanaged = current
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("NEXT_PUBLIC_SUPABASE_") &&
        !line.startsWith("NEXT_PUBLIC_APP_URL="),
    )
    .join("\n")
    .trim();
  writeFileSync(
    destination,
    unmanaged ? `${managed}\n${unmanaged}\n` : managed,
    { mode: 0o600 },
  );
} else {
  writeFileSync(destination, managed, { mode: 0o600 });
}

chmodSync(destination, 0o600);
console.log(
  "Local browser-safe Supabase configuration written to ignored .env.local (values not printed).",
);
