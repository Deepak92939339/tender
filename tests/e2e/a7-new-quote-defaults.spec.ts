import { expect, test, type Page } from "@playwright/test";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

async function persistedQuote(number: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Local browser Supabase configuration is required.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await supabase.auth.signInWithPassword({
    email: "operator@tender.local",
    password: "TenderLocal1!",
  });
  if (signedIn.error) throw signedIn.error;
  const result = await supabase
    .from("quotes")
    .select("customer_id, currency_code, locale")
    .eq("number", number)
    .single();
  await supabase.auth.signOut();
  if (result.error) throw result.error;
  return result.data;
}

test("second_customer_e2e_creates_quote_with_second_customer_defaults", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/quotes/new");

  await expect(page.getByLabel("Customer")).toHaveValue("");
  await expect(page.getByLabel("Currency")).toHaveValue("INR");
  await expect(page.getByLabel("Locale")).toHaveValue("en-IN");

  await page
    .getByLabel("Customer")
    .selectOption({ label: "Helio Fabrication GmbH" });
  await expect(page.getByLabel("Currency")).toHaveValue("EUR");
  await expect(page.getByLabel("Locale")).toHaveValue("de-DE");

  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  await expect(page.getByLabel("Quote currency")).toHaveValue("EUR");
  await expect(page.getByLabel("Locale")).toHaveValue("de-DE");

  const number = decodeURIComponent(
    new URL(page.url()).pathname.split("/").at(-1)!,
  );
  await expect(persistedQuote(number)).resolves.toMatchObject({
    customer_id: "a3000000-0000-4000-8000-000000000002",
    currency_code: "EUR",
    locale: "de-DE",
  });
});

test("operator_can_override_after_selection", async ({ page }) => {
  await signIn(page);
  await page.goto("/quotes/new");

  await page
    .getByLabel("Customer")
    .selectOption({ label: "Helio Fabrication GmbH" });
  await page.getByLabel("Currency").selectOption("GBP");
  await page.getByLabel("Locale").fill("en-GB");

  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await expect(page.getByLabel("Currency")).toHaveValue("INR");
  await expect(page.getByLabel("Locale")).toHaveValue("en-IN");

  await page
    .getByLabel("Customer")
    .selectOption({ label: "Helio Fabrication GmbH" });
  await expect(page.getByLabel("Currency")).toHaveValue("EUR");
  await expect(page.getByLabel("Locale")).toHaveValue("de-DE");

  await page.getByLabel("Currency").selectOption("GBP");
  await page.getByLabel("Locale").fill("en-GB");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  await expect(page.getByLabel("Quote currency")).toHaveValue("GBP");
  await expect(page.getByLabel("Locale")).toHaveValue("en-GB");

  const number = decodeURIComponent(
    new URL(page.url()).pathname.split("/").at(-1)!,
  );
  await expect(persistedQuote(number)).resolves.toMatchObject({
    customer_id: "a3000000-0000-4000-8000-000000000002",
    currency_code: "GBP",
    locale: "en-GB",
  });
});
