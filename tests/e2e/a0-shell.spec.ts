import { expect, test } from "@playwright/test";

test("landing loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Priced once. Approved on the record. Issued unchanged.",
  );
  await expect(
    page.getByRole("heading", { name: "Build a sample quote" }),
  ).toBeVisible();
});

test("authentication routes load", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto("/create-account");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
});

test("protected route redirects with a return target", async ({ page }) => {
  await page.goto("/quotes");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fquotes$/);
});

test("unknown routes are handled", async ({ page }) => {
  const response = await page.goto("/not-a-tender-route");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This page is not part of Tender." }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`has no page overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
}
