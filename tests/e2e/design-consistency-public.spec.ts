import { expect, test } from "@playwright/test";

for (const [label, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`captures the ${label} public and sign-in compositions`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Priced once. Approved on the record. Issued unchanged.",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`landing-${label}.png`),
      fullPage: true,
    });

    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`sign-in-${label}.png`),
      fullPage: true,
    });
  });
}
