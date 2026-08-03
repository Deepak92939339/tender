import { test, expect } from "@playwright/test";

test("qa-04: strict tenant isolation on quotes", async ({ page, browser }) => {
  // Login as operator (org-india-apex)
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Create a quote
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);

  const quoteUrl = page.url();

  // Try to access the same quote as an operator from another tenant (org-euro-technic)
  const euroContext = await browser.newContext();
  const euroPage = await euroContext.newPage();

  await euroPage.goto("/sign-in");
  await euroPage.getByLabel("Email address").fill("outsider@tender.local");
  await euroPage.getByLabel("Password").fill("TenderLocal1!");
  await euroPage.getByRole("button", { name: "Sign in" }).click();
  await expect(euroPage).toHaveURL(/\/quotes$/);

  // Attempt direct URL access
  await euroPage.goto(quoteUrl);

  await expect(
    euroPage.getByRole("heading", { name: "This page is not part of Tender." }),
  ).toBeVisible();
  await expect(
    euroPage.getByRole("heading", { name: "Asha Engineering Works" }),
  ).not.toBeVisible();

  await euroContext.close();
});
