import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "db:reset"]],
  ["npm", ["run", "test:db"]],
  ["npm", ["run", "db:types"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test:unit"]],
  ["npm", ["run", "test:parity"]],
  ["npm", ["run", "test:concurrency"]],
  ["npm", ["run", "test:decisions"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:e2e"]],
  ["npm", ["run", "test:secrets"]],
];

function waitForAuthHealth() {
  console.log("Probing Auth gateway health after db:reset...");
  spawnSync("docker", ["restart", "supabase_kong_tender-local-visual-study"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 20; i++) {
    const res = spawnSync(
      "curl",
      ["-fsS", "http://127.0.0.1:54321/auth/v1/health"],
      { encoding: "utf8" },
    );
    if (res.status === 0 && res.stdout.includes("GoTrue")) {
      console.log("Auth gateway is healthy.");
      return;
    }
    spawnSync("sleep", ["1"]);
  }
}

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(
      `Verification could not start ${command} ${args.join(" ")}: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (args.includes("db:reset")) {
    waitForAuthHealth();
  }
}

console.log("PASS complete Tender Milestone A verification gate.");
