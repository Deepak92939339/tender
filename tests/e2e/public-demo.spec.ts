import { expect, test } from "@playwright/test";

test("public decision room offers a calculator-backed anonymous sample", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Desktop composition only.",
  );
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).not.toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await expect(
    page.getByRole("heading", {
      name: "Priced once. Approved on the record. Issued unchanged.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Build a sample quote" }),
  ).toHaveAttribute("href", "#sample-builder");
  await expect(
    page.locator(".decision-documents").getByLabel("INR sample quotation"),
  ).toBeVisible();
  await expect(
    page.locator(".decision-documents").getByLabel("USD sample quotation"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("public-demo-wide-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: testInfo.outputPath("public-demo-laptop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Build a sample quote" }).click();
  await expect(
    page.getByRole("heading", { name: "Build a sample quote" }),
  ).toBeVisible();
  await expect(page.getByLabel("Live sample quotation document")).toContainText(
    "INR",
  );
  await expect(page.getByLabel("Live sample quotation document")).toContainText(
    "Final amounts include the line discount and tax.",
  );
  await page.locator(".sample-editor select").first().selectOption("USD");
  await expect(page.getByLabel("Live sample quotation document")).toContainText(
    "USD",
  );
  await page.screenshot({
    path: testInfo.outputPath("public-demo-builder-usd.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByLabel("Live sample quotation document")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save/Print as PDF" }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("public-demo-print.png"),
    fullPage: true,
  });
});

test("mobile uses document tabs and a single selectable hero document", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "Mobile composition only.",
  );
  await page.goto("/");
  await expect(
    page
      .locator(".decision-mobile-document")
      .getByLabel("INR sample quotation"),
  ).toBeVisible();
  await page.getByRole("button", { name: "USD" }).click();
  await expect(
    page
      .locator(".decision-mobile-document")
      .getByLabel("USD sample quotation"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Build a sample quote" }).click();
  await page.getByRole("tab", { name: "Document" }).click();
  await expect(page.getByLabel("Live sample quotation document")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("public-demo-mobile-document.png"),
    fullPage: true,
  });
});
