import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "operator@tender.local") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

for (const [label, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`captures authenticated ${label} application surfaces`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await signIn(page);

    const capture = async (name: string) => {
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${label}.png`),
        fullPage: true,
      });
    };

    await capture("quotes");
    const quote = page.locator('a[href^="/quotes/"]').first();
    await expect(quote).toBeVisible();
    const quoteHref = await quote.getAttribute("href");

    await page.goto("/quotes/new");
    await expect(
      page.getByRole("heading", { name: "Prepare the offer" }),
    ).toBeVisible();
    await capture("quote-builder");

    await page.goto(quoteHref ?? "/quotes");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture("quote-detail");

    await page.goto("/approvals");
    await expect(
      page.getByRole("heading", { name: "Approvals" }),
    ).toBeVisible();
    await capture("approvals");

    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
    await capture("catalog");

    await page.goto("/customers");
    await expect(
      page.getByRole("heading", { name: "Customers" }),
    ).toBeVisible();
    await capture("customers");
    const customer = page.locator('a[href^="/customers/"]').first();
    await expect(customer).toBeVisible();
    const customerHref = await customer.getAttribute("href");

    await page.goto(customerHref ?? "/customers");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture("customer-detail");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, "manager@tender.local");

    await page.goto("/approvals");
    await expect(
      page.getByRole("heading", { name: "Approvals" }),
    ).toBeVisible();
    await capture("approvals-manager");

    await page.goto("/settings/organization");
    await expect(
      page.getByRole("heading", { name: "Organization settings" }),
    ).toBeVisible();
    await capture("organization-settings");
  });
}
