const operatorId = "11111111-1111-4111-8111-111111111111";

type Fetcher = typeof fetch;

export async function waitForLocalSupabaseReadiness(
  apiUrl: string,
  anonKey: string,
  options: { attempts?: number; fetcher?: Fetcher } = {},
) {
  const endpoint = new URL(apiUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) {
    throw new Error("Local readiness refuses a non-loopback Supabase API.");
  }

  const attempts = options.attempts ?? 60;
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const health = await fetcher(`${endpoint.origin}/auth/v1/health`);
      if (!health.ok) throw new Error("Auth is not ready.");

      const tokenResponse = await fetcher(
        `${endpoint.origin}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: { apikey: anonKey, "content-type": "application/json" },
          body: JSON.stringify({
            email: "operator@tender.local",
            password: "TenderLocal1!",
          }),
        },
      );
      if (!tokenResponse.ok) throw new Error("Seeded Auth user is not ready.");
      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!token.access_token) throw new Error("Auth token is unavailable.");

      const query = new URL(
        `${endpoint.origin}/rest/v1/organization_memberships`,
      );
      query.searchParams.set(
        "select",
        "organization_id,status,created_at,roles!inner(key,label),organizations!inner(id,slug,name,default_currency_code,default_locale,approval_threshold_bps,timezone)",
      );
      query.searchParams.set("user_id", `eq.${operatorId}`);
      query.searchParams.set("status", "eq.active");
      query.searchParams.set("order", "created_at.asc");
      const membership = await fetcher(query, {
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${token.access_token}`,
        },
      });
      if (!membership.ok) throw new Error("PostgREST schema is not ready.");
      const rows = (await membership.json()) as unknown[];
      if (rows.length !== 1) throw new Error("Seeded membership is not ready.");
      return;
    } catch {
      if (attempt + 1 === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    "Local Supabase did not expose the authenticated organization context in time.",
  );
}
