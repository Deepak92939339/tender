begin;

create type public.quote_revision_record_kind as enum ('verified_revision', 'legacy_capture');
create type public.quote_recipient_event_type as enum ('viewed', 'change_requested', 'declined', 'accepted');
create type public.quote_share_disabled_reason as enum ('revoked', 'superseded', 'accepted');

-- Canonical JSON v1 is independent of jsonb's display representation:
-- * strings and object keys are NFC;
-- * object keys are ordered by their normalized UTF-8 bytes;
-- * arrays retain their supplied order (domain builders sort position arrays);
-- * null and booleans use JSON literals;
-- * numbers are safe base-10 integers only;
-- * output is encoded as UTF-8 without a BOM.
create or replace function public.canonical_json_string_v1(p_value text)
returns text
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  normalized text := pg_catalog.normalize(p_value);
  result text := '"';
  character text;
  codepoint integer;
begin
  for index in 1..pg_catalog.char_length(normalized) loop
    character := pg_catalog.substr(normalized, index, 1);
    codepoint := pg_catalog.ascii(character);
    result := result || case
      when character = '"' then E'\\"'
      when character = E'\\' then E'\\\\'
      when codepoint = 8 then E'\\b'
      when codepoint = 9 then E'\\t'
      when codepoint = 10 then E'\\n'
      when codepoint = 12 then E'\\f'
      when codepoint = 13 then E'\\r'
      when codepoint < 32 then E'\\u' || pg_catalog.lpad(pg_catalog.to_hex(codepoint), 4, '0')
      else character
    end;
  end loop;
  return result || '"';
end;
$$;

create or replace function public.canonical_json_v1(p_value jsonb)
returns bytea
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  kind text := pg_catalog.jsonb_typeof(p_value);
  rendered text;
  duplicate_count integer;
begin
  case kind
    when 'null' then rendered := 'null';
    when 'boolean' then rendered := case when p_value = 'true'::jsonb then 'true' else 'false' end;
    when 'string' then rendered := public.canonical_json_string_v1(p_value #>> '{}');
    when 'number' then
      rendered := p_value::text;
      if rendered !~ '^-?(0|[1-9][0-9]*)$'
        or rendered::numeric < -9007199254740991::numeric
        or rendered::numeric > 9007199254740991::numeric then
        raise exception using errcode = '22023', message = 'canonical_json_integer_invalid';
      end if;
    when 'array' then
      select '[' || coalesce(pg_catalog.string_agg(
        pg_catalog.convert_from(public.canonical_json_v1(entry.value), 'UTF8'),
        ',' order by entry.ordinality
      ), '') || ']'
      into rendered
      from pg_catalog.jsonb_array_elements(p_value) with ordinality entry(value, ordinality);
    when 'object' then
      select pg_catalog.count(*) - pg_catalog.count(distinct pg_catalog.normalize(entry.key))
      into duplicate_count
      from pg_catalog.jsonb_each(p_value) entry;
      if duplicate_count > 0 then
        raise exception using errcode = '22023', message = 'canonical_json_key_normalization_collision';
      end if;
      select '{' || coalesce(pg_catalog.string_agg(
        public.canonical_json_string_v1(pg_catalog.normalize(entry.key)) || ':' ||
          pg_catalog.convert_from(public.canonical_json_v1(entry.value), 'UTF8'),
        ',' order by pg_catalog.convert_to(pg_catalog.normalize(entry.key), 'UTF8')
      ), '') || '}'
      into rendered
      from pg_catalog.jsonb_each(p_value) entry;
    else
      raise exception using errcode = '22023', message = 'canonical_json_type_invalid';
  end case;
  return pg_catalog.convert_to(rendered, 'UTF8');
end;
$$;

create or replace function public.sha256_hex(p_value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(p_value, 'sha256'), 'hex');
$$;

create or replace function public.quote_acceptance_statement_v1(
  p_buyer_asserted_name text,
  p_buyer_asserted_title text,
  p_revision_id uuid,
  p_snapshot_hash text,
  p_calculation_fingerprint text,
  p_format_version smallint default 1
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(pg_catalog.normalize(coalesce(p_buyer_asserted_name, '')));
  normalized_title text := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_buyer_asserted_title, ''))), '');
  statement constant text := 'I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.';
begin
  if p_format_version <> 1 or p_revision_id is null
    or p_snapshot_hash is null or p_snapshot_hash !~ '^[0-9a-f]{64}$'
    or p_calculation_fingerprint is null
    or p_calculation_fingerprint !~ '^[0-9a-f]{64}$'
    or pg_catalog.char_length(normalized_name) not between 1 and 200
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_title is not null and (
      pg_catalog.char_length(normalized_title) not between 1 and 200
      or normalized_title ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'acceptance_evidence_invalid';
  end if;
  return pg_catalog.jsonb_build_object(
    'format_version', 1,
    'statement', statement,
    'buyer_asserted_name', normalized_name,
    'buyer_asserted_title', normalized_title,
    'revision_id', p_revision_id,
    'snapshot_hash', p_snapshot_hash,
    'calculation_fingerprint', p_calculation_fingerprint
  );
end;
$$;

create table public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  revision_number integer not null check (revision_number >= 0),
  record_kind public.quote_revision_record_kind not null,
  state public.quote_state not null,
  parent_revision_id uuid,
  legacy_source_revision_id uuid,
  source_quote_version integer not null check (source_quote_version > 0),
  snapshot_format_version integer,
  calculation_format_version integer,
  snapshot jsonb,
  canonical_snapshot bytea,
  calculation_document jsonb,
  canonical_calculation bytea,
  calculation_fingerprint char(64),
  calculation_hash char(64),
  snapshot_hash char(64),
  currency_code text,
  total_minor bigint,
  valid_until date,
  approval_threshold_bps integer,
  requires_manual_approval boolean,
  approval_reason_codes text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejected_reason text,
  issued_by uuid references auth.users(id),
  issued_at timestamptz,
  verification_code char(32),
  legacy_snapshot jsonb,
  legacy_captured_at timestamptz,
  unique (organization_id, quote_id, revision_number),
  unique (organization_id, quote_id, id),
  foreign key (organization_id, quote_id) references public.quotes(organization_id, id) on delete cascade,
  check (state <> 'expired'),
  check ((revision_number = 0) = (record_kind = 'legacy_capture')),
  check (parent_revision_id is null or record_kind = 'verified_revision'),
  check (legacy_source_revision_id is null or record_kind = 'verified_revision'),
  check (parent_revision_id is null or legacy_source_revision_id is null),
  check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  check (total_minor is null or total_minor >= 0),
  check (approval_threshold_bps is null or approval_threshold_bps between 0 and 10000),
  check (calculation_fingerprint is null or calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  check (calculation_hash is null or calculation_hash ~ '^[0-9a-f]{64}$'),
  check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$'),
  check (verification_code is null or verification_code ~ '^[A-F0-9]{32}$'),
  check (canonical_snapshot is null or octet_length(canonical_snapshot) <= 2097152),
  check (canonical_calculation is null or octet_length(canonical_calculation) <= 1048576),
  check (snapshot is null or canonical_snapshot = public.canonical_json_v1(snapshot)),
  check (calculation_document is null or canonical_calculation = public.canonical_json_v1(calculation_document)),
  check (canonical_snapshot is null or snapshot_hash = public.sha256_hex(canonical_snapshot)),
  check (canonical_calculation is null or (
    calculation_hash = public.sha256_hex(canonical_calculation)
    and calculation_fingerprint = calculation_hash
  )),
  check (
    (record_kind = 'legacy_capture'
      and legacy_snapshot is not null
      and legacy_captured_at is not null
      and snapshot is null and canonical_snapshot is null and calculation_document is null
      and canonical_calculation is null and calculation_fingerprint is null
      and calculation_hash is null and snapshot_hash is null
      and snapshot_format_version is null and calculation_format_version is null
      and requires_manual_approval is null and verification_code is null)
    or
    (record_kind = 'verified_revision'
      and legacy_snapshot is null and legacy_captured_at is null
      and revision_number > 0
      and (
        (state = 'draft'
          and snapshot is null and canonical_snapshot is null and calculation_document is null
          and canonical_calculation is null and calculation_fingerprint is null
          and calculation_hash is null and snapshot_hash is null
          and snapshot_format_version is null and calculation_format_version is null
          and requires_manual_approval is null and submitted_at is null)
        or
        (state in ('waiting', 'approved', 'rejected', 'issued')
          and snapshot is not null and canonical_snapshot is not null
          and calculation_document is not null and canonical_calculation is not null
          and calculation_fingerprint is not null and calculation_hash is not null
          and calculation_fingerprint = calculation_hash
          and snapshot_hash is not null
          and snapshot_format_version = 1 and calculation_format_version = 1
          and currency_code is not null and total_minor is not null and valid_until is not null
          and approval_threshold_bps is not null and requires_manual_approval is not null
          and submitted_at is not null)
      ))
  ),
  check (record_kind = 'legacy_capture' or ((state = 'waiting') = (requires_manual_approval is true and approved_at is null and rejected_at is null))),
  check (record_kind = 'legacy_capture' or state <> 'approved' or approved_at is not null),
  check (record_kind = 'legacy_capture' or state <> 'rejected' or (rejected_at is not null and nullif(btrim(rejected_reason), '') is not null)),
  check (record_kind = 'legacy_capture' or state <> 'issued' or (approved_at is not null and issued_at is not null and verification_code is not null))
);

alter table public.quote_revisions
  add constraint quote_revisions_parent_fkey
  foreign key (organization_id, quote_id, parent_revision_id)
  references public.quote_revisions(organization_id, quote_id, id),
  add constraint quote_revisions_legacy_source_fkey
  foreign key (organization_id, quote_id, legacy_source_revision_id)
  references public.quote_revisions(organization_id, quote_id, id);

alter table public.quotes
  add column current_revision_id uuid,
  add column accepted_revision_id uuid,
  add column revision_counter integer not null default 0 check (revision_counter >= 0);

-- The child table exists first. Existing quotes keep null pointers. Commands insert
-- a revision, then validate/set the quote pointer in the same transaction.
alter table public.quotes
  add constraint quotes_current_revision_fkey
    foreign key (organization_id, id, current_revision_id)
    references public.quote_revisions(organization_id, quote_id, id) not valid,
  add constraint quotes_accepted_revision_fkey
    foreign key (organization_id, id, accepted_revision_id)
    references public.quote_revisions(organization_id, quote_id, id) not valid;
alter table public.quotes validate constraint quotes_current_revision_fkey;
alter table public.quotes validate constraint quotes_accepted_revision_fkey;

create unique index quote_revisions_one_open_idx
  on public.quote_revisions (organization_id, quote_id)
  where record_kind = 'verified_revision' and state = 'draft';
create unique index quote_revisions_verification_code_idx
  on public.quote_revisions (verification_code) where verification_code is not null;
create index quote_revisions_quote_timeline_idx
  on public.quote_revisions (organization_id, quote_id, revision_number desc);

create table public.quote_share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  revision_id uuid not null,
  selector uuid not null unique default gen_random_uuid(),
  token_format_version smallint not null default 1 check (token_format_version = 1),
  token_hash_algorithm text not null default 'sha256' check (token_hash_algorithm = 'sha256'),
  token_hash bytea not null check (octet_length(token_hash) = 32),
  recipient_email text not null check (char_length(btrim(recipient_email)) between 3 and 254),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason public.quote_share_disabled_reason,
  unique (organization_id, quote_id, id),
  unique (organization_id, quote_id, id, revision_id),
  foreign key (organization_id, quote_id, revision_id)
    references public.quote_revisions(organization_id, quote_id, id) on delete cascade,
  check ((disabled_at is null) = (disabled_reason is null)),
  check (expires_at > created_at)
);
create index quote_share_links_revision_idx on public.quote_share_links (organization_id, revision_id, created_at desc);

create table public.quote_recipient_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  revision_id uuid not null,
  share_link_id uuid not null,
  event_type public.quote_recipient_event_type not null,
  idempotency_key uuid not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  message text check (message is null or char_length(message) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (share_link_id, idempotency_key),
  unique (organization_id, quote_id, revision_id, share_link_id, id),
  foreign key (organization_id, quote_id, revision_id)
    references public.quote_revisions(organization_id, quote_id, id) on delete cascade,
  foreign key (organization_id, quote_id, share_link_id, revision_id)
    references public.quote_share_links(organization_id, quote_id, id, revision_id) on delete cascade
);
create unique index quote_recipient_events_terminal_revision_idx
  on public.quote_recipient_events (organization_id, quote_id, revision_id)
  where event_type in ('change_requested', 'declined', 'accepted');
create index quote_recipient_events_quote_idx
  on public.quote_recipient_events (organization_id, quote_id, created_at desc);

create table public.quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  revision_id uuid not null,
  share_link_id uuid not null,
  recipient_event_id uuid not null unique,
  idempotency_key uuid not null,
  snapshot_format_version integer not null check (snapshot_format_version = 1),
  calculation_format_version integer not null check (calculation_format_version = 1),
  snapshot_hash char(64) not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  calculation_fingerprint char(64) not null check (calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  recipient_email_snapshot text not null
    check (char_length(recipient_email_snapshot) between 3 and 254
      and recipient_email_snapshot = lower(btrim(normalize(recipient_email_snapshot)))),
  buyer_asserted_name text not null
    check (char_length(buyer_asserted_name) between 1 and 200
      and buyer_asserted_name !~ '[[:cntrl:]]'
      and buyer_asserted_name = btrim(normalize(buyer_asserted_name))),
  buyer_asserted_title text
    check (buyer_asserted_title is null or (
      char_length(buyer_asserted_title) between 1 and 200
      and buyer_asserted_title !~ '[[:cntrl:]]'
      and buyer_asserted_title = btrim(normalize(buyer_asserted_title))
    )),
  acceptance_statement_version smallint not null check (acceptance_statement_version = 1),
  acceptance_statement text not null,
  acceptance_statement_document jsonb not null,
  canonical_acceptance_statement bytea not null
    check (octet_length(canonical_acceptance_statement) <= 16384),
  acceptance_statement_hash char(64) not null
    check (acceptance_statement_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  unique (organization_id, quote_id),
  unique (revision_id),
  unique (share_link_id, idempotency_key),
  foreign key (organization_id, quote_id, revision_id)
    references public.quote_revisions(organization_id, quote_id, id),
  foreign key (organization_id, quote_id, share_link_id, revision_id)
    references public.quote_share_links(organization_id, quote_id, id, revision_id),
  foreign key (organization_id, quote_id, revision_id, share_link_id, recipient_event_id)
    references public.quote_recipient_events(organization_id, quote_id, revision_id, share_link_id, id),
  check (canonical_acceptance_statement = public.canonical_json_v1(acceptance_statement_document)),
  check (acceptance_statement_hash = public.sha256_hex(canonical_acceptance_statement)),
  check (acceptance_statement_document->>'format_version' = acceptance_statement_version::text),
  check (acceptance_statement_document->>'statement' = acceptance_statement),
  check (acceptance_statement_document->>'buyer_asserted_name' = buyer_asserted_name),
  check (acceptance_statement_document->>'buyer_asserted_title' is not distinct from buyer_asserted_title),
  check (acceptance_statement_document->>'revision_id' = revision_id::text),
  check (acceptance_statement_document->>'snapshot_hash' = snapshot_hash),
  check (acceptance_statement_document->>'calculation_fingerprint' = calculation_fingerprint),
  check (acceptance_statement_document = public.quote_acceptance_statement_v1(
    buyer_asserted_name, buyer_asserted_title, revision_id, snapshot_hash,
    calculation_fingerprint, acceptance_statement_version
  ))
);

create table public.quote_public_rate_buckets (
  operation text not null check (operation in ('open', 'view', 'change_request', 'decline', 'accept', 'verify')),
  subject_hash bytea not null check (octet_length(subject_hash) = 32),
  bucket_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (operation, subject_hash, bucket_started_at),
  check (expires_at > bucket_started_at)
);
create index quote_public_rate_buckets_expiry_idx on public.quote_public_rate_buckets (expires_at);

create or replace function public.prevent_quote_revision_authority_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.record_kind = 'legacy_capture' then
    raise exception using errcode = '55000', message = 'legacy_capture_immutable';
  end if;
  if old.canonical_snapshot is not null and row(
    new.snapshot_format_version, new.calculation_format_version, new.snapshot,
    new.canonical_snapshot, new.calculation_document, new.canonical_calculation,
    new.calculation_fingerprint, new.calculation_hash, new.snapshot_hash,
    new.currency_code, new.total_minor, new.valid_until,
    new.approval_threshold_bps, new.requires_manual_approval, new.approval_reason_codes
  ) is distinct from row(
    old.snapshot_format_version, old.calculation_format_version, old.snapshot,
    old.canonical_snapshot, old.calculation_document, old.canonical_calculation,
    old.calculation_fingerprint, old.calculation_hash, old.snapshot_hash,
    old.currency_code, old.total_minor, old.valid_until,
    old.approval_threshold_bps, old.requires_manual_approval, old.approval_reason_codes
  ) then
    raise exception using errcode = '55000', message = 'quote_revision_snapshot_immutable';
  end if;
  if old.state = 'issued' then
    raise exception using errcode = '55000', message = 'issued_revision_immutable';
  end if;
  return new;
end;
$$;
create trigger quote_revisions_authority_immutable
before update on public.quote_revisions
for each row execute function public.prevent_quote_revision_authority_change();

create or replace function public.prevent_quote_acceptance_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'quote_acceptance_immutable';
end;
$$;
create trigger quote_acceptances_immutable
before update on public.quote_acceptances
for each row execute function public.prevent_quote_acceptance_change();

insert into public.capabilities (key, label) values
  ('quote.revise', 'Create verified quotation revisions'),
  ('quote.share', 'Create and revoke secure quotation links')
on conflict (key) do nothing;
insert into public.role_capabilities (role_id, capability_key)
select role.id, capability.key
from public.roles role
cross join public.capabilities capability
where role.key in ('operator', 'manager', 'organization_admin')
  and capability.key in ('quote.revise', 'quote.share')
on conflict do nothing;

alter table public.quote_revisions enable row level security;
alter table public.quote_share_links enable row level security;
alter table public.quote_recipient_events enable row level security;
alter table public.quote_acceptances enable row level security;
alter table public.quote_public_rate_buckets enable row level security;

create policy quote_revisions_select_member on public.quote_revisions for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_share_links_select_member on public.quote_share_links for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_recipient_events_select_member on public.quote_recipient_events for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));
create policy quote_acceptances_select_member on public.quote_acceptances for select to authenticated
using (public.has_org_capability(organization_id, 'quote.read'));

revoke all on public.quote_revisions, public.quote_share_links,
  public.quote_recipient_events, public.quote_acceptances,
  public.quote_public_rate_buckets from public, anon, authenticated;
grant select on public.quote_revisions, public.quote_recipient_events, public.quote_acceptances to authenticated;
grant select (
  id, organization_id, quote_id, revision_id, selector, recipient_email,
  expires_at, created_by, created_at, disabled_at, disabled_reason
) on public.quote_share_links to authenticated;

revoke all on function public.canonical_json_string_v1(text), public.canonical_json_v1(jsonb),
  public.sha256_hex(bytea), public.quote_acceptance_statement_v1(text,text,uuid,text,text,smallint),
  public.prevent_quote_revision_authority_change(),
  public.prevent_quote_acceptance_change()
from public, anon, authenticated;

commit;
