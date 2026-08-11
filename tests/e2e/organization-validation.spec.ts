import { expect, test, type Page } from "@playwright/test";

const password = "TenderLocal1!";

async function createAccount(page: Page, email: string) {
  await page.goto("/create-account");
  await page.getByLabel("Full name").fill("Local organization test user");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("organization onboarding blocks invalid values and rejects duplicates without a partial workspace", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "One disposable local transaction check is sufficient.",
  );
  const suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const slug = `landmark-local-${suffix}`;
  await createAccount(page, `first-${slug}@example.test`);
  await page.getByLabel("Organization name").fill("Landmark Local");
  await expect(page.getByLabel("Workspace URL slug")).toHaveValue(
    "landmark-local",
  );
  await page.getByLabel("Workspace URL slug").fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/quotes$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await createAccount(page, `second-${slug}@example.test`);
  await page.getByLabel("Organization name").fill("Another Landmark");
  await page.getByLabel("Workspace URL slug").fill("Landmark@site123.com");
  await expect(
    page.getByRole("button", { name: "Create organization" }),
  ).toBeDisabled();
  await page.getByLabel("Workspace URL slug").fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Choose another workspace URL slug",
  );
  await expect(page).toHaveURL(/\/onboarding$/);
});
