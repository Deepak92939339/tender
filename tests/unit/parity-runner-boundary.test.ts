import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runnerSource = readFileSync(
  "scripts/verify-calculation-parity.ts",
  "utf8",
);

describe("authoritative calculation parity boundary", () => {
  it("parity_runner_uses_privileged_local_path", () => {
    expect(runnerSource).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(runnerSource).not.toContain('.rpc("calculate_quote_payload"');
    expect(runnerSource).toContain("docker");
    expect(runnerSource).toContain("psql");
  });

  it("calculation_parity_5000_cases", () => {
    expect(runnerSource).toMatch(/length:\s*5_000/);
    expect(runnerSource).toContain("PASS 5000");
  });
});
