import { expect, test, type Locator, type Page } from "@playwright/test";

type FreshOrganization = {
  organizationName: string;
  slug: string;
};

function uniqueToken() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, "0")}`;
}

async function createFreshOrganization(page: Page): Promise<FreshOrganization> {
  const token = uniqueToken();
  const slug = `r6-${token}`;
  const organizationName = `R6 Fresh ${token}`;

  await page.goto("/create-account");
  await page
    .getByLabel("Full name", { exact: true })
    .fill("R6 Fresh Tenant Admin");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`${slug}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("TenderLocal1!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page
    .getByLabel("Organization name", { exact: true })
    .fill(organizationName);
  await page.getByLabel("Workspace URL slug", { exact: true }).fill(slug);
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await expect(page).toHaveURL(/\/quotes$/);

  return { organizationName, slug };
}

async function openOrganizationSettings(page: Page) {
  const link = page.getByRole("link", {
    name: "Organization settings",
    exact: true,
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/settings\/organization(?:\?|$)/);
  await expect(
    page.getByRole("heading", {
      name: "Organization settings",
      exact: true,
    }),
  ).toBeVisible();
}

async function expectSettingsResult(
  page: Page,
  result: string,
  message: string,
) {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/settings/organization" &&
      url.searchParams.get("result") === result
    );
  });
  const status = page.getByRole("status", {
    name: "Settings update status",
    exact: true,
  });
  await expect(status).toHaveText(message);
  await expect(status).toBeFocused();

  await page.reload();
  await expect(status).toHaveText(message);
  await expect(status).toBeFocused();
}

async function openNamedDisclosure(
  scope: Page | Locator,
  accessibleName: string,
) {
  const disclosure = scope
    .locator("summary")
    .filter({ hasText: accessibleName });
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toHaveText(accessibleName);
  await disclosure.click();
}

async function createTaxProfile(
  page: Page,
  values: {
    code: string;
    label: string;
    rateBps?: string;
    treatment?: "standard" | "exempt" | "zero_rated" | "reverse_charge";
    countryCode?: string;
  },
) {
  await openNamedDisclosure(page, "Create tax profile");
  const group = page.getByRole("group", {
    name: "Create tax profile",
    exact: true,
  });
  await group.getByLabel("Code", { exact: true }).fill(values.code);
  await group.getByLabel("Label", { exact: true }).fill(values.label);
  await group
    .getByLabel("Rate (basis points)", { exact: true })
    .fill(values.rateBps ?? "0");
  await group
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption(values.treatment ?? "exempt");
  await group
    .getByLabel("Jurisdiction country code", { exact: true })
    .fill(values.countryCode ?? "");
  await group
    .getByRole("button", { name: "Create tax profile", exact: true })
    .click();
}

async function archiveTaxProfile(
  page: Page,
  article: Locator,
  code: string,
  replacementLabel: string,
) {
  await openNamedDisclosure(article, `Archive ${code}`);
  const group = article.getByRole("group", {
    name: `Archive ${code} tax profile`,
    exact: true,
  });
  await group
    .getByRole("combobox", {
      name: "Replacement tax profile",
      exact: true,
    })
    .selectOption({ label: replacementLabel });
  await group
    .getByRole("button", {
      name: `Archive ${code} tax profile`,
      exact: true,
    })
    .click();
}

async function waitForDraftSave(page: Page) {
  const indicator = page.locator(".save-indicator");
  await expect(indicator).toBeVisible();
  await expect(indicator.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test("fresh_tenant_end_to_end", async ({ page }) => {
  test.setTimeout(180_000);

  const { organizationName } = await createFreshOrganization(page);
  const commercialToken = uniqueToken().replaceAll("-", "").toUpperCase();
  const sellerName = `R6 Seller ${commercialToken} GmbH`;
  const customerName = `R6 Customer ${commercialToken}`;
  const productSku = `R6-${commercialToken}`;
  const productDescription = "Fresh-tenant configured service";
  const taxCode = `R6_${commercialToken}`;
  const taxLabel = "Configured German tax";
  const updatedTaxLabel = "Configured German tax updated";

  await openOrganizationSettings(page);

  const noTax = page.getByRole("article", {
    name: "NO_TAX — No tax",
    exact: true,
  });
  await expect(noTax).toHaveCount(1);
  await expect(page.locator('[data-testid^="tax-profile-"]')).toHaveCount(1);
  await expect(noTax).toContainText("Exempt", { ignoreCase: true });
  await expect(noTax).toContainText("Active", { ignoreCase: true });

  await page
    .getByLabel("Organization name", { exact: true })
    .fill(`${organizationName} International`);
  await page
    .getByRole("combobox", { name: "Default currency", exact: true })
    .selectOption("USD");
  await page.getByLabel("Default locale", { exact: true }).fill("de-DE");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Berlin");
  await page
    .getByLabel("Approval threshold (basis points)", { exact: true })
    .fill("0");
  await page
    .getByRole("textbox", { name: "Seller legal name", exact: true })
    .fill(sellerName);
  await page
    .getByRole("textbox", { name: "Seller address line 1", exact: true })
    .fill("17 Handelsstraße");
  await page
    .getByLabel("Seller address line 2", { exact: true })
    .fill("Suite 6");
  await page
    .getByRole("textbox", { name: "Seller city", exact: true })
    .fill("Berlin");
  await page.getByLabel("Seller region", { exact: true }).fill("Berlin");
  await page.getByLabel("Seller postal code", { exact: true }).fill("10115");
  await page
    .getByRole("textbox", { name: "Seller country code", exact: true })
    .fill("DE");
  await page
    .getByLabel("Seller tax identifier", { exact: true })
    .fill(`DE-${commercialToken}`);
  await page
    .getByLabel("Seller contact email", { exact: true })
    .fill(`sales-${commercialToken.toLowerCase()}@example.test`);
  await page
    .getByLabel("Seller contact phone", { exact: true })
    .fill("+49 30 5550 0100");
  await page
    .getByRole("button", {
      name: "Save organization settings",
      exact: true,
    })
    .click();
  await expectSettingsResult(
    page,
    "organization_saved",
    "Organization settings were saved.",
  );

  await createTaxProfile(page, {
    code: taxCode,
    label: taxLabel,
    rateBps: "1900",
    treatment: "standard",
    countryCode: "DE",
  });
  await expectSettingsResult(
    page,
    "tax_profile_created",
    "Tax profile was created.",
  );

  let managedProfile = page.getByRole("article", {
    name: `${taxCode} — ${taxLabel}`,
    exact: true,
  });
  await expect(managedProfile).toHaveCount(1);
  await openNamedDisclosure(managedProfile, `Edit ${taxCode}`);
  const editGroup = managedProfile.getByRole("group", {
    name: `Edit ${taxCode} tax profile`,
    exact: true,
  });
  await editGroup.getByLabel("Label", { exact: true }).fill(updatedTaxLabel);
  await editGroup
    .getByRole("button", {
      name: `Save ${taxCode} tax profile`,
      exact: true,
    })
    .click();
  await expectSettingsResult(
    page,
    "tax_profile_updated",
    "Tax profile was updated.",
  );
  managedProfile = page.getByRole("article", {
    name: `${taxCode} — ${updatedTaxLabel}`,
    exact: true,
  });
  await expect(managedProfile).toHaveCount(1);

  await page.goto("/customers");
  await openNamedDisclosure(page, "Create customer");
  const customerForm = page.locator("form.record-form").filter({
    has: page.getByRole("button", {
      name: "Create customer",
      exact: true,
    }),
  });
  await expect(customerForm).toHaveCount(1);
  await customerForm
    .getByLabel("Customer name", { exact: true })
    .fill(customerName);
  await customerForm
    .getByLabel("Contact name", { exact: true })
    .fill("Fresh Buyer");
  await customerForm
    .getByLabel("Email", { exact: true })
    .fill("fresh-buyer@example.test");
  await customerForm
    .getByLabel("Billing address", { exact: true })
    .fill("48 Kundenweg");
  await customerForm.getByLabel("City", { exact: true }).fill("Hamburg");
  await customerForm.getByLabel("Country code", { exact: true }).fill("DE");
  await expect(customerForm.getByLabel("Locale", { exact: true })).toHaveValue(
    "de-DE",
  );
  await expect(
    customerForm.getByRole("combobox", { name: "Currency", exact: true }),
  ).toHaveValue("USD");
  await customerForm
    .getByRole("button", { name: "Create customer", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    `${customerName} was created.`,
  );

  await page.goto("/catalog");
  await openNamedDisclosure(page, "Create product");
  const productForm = page.locator("form.record-form").filter({
    has: page.getByRole("button", {
      name: "Create product",
      exact: true,
    }),
  });
  await expect(productForm).toHaveCount(1);
  await productForm.getByLabel("SKU", { exact: true }).fill(productSku);
  await productForm
    .getByLabel("Description", { exact: true })
    .fill(productDescription);
  await productForm.getByLabel("Unit price", { exact: true }).fill("125.00");
  await expect(
    productForm.getByRole("combobox", { name: "Currency", exact: true }),
  ).toHaveValue("USD");
  await productForm
    .getByRole("combobox", { name: "Tax profile", exact: true })
    .selectOption({ label: `${taxCode} — ${updatedTaxLabel}` });
  await productForm
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    `Product ${productSku} was created.`,
  );

  await page.goto("/quotes/new");
  await page
    .getByRole("combobox", { name: "Customer", exact: true })
    .selectOption({ label: customerName });
  await expect(
    page.getByRole("combobox", { name: "Currency", exact: true }),
  ).toHaveValue("USD");
  await expect(page.getByLabel("Locale", { exact: true })).toHaveValue("de-DE");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/quotes\/TND-\d{4}-\d{4,}$/);
  const quoteUrl = page.url();
  const quoteNumber = await page
    .getByRole("heading", { name: /^TND-\d{4}-\d{4,}$/ })
    .textContent();

  await page
    .getByRole("combobox", { name: "Catalog product", exact: true })
    .selectOption({ label: `${productSku} — ${productDescription}` });
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await waitForDraftSave(page);
  await page.getByLabel("Discount percent", { exact: true }).fill("1.00");
  await waitForDraftSave(page);
  await page.reload();
  await expect(
    page.locator(".quote-lines tbody tr").filter({ hasText: productSku }),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("Discount percent", { exact: true }),
  ).toHaveValue("1");
  await page.getByRole("button", { name: /Submit for decision/ }).click();
  await expect(page.locator(".state-label")).toHaveText(
    "Waiting for approval",
    { timeout: 20_000 },
  );
  await page
    .getByRole("button", { name: "Approve quote", exact: true })
    .click();
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote", exact: true }).click();
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Print / Save PDF", exact: true }),
  ).toBeVisible();

  await page.emulateMedia({ media: "print" });
  let printDocument = page.locator(".print-document");
  const seller = printDocument.getByLabel("Seller", { exact: true });
  const customer = printDocument.getByLabel("Customer", { exact: true });
  await expect(printDocument).toBeVisible();
  await expect(printDocument).toContainText(quoteNumber ?? "TND-");
  await expect(seller).toContainText(sellerName);
  await expect(seller).toContainText("17 Handelsstraße");
  await expect(customer).toContainText(customerName);
  await expect(customer).toContainText("48 Kundenweg");
  await expect(seller).not.toContainText(customerName);
  await expect(customer).not.toContainText(sellerName);
  await expect(
    printDocument.getByRole("cell", { name: taxCode, exact: true }),
  ).toHaveCount(1);
  await page.emulateMedia({ media: "screen" });

  await page.goto("/settings/organization");
  managedProfile = page.getByRole("article", {
    name: `${taxCode} — ${updatedTaxLabel}`,
    exact: true,
  });
  await archiveTaxProfile(page, managedProfile, taxCode, "NO_TAX — No tax");
  await expectSettingsResult(
    page,
    "tax_profile_archived",
    "Tax profile was archived.",
  );
  await expect(
    page.getByRole("article", {
      name: `${taxCode} — ${updatedTaxLabel}`,
      exact: true,
    }),
  ).toContainText("Archived", { ignoreCase: true });

  await page.goto("/catalog");
  const productRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: productSku, exact: true }),
  });
  await expect(productRow).toHaveCount(1);
  await expect(
    productRow.getByRole("cell", { name: "NO_TAX", exact: true }),
  ).toHaveCount(1);

  await openNamedDisclosure(page, "Create product");
  const nextProductForm = page.locator("form.record-form").filter({
    has: page.getByRole("button", {
      name: "Create product",
      exact: true,
    }),
  });
  await expect(nextProductForm).toHaveCount(1);
  const nextProductTaxProfile = nextProductForm.getByRole("combobox", {
    name: "Tax profile",
    exact: true,
  });
  await expect(
    nextProductTaxProfile.getByRole("option", {
      name: `${taxCode} — ${updatedTaxLabel}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    nextProductTaxProfile.getByRole("option", {
      name: "NO_TAX — No tax",
      exact: true,
    }),
  ).toHaveCount(1);

  await page.goto(quoteUrl);
  await page.emulateMedia({ media: "print" });
  printDocument = page.locator(".print-document");
  await expect(
    printDocument.getByRole("cell", { name: taxCode, exact: true }),
  ).toHaveCount(1);
  await expect(
    printDocument.getByLabel("Seller", { exact: true }),
  ).toContainText(sellerName);
  await expect(
    printDocument.getByLabel("Customer", { exact: true }),
  ).toContainText(customerName);
});

test("archive_success_status_survives_revalidation", async ({ page }) => {
  test.setTimeout(120_000);

  await createFreshOrganization(page);
  const taxCode = `ARC_${uniqueToken().replaceAll("-", "").toUpperCase()}`;
  const taxLabel = "Temporary archive proof";
  await openOrganizationSettings(page);
  await createTaxProfile(page, {
    code: taxCode,
    label: taxLabel,
  });
  await expectSettingsResult(
    page,
    "tax_profile_created",
    "Tax profile was created.",
  );

  const article = page.getByRole("article", {
    name: `${taxCode} — ${taxLabel}`,
    exact: true,
  });
  await archiveTaxProfile(page, article, taxCode, "NO_TAX — No tax");
  await expectSettingsResult(
    page,
    "tax_profile_archived",
    "Tax profile was archived.",
  );
  await expect(
    page.getByRole("article", {
      name: `${taxCode} — ${taxLabel}`,
      exact: true,
    }),
  ).toContainText("Archived", { ignoreCase: true });
});

test("manager organization settings follow the explicit capability map", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("manager@tender.local");
  await page.getByLabel("Password", { exact: true }).fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(
    page.getByRole("link", {
      name: "Organization settings",
      exact: true,
    }),
  ).toHaveCount(0);

  await page.goto("/settings/organization");
  await expect(
    page.getByText(
      "Your explicit capability map does not grant access to organization settings.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Save organization settings",
      exact: true,
    }),
  ).toHaveCount(0);
});
