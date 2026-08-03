import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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

async function waitForSave(page: Page) {
  await expect(page.getByRole("status")).toContainText(/Unsaved|Saving/);
  await expect(
    page.getByRole("status").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function changeCatalogPrice() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Local browser Supabase configuration is required.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await supabase.auth.signInWithPassword({
    email: "manager@tender.local",
    password: "TenderLocal1!",
  });
  if (signedIn.error) throw signedIn.error;
  const productResult = await supabase
    .from("products")
    .select(
      "id, version, sku, description, unit_code, quantity_precision, unit_price_minor, currency_code, tax_profile_id, active",
    )
    .eq("id", "a2000000-0000-4000-8000-000000000001")
    .single();
  if (productResult.error) throw productResult.error;
  const product = productResult.data;
  const nextPrice = product.unit_price_minor + 12345;
  const updated = await supabase.rpc("update_product", {
    p_product_id: product.id,
    p_expected_version: product.version,
    p_payload: {
      sku: product.sku,
      description: product.description,
      unit_code: product.unit_code,
      quantity_precision: product.quantity_precision,
      unit_price_minor: nextPrice,
      currency_code: product.currency_code,
      tax_profile_id: product.tax_profile_id,
      active: product.active,
    },
    p_command_id: crypto.randomUUID(),
  });
  if (updated.error) throw updated.error;
  await supabase.auth.signOut();
  return nextPrice;
}

test("draft builder autosaves exact lines and charges, restores, blocks currency, detects stale versions", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  await expect(page.getByRole("heading", { name: /TND-/ })).toBeVisible();
  const quoteUrl = page.url();

  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "SFR-310 — Stainless feed rail" });
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Quantity for SFR-310").fill("1.250");
  await waitForSave(page);

  await page.getByRole("button", { name: "Add charge" }).click();
  await page.getByLabel("Charge 1 description").fill("Measured freight");
  await page.getByLabel("Charge 1 amount").fill("10.00");
  await page
    .getByLabel("Charge 1 tax profile")
    .selectOption({ label: "IN_GST18 — India GST 18% — demo configuration" });
  await waitForSave(page);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await expect(page.getByRole("status")).toContainText("Saving");
  await expect(page.getByRole("status")).toContainText("Saved", {
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /print|pdf/i })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(quoteUrl);
  await expect(page.getByText("SFR-310", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Quantity for SFR-310")).toHaveValue("1.25");
  await expect(page.getByLabel("Charge 1 description")).toHaveValue(
    "Measured freight",
  );

  await page.getByRole("button", { name: "Remove SFR-310" }).click();
  await waitForSave(page);
  await expect(
    page.getByText("Add a catalog product to prepare this quotation."),
  ).toBeVisible();
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "SFR-310 — Stainless feed rail" });
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Quantity for SFR-310").fill("2.500");
  await waitForSave(page);

  await page.getByLabel("Quote currency").selectOption("USD");
  await expect(page.locator(".quote-summary .form-error")).toContainText(
    "mixed currency",
  );
  await expect(page.getByRole("status")).toContainText("Save failed", {
    timeout: 5_000,
  });
  await page.getByLabel("Quote currency").selectOption("INR");
  await expect(page.getByRole("status")).toContainText(
    "Saved server state unchanged",
  );

  const secondContext: BrowserContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await signIn(secondPage);
  await secondPage.goto(quoteUrl);
  await expect(secondPage.getByRole("heading", { name: /TND-/ })).toBeVisible();
  await page
    .getByLabel("Commercial notes")
    .fill("Saved from the first session");
  await waitForSave(page);
  await secondPage
    .getByLabel("Commercial notes")
    .fill("Stale second-session edit");
  await expect(secondPage.getByRole("status")).toContainText("Save failed", {
    timeout: 20_000,
  });
  await expect(secondPage.getByRole("status")).toContainText("another session");
  await expect(
    secondPage.getByRole("button", { name: "Reload server state" }),
  ).toBeVisible();
  await secondContext.close();

  await page.reload();
  await expect(page.getByLabel("Commercial notes")).toHaveValue(
    "Saved from the first session",
  );
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

test("quote price basis authoritatively recalculates items and charges and labels the issued document", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);

  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "PCA-220 — Precision coupling assembly" });
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  await page.getByRole("button", { name: "Add charge" }).click();
  await page.getByLabel("Charge 1 description").fill("Basis-sensitive freight");
  await page.getByLabel("Charge 1 amount").fill("118.00");
  await page
    .getByLabel("Charge 1 tax profile")
    .selectOption({ label: "IN_GST18 — India GST 18% — demo configuration" });
  await waitForSave(page);

  const exclusiveTotal = await page.locator(".total-row dd").textContent();
  await expect(
    page.getByText("Prices are marked tax-exclusive."),
  ).toBeVisible();
  await page.getByLabel("Price basis").selectOption("inclusive");
  await waitForSave(page);
  await expect(
    page.getByText("Prices are marked tax-inclusive."),
  ).toBeVisible();
  await expect(page.locator(".total-row dd")).not.toHaveText(
    exclusiveTotal ?? "",
  );
  const inclusiveTotal = await page.locator(".total-row dd").textContent();

  await page.reload();
  await expect(page.getByLabel("Price basis")).toHaveValue("inclusive");
  await expect(page.locator(".total-row dd")).toHaveText(inclusiveTotal ?? "");
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toContainText(
    "Prices are tax-inclusive.",
  );
});

test("stable browser identities preserve snapshots until explicit catalog refresh", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Stable identity reconciliation is covered once in desktop Chrome.",
  );
  await signIn(page);
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "PCA-220 — Precision coupling assembly" });
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);

  const line = page
    .locator(".quote-lines tbody tr")
    .filter({ hasText: "PCA-220" });
  const initialLineId = await line.getAttribute("data-line-id");
  expect(initialLineId).toMatch(/^[0-9a-f-]{36}$/);
  const initialUnitPrice = await line.locator("td").nth(2).textContent();

  await page.getByRole("button", { name: "Add charge" }).click();
  await page.getByLabel("Charge 1 description").fill("Stable browser freight");
  await page.getByLabel("Charge 1 amount").fill("25.00");
  await waitForSave(page);
  const charge = page.locator(".charge-row").first();
  const initialChargeId = await charge.getAttribute("data-charge-id");
  expect(initialChargeId).toMatch(/^[0-9a-f-]{36}$/);

  await changeCatalogPrice();
  await page
    .getByLabel("Commercial notes")
    .fill("Notes-only save after catalog change");
  await waitForSave(page);
  await expect(line).toHaveAttribute("data-line-id", initialLineId!);
  await expect(line.locator("td").nth(2)).toHaveText(initialUnitPrice ?? "");
  await expect(charge).toHaveAttribute("data-charge-id", initialChargeId!);

  await page.reload();
  const reloadedLine = page
    .locator(".quote-lines tbody tr")
    .filter({ hasText: "PCA-220" });
  await expect(reloadedLine).toHaveAttribute("data-line-id", initialLineId!);
  await expect(reloadedLine.locator("td").nth(2)).toHaveText(
    initialUnitPrice ?? "",
  );
  await page.getByRole("button", { name: "Refresh pricing" }).click();
  await expect(
    page.getByText("Line pricing refreshed from catalog.").first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(reloadedLine.locator("td").nth(2)).not.toHaveText(
    initialUnitPrice ?? "",
  );
  await expect(reloadedLine).toHaveAttribute("data-line-id", initialLineId!);
  await expect(
    page
      .getByText("Line pricing refreshed from catalog.", { exact: true })
      .last(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Remove PCA-220" }).click();
  await waitForSave(page);
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "PCA-220 — Precision coupling assembly" });
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  const readdedLineId = await page
    .locator(".quote-lines tbody tr")
    .filter({ hasText: "PCA-220" })
    .getAttribute("data-line-id");
  expect(readdedLineId).toMatch(/^[0-9a-f-]{36}$/);
  expect(readdedLineId).not.toBe(initialLineId);
});
