import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  canonicalizeCalculationDocumentV1,
  canonicalizeQuoteSnapshotV1,
} from "../lib/quotes/canonical-snapshot.ts";
import { canonicalV1Vectors } from "../tests/fixtures/canonical-v1-vectors.ts";

const container = "supabase_db_tender-local-visual-study";
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function postgresCanonical(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  const sql = `select encode(public.canonical_json_v1(convert_from(decode('${payload}','base64'),'UTF8')::jsonb),'base64');`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return Buffer.from(result.stdout.trim(), "base64");
}

function currencyExponent(currency: string) {
  const sql = `select public.currency_minor_unit_exponent('${currency}');`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

for (const vector of canonicalV1Vectors) {
  const calculation = canonicalizeCalculationDocumentV1(vector.calculation);
  const snapshot = canonicalizeQuoteSnapshotV1(vector.snapshot);
  const pgCalculation = postgresCanonical({
    ...vector.calculation,
    items: [...vector.calculation.items].sort(
      (left, right) => left.position - right.position,
    ),
    charges: [...vector.calculation.charges].sort(
      (left, right) => left.position - right.position,
    ),
  });
  const pgSnapshot = postgresCanonical({
    ...vector.snapshot,
    items: [...vector.snapshot.items].sort(
      (left, right) => left.position - right.position,
    ),
    charges: [...vector.snapshot.charges].sort(
      (left, right) => left.position - right.position,
    ),
    approval_policy: {
      ...vector.snapshot.approval_policy,
      reason_codes: [
        ...new Set(
          vector.snapshot.approval_policy.reason_codes.map((code) =>
            code.normalize("NFC"),
          ),
        ),
      ].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    },
  });
  assert.deepEqual(
    pgCalculation,
    Buffer.from(calculation, "utf8"),
    `${vector.name}: calculation bytes`,
  );
  assert.deepEqual(
    pgSnapshot,
    Buffer.from(snapshot, "utf8"),
    `${vector.name}: snapshot bytes`,
  );
  assert.equal(
    hash(calculation),
    vector.expectedCalculationHash,
    `${vector.name}: calculation hash`,
  );
  assert.equal(
    hash(snapshot),
    vector.expectedSnapshotHash,
    `${vector.name}: snapshot hash`,
  );
  assert.equal(
    vector.snapshot.calculation.fingerprint,
    vector.expectedCalculationHash,
    `${vector.name}: fingerprint`,
  );
  assert.equal(
    currencyExponent(vector.calculation.currency_code),
    vector.currencyExponent,
    `${vector.name}: exponent`,
  );
}

console.log(
  `PASS ${canonicalV1Vectors.length} canonical v1 golden vectors are byte-identical in TypeScript and PostgreSQL.`,
);
