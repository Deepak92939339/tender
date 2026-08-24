import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const project = "tender-local-visual-study";
const container = `supabase_db_${project}`;
const rateSecretName = "PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET";
const transportSecretName = "TENDER_EDGE_BROKER_TRANSPORT_SECRET";

export type RecipientFixture = {
  quoteId: string;
  revisionId: string;
  selector: string;
  secret: string;
  verificationCode: string;
};

export type IssuedRevisionFixture = {
  quoteId: string;
  revisionId: string;
  quoteNumber: string;
};

export type RecipientCapability = Pick<RecipientFixture, "selector" | "secret">;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Local recipient fixture command failed (${command}).`);
  }
  return result.stdout.trim();
}

function assertLocalTarget() {
  const status = JSON.parse(
    run("./node_modules/.bin/supabase", ["status", "-o", "json"]),
  ) as { DB_URL?: string };
  if (!status.DB_URL) throw new Error("Local database URL is unavailable.");
  const database = new URL(status.DB_URL);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(database.hostname) ||
    database.port !== "54322"
  ) {
    throw new Error("Recipient fixtures require the loopback database.");
  }
  const identity = run("docker", [
    "inspect",
    "--format",
    '{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}',
    container,
  ]);
  if (identity !== `/${container}|${project}`) {
    throw new Error("Recipient fixture container identity is invalid.");
  }
}

function localRuntime() {
  const status = JSON.parse(
    run("./node_modules/.bin/supabase", ["status", "-o", "json"]),
  ) as { API_URL?: string; ANON_KEY?: string };
  if (!status.API_URL || !status.ANON_KEY) {
    throw new Error("Local Supabase runtime values are unavailable.");
  }
  const api = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(api.hostname)) {
    throw new Error("Recipient server requires the loopback API.");
  }
  return { apiUrl: api.origin, anonKey: status.ANON_KEY };
}

function psql(sql: string) {
  assertLocalTarget();
  return run("docker", [
    "exec",
    container,
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

export function provisionRecipientFixture(): RecipientFixture {
  const marker = randomUUID();
  const result = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $fixture$
declare
  created jsonb;
  shared jsonb;
  quote_id uuid;
  revision_id uuid;
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
      'notes', 'Recipient browser fixture ${marker}',
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
  shared := public.create_quote_share_link(
    quote_id, revision_id, 4, 'recipient-${marker}@example.test',
    now() + interval '1 day', extensions.gen_random_uuid()
  );
  create temporary table recipient_fixture_result(value jsonb) on commit drop;
  insert into recipient_fixture_result values (jsonb_build_object(
    'quoteId', quote_id,
    'revisionId', revision_id,
    'selector', shared->>'selector',
    'secret', shared->>'secret',
    'verificationCode', (select verification_code from public.quote_revisions where id=revision_id)
  ));
end;
$fixture$;
select value from recipient_fixture_result;
commit;`);
  const parsed = JSON.parse(result) as RecipientFixture;
  if (!parsed.selector || !parsed.secret || !parsed.verificationCode) {
    throw new Error(
      "Recipient fixture provisioning returned an invalid result.",
    );
  }
  return parsed;
}

export function provisionIssuedRevisionWithoutLink(): IssuedRevisionFixture {
  const marker = randomUUID();
  const result = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $fixture$
declare
  created jsonb;
  quote_id uuid;
  revision_id uuid;
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
      'notes', 'Issuer share fixture ${marker}',
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
  create temporary table issuer_fixture_result(value jsonb) on commit drop;
  insert into issuer_fixture_result values (jsonb_build_object(
    'quoteId', quote_id,
    'revisionId', revision_id,
    'quoteNumber', (select number from public.quotes where id = quote_id)
  ));
end;
$fixture$;
select value from issuer_fixture_result;
commit;`);
  const parsed = JSON.parse(result) as IssuedRevisionFixture;
  if (!parsed.quoteId || !parsed.revisionId || !parsed.quoteNumber) {
    throw new Error(
      "Issued revision fixture provisioning returned invalid data.",
    );
  }
  return parsed;
}

export function makeRecipientRevisionStale(fixture: RecipientFixture) {
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.begin_quote_revision(
  '${fixture.quoteId}'::uuid, '${fixture.revisionId}'::uuid, 4,
  extensions.gen_random_uuid()
);
commit;`);
}

export function provisionSiblingCapability(
  fixture: RecipientFixture,
): RecipientCapability {
  const marker = randomUUID();
  const result = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
create temporary table recipient_sibling_result(value jsonb) on commit drop;
with shared as (
  select public.create_quote_share_link(
    '${fixture.quoteId}'::uuid,
    '${fixture.revisionId}'::uuid,
    (select version from public.quotes where id = '${fixture.quoteId}'::uuid),
    'recipient-sibling-${marker}@example.test',
    now() + interval '1 day',
    extensions.gen_random_uuid()
  ) result
)
insert into recipient_sibling_result
select jsonb_build_object(
  'selector', result->>'selector',
  'secret', result->>'secret'
) from shared;
select value from recipient_sibling_result;
commit;`);
  const parsed = JSON.parse(result) as RecipientCapability;
  if (!parsed.selector || !parsed.secret) {
    throw new Error("Sibling capability provisioning returned invalid data.");
  }
  return parsed;
}

async function serveRecipientE2E() {
  assertLocalTarget();
  const { apiUrl, anonKey } = localRuntime();
  const transportSecret = randomBytes(48).toString("base64url");
  const sessionSecret = randomBytes(48).toString("base64url");
  const rateSecret = randomBytes(48).toString("base64url");
  const directory = mkdtempSync(join(tmpdir(), "tender-recipient-e2e-"));
  const environmentFile = join(directory, "edge.env");
  writeFileSync(
    environmentFile,
    `${rateSecretName}=${rateSecret}\n${transportSecretName}=${transportSecret}\n`,
    { mode: 0o600 },
  );
  const common = {
    ...process.env,
    DO_NOT_TRACK: "1",
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  const edge = spawn(
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
        ...common,
        [rateSecretName]: rateSecret,
        [transportSecretName]: transportSecret,
      },
      stdio: "ignore",
    },
  );
  const brokerEndpoint = `${apiUrl}/functions/v1/trusted-public-broker`;
  let edgeReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (edge.exitCode !== null) {
      throw new Error("Local Edge server stopped before becoming ready.");
    }
    try {
      const response = await fetch(brokerEndpoint, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          verificationCode: "0".repeat(32),
        }),
      });
      if (response.status < 500) {
        edgeReady = true;
        break;
      }
    } catch {
      // The local gateway may accept connections before the function worker is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!edgeReady) {
    edge.kill("SIGTERM");
    throw new Error("Local Edge server did not become ready.");
  }
  const next = spawn(
    "./node_modules/.bin/next",
    ["start", "-H", "localhost", "-p", "3000"],
    {
      cwd: process.cwd(),
      env: {
        ...common,
        NEXT_PUBLIC_SUPABASE_URL: apiUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        TENDER_EDGE_BROKER_TRANSPORT_SECRET: transportSecret,
        TENDER_PUBLIC_SESSION_ENCRYPTION_KEY: sessionSecret,
      },
      stdio: "inherit",
    },
  );
  const stop = () => {
    next.kill("SIGTERM");
    edge.kill("SIGTERM");
    rmSync(directory, { recursive: true, force: true });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await new Promise<void>((resolve, reject) => {
    next.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Local Next server stopped.")),
    );
    edge.once("exit", (code) => {
      if (code && code !== 0) reject(new Error("Local Edge server stopped."));
    });
  }).finally(stop);
}

if (process.argv.includes("--serve")) {
  await serveRecipientE2E();
}
