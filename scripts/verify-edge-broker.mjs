import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectId = "tender-local-visual-study";
const databaseContainer = `supabase_db_${projectId}`;
const hmacSecretName = "PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET";
const hmacSecret = randomBytes(48).toString("base64url");
const transportSecretName = "TENDER_EDGE_BROKER_TRANSPORT_SECRET";
const transportSecret = randomBytes(48).toString("base64url");
const sessionSecretName = "TENDER_PUBLIC_SESSION_ENCRYPTION_KEY";
const sessionSecret = randomBytes(48).toString("base64url");
const nextPort = 3117;
const nextOrigin = `http://localhost:${nextPort}`;
const runId = randomBytes(8).toString("hex");
const marker = `edge-broker-integration:${runId}`;
const localOnlyEnvironment = {
  ...process.env,
  DO_NOT_TRACK: "1",
  SUPABASE_TELEMETRY_DISABLED: "1",
};
let checks = 0;
let functionProcess;
let nextProcess;
let functionDiagnostic = "";
let nextDiagnostic = "";
let temporaryDirectory;
let rateBucketStartedAt;

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
  checks += 1;
}

function safeDiagnostic(value) {
  return String(value ?? "")
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted-jwt]")
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, "[redacted-token]")
    .replace(/\b[A-F0-9]{32}\b/g, "[redacted-code]")
    .replace(/[\w.+-]+@[\w.-]+/g, "[redacted-email]")
    .slice(0, 2_000);
}

function command(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: localOnlyEnvironment,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} failed: ${safeDiagnostic(result.stderr)}`);
  }
  return result.stdout.trim();
}

function psql(sql) {
  return command("docker", [
    "exec",
    databaseContainer,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-q",
    "-c",
    sql,
  ]);
}

function localStatus() {
  const raw = command("./node_modules/.bin/supabase", ["status", "-o", "json"]);
  const status = JSON.parse(raw);
  const apiUrl = new URL(status.API_URL);
  if (apiUrl.hostname !== "127.0.0.1" && apiUrl.hostname !== "localhost") {
    fail("The Supabase target is not loopback-only.");
  }
  if (typeof status.ANON_KEY !== "string" || !status.ANON_KEY) {
    fail("The local public key is unavailable.");
  }
  return { apiUrl: apiUrl.origin, anonKey: status.ANON_KEY };
}

function startFunctionServer() {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "tender-edge-broker-"));
  const environmentFile = join(temporaryDirectory, "edge.env");
  writeFileSync(
    environmentFile,
    `${hmacSecretName}=${hmacSecret}\n${transportSecretName}=${transportSecret}\n`,
    { mode: 0o600 },
  );
  functionProcess = spawn(
    "./node_modules/.bin/supabase",
    [
      "functions",
      "serve",
      "trusted-public-broker",
      "--no-verify-jwt",
      "--env-file",
      environmentFile,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...localOnlyEnvironment,
        [hmacSecretName]: hmacSecret,
        [transportSecretName]: transportSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const capture = (chunk) => {
    functionDiagnostic = safeDiagnostic(`${functionDiagnostic}${chunk}`).slice(
      -2_000,
    );
  };
  functionProcess.stdout.on("data", capture);
  functionProcess.stderr.on("data", capture);
}

async function waitForFunction(endpoint, anonKey) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (functionProcess.exitCode !== null) {
      fail(
        `The local Edge runtime stopped before becoming ready. ${functionDiagnostic || "No runtime diagnostic was emitted."}`,
      );
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "verify",
          verificationCode: "0".repeat(32),
        }),
        signal: AbortSignal.timeout(1_500),
      });
      const responseText = await response.text();
      try {
        const body = JSON.parse(responseText);
        if (
          body?.status === "invalid_request" ||
          body?.status === "unavailable"
        ) {
          return;
        }
      } catch {
        // The gateway route is not registered yet.
      }
    } catch {
      // The loopback Edge runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(
    `The local Edge runtime did not become ready. ${functionDiagnostic || "No runtime diagnostic was emitted."}`,
  );
}

function startNextServer(apiUrl, anonKey) {
  nextProcess = spawn(
    "./node_modules/.bin/next",
    ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(nextPort)],
    {
      cwd: process.cwd(),
      env: {
        ...localOnlyEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: apiUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        [transportSecretName]: transportSecret,
        [sessionSecretName]: sessionSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const capture = (chunk) => {
    nextDiagnostic = safeDiagnostic(`${nextDiagnostic}${chunk}`).slice(-2_000);
  };
  nextProcess.stdout.on("data", capture);
  nextProcess.stderr.on("data", capture);
}

async function waitForNext() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (nextProcess.exitCode !== null) {
      fail(
        `The local Next runtime stopped before becoming ready. ${nextDiagnostic || "No runtime diagnostic was emitted."}`,
      );
    }
    try {
      const response = await fetch(`${nextOrigin}/`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // The loopback Next runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(
    `The local Next runtime did not become ready. ${nextDiagnostic || "No runtime diagnostic was emitted."}`,
  );
}

function fixtureSql() {
  return `
begin;
create temporary table edge_broker_fixtures (scenario text primary key, value jsonb not null);
grant all on edge_broker_fixtures to authenticated;
create or replace function pg_temp.make_edge_quote(p_scenario text, p_links integer)
returns jsonb language plpgsql as $$
declare
  created jsonb;
  quote_id uuid;
  revision_id uuid;
  shared jsonb;
  links jsonb := '[]'::jsonb;
  verification_code text;
begin
  created := public.create_verified_quote_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3000000-0000-4000-8000-000000000001',
    'INR', 'en-IN', 'GST 18%', 'exclusive', current_date, current_date + 30,
    extensions.gen_random_uuid()
  );
  quote_id := (created->>'id')::uuid;
  revision_id := (created->>'current_revision_id')::uuid;
  perform public.save_quote_draft(
    quote_id, 1, extensions.gen_random_uuid(),
    jsonb_build_object(
      'customer_id', 'a3000000-0000-4000-8000-000000000001',
      'currency_code', 'INR', 'locale', 'en-IN', 'tax_label', 'GST 18%',
      'tax_mode', 'exclusive', 'discount_bps', 0,
      'issue_date', current_date, 'valid_until', current_date + 30,
      'notes', '${marker}:' || p_scenario,
      'items', jsonb_build_array(jsonb_build_object(
        'line_id', null,
        'product_id', 'a2000000-0000-4000-8000-000000000001',
        'position', 1, 'quantity_scaled', 1, 'quantity_scale', 1
      )),
      'charges', '[]'::jsonb
    )
  );
  perform public.submit_quote_revision(quote_id, revision_id, 2, extensions.gen_random_uuid());
  perform public.issue_quote_revision(quote_id, revision_id, 3, extensions.gen_random_uuid());
  for index in 1..p_links loop
    shared := public.create_quote_share_link(
      quote_id, revision_id, 4,
      p_scenario || '-' || index || '@example.test',
      now() + interval '7 days', extensions.gen_random_uuid()
    );
    links := links || jsonb_build_array(jsonb_build_object(
      'id', shared->>'link_id', 'selector', shared->>'selector', 'secret', shared->>'secret'
    ));
  end loop;
  select r.verification_code into verification_code
  from public.quote_revisions r where r.id = revision_id;
  return jsonb_build_object(
    'quoteId', quote_id, 'revisionId', revision_id,
    'verificationCode', verification_code, 'links', links
  );
end;
$$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into edge_broker_fixtures values
  ('change', pg_temp.make_edge_quote('change', 1)),
  ('decline', pg_temp.make_edge_quote('decline', 1)),
  ('accept', pg_temp.make_edge_quote('accept', 1)),
  ('compete', pg_temp.make_edge_quote('compete', 2)),
  ('expired', pg_temp.make_edge_quote('expired', 1)),
  ('revoked', pg_temp.make_edge_quote('revoked', 1)),
  ('superseded', pg_temp.make_edge_quote('superseded', 1));
reset role;
update public.quote_share_links
set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where id = ((select value from edge_broker_fixtures where scenario = 'expired')#>>'{links,0,id}')::uuid;
set local role authenticated;
do $block$
begin
  perform public.revoke_quote_share_link(
    ((select value from edge_broker_fixtures where scenario = 'revoked')->>'quoteId')::uuid,
    ((select value from edge_broker_fixtures where scenario = 'revoked')#>>'{links,0,id}')::uuid,
    4, extensions.gen_random_uuid()
  );
  perform public.begin_quote_revision(
    ((select value from edge_broker_fixtures where scenario = 'superseded')->>'quoteId')::uuid,
    ((select value from edge_broker_fixtures where scenario = 'superseded')->>'revisionId')::uuid,
    4, extensions.gen_random_uuid()
  );
end;
$block$;
reset role;
select jsonb_object_agg(scenario, value) from edge_broker_fixtures;
commit;`;
}

function rateSubject(clientAddress = "unattributed:v1") {
  return createHmac("sha256", hmacSecret)
    .update(`trusted-public-broker:v2\0${clientAddress}`)
    .digest("hex");
}

function selectorSubject(selector) {
  return createHash("sha256").update(selector).digest("hex");
}

function codeSubject(code) {
  return createHash("sha256").update(code).digest("hex");
}

async function localFetch(url, init) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch {
      if (attempt === 2) fail("A loopback HTTP request failed after retries.");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  fail("A loopback HTTP request failed.");
}

async function unsignedEdgeCall(endpoint, anonKey, body) {
  const response = await localFetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.200",
      "x-real-ip": "203.0.113.201",
      "cf-connecting-ip": "203.0.113.202",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const responseText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    fail(
      `The Edge response was not JSON (HTTP ${response.status}): ${safeDiagnostic(responseText)}`,
    );
  }
  return { response, body: parsed };
}

const sessionCookies = new Map();

async function nextRouteCall(path, body, cookie, method = "POST") {
  const headers = {
    origin: nextOrigin,
    "x-forwarded-for": "203.0.113.200",
    "x-real-ip": "203.0.113.201",
    "cf-connecting-ip": "203.0.113.202",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await localFetch(`${nextOrigin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(
        `The Next response was not JSON (HTTP ${response.status}): ${safeDiagnostic(text)}`,
      );
    }
  }
  return { response, body: parsed };
}

async function nextBrokerCall(body) {
  if (body.action === "open") {
    const result = await nextRouteCall("/api/public-quotes/session", {
      selector: body.selector,
      secret: body.secret,
    });
    if (result.response.ok) {
      const cookie = result.response.headers
        .get("set-cookie")
        ?.split(";", 1)[0];
      check(
        Boolean(cookie),
        "A successful session exchange did not set a cookie.",
      );
      sessionCookies.set(body.selector, cookie);
      return {
        response: result.response,
        body: { status: "ok", value: result.body },
      };
    }
    return result;
  }
  if (body.action === "verify") {
    const result = await nextRouteCall("/api/public-quotes/verify", {
      verificationCode: body.verificationCode,
    });
    return result.response.ok
      ? {
          response: result.response,
          body: { status: "ok", value: result.body },
        }
      : result;
  }
  if (!sessionCookies.has(body.selector)) {
    const opened = await nextBrokerCall({
      action: "open",
      selector: body.selector,
      secret: body.secret,
    });
    check(
      opened.response.ok && opened.body?.status === "ok",
      "The action preflight session exchange failed.",
    );
  }
  const cookie = sessionCookies.get(body.selector);
  check(
    Boolean(cookie),
    "A recipient action was attempted without a session exchange.",
  );
  const browserBody = { ...body };
  delete browserBody.selector;
  delete browserBody.secret;
  const result = await nextRouteCall(
    "/api/public-quotes/action",
    browserBody,
    cookie,
  );
  return result.response.ok
    ? { response: result.response, body: { status: "ok", value: result.body } }
    : result;
}

function stopFunctionServer() {
  if (!functionProcess) return;
  if (functionProcess.exitCode === null && functionProcess.pid) {
    try {
      process.kill(-functionProcess.pid, "SIGTERM");
    } catch {
      functionProcess.kill("SIGTERM");
    }
  }
  functionProcess.stdout.destroy();
  functionProcess.stderr.destroy();
  functionProcess.unref();
}

function stopNextServer() {
  if (!nextProcess) return;
  if (nextProcess.exitCode === null && nextProcess.pid) {
    try {
      process.kill(-nextProcess.pid, "SIGTERM");
    } catch {
      nextProcess.kill("SIGTERM");
    }
  }
  nextProcess.stdout.destroy();
  nextProcess.stderr.destroy();
  nextProcess.unref();
}

function link(fixtures, scenario, index = 0) {
  return fixtures[scenario].links[index];
}

async function directRpcDenials(apiUrl, anonKey) {
  const rpcUrl = `${apiUrl}/rest/v1/rpc/broker_verify_quote`;
  const rpcBody = JSON.stringify({
    p_verification_code: "0".repeat(32),
    p_subject_hash: `\\x${"0".repeat(64)}`,
  });
  const anonResponse = await localFetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
    },
    body: rpcBody,
    signal: AbortSignal.timeout(5_000),
  });
  check(!anonResponse.ok, "Direct anon broker RPC execution was not denied.");

  const tokenResponse = await localFetch(
    `${apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({
        email: "operator@tender.local",
        password: "TenderLocal1!",
      }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  const tokenBody = await tokenResponse.json();
  check(
    tokenResponse.ok && typeof tokenBody.access_token === "string",
    "Local authenticated test sign-in failed.",
  );
  const authenticatedResponse = await localFetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${tokenBody.access_token}`,
      "content-type": "application/json",
    },
    body: rpcBody,
    signal: AbortSignal.timeout(5_000),
  });
  check(
    !authenticatedResponse.ok,
    "Direct authenticated broker RPC execution was not denied.",
  );
}

async function main() {
  const { apiUrl, anonKey } = localStatus();
  const configuredProject = command("docker", [
    "inspect",
    "--format",
    '{{index .Config.Labels "com.supabase.cli.project"}}',
    databaseContainer,
  ]);
  check(
    configuredProject === projectId,
    "The active local database project is not the approved disposable project.",
  );
  rateBucketStartedAt = psql("select date_trunc('minute', clock_timestamp());");

  startFunctionServer();
  const endpoint = `${apiUrl}/functions/v1/trusted-public-broker`;
  await waitForFunction(endpoint, anonKey);
  const unsigned = await unsignedEdgeCall(endpoint, anonKey, {
    action: "verify",
    verificationCode: "0".repeat(32),
  });
  check(
    unsigned.response.status === 401 &&
      unsigned.body?.code === "transport_authentication_failed",
    "The Edge broker did not reject a direct unsigned public request.",
  );
  startNextServer(apiUrl, anonKey);
  await waitForNext();
  const unsupportedMethod = await localFetch(
    `${nextOrigin}/api/public-quotes/action`,
    { method: "GET", signal: AbortSignal.timeout(5_000) },
  );
  check(
    unsupportedMethod.status === 405,
    "The Next action route did not reject an unsupported method.",
  );
  const crossOrigin = await localFetch(
    `${nextOrigin}/api/public-quotes/session`,
    {
      method: "POST",
      headers: {
        origin: "https://cross-origin.invalid",
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    },
  );
  check(
    crossOrigin.status === 403 &&
      crossOrigin.headers.get("cache-control") === "no-store",
    "The Next session route did not enforce same-origin with no-store.",
  );
  const wrongContentType = await localFetch(
    `${nextOrigin}/api/public-quotes/verify`,
    {
      method: "POST",
      headers: { origin: nextOrigin, "content-type": "text/plain" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    },
  );
  check(
    wrongContentType.status === 415 &&
      wrongContentType.headers.get("cache-control") === "no-store",
    "The Next verification route did not enforce JSON with no-store.",
  );
  const fixtures = JSON.parse(psql(fixtureSql()));
  const call = async (body) => nextBrokerCall(body);

  const changeLink = link(fixtures, "change");
  const opened = await call({
    action: "open",
    selector: changeLink.selector,
    secret: changeLink.secret,
  });
  check(
    opened.response.status === 200 && opened.body.status === "ok",
    `Open failed with HTTP ${opened.response.status} and status ${String(opened.body?.status ?? "missing")}. Next: ${nextDiagnostic} Edge: ${functionDiagnostic}`,
  );

  const viewKey = randomUUID();
  const viewed = await call({
    action: "record_event",
    eventType: "viewed",
    selector: changeLink.selector,
    secret: changeLink.secret,
    idempotencyKey: viewKey,
  });
  const viewReplay = await call({
    action: "record_event",
    eventType: "viewed",
    selector: changeLink.selector,
    secret: changeLink.secret,
    idempotencyKey: viewKey,
  });
  check(
    viewed.body.value.eventId === viewReplay.body.value.eventId,
    "View replay was not idempotent.",
  );

  const changed = await call({
    action: "record_event",
    eventType: "change_requested",
    selector: changeLink.selector,
    secret: changeLink.secret,
    idempotencyKey: randomUUID(),
    message: "Please change delivery terms.",
  });
  check(
    changed.response.status === 200 &&
      changed.body.value.type === "change_requested",
    "Change request failed.",
  );
  const openedAfterChange = await call({
    action: "open",
    selector: changeLink.selector,
    secret: changeLink.secret,
  });
  check(
    openedAfterChange.body.value.responseType === "change_requested" &&
      openedAfterChange.body.value.acceptanceAllowed === false,
    "Revision-scoped change terminal state was not preserved.",
  );

  const declineLink = link(fixtures, "decline");
  const declined = await call({
    action: "record_event",
    eventType: "declined",
    selector: declineLink.selector,
    secret: declineLink.secret,
    idempotencyKey: randomUUID(),
  });
  check(
    declined.response.status === 200 && declined.body.value.type === "declined",
    "Decline failed.",
  );

  const acceptLink = link(fixtures, "accept");
  const acceptanceKey = randomUUID();
  const acceptanceRequest = {
    action: "accept",
    selector: acceptLink.selector,
    secret: acceptLink.secret,
    idempotencyKey: acceptanceKey,
    buyerAssertedName: "Café Buyer",
    buyerAssertedTitle: "Procurement Lead",
    acceptanceStatementVersion: 1,
  };
  const accepted = await call(acceptanceRequest);
  const acceptanceReplay = await call(acceptanceRequest);
  check(
    accepted.response.status === 200 && accepted.body.value.replayed === false,
    "Acceptance failed.",
  );
  check(
    acceptanceReplay.response.status === 200 &&
      acceptanceReplay.body.value.replayed === true &&
      acceptanceReplay.body.value.acceptanceId ===
        accepted.body.value.acceptanceId,
    "Acceptance replay was not stable.",
  );
  const verified = await call({
    action: "verify",
    verificationCode: fixtures.accept.verificationCode,
  });
  check(
    verified.response.status === 200 &&
      verified.body.value.verified === true &&
      verified.body.value.acceptedAt !== null,
    "Verification failed.",
  );

  for (const [scenario, expectedStatus] of [
    ["expired", "expired"],
    ["revoked", "revoked"],
    ["superseded", "superseded"],
  ]) {
    const target = link(fixtures, scenario);
    const result = await call({
      action: "open",
      selector: target.selector,
      secret: target.secret,
    });
    check(
      result.response.status === 410 && result.body.status === expectedStatus,
      `${scenario} link semantics failed.`,
    );
  }

  const competeFirst = link(fixtures, "compete", 0);
  const competeSecond = link(fixtures, "compete", 1);
  const competing = await Promise.all([
    call({
      action: "accept",
      selector: competeFirst.selector,
      secret: competeFirst.secret,
      idempotencyKey: randomUUID(),
      buyerAssertedName: "Concurrent Buyer",
      acceptanceStatementVersion: 1,
    }),
    call({
      action: "record_event",
      eventType: "declined",
      selector: competeSecond.selector,
      secret: competeSecond.secret,
      idempotencyKey: randomUUID(),
    }),
  ]);
  check(
    competing.filter((result) => result.response.status === 200).length === 1,
    "Competing terminal requests did not produce exactly one winner.",
  );
  const terminalCount = Number(
    psql(
      `select count(*) from public.quote_recipient_events where quote_id = '${fixtures.compete.quoteId}' and event_type in ('change_requested','declined','accepted');`,
    ),
  );
  check(
    terminalCount === 1,
    "PostgreSQL did not remain authoritative for the terminal response.",
  );

  await directRpcDenials(apiUrl, anonKey);

  const allSelectors = Object.values(fixtures).flatMap((fixture) =>
    fixture.links.map((entry) => entry.selector),
  );
  const subjects = [
    ...new Set([
      rateSubject(),
      ...allSelectors.map(selectorSubject),
      codeSubject(fixtures.accept.verificationCode),
      codeSubject("0".repeat(32)),
    ]),
  ];
  psql(`
    delete from public.quote_acceptances
    where quote_id in (select id from public.quotes where notes like '${marker}:%');
    update public.quotes set current_revision_id = null, accepted_revision_id = null
    where notes like '${marker}:%';
    delete from public.quotes where notes like '${marker}:%';
    delete from public.quote_public_rate_buckets
    where subject_hash in (${subjects.map((value) => `'\\x${value}'::bytea`).join(",")})
      or bucket_started_at >= '${rateBucketStartedAt}'::timestamptz;
  `);

  console.log(`PASS ${checks} local Edge broker integration checks.`);
}

try {
  await main();
} finally {
  stopNextServer();
  stopFunctionServer();
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  try {
    psql(`
      delete from public.quote_acceptances
      where quote_id in (select id from public.quotes where notes like '${marker}:%');
      update public.quotes set current_revision_id = null, accepted_revision_id = null
      where notes like '${marker}:%';
      delete from public.quotes where notes like '${marker}:%';
      ${
        rateBucketStartedAt
          ? `delete from public.quote_public_rate_buckets where bucket_started_at >= '${rateBucketStartedAt}'::timestamptz;`
          : ""
      }
    `);
  } catch {
    // Preserve the original failure; the disposable local database can be reset.
  }
}
