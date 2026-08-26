import { expect, test } from "@playwright/test";

test("public reviewer enters in one click and sees only read controls", async ({
  page,
}) => {
  test.skip(
    process.env.TENDER_DEMO_MODE !== "true",
    "Runs only against the explicit public-demo configuration.",
  );

  await page.goto("/");
  await page.getByRole("link", { name: "Open reviewer demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Read-only reviewer access" }),
  ).toBeVisible();
  await expect(
    page.getByText("demo.reviewer@tender.example.test"),
  ).toBeVisible();
  await expect(page.getByText("TenderReview2026!")).toBeVisible();

  await page.getByRole("button", { name: "Enter reviewer workspace" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByRole("link", { name: "Create quote" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Help" })).toBeVisible();

  await page.getByRole("link", { name: "Help" }).click();
  await expect(
    page.getByRole("heading", { name: "How to review Tender" }),
  ).toBeVisible();
  await expect(
    page.getByText("Read-only account", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Application" })
    .getByRole("link", { name: "Approvals" })
    .click();
  await expect(page.getByText(/cannot approve or reject/i)).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
