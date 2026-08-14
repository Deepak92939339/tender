import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const trackedEnv = tracked.filter(
  (path) => basename(path) === ".env" || basename(path).startsWith(".env."),
);
const unexpectedEnv = trackedEnv.filter(
  (path) =>
    basename(path) !== ".env.example" && !basename(path).endsWith(".example"),
);
if (unexpectedEnv.length)
  throw new Error(
    `Tracked environment files are forbidden: ${unexpectedEnv.join(", ")}`,
  );

const rawPatterns = [
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sb_secret_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/,
];
const assignedSecret =
  /\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|TENDER_EDGE_BROKER_TRANSPORT_SECRET|TENDER_PUBLIC_SESSION_ENCRYPTION_KEY|PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET|FRIDAY_GATEWAY_SECRET|FRIDAY_N8N_WEBHOOK_SECRET|N8N_[A-Z0-9_]*SECRET)[\t ]*=[\t ]*([^\s#]*)/g;
const placeholders = new Set([
  "",
  "replace_me",
  "placeholder",
  "example",
  "changeme",
]);
const findings = [];
let textFiles = 0;

for (const path of tracked) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) continue;
  if (statSync(absolute).size > 2_000_000) continue;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const source = buffer.toString("utf8");
  textFiles += 1;
  for (const pattern of rawPatterns)
    if (pattern.test(source))
      findings.push(`${path}: raw credential/token pattern`);
  for (const match of source.matchAll(assignedSecret)) {
    const value = match[1].replace(/^['"]|['"]$/g, "").toLowerCase();
    if (!placeholders.has(value))
      findings.push(`${path}: assigned ${match[0].split("=")[0].trim()}`);
  }
}

const clientFiles = [];
function collectClientFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) collectClientFiles(absolute);
    else clientFiles.push(absolute);
  }
}

const clientRoot = join(root, ".next", "static");
collectClientFiles(clientRoot);
for (const path of clientFiles) {
  const source = readFileSync(path, "utf8");
  if (
    /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|TENDER_EDGE_BROKER_TRANSPORT_SECRET|TENDER_PUBLIC_SESSION_ENCRYPTION_KEY|PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET|postgres(?:ql)?:\/\/|sb_secret_|ghp_|github_pat_|xox[baprs]-/.test(
      source,
    )
  ) {
    findings.push(
      `${path.slice(root.length + 1)}: server-only credential marker in browser bundle`,
    );
  }
}

if (findings.length)
  throw new Error(`Secret verification failed:\n${findings.join("\n")}`);
console.log(
  `PASS tracked environment files are examples only (${trackedEnv.join(", ") || "none"}).`,
);
console.log(
  `PASS ${textFiles} tracked text files contain no assigned credential or raw token pattern.`,
);
console.log(
  `PASS ${clientFiles.length} built client assets contain no server-only key, database URL, or raw token marker.`,
);
