import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const ARTIFACT_DIR = path.join(
  process.cwd(),
  "qa-runs",
  "20260726-170046",
  "artifacts",
  "reports",
);

test("qa-02: non-trivial calculations and minor units boundary", async ({
  page,
  browser,
}) => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);

  // Add a product with non-trivial calculation amounts
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "SFR-310 — Stainless feed rail" });
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Quantity for SFR-310").fill("142.750");
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // Set a fractional discount
  await page.getByLabel("Discount percent").fill("12.5");
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  const quoteUrl = page.url();

  // Submit and approve
  await page.getByRole("button", { name: /Submit for decision/ }).click();

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await managerPage.goto("/sign-in");
  await managerPage.getByLabel("Email address").fill("manager@tender.local");
  await managerPage.getByLabel("Password").fill("TenderLocal1!");
  await managerPage.getByRole("button", { name: "Sign in" }).click();
  await expect(managerPage).toHaveURL(/\/quotes$/);

  await managerPage.goto(quoteUrl);
  await managerPage.getByRole("button", { name: "Approve quote" }).click();
  await expect(managerPage.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await managerContext.close();

  // Issue the quote so it can be printed
  await page.reload();
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });

  // Print Validation for Calculations
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toBeVisible();

  const content = await page.content();
  const htmlPath = path.join(ARTIFACT_DIR, "qa-02-money-print.html");
  fs.writeFileSync(htmlPath, content, "utf-8");
});
