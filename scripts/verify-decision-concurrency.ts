import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key)
  throw new Error("Local public Supabase environment is required.");
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let response = await supabase.auth.signInWithPassword({
  email: "operator@tender.local",
  password: "TenderLocal1!",
});
if (response.error) throw response.error;
const command = (suffix: number) =>
  `a7000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const created = await supabase.rpc("create_quote_draft", {
  p_organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  p_customer_id: "a3000000-0000-4000-8000-000000000001",
  p_currency_code: "INR",
  p_locale: "en-IN",
  p_tax_label: "GST 18%",
  p_tax_mode: "exclusive",
  p_issue_date: "2026-07-22",
  p_valid_until: "2026-08-22",
  p_command_id: command(1),
});
if (created.error) throw created.error;
const quote = created.data as { id: string; version: number };
const saved = await supabase.rpc("save_quote_draft", {
  p_quote_id: quote.id,
  p_expected_version: quote.version,
  p_command_id: command(2),
  p_payload: {
    customer_id: "a3000000-0000-4000-8000-000000000001",
    currency_code: "INR",
    locale: "en-IN",
    tax_label: "GST 18%",
    tax_mode: "exclusive",
    discount_bps: 1200,
    issue_date: "2026-07-22",
    valid_until: "2026-08-22",
    notes: "",
    items: [
      {
        line_id: null,
        product_id: "a2000000-0000-4000-8000-000000000001",
        position: 1,
        quantity_scaled: 1,
        quantity_scale: 1,
      },
    ],
    charges: [],
  },
});
if (saved.error) throw saved.error;
const submitted = await supabase.rpc("submit_quote", {
  p_quote_id: quote.id,
  p_expected_version: 2,
  p_command_id: command(3),
});
if (submitted.error) throw submitted.error;

response = await supabase.auth.signInWithPassword({
  email: "manager@tender.local",
  password: "TenderLocal1!",
});
if (response.error) throw response.error;
const decisions = await Promise.all([
  supabase.rpc("approve_quote", {
    p_quote_id: quote.id,
    p_expected_version: 3,
    p_command_id: command(4),
  }),
  supabase.rpc("approve_quote", {
    p_quote_id: quote.id,
    p_expected_version: 3,
    p_command_id: command(5),
  }),
]);
assert.equal(
  decisions.filter((decision) => !decision.error).length,
  1,
  "Exactly one concurrent approval must succeed.",
);
assert.equal(
  decisions.filter((decision) => decision.error).length,
  1,
  "Exactly one concurrent approval must lose.",
);
const activity = await supabase
  .from("quote_activity")
  .select("id", { count: "exact" })
  .eq("quote_id", quote.id)
  .eq("event_type", "quote.approved");
if (activity.error) throw activity.error;
assert.equal(
  activity.count,
  1,
  "Concurrent decisions must append one approval Activity row.",
);

console.log(
  "PASS concurrent approval produced one winner, one conflict, and one approval Activity row.",
);
