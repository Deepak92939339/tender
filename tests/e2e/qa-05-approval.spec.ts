import { test, expect } from "@playwright/test";

test("qa-05: strict manager approval for high discount quote", async ({
  page,
  browser,
}) => {
  // 1. Operator logs in and creates a draft
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);

  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);

  // Add line items
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: "SFR-310 — Stainless feed rail" });
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Quantity for SFR-310").fill("1.000");
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  const quoteUrl = page.url();

  // Set discount to trigger manager approval (>10%)
  await page.getByLabel("Discount percent").fill("15");
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // Reload to ensure state is finalized before submitting
  await page.reload();
  await expect(page.getByLabel("Discount percent")).toHaveValue("15");

  // 2. Submit for approval
  await page.getByRole("button", { name: /Submit for decision/ }).click();

  // Assert it lands in WAITING and not APPROVED
  await expect(page.locator(".state-label")).toHaveText(
    "Waiting for approval",
    { timeout: 20_000 },
  );

  // Assert the operator cannot approve their own quote
  await expect(page.getByRole("button", { name: "Approve quote" })).toHaveCount(
    0,
  );

  // 3. Manager approves
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await managerPage.goto("/sign-in");
  await managerPage.getByLabel("Email address").fill("manager@tender.local");
  await managerPage.getByLabel("Password").fill("TenderLocal1!");
  await managerPage.getByRole("button", { name: "Sign in" }).click();
  await expect(managerPage).toHaveURL(/\/quotes$/);

  await managerPage.goto(quoteUrl);
  await expect(
    managerPage.getByRole("button", { name: "Approve quote" }),
  ).toBeVisible();
  await managerPage.getByRole("button", { name: "Approve quote" }).click();
  await expect(managerPage.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await managerContext.close();

  // 4. Operator verifies final state and activity log
  await page.reload();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });

  // Assert activity log contains approval entry
  const activityLog = page.locator(".activity-section");
  await expect(activityLog).toContainText("Quotation approved.");
});
