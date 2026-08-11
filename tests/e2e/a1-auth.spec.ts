import { expect, test } from "@playwright/test";

test("account, organization, sign-out, deep-link sign-in and refresh", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${Date.now()}`;
  const email = `e2e-${suffix}@example.test`;
  const password = "TenderLocal1!";
  const organization = `E2E ${testInfo.project.name}`;
  const slug = `e2e-${suffix}`.slice(0, 62).replace(/-+$/, "x");

  await page.goto("/create-account");
  await page.getByLabel("Full name").fill("E2E Tender User");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel("Organization name").fill(organization);
  const slugInput = page.getByLabel("Workspace URL slug");
  await expect(slugInput).toHaveValue(
    new RegExp(`^e2e-${testInfo.project.name}`),
  );
  await slugInput.fill("landmark.org");
  await expect(
    page.getByRole("button", { name: "Create organization" }),
  ).toBeDisabled();
  await expect(page.getByText("Use 3–64 lowercase letters")).toBeVisible();
  await slugInput.fill(slug);
  await page.screenshot({
    path: testInfo.outputPath(`onboarding-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();
  await expect(page.getByText(organization, { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`post-onboarding-${testInfo.project.name}.png`),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  const deepLink = "/catalog";
  await page.goto(deepLink);
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${deepLink.replaceAll("/", "\\/")}$`),
  );
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`${deepLink.replaceAll("/", "\\/")}$`),
  );
  await expect(page.getByText(organization, { exact: true })).toBeVisible();
});
