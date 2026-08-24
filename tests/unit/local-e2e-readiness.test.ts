import { describe, expect, it, vi } from "vitest";
import { waitForLocalSupabaseReadiness } from "../e2e/local-readiness.ts";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("local E2E readiness", () => {
  it("retries until Auth and the nested membership schema are ready", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ access_token: "local-token" }))
      .mockResolvedValueOnce(
        response(
          { code: "PGRST200", message: "relationship unavailable" },
          400,
        ),
      )
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ access_token: "local-token" }))
      .mockResolvedValueOnce(response([{ organization_id: "demo" }]));

    await expect(
      waitForLocalSupabaseReadiness("http://127.0.0.1:54321", "anon", {
        attempts: 3,
        fetcher,
      }),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("refuses a non-loopback API", async () => {
    await expect(
      waitForLocalSupabaseReadiness("https://example.com", "anon"),
    ).rejects.toThrow("non-loopback");
  });
});
