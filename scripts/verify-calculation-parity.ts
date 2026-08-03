import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  calculateQuote,
  CHARGE_TYPES,
  CURRENCY_CODES,
  TAX_TREATMENTS,
  UNIT_CODES,
  type QuoteCalculationInput,
} from "../lib/quotes/calculate.ts";

let state = 0x74e6d123;
function random(max: number) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % max;
}

function pick<const T extends readonly unknown[]>(
  values: T,
  index: number,
): T[number] {
  return values[index % values.length]!;
}

function makeCase(caseIndex: number): QuoteCalculationInput {
  const currency = pick(CURRENCY_CODES, random(CURRENCY_CODES.length));
  const taxMode =
    caseIndex % 2 === 0 ? ("exclusive" as const) : ("inclusive" as const);
  const discounts = [0, 1, 999, 1250, 3333, 5000, 9999, 10_000];
  const discount =
    caseIndex % 9 === 0 ? pick(discounts, caseIndex) : random(10_001);
  const items = Array.from({ length: 1 + random(4) }, (_, itemIndex) => {
    const unit = pick(UNIT_CODES, random(UNIT_CODES.length));
    const precision = unit === "EA" || unit === "BOX" ? 0 : random(4);
    const scale = 10 ** precision;
    const rates = [0, 1, 500, 825, 1800, 1900, 2000, 9999, 10_000];
    return {
      position: itemIndex + 1,
      product_id: `case-${caseIndex}-product-${itemIndex}`,
      sku_snapshot: `SKU-${caseIndex}-${itemIndex}`,
      description_snapshot: `Deterministic item ${caseIndex}.${itemIndex}`,
      unit_code_snapshot: unit,
      quantity_precision_snapshot: precision,
      unit_price_minor_snapshot:
        1 + random(caseIndex % 17 === 0 ? 900_000_000 : 2_000_000),
      currency_code: currency,
      quantity_scaled:
        1 + random(unit === "EA" || unit === "BOX" ? 500 : 2_000_000),
      quantity_scale: scale,
      tax_code_snapshot: `T${pick(rates, caseIndex + itemIndex)}`,
      tax_bps_snapshot: pick(rates, caseIndex + itemIndex),
      tax_price_basis_snapshot:
        (caseIndex + itemIndex) % 2
          ? ("inclusive" as const)
          : ("exclusive" as const),
      tax_treatment_snapshot: pick(TAX_TREATMENTS, caseIndex + itemIndex),
    };
  });
  const charges = Array.from({ length: random(4) }, (_, chargeIndex) => {
    const rates = [0, 500, 825, 1800, 1900, 2000, 10_000];
    return {
      position: chargeIndex + 1,
      charge_type: pick(CHARGE_TYPES, caseIndex + chargeIndex),
      description_snapshot: `Deterministic charge ${caseIndex}.${chargeIndex}`,
      amount_minor: random(caseIndex % 23 === 0 ? 9_000_000_000 : 1_000_000),
      currency_code: currency,
      tax_code_snapshot: `C${pick(rates, caseIndex + chargeIndex)}`,
      tax_bps_snapshot: pick(rates, caseIndex + chargeIndex),
      tax_price_basis_snapshot:
        (caseIndex + chargeIndex) % 2
          ? ("exclusive" as const)
          : ("inclusive" as const),
      tax_treatment_snapshot: pick(TAX_TREATMENTS, caseIndex + chargeIndex + 1),
      discount_applies: (caseIndex + chargeIndex) % 3 === 0,
    };
  });
  return {
    currency_code: currency,
    tax_mode: taxMode,
    discount_bps: discount,
    items,
    charges,
  };
}

const inputs = Array.from({ length: 5_000 }, (_, index) => makeCase(index));
const expected = inputs.map(calculateQuote);

const batchSize = 100;
for (let offset = 0; offset < inputs.length; offset += batchSize) {
  const batch = inputs.slice(offset, offset + batchSize);
  const sql = `
    select coalesce(
      jsonb_agg(public.calculate_quote_payload(source.value) order by source.ordinality),
      '[]'::jsonb
    )
    from jsonb_array_elements(
      $tender_parity$${JSON.stringify(batch)}$tender_parity$::jsonb
    ) with ordinality source(value, ordinality);
  `;
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_tender-local-visual-study",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-AtX",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(
      `Privileged local parity execution could not start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Privileged local parity execution failed for group ${offset}: ${result.stderr.trim()}`,
    );
  }
  const actual = JSON.parse(result.stdout.trim()) as ReturnType<
    typeof calculateQuote
  >[];
  assert.deepStrictEqual(
    actual,
    expected.slice(offset, offset + batchSize),
    `TypeScript/SQL mismatch in group beginning ${offset}.`,
  );
}

console.log(
  `PASS 5000 deterministic TypeScript/SQL quote calculation cases matched exactly.`,
);
