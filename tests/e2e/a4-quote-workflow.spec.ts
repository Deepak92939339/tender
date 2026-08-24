import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function createPreparedQuote(
  page: Page,
  discountPercent: string,
  lineCount = 1,
) {
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  const catalog = page.getByLabel("Catalog product");
  if (await catalog.count()) {
    await catalog.selectOption({
      label: "PCA-220 — Precision coupling assembly",
    });
  }
  for (let index = 0; index < lineCount; index += 1)
    await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  if (discountPercent !== "0") {
    await page.getByLabel("Discount percent").fill(discountPercent);
    await waitForSave(page);
  }
  await page.reload();
  await expect(page.getByLabel("Discount percent")).toHaveValue(
    discountPercent,
  );
  await expect(page.locator(".quote-lines tbody tr")).toHaveCount(lineCount);
  return page.url();
}

async function managerPage(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "manager@tender.local");
  await page.goto(url);
  return { context, page };
}

test("operator submits boundary-approved quote, issues separately, then prints", async ({
  page,
}) => {
  await signIn(page);
  await createPreparedQuote(page, "8");
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Issue quote" })).toBeVisible();
  await expect(
    page.getByText("Verified quotation revision submit completed."),
  ).toBeVisible();
  await expect(page.getByText("Approval rule", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Print|PDF/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  await expect(
    page.getByText("Verified quotation revision issue completed."),
  ).toBeVisible();
  await expect(
    page.getByText("Issued does not mean Delivered", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toBeVisible();
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  await expect(page.locator(".print-totals")).toHaveCount(1);
  await page.emulateMedia({ media: "screen" });
});

test("above-threshold quote requires manager approval before operator issuance", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const quoteUrl = await createPreparedQuote(page, "12");
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText(
    "Waiting for approval",
    { timeout: 20_000 },
  );
  await expect(page.getByRole("button", { name: "Approve quote" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Reject quote" })).toHaveCount(
    0,
  );

  const manager = await managerPage(browser, quoteUrl);
  await expect(
    manager.page.getByRole("button", { name: "Approve quote" }),
  ).toBeVisible();
  await manager.page.getByRole("button", { name: "Approve quote" }).click();
  await expect(manager.page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await manager.context.close();

  await page.reload();
  await expect(page.locator(".state-label")).toHaveText("Approved");
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
});

test("manager rejection safely records reason and other tenant learns nothing", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const quoteUrl = await createPreparedQuote(page, "15");
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText(
    "Waiting for approval",
    { timeout: 20_000 },
  );

  const manager = await managerPage(browser, quoteUrl);
  await manager.page.getByRole("button", { name: "Reject quote" }).click();
  const reason = manager.page.getByLabel("Rejection reason");
  await expect(reason).toBeFocused();
  for (let index = 0; index < 5; index += 1) {
    await manager.page.keyboard.press(index === 0 ? "Shift+Tab" : "Tab");
    expect(
      await manager.page.evaluate(() =>
        document.activeElement?.closest("dialog")?.hasAttribute("open"),
      ),
    ).toBe(true);
  }
  await manager.page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    manager.page.getByRole("button", { name: "Reject quote" }),
  ).toBeFocused();
  await manager.page.getByRole("button", { name: "Reject quote" }).click();
  const rejectionReason =
    `<img src=x onerror=alert(1)> ${"Commercial risk. ".repeat(80)}`.slice(
      0,
      1000,
    );
  await reason.fill(rejectionReason);
  await manager.page.getByRole("button", { name: "Confirm rejection" }).click();
  await expect(manager.page.locator(".state-label")).toHaveText("Rejected", {
    timeout: 20_000,
  });
  const renderedReason = manager.page.locator(".rejection-reason span");
  await expect(renderedReason).toBeVisible();
  await expect(renderedReason).toHaveText(rejectionReason);
  expect(
    await renderedReason.evaluate((element) => element.textContent?.length),
  ).toBe(1000);
  await expect(
    manager.page.getByRole("button", { name: "Issue quote" }),
  ).toHaveCount(0);
  await manager.context.close();

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, "outsider@tender.local");
  await otherPage.goto(quoteUrl);
  await expect(
    otherPage.getByRole("heading", {
      name: "This page is not part of Tender.",
    }),
  ).toBeVisible();
  await expect(otherPage.getByText(/TND-\d{4}-\d{4,}/)).toHaveCount(0);
  await otherContext.close();
});

test("expired draft is derived consistently in detail and list views", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Create quote" }).click();
  await page
    .getByLabel("Customer")
    .selectOption({ label: "Asha Engineering Works" });
  await page.getByLabel("Issue date").fill("2001-01-01");
  await page.getByLabel("Valid until").fill("2001-01-02");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  const number = (await page
    .getByRole("heading", { name: /TND-/ })
    .textContent())!;
  await expect(page.locator(".state-label")).toHaveText("Expired");
  await expect(
    page.getByRole("button", { name: /Submit for decision/ }),
  ).toHaveCount(0);
  await expect(page.locator(".quote-edit-fieldset")).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(page.getByLabel("Issue date")).toBeDisabled();

  await page.goto("/quotes");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: number }) });
  await expect(row.locator(".state-label")).toHaveText("Expired");
});

test("issued document keeps the submission-time customer snapshot", async ({
  page,
}, testInfo) => {
  const token = `Snapshot ${testInfo.project.name} ${Date.now()}`;
  const originalName = `${token} Customer`;
  const originalAddress = "17 Submission Lane";
  const originalTaxId = `SNAP-${Date.now()}`;
  await signIn(page);

  await page.goto("/customers");
  await page.locator("summary", { hasText: "Create customer" }).click();
  await page.getByLabel("Customer name").fill(originalName);
  await page.getByLabel("Contact name").fill("Submission Contact");
  await page.getByLabel("Email").fill("snapshot@example.test");
  await page.getByLabel("Billing address").fill(originalAddress);
  await page.getByLabel("Country code").fill("IN");
  await page.getByLabel("Tax identifier").fill(originalTaxId);
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("status")).toContainText("was created");
  await page.reload();
  await page.getByRole("link", { name: originalName }).click();
  await expect(page.getByRole("heading", { name: originalName })).toBeVisible();
  const customerUrl = page.url();

  await page.goto("/quotes/new");
  await page.getByLabel("Customer").selectOption({ label: originalName });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForSave(page);
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  const quoteUrl = page.url();

  await page.goto(customerUrl);
  await page.locator("summary", { hasText: "Edit customer" }).click();
  await page.getByLabel("Customer name").fill(`${token} Renamed`);
  await page.getByLabel("Billing address").fill("99 Live Record Changed");
  await page.getByLabel("Tax identifier").fill("LIVE-CHANGED");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toContainText("was updated");

  await page.goto(quoteUrl);
  const snapshot = page.locator(".quote-submission-snapshot");
  await expect(
    snapshot.getByRole("heading", { name: originalName }),
  ).toBeVisible();
  await expect(snapshot).toContainText(originalAddress);
  await expect(snapshot).toContainText(originalTaxId);
  await expect(snapshot).not.toContainText("99 Live Record Changed");

  await page.emulateMedia({ media: "print" });
  const printDocument = page.locator(".print-document");
  await expect(printDocument).toContainText(originalName);
  await expect(printDocument).toContainText(originalAddress);
  await expect(printDocument).toContainText(originalTaxId);
  await expect(printDocument).not.toContainText("LIVE-CHANGED");
  await page.emulateMedia({ media: "screen" });
});

test("40-line issued quote has deterministic continued print pages", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Long-print pagination is covered once in desktop Chrome.",
  );
  await signIn(page);
  await createPreparedQuote(page, "0", 40);
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-page")).toHaveCount(3);
  await expect(page.getByText("Page 3 of 3")).toBeVisible();
  await expect(page.getByText("Continued — commercial lines")).toHaveCount(2);
  await expect(page.locator(".print-totals")).toHaveCount(1);
});
