import { describe, expect, it, vi } from "vitest";
import { createPublicBrokerInvoker } from "../../lib/public-quotes/edge-client.ts";
import {
  handlePublicQuoteActionPost,
  handlePublicQuoteSessionDelete,
  handlePublicQuoteSessionPost,
  handlePublicQuoteVerifyPost,
  type PublicQuoteRouteDependencies,
} from "../../lib/public-quotes/route-handlers.ts";
import {
  decryptPublicQuoteCapability,
  encryptPublicQuoteCapability,
  PUBLIC_QUOTE_COOKIE_NAME,
} from "../../lib/public-quotes/session-cookie.ts";
import {
  decodeCanonicalBase64url,
  encodeBase64url,
} from "../../lib/public-quotes/base64url.ts";
import {
  NEXT_PUBLIC_REQUEST_MAX_BYTES,
  parseActionRequest,
  parseSessionRequest,
} from "../../lib/public-quotes/route-validation.ts";
import {
  trustedClientAddressFromNext,
  verifySignedBrokerTransport,
} from "../../lib/public-quotes/transport.ts";

const selector = "10000000-0000-4000-8000-000000000001";
const idempotencyKey = "20000000-0000-4000-8000-000000000001";
const shareSecret = "A".repeat(43);
const transportSecret = "unit-transport-secret-with-more-than-thirty-two-bytes";
const sessionSecret = "unit-session-key-with-more-than-thirty-two-bytes";
const origin = "https://quotes.example.test";

function request(
  path: string,
  body?: unknown,
  options: {
    origin?: string | null;
    contentType?: string;
    cookie?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (body !== undefined) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function dependencies(
  broker: PublicQuoteRouteDependencies["broker"],
): PublicQuoteRouteDependencies {
  return {
    broker,
    sessionSecret,
    secureCookies: true,
    now: () => Math.floor(Date.now() / 1_000),
  };
}

function cookiePair(response: Response) {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

describe("public quote capability cookie", () => {
  it("round-trips only encrypted minimum capability material", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const token = await encryptPublicQuoteCapability(
      { version: 1, selector, secret: shareSecret, expiresAt: now + 300 },
      sessionSecret,
    );
    expect(token).not.toContain(selector);
    expect(token).not.toContain(shareSecret);
    await expect(
      decryptPublicQuoteCapability(token, sessionSecret, now),
    ).resolves.toEqual({
      version: 1,
      selector,
      secret: shareSecret,
      expiresAt: now + 300,
    });
  });

  it("rejects decoded ciphertext bytes, decoded tag bytes, and expiry tampering", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const token = await encryptPublicQuoteCapability(
      { version: 1, selector, secret: shareSecret, expiresAt: now + 300 },
      sessionSecret,
    );
    const parts = token.split(".");
    const encrypted = decodeCanonicalBase64url(parts[2]!);
    const tamperedCiphertext = encrypted.slice();
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 1;
    const tamperedTag = encrypted.slice();
    tamperedTag[tamperedTag.length - 1] =
      tamperedTag[tamperedTag.length - 1]! ^ 1;
    await expect(
      decryptPublicQuoteCapability(
        `${parts[0]}.${parts[1]}.${encodeBase64url(tamperedCiphertext)}`,
        sessionSecret,
        now,
      ),
    ).rejects.toThrow(/invalid encrypted session/i);
    await expect(
      decryptPublicQuoteCapability(
        `${parts[0]}.${parts[1]}.${encodeBase64url(tamperedTag)}`,
        sessionSecret,
        now,
      ),
    ).rejects.toThrow(/invalid encrypted session/i);
    await expect(
      decryptPublicQuoteCapability(token, sessionSecret, now + 301),
    ).rejects.toThrow(/invalid encrypted session/i);
  });

  it("rejects malformed and alternate non-canonical base64url spellings", async () => {
    const now = 1_800_000_000;
    const token = await encryptPublicQuoteCapability(
      { version: 1, selector, secret: shareSecret, expiresAt: now + 300 },
      sessionSecret,
    );
    const parts = token.split(".");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const ciphertext = parts[2]!;
    expect(ciphertext.length % 4).not.toBe(0);
    const canonicalIndex = alphabet.indexOf(ciphertext.at(-1)!);
    const alternate = `${ciphertext.slice(0, -1)}${alphabet[canonicalIndex + 1]}`;
    await expect(
      decryptPublicQuoteCapability(
        `${parts[0]}.${parts[1]}.${alternate}`,
        sessionSecret,
        now,
      ),
    ).rejects.toThrow(/invalid encrypted session/i);
    await expect(
      decryptPublicQuoteCapability("v1.invalid=.invalid", sessionSecret, now),
    ).rejects.toThrow(/invalid encrypted session/i);
    expect(() => decodeCanonicalBase64url("AB")).toThrow(/invalid base64url/i);
  });
});

describe("public quote route boundary", () => {
  it("exchanges selector and raw secret for a hardened encrypted cookie", async () => {
    const broker = vi.fn(async () => ({
      httpStatus: 200,
      result: {
        status: "ok" as const,
        value: { quoteNumber: "TND-2026-0001", effectiveState: "issued" },
      },
    }));
    const response = await handlePublicQuoteSessionPost(
      request("/api/public-quotes/session", { selector, secret: shareSecret }),
      dependencies(broker),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      quoteNumber: "TND-2026-0001",
      effectiveState: "issued",
    });
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${PUBLIC_QUOTE_COOKIE_NAME}=v1.`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/public-quotes");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).not.toContain(selector);
    expect(setCookie).not.toContain(shareSecret);
    expect(broker).toHaveBeenCalledWith(
      "open",
      { action: "open", selector, secret: shareSecret },
      expect.any(Headers),
    );
  });

  it("reads capability only from the cookie and preserves idempotency", async () => {
    const openBroker = vi.fn(async () => ({
      httpStatus: 200,
      result: { status: "ok" as const, value: { quoteNumber: "TND-1" } },
    }));
    const opened = await handlePublicQuoteSessionPost(
      request("/api/public-quotes/session", { selector, secret: shareSecret }),
      dependencies(openBroker),
    );
    const broker = vi.fn(async () => ({
      httpStatus: 200,
      result: {
        status: "ok" as const,
        value: { type: "viewed", eventId: selector },
      },
    }));
    const response = await handlePublicQuoteActionPost(
      request(
        "/api/public-quotes/action",
        { action: "record_event", eventType: "viewed", idempotencyKey },
        { cookie: cookiePair(opened) },
      ),
      dependencies(broker),
    );
    expect(response.status).toBe(200);
    expect(broker).toHaveBeenCalledWith(
      "record_event",
      {
        action: "record_event",
        eventType: "viewed",
        idempotencyKey,
        selector,
        secret: shareSecret,
      },
      expect.any(Headers),
    );
    expect(() =>
      parseActionRequest({
        action: "record_event",
        eventType: "viewed",
        idempotencyKey,
        secret: shareSecret,
      }),
    ).toThrow(/invalid/i);
  });

  it("clears invalid, terminal, and explicitly deleted sessions", async () => {
    const terminalBroker = vi.fn(async () => ({
      httpStatus: 410,
      result: { status: "revoked" },
    }));
    const failed = await handlePublicQuoteSessionPost(
      request("/api/public-quotes/session", { selector, secret: shareSecret }),
      dependencies(terminalBroker),
    );
    expect(failed.headers.get("set-cookie")).toContain("Max-Age=0");

    const invalid = await handlePublicQuoteActionPost(
      request(
        "/api/public-quotes/action",
        { action: "record_event", eventType: "viewed", idempotencyKey },
        { cookie: `${PUBLIC_QUOTE_COOKIE_NAME}=v1.invalid.invalid` },
      ),
      dependencies(terminalBroker),
    );
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toContain("Max-Age=0");

    const deleted = await handlePublicQuoteSessionDelete(
      new Request(`${origin}/api/public-quotes/session`, {
        method: "DELETE",
        headers: { origin },
      }),
      dependencies(terminalBroker),
    );
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    ["missing origin", { origin: null }, 403],
    ["cross origin", { origin: "https://evil.example" }, 403],
    ["wrong content type", { contentType: "text/plain" }, 415],
  ])("rejects %s", async (_label, options, status) => {
    const broker = vi.fn();
    const response = await handlePublicQuoteSessionPost(
      request(
        "/api/public-quotes/session",
        { selector, secret: shareSecret },
        options,
      ),
      dependencies(broker),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(broker).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and oversized bodies before broker access", async () => {
    expect(() =>
      parseSessionRequest({
        selector,
        secret: shareSecret,
        organizationId: selector,
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      parseSessionRequest({
        selector,
        secret: `${shareSecret.slice(0, -1)}B`,
      }),
    ).toThrow(/invalid/i);
    const broker = vi.fn();
    const response = await handlePublicQuoteSessionPost(
      request("/api/public-quotes/session", {
        selector,
        secret: shareSecret,
        padding: "x".repeat(NEXT_PUBLIC_REQUEST_MAX_BYTES),
      }),
      dependencies(broker),
    );
    expect(response.status).toBe(413);
    expect(broker).not.toHaveBeenCalled();
  });

  it("sends verification without reading or creating a session cookie", async () => {
    const broker = vi.fn(async () => ({
      httpStatus: 200,
      result: { status: "ok" as const, value: { verified: true } },
    }));
    const response = await handlePublicQuoteVerifyPost(
      request("/api/public-quotes/verify", {
        verificationCode: "a".repeat(32),
      }),
      dependencies(broker),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(broker).toHaveBeenCalledWith(
      "verify",
      { action: "verify", verificationCode: "A".repeat(32) },
      expect.any(Headers),
    );
  });

  it("normalizes internal failures without logging request capability material", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const broker = vi.fn(async () => {
      throw new Error(
        JSON.stringify({
          selector,
          secret: shareSecret,
          organizationId: selector,
        }),
      );
    });
    const response = await handlePublicQuoteSessionPost(
      request("/api/public-quotes/session", { selector, secret: shareSecret }),
      dependencies(broker),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    const serialized = JSON.stringify(logs.mock.calls);
    expect(serialized).not.toContain(selector);
    expect(serialized).not.toContain(shareSecret);
    expect(serialized).toContain("session_broker_unknown");
    logs.mockRestore();
  });
});

describe("Next-to-Edge client address integrity", () => {
  it("uses Vercel's overwritten address only in the documented Vercel runtime", () => {
    const headers = new Headers({ "x-forwarded-for": "192.0.2.25" });
    expect(trustedClientAddressFromNext(headers, true)).toBe(
      "vercel-ip:v1:192.0.2.25",
    );
    expect(trustedClientAddressFromNext(headers, false)).toBe(
      "unattributed:v1",
    );
    headers.set("x-forwarded-for", "192.0.2.25, 203.0.113.1");
    expect(trustedClientAddressFromNext(headers, true)).toBe("unattributed:v1");
  });

  it("signs the exact body and ignores spoofed address headers outside Vercel", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (_input, init) => {
      const body = String(init?.body);
      const verified = await verifySignedBrokerTransport({
        method: String(init?.method),
        headers: new Headers(init?.headers),
        bodyBytes: new TextEncoder().encode(body),
        secret: transportSecret,
      });
      expect(verified.clientAddress).toBe("unattributed:v1");
      return new Response(JSON.stringify({ status: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    const invoke = createPublicBrokerInvoker({
      supabaseUrl: "http://127.0.0.1:54321",
      anonKey: "public-test-key",
      transportSecret,
      isVercelRuntime: false,
      fetchImplementation: fakeFetch,
    });
    const result = await invoke(
      "verify",
      { action: "verify", verificationCode: "A".repeat(32) },
      new Headers({
        "x-forwarded-for": "203.0.113.99",
        "x-real-ip": "203.0.113.98",
        "cf-connecting-ip": "203.0.113.97",
      }),
    );
    expect(result).toEqual({
      httpStatus: 404,
      result: { status: "not_found" },
    });
  });

  it("rejects an Edge response outside the fixed verification projection", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const invoke = createPublicBrokerInvoker({
      supabaseUrl: "http://127.0.0.1:54321",
      anonKey: "public-test-key",
      transportSecret,
      fetchImplementation: vi.fn(async () =>
        Response.json({
          status: "ok",
          value: {
            verified: true,
            quoteNumber: "TND-1",
            revisionNumber: 1,
            sellerLegalName: "Seller",
            currencyCode: "USD",
            totalMinor: 100,
            issuedAt: null,
            acceptedAt: null,
            snapshotHash: null,
            calculationFingerprint: null,
            organizationId: selector,
          },
        }),
      ),
    });
    await expect(
      invoke(
        "verify",
        { action: "verify", verificationCode: "A".repeat(32) },
        new Headers(),
      ),
    ).rejects.toThrow(/unavailable/i);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(selector);
    logs.mockRestore();
  });
});
