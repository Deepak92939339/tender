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

test("qa-03: snapshot integrity on quote documents", async ({ page }) => {
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

  // Add a product
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "SFR-310 — Stainless feed rail" });
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Quantity for SFR-310").fill("1.000");
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // Submit and wait for auto-approval (discount is 0%)
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });

  // Issue the quote
  await page.reload();
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toBeVisible();

  const content = await page.content();
  const htmlPath = path.join(ARTIFACT_DIR, "qa-03-snapshot-print.html");
  fs.writeFileSync(htmlPath, content, "utf-8");

  // Attempt to modify the issued quote
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByLabel("Quantity for SFR-310")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add product" }),
  ).not.toBeVisible();
});
