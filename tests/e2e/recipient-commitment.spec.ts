import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  makeRecipientRevisionStale,
  provisionRecipientFixture,
  provisionSiblingCapability,
  type RecipientCapability,
} from "./recipient-local-fixture";

test.use({ trace: "off", screenshot: "off", video: "off" });

const statement =
  "I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.";

async function openRecipient(page: Page, fixture: RecipientCapability) {
  await page.goto(`/quote/${fixture.selector}#secret=${fixture.secret}`);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(page.getByRole("heading", { name: /^TND-/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(fixture.secret);
  expect(page.url()).not.toContain(fixture.secret);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "tender-public-quote-v1",
  );
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Strict");
}

function sessionCookieHeader(
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
) {
  const cookie = cookies.find(
    (candidate) => candidate.name === "tender-public-quote-v1",
  );
  if (!cookie) throw new Error("Encrypted recipient session was not created.");
  return `${cookie.name}=${cookie.value}`;
}

test("recipient acceptance uses authoritative statement and encrypted session", async ({
  page,
  context,
}) => {
  const fixture = provisionRecipientFixture();
  await openRecipient(page, fixture);
  await expect(page.getByText("Issued", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept quotation" }).click();
  const dialog = page.getByRole("dialog", { name: "Accept quotation" });
  await expect(dialog).toContainText(statement);
  await expect(dialog.getByLabel("Buyer-asserted full name")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Accept quotation" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Buyer-asserted full name")).toBeFocused();
  await dialog.getByRole("button", { name: "Accept quotation" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Buyer-asserted full name").fill("A".repeat(201));
  await dialog.getByRole("button", { name: "Accept quotation" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Buyer-asserted full name").fill("Recipient Buyer");
  await dialog
    .getByLabel("Buyer-asserted title (optional)")
    .fill("T".repeat(201));
  await dialog.getByRole("button", { name: "Accept quotation" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByLabel("Buyer-asserted title (optional)")
    .fill("Procurement Lead");
  const cookieHeader = sessionCookieHeader(await context.cookies());
  let acceptanceRequest: Record<string, unknown> | null = null;
  await page.route("**/api/public-quotes/action", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === "accept") {
      acceptanceRequest = body;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Accept quotation" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("Acceptance recorded", { exact: true }),
  ).toBeVisible();
  const capturedAcceptanceRequest = acceptanceRequest as unknown as Record<
    string,
    unknown
  >;
  expect(capturedAcceptanceRequest.acceptanceStatementVersion).toBe(1);
  const replay = await page.request.post("/api/public-quotes/action", {
    headers: {
      origin: "http://localhost:3000",
      cookie: cookieHeader,
    },
    data: capturedAcceptanceRequest,
  });
  expect(replay.status()).toBe(200);
  const replayEvidence = (await replay.json()) as {
    replayed?: boolean;
    acceptanceStatement?: string;
  };
  expect(replayEvidence.replayed).toBe(true);
  expect(replayEvidence.acceptanceStatement).toBe(statement);
  const cookies = await context.cookies();
  expect(
    cookies.some((cookie) => cookie.name === "tender-public-quote-v1"),
  ).toBe(false);
});

test("recipient change request, decline, verification and session boundaries", async ({
  page,
}) => {
  const change = provisionRecipientFixture();
  await openRecipient(page, change);
  await page.getByRole("button", { name: "Request changes" }).click();
  const changeDialog = page.getByRole("dialog", { name: "Request changes" });
  const message = changeDialog.getByLabel("Message to the issuer");
  await expect(message).toHaveAttribute("maxlength", "2000");
  await message.fill("x".repeat(2000));
  await expect(changeDialog.getByText("2000/2,000 characters")).toBeVisible();
  await changeDialog
    .getByRole("button", { name: "Send change request" })
    .click();
  await expect(
    changeDialog.getByText("Your change request was recorded."),
  ).toBeVisible();

  const decline = provisionRecipientFixture();
  await page.goto("/");
  await openRecipient(page, decline);
  const trigger = page.getByRole("button", { name: "Decline" });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Decline quotation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Confirm decline" }).click();
  await expect(page.getByText("Your decline was recorded.")).toBeVisible();

  const verify = provisionRecipientFixture();
  await page.goto("/");
  await openRecipient(page, verify);
  const grouped = verify.verificationCode
    .toLowerCase()
    .match(/.{1,8}/g)!
    .join(" ");
  await page.getByLabel("Verification code").fill(grouped);
  await page.getByRole("button", { name: "Verify record" }).click();
  await expect(page.getByText(/^Verified ·/)).toBeVisible();
});

test("recipient terminal responses allow only one winner", async ({
  browser,
  page,
}) => {
  const fixture = provisionRecipientFixture();
  const competing = provisionSiblingCapability(fixture);
  const competingContext = await browser.newContext();
  const competingPage = await competingContext.newPage();
  try {
    await openRecipient(page, fixture);
    await openRecipient(competingPage, competing);
    await page.getByRole("button", { name: "Accept quotation" }).click();
    const dialog = page.getByRole("dialog", { name: "Accept quotation" });
    await dialog.getByLabel("Buyer-asserted full name").fill("Winning Buyer");
    await dialog.getByRole("button", { name: "Accept quotation" }).click();
    await expect(
      page.getByText("Acceptance recorded", { exact: true }),
    ).toBeVisible();
    await competingPage.getByRole("button", { name: "Decline" }).click();
    await competingPage
      .getByRole("button", { name: "Confirm decline" })
      .click();
    await expect(
      competingPage.getByText("This quotation has already been accepted."),
    ).toBeVisible();
  } finally {
    await competingContext.close();
  }
});

test("recipient handles stale and invalid sessions and prints only the document", async ({
  page,
}) => {
  const stale = provisionRecipientFixture();
  await openRecipient(page, stale);
  makeRecipientRevisionStale(stale);
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByRole("button", { name: "Confirm decline" }).click();
  await expect(
    page.getByText("This quotation revision has been superseded."),
  ).toBeVisible();

  const printable = provisionRecipientFixture();
  await page.goto("/");
  await openRecipient(page, printable);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".recipient-document")).toBeVisible();
  await expect(page.locator(".recipient-actions")).toBeHidden();
  await expect(page.locator(".recipient-verification")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.context().clearCookies();
  await page.reload();
  await expect(
    page.getByText("This quotation link is not valid."),
  ).toBeVisible();
});
