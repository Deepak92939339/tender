import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

const container = "supabase_db_tender-local-visual-study";
const userId = "d1000000-0000-4000-8000-000000000001";
const organizationId = "d2000000-0000-4000-8000-000000000001";
const taxId = "d3000000-0000-4000-8000-000000000001";
const productId = "d4000000-0000-4000-8000-000000000001";
const customerId = "d5000000-0000-4000-8000-000000000001";

type Link = { selector: string; secret: string };

function psql(sql: string) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function psqlConcurrent(sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ]);
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (error += chunk));
    child.on("close", (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(error)),
    );
  });
}

const authenticated = (sql: string) =>
  `set role authenticated; set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}'; ${sql}`;
const broker = (sql: string) => `set role service_role; ${sql}`;

function commandUuid(scenario: number, command: number) {
  return `d6${String(scenario).padStart(2, "0")}0000-0000-4000-8000-${String(command).padStart(12, "0")}`;
}

function createIssuedQuote(scenario: number) {
  const created = JSON.parse(
    psql(
      authenticated(
        `select public.create_verified_quote_draft('${organizationId}','${customerId}','INR','en-IN','Tax','exclusive','2026-08-14','2026-09-14','${commandUuid(scenario, 1)}');`,
      ),
    ),
  );
  const quoteId = created.id as string;
  const revisionId = created.current_revision_id as string;
  psql(
    authenticated(
      `select public.save_quote_draft('${quoteId}',1,'${commandUuid(scenario, 2)}','{"customer_id":"${customerId}","currency_code":"INR","locale":"en-IN","tax_label":"Tax","tax_mode":"exclusive","discount_bps":0,"issue_date":"2026-08-14","valid_until":"2026-09-14","notes":"","items":[{"line_id":null,"product_id":"${productId}","position":1,"quantity_scaled":1,"quantity_scale":1}],"charges":[]}'::jsonb);`,
    ),
  );
  psql(
    authenticated(
      `select public.submit_quote_revision('${quoteId}','${revisionId}',2,'${commandUuid(scenario, 3)}');`,
    ),
  );
  psql(
    authenticated(
      `select public.issue_quote_revision('${quoteId}','${revisionId}',3,'${commandUuid(scenario, 4)}');`,
    ),
  );
  const first = JSON.parse(
    psql(
      authenticated(
        `select public.create_quote_share_link('${quoteId}','${revisionId}',4,'first-${scenario}@example.test','2026-09-01T00:00:00Z','${commandUuid(scenario, 5)}');`,
      ),
    ),
  ) as Link;
  const second = JSON.parse(
    psql(
      authenticated(
        `select public.create_quote_share_link('${quoteId}','${revisionId}',4,'second-${scenario}@example.test','2026-09-01T00:00:00Z','${commandUuid(scenario, 6)}');`,
      ),
    ),
  ) as Link;
  return { quoteId, revisionId, first, second };
}

const subject = (value: string) =>
  `extensions.digest(convert_to('${value}','UTF8'),'sha256')`;

function accept(link: Link, key: string, name: string, rateSubject: string) {
  return broker(
    `select public.broker_accept_quote('${link.selector}','${link.secret}',${subject(rateSubject)},'${key}','${name}',null,1::smallint);`,
  );
}

function terminal(
  type: "change_requested" | "declined",
  link: Link,
  key: string,
  rateSubject: string,
) {
  const message =
    type === "change_requested" ? "'Please revise delivery.'" : "null";
  return broker(
    `select public.broker_record_quote_event('${type}','${link.selector}','${link.secret}',${subject(rateSubject)},'${key}',${message});`,
  );
}

try {
  psql(`
    update public.quotes set current_revision_id=null, accepted_revision_id=null where organization_id='${organizationId}';
    delete from public.quote_acceptances where organization_id='${organizationId}';
    delete from public.quote_recipient_events where organization_id='${organizationId}';
    delete from public.quote_share_links where organization_id='${organizationId}';
    delete from public.quote_revisions where organization_id='${organizationId}';
    delete from public.quotes where organization_id='${organizationId}';
    delete from public.organizations where id='${organizationId}';
    delete from auth.users where id='${userId}';
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('00000000-0000-0000-0000-000000000000','${userId}','authenticated','authenticated','stage1-concurrency@tender.local','',now(),'','','','','{"provider":"email"}','{"display_name":"Stage 1 Concurrency"}',now(),now());
    insert into public.organizations (id,slug,name,timezone,created_by,seller_legal_name,seller_address_line1,seller_city,seller_country_code)
    values ('${organizationId}','stage1-concurrency','Stage 1 Concurrency','UTC','${userId}','Stage 1 Seller','1 Test Road','Test City','IN');
    insert into public.organization_memberships (organization_id,user_id,role_id,status)
    select '${organizationId}','${userId}',id,'active' from public.roles where key='organization_admin';
    insert into public.tax_profiles (id,organization_id,code,label,rate_bps,price_basis,treatment,created_by)
    values ('${taxId}','${organizationId}','ZERO','Zero',0,'exclusive','zero_rated','${userId}');
    insert into public.products (id,organization_id,sku,description,unit_code,quantity_precision,unit_price_minor,currency_code,tax_profile_id,created_by)
    values ('${productId}','${organizationId}','TEST-1','Concurrency product','EA',0,10000,'INR','${taxId}','${userId}');
    insert into public.customers (id,organization_id,name,billing_country_code,locale,preferred_currency_code,created_by)
    values ('${customerId}','${organizationId}','Concurrency buyer','IN','en-IN','INR','${userId}');
  `);

  const terminalQuote = createIssuedQuote(1);
  const terminalLeftKey = "d7100000-0000-4000-8000-000000000001";
  const terminalRightKey = "d7100000-0000-4000-8000-000000000002";
  const terminalResults = (
    await Promise.all([
      psqlConcurrent(
        terminal(
          "change_requested",
          terminalQuote.first,
          terminalLeftKey,
          "terminal-left",
        ),
      ),
      psqlConcurrent(
        terminal(
          "declined",
          terminalQuote.second,
          terminalRightKey,
          "terminal-right",
        ),
      ),
    ])
  ).map((value) => JSON.parse(value));
  assert.equal(
    terminalResults.filter((value) => value.status === "ok").length,
    1,
    "exactly one terminal response succeeds",
  );
  assert.equal(
    Number(
      psql(
        `select count(*) from public.quote_recipient_events where revision_id='${terminalQuote.revisionId}' and event_type in ('change_requested','declined','accepted');`,
      ),
    ),
    1,
    "one terminal response is stored for the revision",
  );
  assert.equal(
    Number(
      psql(
        `select count(*) from public.quote_share_links where revision_id='${terminalQuote.revisionId}' and disabled_at is not null;`,
      ),
    ),
    0,
    "terminal recipient response does not disable view links",
  );
  const terminalWinner = terminalResults[0]!.status === "ok" ? 0 : 1;
  const terminalReplay = JSON.parse(
    psql(
      terminalWinner === 0
        ? terminal(
            "change_requested",
            terminalQuote.first,
            terminalLeftKey,
            "terminal-left",
          )
        : terminal(
            "declined",
            terminalQuote.second,
            terminalRightKey,
            "terminal-right",
          ),
    ),
  );
  assert.equal(
    terminalReplay.value.replayed,
    true,
    "terminal winner replays exactly",
  );

  const competingQuote = createIssuedQuote(2);
  const acceptKey = "d7200000-0000-4000-8000-000000000001";
  const changeKey = "d7200000-0000-4000-8000-000000000002";
  const competingResults = (
    await Promise.all([
      psqlConcurrent(
        accept(
          competingQuote.first,
          acceptKey,
          "Competing Buyer",
          "accept-side",
        ),
      ),
      psqlConcurrent(
        terminal(
          "change_requested",
          competingQuote.second,
          changeKey,
          "change-side",
        ),
      ),
    ])
  ).map((value) => JSON.parse(value));
  assert.equal(
    competingResults.filter((value) => value.status === "ok").length,
    1,
    "exactly one competing acceptance/change request succeeds",
  );
  assert.equal(
    Number(
      psql(
        `select count(*) from public.quote_recipient_events where revision_id='${competingQuote.revisionId}' and event_type in ('change_requested','declined','accepted');`,
      ),
    ),
    1,
    "acceptance and change request cannot both become terminal",
  );
  const acceptedWon = competingResults[0]!.status === "ok";
  assert.equal(
    Number(
      psql(
        `select count(*) from public.quote_acceptances where revision_id='${competingQuote.revisionId}';`,
      ),
    ),
    acceptedWon ? 1 : 0,
    "acceptance evidence exists exactly when acceptance wins",
  );

  const acceptanceQuote = createIssuedQuote(3);
  const leftKey = "d7300000-0000-4000-8000-000000000001";
  const rightKey = "d7300000-0000-4000-8000-000000000002";
  const acceptanceResults = (
    await Promise.all([
      psqlConcurrent(
        accept(
          acceptanceQuote.first,
          leftKey,
          "Concurrency Left",
          "accept-left",
        ),
      ),
      psqlConcurrent(
        accept(
          acceptanceQuote.second,
          rightKey,
          "Concurrency Right",
          "accept-right",
        ),
      ),
    ])
  ).map((value) => JSON.parse(value));
  assert.equal(
    acceptanceResults.filter((value) => value.status === "ok").length,
    1,
    "exactly one competing acceptance succeeds",
  );
  assert.ok(
    acceptanceResults.some((value) =>
      ["accepted", "already_accepted", "already_responded"].includes(
        value.status,
      ),
    ),
    "losing acceptance observes the closed revision",
  );
  assert.equal(
    Number(
      psql(
        `select count(*) from public.quote_acceptances where revision_id='${acceptanceQuote.revisionId}';`,
      ),
    ),
    1,
    "one immutable acceptance row is stored",
  );
  const acceptanceWinner = acceptanceResults[0]!.status === "ok" ? 0 : 1;
  const acceptanceReplay = JSON.parse(
    psql(
      acceptanceWinner === 0
        ? accept(
            acceptanceQuote.first,
            leftKey,
            "Concurrency Left",
            "accept-left",
          )
        : accept(
            acceptanceQuote.second,
            rightKey,
            "Concurrency Right",
            "accept-right",
          ),
    ),
  );
  assert.equal(
    acceptanceReplay.value.replayed,
    true,
    "acceptance winner replays exact immutable evidence",
  );

  console.log(
    "PASS revision-scoped terminal, competing acceptance/change, and competing acceptance concurrency.",
  );
} finally {
  psql(
    `update public.quotes set current_revision_id=null, accepted_revision_id=null where organization_id='${organizationId}'; delete from public.quote_acceptances where organization_id='${organizationId}'; delete from public.quote_recipient_events where organization_id='${organizationId}'; delete from public.quote_share_links where organization_id='${organizationId}'; delete from public.quote_revisions where organization_id='${organizationId}'; delete from public.quotes where organization_id='${organizationId}'; delete from public.organizations where id='${organizationId}'; delete from auth.users where id='${userId}';`,
  );
}
