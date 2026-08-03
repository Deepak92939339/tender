import { expect, test, type Page } from "@playwright/test";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@tender.local");
  await page.getByLabel("Password").fill("TenderLocal1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.right > document.documentElement.clientWidth + 1 ||
          bounds.left < -1
        );
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
      })),
  }));
  expect(widths.scroll, JSON.stringify(widths.offenders)).toBeLessThanOrEqual(
    widths.client,
  );
}

async function waitForAuthoritativeSave(page: Page) {
  await expect(page.locator(".save-indicator")).toContainText(/Unsaved|Saving/);
  await expect(
    page.locator(".save-indicator").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

test("keyboard sign-in, visible focus, focused error summary and skip link", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Keyboard semantics are covered once in desktop Chrome.",
  );
  await page.goto("/sign-in");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      transform: style.transform,
    };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).not.toBe("0px");
  expect(focusStyle.transform).not.toContain("-160");

  const email = page.getByLabel("Email address");
  for (
    let index = 0;
    index < 4 &&
    !(await email.evaluate((element) => element === document.activeElement));
    index += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(email).toBeFocused();
  await page.keyboard.type("operator@tender.local");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Wrong123!");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  const error = page.locator(".form-error[role='alert']");
  await expect(error).toContainText(
    "Nothing changed and your data is preserved",
  );
  await expect(error).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.type("operator@tender.local");
  await page.keyboard.press("Tab");
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.type("TenderLocal1!");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();
});

test("long international content, large money, effective widths, RTL and keyboard submit remain usable", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Resilience matrix is covered once with explicit viewports.",
  );
  const token = `A5${Date.now()}`;
  const customerName =
    `${token} ${"International Commercial Customer ".repeat(7)}`.slice(0, 160);
  const productSku = `${token}-MAX`.slice(0, 64);
  const productDescription =
    `${"Expanded multilingual quotation description — नमस्ते — مرحباً — ".repeat(8)}safe text`.slice(
      0,
      500,
    );

  await signIn(page);
  await page.goto("/customers");
  await page.locator("summary", { hasText: "Create customer" }).click();
  await page.getByLabel("Customer name").fill(customerName);
  await page
    .getByLabel("Billing address")
    .fill("42 International Commerce Way");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("status")).toContainText("was created");

  await page.goto("/catalog");
  await page.locator("summary", { hasText: "Create product" }).click();
  await page.getByLabel("SKU").fill(productSku);
  await page.getByLabel("Description").fill(productDescription);
  await page.getByLabel("Unit price").fill("9999999999999.99");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("status")).toContainText(productSku);

  await page.goto("/quotes/new");
  await page.getByLabel("Customer").selectOption({ label: customerName });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page
    .getByLabel("Catalog product")
    .selectOption({ label: `${productSku} — ${productDescription}` });
  await page.getByRole("button", { name: "Add product" }).click();
  await waitForAuthoritativeSave(page);
  await page.reload();
  await expect(page.getByText(productSku, { exact: true })).toBeVisible();
  await expect(page.locator(".quote-lines .money").first()).toContainText(
    /[0-9]/,
  );

  const effectiveWidths = [
    { label: "390px phone", width: 390, height: 844 },
    { label: "768px tablet", width: 768, height: 1024 },
    { label: "1440px desktop", width: 1440, height: 1000 },
    { label: "125% effective desktop", width: 1152, height: 800 },
    { label: "150% effective desktop", width: 960, height: 720 },
  ];
  for (const viewport of effectiveWidths) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await expectNoPageOverflow(page);
      await expect(
        page.getByRole("region", { name: "Quotation items table" }),
      ).toBeVisible();
    });
  }

  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).direction,
    ),
  ).toBe("rtl");
  await expectNoPageOverflow(page);
  await expect(
    page.getByText(productDescription, { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dir = "ltr";
  });

  await page.getByLabel("Discount percent").focus();
  await page.keyboard.press(`${modifier}+Enter`);
  await expect(page.locator(".state-label")).toHaveText("Approved", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Issue quote" }).press("Enter");
  await expect(page.locator(".state-label")).toHaveText("Issued", {
    timeout: 20_000,
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toBeVisible();
  await expect(
    page
      .locator(".print-document")
      .getByText(productDescription, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".print-totals")).toHaveCount(1);
});
