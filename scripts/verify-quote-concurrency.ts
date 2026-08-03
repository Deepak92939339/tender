import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key)
  throw new Error("Local public Supabase environment is required.");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: signInError } = await supabase.auth.signInWithPassword({
  email: "operator@tender.local",
  password: "TenderLocal1!",
});
if (signInError) throw signInError;

const calls = Array.from({ length: 40 }, (_, index) =>
  supabase.rpc("create_quote_draft", {
    p_organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    p_customer_id: "a3000000-0000-4000-8000-000000000001",
    p_currency_code: "INR",
    p_locale: "en-IN",
    p_tax_label: "GST 18%",
    p_tax_mode: "exclusive",
    p_issue_date: "2026-07-22",
    p_valid_until: "2026-08-22",
    p_command_id: `a5000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }),
);
const responses = await Promise.all(calls);
const errors = responses.flatMap((response) =>
  response.error ? [response.error] : [],
);
assert.equal(errors.length, 0, errors.map((error) => error.message).join("; "));
const numbers = responses.map(
  (response) => (response.data as { number: string }).number,
);
assert.equal(
  new Set(numbers).size,
  40,
  "Concurrent draft commands must receive unique numbers.",
);
assert.ok(
  numbers.every((number) => /^TND-2026-[0-9]{4,}$/.test(number)),
  "Every number must use the immutable format.",
);

console.log(
  "PASS 40 concurrent draft commands produced 40 unique organization/year quote numbers.",
);
