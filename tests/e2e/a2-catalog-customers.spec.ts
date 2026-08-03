import { expect, test, type Page } from "@playwright/test";

async function signInOperator(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

test("customer, product, CSV review, partial import and deep links", async ({
  page,
}, testInfo) => {
  const token = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "").toUpperCase()}${Date.now()}`;
  const customerName = `Northstar ${token}`;
  const productSku = `P-${token}`.slice(0, 60);
  await signInOperator(page);

  await page.goto("/customers");
  await page.locator("summary", { hasText: "Create customer" }).click();
  await page.getByLabel("Customer name").fill(customerName);
  await page.getByLabel("Contact name").fill("Riya <script>text</script>");
  await page.getByLabel("Email").fill("riya@example.test");
  await page.getByLabel("Billing address").fill("22 Safe Rendering Road");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("status")).toContainText("was created");
  await page.reload();
  const customerLink = page.getByRole("link", { name: customerName });
  await expect(customerLink).toBeVisible();
  await customerLink.click();
  await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
  const customerUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(customerUrl);

  await page.locator("summary", { hasText: "Edit customer" }).click();
  await page.getByLabel("Phone").fill("+91 90000 00000");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toContainText("was updated");

  await page.goto("/catalog");
  await page.locator("summary", { hasText: "Create product" }).click();
  await page.getByLabel("SKU").fill(productSku);
  await page.getByLabel("Description").fill("Measured test product");
  await page.locator('select[name="unitCode"]').selectOption("KG");
  await page.locator('select[name="quantityPrecision"]').selectOption("3");
  await page.getByLabel("Unit price").fill("12.34");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("status")).toContainText(productSku);
  await page.getByRole("button", { name: "Close product form" }).click();

  await page.locator("summary", { hasText: "Import CSV" }).click();
  const validSku = `CSV-${token}`.slice(0, 60);
  const invalidSku = `BAD-${token}`.slice(0, 60);
  const csv = [
    "sku,description,unit_code,quantity_precision,unit_price,currency_code,tax_code,active",
    `${validSku},=SUM(A1:A2) remains text,M,3,4.56,INR,IN_GST18,true`,
    `${invalidSku},Unknown tax,EA,0,8.00,INR,NO_SUCH_TAX,true`,
  ].join("\n");
  await page.getByLabel("Catalog CSV").setInputFiles({
    name: `partial-${token}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole("button", { name: "Review CSV" })).toBeEnabled();
  await page.getByRole("button", { name: "Review CSV" }).click();
  await expect(page.getByRole("heading", { name: "CSV review" })).toBeVisible();
  await expect(page.getByText("1 valid · 1 invalid · 2 total")).toBeVisible();
  await expect(
    page.getByText("TAX_CODE_UNKNOWN", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Import only the 1 validated row/ })
    .check();
  await page.getByRole("button", { name: "Confirm partial import" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "Imported 1 product rows; skipped 1 invalid rows",
  );
  await page.reload();
  await expect(page.getByText(validSku, { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  await expect(
    page.getByRole("region", { name: "Catalog table" }),
  ).toBeVisible();
});

test("catalog and customer search treat wildcard punctuation as literal text", async ({
  page,
}) => {
  await signInOperator(page);

  await page.goto("/catalog");
  await page.getByLabel("Search catalog").fill("_");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByText("No catalog products match this view."),
  ).toBeVisible();
  await page.getByLabel("Search catalog").fill("PCA");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("PCA-220", { exact: true })).toBeVisible();

  await page.goto("/customers");
  await page.getByLabel("Search customers").fill("_");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No customers match this view.")).toBeVisible();
  await page.getByLabel("Search customers").fill("asha");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("link", { name: "Asha Engineering Works" }),
  ).toBeVisible();
});
