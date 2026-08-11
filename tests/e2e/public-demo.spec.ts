import { expect, test } from "@playwright/test";

test("public specimen uses all five exponent-aware markets and live authoritative totals", async ({
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
  await page.evaluate(() =>
    (globalThis.document.activeElement as HTMLElement | null)?.blur(),
  );
  await expect(
    page.getByRole("heading", {
      name: "Priced once. Approved on the record. Issued unchanged.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Try it — no account" }).click();
  const preview = page.getByLabel("Live sample quotation document");
  const market = page.getByLabel("Market");
  await expect(market.locator("option")).toHaveCount(5);
  for (const [value, currency, decimals] of [
    ["india", "INR", 2],
    ["canada", "CAD", 2],
    ["kuwait", "KWD", 3],
    ["japan", "JPY", 0],
    ["united-states", "USD", 2],
  ] as const) {
    await market.selectOption(value);
    const amount = await preview.locator(".sample-total dd").textContent();
    expect(amount).toContain(currency);
    expect(amount ?? "").toMatch(
      decimals === 0
        ? /\d(?:,\d{3})*(?!\.\d)/
        : new RegExp(`\\.\\d{${decimals}}`),
    );
  }
  await market.selectOption("india");
  await page.getByLabel("Tax presentation").selectOption("india-inter");
  await expect(preview).toContainText("IGST 18%");
  await page.getByLabel("Tax presentation").selectOption("india-intra");
  await expect(preview).toContainText("CGST 9%");
  await expect(preview).toContainText("SGST 9%");
  await market.selectOption("canada");
  await page.getByLabel("Tax presentation").selectOption("canada-on");
  await expect(preview).toContainText("HST 13%");
  await page.getByLabel("Tax presentation").selectOption("canada-bc");
  await expect(preview).toContainText("GST 5%");
  await expect(preview).toContainText("PST 7%");
  const before = await preview.locator(".sample-total dd").textContent();
  await page
    .locator(".sample-editor-line")
    .first()
    .getByLabel("Unit price")
    .fill("200");
  await expect(preview.locator(".sample-total dd")).not.toHaveText(
    before ?? "",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("public-demo-1440x900.png"),
    fullPage: true,
  });
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(
        `public-demo-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
    });
  }
  await page.emulateMedia({ media: "print" });
  await expect(preview).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save/Print as PDF" }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("public-demo-print.png"),
    fullPage: true,
  });
  await page.pdf({
    path: testInfo.outputPath("public-demo-a4.pdf"),
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
});

test("mobile form and document tabs move both selection and focus", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "Mobile composition only.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#sample-builder");
  const formTab = page.getByRole("tab", { name: "Form" });
  const documentTab = page.getByRole("tab", { name: "Document" });
  await formTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(documentTab).toBeFocused();
  await expect(documentTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Live sample quotation document")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(formTab).toBeFocused();
  await expect(formTab).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("public-demo-390x844.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await documentTab.click();
  await page.screenshot({
    path: testInfo.outputPath("public-demo-768x1024.png"),
    fullPage: true,
  });
});
