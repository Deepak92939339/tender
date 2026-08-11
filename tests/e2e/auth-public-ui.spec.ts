import { expect, test } from "@playwright/test";

test("sign-in uses the public editorial system without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1998, height: 1000 });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`sign-in-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
