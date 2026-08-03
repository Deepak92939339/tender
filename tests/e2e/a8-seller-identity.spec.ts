import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

async function waitForSave(page: Page) {
  await expect(
    page
      .getByRole("status")
      .getByText(/Unsaved|Saving/)
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function issuePreparedQuote(page: Page) {
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
}

function runOwnerSql(sql: string) {
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
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Local seller test setup failed: ${result.stderr}`);
  }
}

test("issued_print_contains_seller_and_customer", async ({ page }) => {
  await signIn(page);
  await issuePreparedQuote(page);

  await page.emulateMedia({ media: "print" });
  const printDocument = page.locator(".print-document");
  const seller = printDocument.locator(".print-seller");
  const customer = printDocument.locator(".print-customer");
  await expect(seller).toHaveCount(1);
  await expect(customer).toHaveCount(1);
  await expect(seller).toContainText("Tender Demonstration Company");
  await expect(seller).toContainText("14 Commerce Avenue");
  await expect(seller).toContainText("GSTIN-DEMO-TENDER");
  await expect(customer).toContainText("Asha Engineering Works");
  await expect(seller).not.toContainText("Asha Engineering Works");
  await expect(customer).not.toContainText("14 Commerce Avenue");
  await page.emulateMedia({ media: "screen" });
});

test("issued_print_uses_snapshots_only", async ({ page }) => {
  await signIn(page);
  await issuePreparedQuote(page);
  const quoteUrl = page.url();

  try {
    runOwnerSql(`
      update public.organizations
      set
        name = 'LIVE ORGANIZATION CHANGED',
        seller_legal_name = 'LIVE SELLER CHANGED',
        seller_address_line1 = '999 Live Record Road',
        seller_tax_identifier = 'LIVE-TAX-CHANGED'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    `);
    await page.goto(quoteUrl);
    await page.emulateMedia({ media: "print" });
    const seller = page.locator(".print-document .print-seller").first();
    await expect(seller).toContainText("Tender Demonstration Company");
    await expect(seller).toContainText("14 Commerce Avenue");
    await expect(seller).toContainText("GSTIN-DEMO-TENDER");
    await expect(seller).not.toContainText("LIVE SELLER CHANGED");
    await expect(seller).not.toContainText("999 Live Record Road");
    await expect(seller).not.toContainText("LIVE-TAX-CHANGED");
  } finally {
    runOwnerSql(`
      update public.organizations
      set
        name = 'Tender Demonstration Company',
        seller_legal_name = 'Tender Demonstration Company',
        seller_address_line1 = '14 Commerce Avenue',
        seller_tax_identifier = 'GSTIN-DEMO-TENDER'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    `);
  }
});
