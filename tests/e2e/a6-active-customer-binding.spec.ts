import { expect, test, type Page } from "@playwright/test";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

test("archived customers cannot start new quotes while bound drafts preserve them", async ({
  page,
}) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Local browser Supabase configuration is required.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signInResult = await supabase.auth.signInWithPassword({
    email: "operator@tender.local",
    password: "TenderLocal1!",
  });
  if (signInResult.error) throw signInResult.error;

  const unique = crypto.randomUUID().slice(0, 8);
  const customerName = `R2 Archived ${unique}`;
  const customerResult = await supabase.rpc("create_customer", {
    p_organization_id: organizationId,
    p_payload: {
      name: customerName,
      contact_name: "R2 Contact",
      email: `r2-${unique}@example.test`,
      phone: "",
      billing_address_line1: "2 Recovery Road",
      billing_address_line2: "",
      billing_city: "Pune",
      billing_region: "Maharashtra",
      billing_postal_code: "411001",
      billing_country_code: "IN",
      locale: "en-IN",
      preferred_currency_code: "INR",
      tax_treatment: "standard",
      tax_identifier: "",
      active: true,
    },
    p_command_id: crypto.randomUUID(),
  });
  if (customerResult.error) throw customerResult.error;
  const customer = customerResult.data as { id: string; version: number };

  const today = new Date().toISOString().slice(0, 10);
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const quoteResult = await supabase.rpc("create_quote_draft", {
    p_organization_id: organizationId,
    p_customer_id: customer.id,
    p_currency_code: "INR",
    p_locale: "en-IN",
    p_tax_label: "Configured tax",
    p_tax_mode: "exclusive",
    p_issue_date: today,
    p_valid_until: validUntil,
    p_command_id: crypto.randomUUID(),
  });
  if (quoteResult.error) throw quoteResult.error;
  const quote = quoteResult.data as { id: string; number: string };

  const archiveResult = await supabase.rpc("archive_customer", {
    p_customer_id: customer.id,
    p_expected_version: customer.version,
    p_command_id: crypto.randomUUID(),
  });
  if (archiveResult.error) throw archiveResult.error;

  await signIn(page);
  await page.goto("/quotes/new");
  await expect(
    page.getByRole("option", { name: customerName, exact: true }),
  ).toHaveCount(0);

  await page.goto(`/quotes/${encodeURIComponent(quote.number)}`);
  const customerSelect = page.getByLabel("Customer");
  await expect(customerSelect).toHaveValue(customer.id);
  await expect(
    customerSelect.getByRole("option", { name: customerName, exact: true }),
  ).toHaveValue(customer.id);

  const persisted = await supabase
    .from("quotes")
    .select("customer_id")
    .eq("id", quote.id)
    .single();
  if (persisted.error) throw persisted.error;
  expect(persisted.data.customer_id).toBe(customer.id);
  await supabase.auth.signOut();
});
