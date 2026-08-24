import { expect, test, type Page } from "@playwright/test";
import { provisionIssuedRevisionWithoutLink } from "./recipient-local-fixture";

test.use({ trace: "off", screenshot: "off", video: "off" });

const statement =
  "I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.";

async function signIn(page: Page, email = "operator@tender.local") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
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

async function createAndIssueQuote(page: Page) {
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  await page.getByLabel("Catalog product").selectOption({
    label: "PCA-220 — Precision coupling assembly",
  });
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label").first()).toHaveText("Approved", {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { name: "Recipient access" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label").first()).toHaveText("Issued", {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { name: "Recipient access" }),
  ).toBeVisible();
  return page.url();
}

function capabilityFromHref(href: string | null) {
  expect(href).toMatch(/^\/quote\/[0-9a-f-]{36}#secret=[A-Za-z0-9_-]{43}$/);
  expect(href).not.toContain("?");
  const [path, secret] = href!.split("#secret=");
  return { path: path!, secret: secret! };
}

test("issuer issues, shares once, revokes, and sees acceptance evidence", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Full issuer path is exercised on desktop.",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const quoteUrl = await createAndIssueQuote(page);
  await expect(
    page.getByRole("heading", { name: "Recipient commitment" }),
  ).toBeVisible();
  const firstEmail = `buyer-one-${Date.now()}@example.test`;
  const secondEmail = `buyer-two-${Date.now()}@example.test`;
  await page.getByLabel("Recipient email").fill(firstEmail);
  await page.getByRole("button", { name: "Create recipient link" }).click();
  await expect(
    page.getByText("Tender cannot show this secret again", { exact: false }),
  ).toBeVisible();
  const created = capabilityFromHref(
    await page.getByRole("link", { name: "Open link" }).getAttribute("href"),
  );
  await page.getByRole("button", { name: "Copy link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.endsWith(created.path + "#secret=" + created.secret)).toBe(
    true,
  );
  expect(copied).not.toContain("?secret=");

  await page.getByLabel("Recipient email").fill(secondEmail);
  await page.getByRole("button", { name: "Create recipient link" }).click();
  await expect(page.getByRole("cell", { name: secondEmail })).toBeVisible();
  const secondRow = page.locator("tr", { hasText: secondEmail });
  await secondRow.getByRole("button", { name: "Revoke link" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke recipient link" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Confirm revocation" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Confirm revocation" }).click();
  await expect(secondRow.getByText("Revoked")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Recipient access" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open link" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(created.secret);
  expect(page.url()).not.toContain(created.secret);
  await expect(page.getByRole("cell", { name: firstEmail })).toBeVisible();
  await expect(
    page.locator("tr", { hasText: firstEmail }).getByText("Active"),
  ).toBeVisible();
  await expect(
    page.locator("tr", { hasText: secondEmail }).getByText("Revoked"),
  ).toBeVisible();
  expect(await page.content()).not.toContain("token_hash");
  await page.screenshot({
    path: testInfo.outputPath("issuer-recipient-access.png"),
    fullPage: true,
  });

  await page.goto(`${created.path}#secret=${created.secret}`);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await page.getByRole("button", { name: "Accept quotation" }).click();
  const accept = page.getByRole("dialog", { name: "Accept quotation" });
  await expect(accept).toContainText(statement);
  await accept.getByLabel("Buyer-asserted full name").fill("Issuer Path Buyer");
  await accept
    .getByLabel("Buyer-asserted title (optional)")
    .fill("Buyer title");
  await accept.getByRole("button", { name: "Accept quotation" }).click();
  await expect(
    page.getByText("Acceptance recorded", { exact: true }),
  ).toBeVisible();

  await page.goto(quoteUrl);
  await expect(
    page.getByRole("heading", { name: "Recipient commitment" }),
  ).toBeVisible();
  await expect(
    page.getByText("Accepted", { exact: true }).first(),
  ).toBeVisible();
  const commitment = page.getByLabel("Recipient commitment");
  await expect(commitment.getByText("Issuer Path Buyer")).toBeVisible();
  await expect(commitment.getByText("Buyer title")).toBeVisible();
  await expect(commitment.getByText(firstEmail)).toBeVisible();
  await expect(commitment.getByText(statement)).toBeVisible();
  await expect(
    page.getByText("not a certified digital signature", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(created.secret);
});

test("draft quotes and other tenants cannot use recipient sharing", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Authorization checks are desktop-only.",
  );
  await signIn(page);
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  const draftUrl = page.url();
  await expect(
    page.getByRole("heading", { name: "Recipient access" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create recipient link" }),
  ).toHaveCount(0);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await signIn(otherPage, "outsider@tender.local");
    await otherPage.goto(draftUrl);
    await expect(
      otherPage.getByRole("heading", {
        name: "This page is not part of Tender.",
      }),
    ).toBeVisible();
    await expect(
      otherPage.getByRole("heading", { name: "Recipient access" }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("mobile and keyboard issuer sharing stay operable", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "Mobile composition only.",
  );
  const fixture = provisionIssuedRevisionWithoutLink();
  await signIn(page);
  await page.goto(`/quotes/${encodeURIComponent(fixture.quoteNumber)}`);
  await expect(
    page.getByRole("heading", { name: "Recipient access" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".recipient-access")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page
    .getByLabel("Recipient email")
    .fill(`mobile-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Create recipient link" }).click();
  const href = await page
    .getByRole("link", { name: "Open link" })
    .getAttribute("href");
  capabilityFromHref(href);
  await page.getByRole("button", { name: "Revoke link" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke recipient link" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Revoke link" })).toBeFocused();
  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm revocation" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});
