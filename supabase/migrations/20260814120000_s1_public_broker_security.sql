begin;

create or replace function public.constant_time_bytea_equal(p_left bytea, p_right bytea)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  difference integer := pg_catalog.octet_length(p_left) # pg_catalog.octet_length(p_right);
  right_length integer := greatest(pg_catalog.octet_length(p_right), 1);
begin
  if pg_catalog.octet_length(p_left) = 0 or pg_catalog.octet_length(p_right) = 0 then return false; end if;
  for index in 0..pg_catalog.octet_length(p_left) - 1 loop
    difference := difference | (pg_catalog.get_byte(p_left, index) # pg_catalog.get_byte(p_right, index % right_length));
  end loop;
  return difference = 0;
end;
$$;

create or replace function public.consume_quote_public_rate_limit(
  p_operation text,
  p_subject_hash bytea,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz;
  observed integer;
begin
  if p_operation not in ('open', 'view', 'change_request', 'decline', 'accept', 'verify')
    or pg_catalog.octet_length(p_subject_hash) <> 32 or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'rate_limit_configuration_invalid';
  end if;
  bucket := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds)
      * p_window_seconds
  );
  insert into public.quote_public_rate_buckets (
    operation, subject_hash, bucket_started_at, request_count, expires_at
  ) values (
    p_operation, p_subject_hash, bucket, 1,
    bucket + pg_catalog.make_interval(secs => p_window_seconds * 2)
  )
  on conflict (operation, subject_hash, bucket_started_at) do update
    set request_count = public.quote_public_rate_buckets.request_count + 1
  returning request_count into observed;
  return observed <= p_limit;
end;
$$;

create or replace function public.quote_public_link_status(
  p_selector uuid,
  p_secret text,
  p_operation text,
  p_subject_hash bytea,
  p_limit integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.quote_share_links%rowtype;
  revision public.quote_revisions%rowtype;
  quote_row public.quotes%rowtype;
  selector_subject bytea := extensions.digest(
    pg_catalog.convert_to(coalesce(p_selector::text, ''), 'UTF8'), 'sha256'
  );
  candidate_hash bytea := extensions.digest(
    pg_catalog.convert_to(coalesce(p_secret, ''), 'UTF8'), 'sha256'
  );
begin
  if not public.consume_quote_public_rate_limit(
    p_operation, p_subject_hash, p_limit, p_window_seconds
  ) or not public.consume_quote_public_rate_limit(
    p_operation, selector_subject, greatest(5, p_limit / 2), p_window_seconds
  ) then
    return pg_catalog.jsonb_build_object('status', 'rate_limited');
  end if;
  select * into link from public.quote_share_links where selector = p_selector;
  if link.id is null or not public.constant_time_bytea_equal(link.token_hash, candidate_hash) then
    return pg_catalog.jsonb_build_object('status', 'invalid_link');
  end if;
  select * into revision from public.quote_revisions where id = link.revision_id;
  select * into quote_row from public.quotes where id = link.quote_id;
  if link.disabled_at is not null then
    return pg_catalog.jsonb_build_object(
      'status', link.disabled_reason::text, 'link_id', link.id,
      'quote_id', link.quote_id, 'revision_id', link.revision_id,
      'organization_id', link.organization_id
    );
  end if;
  if quote_row.current_revision_id <> revision.id then
    return pg_catalog.jsonb_build_object('status', 'superseded');
  end if;
  if revision.state <> 'issued' then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  if link.expires_at <= pg_catalog.statement_timestamp()
    or revision.valid_until < public.organization_local_date(
      revision.organization_id, pg_catalog.statement_timestamp()
    ) then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  if quote_row.accepted_revision_id is not null then
    return pg_catalog.jsonb_build_object(
      'status', case when quote_row.accepted_revision_id = revision.id
        then 'accepted' else 'stale' end,
      'link_id', link.id, 'quote_id', link.quote_id,
      'revision_id', link.revision_id, 'organization_id', link.organization_id
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'link_id', link.id, 'quote_id', link.quote_id,
    'revision_id', link.revision_id, 'organization_id', link.organization_id
  );
end;
$$;

create or replace function public.broker_open_quote(
  p_selector uuid,
  p_secret text,
  p_subject_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access jsonb;
  revision public.quote_revisions%rowtype;
  quote_row public.quotes%rowtype;
  terminal public.quote_recipient_events%rowtype;
begin
  access := public.quote_public_link_status(p_selector, p_secret, 'open', p_subject_hash, 30, 60);
  if access->>'status' <> 'ok' then return access; end if;
  select * into revision from public.quote_revisions where id = (access->>'revision_id')::uuid;
  select * into quote_row from public.quotes where id = revision.quote_id;
  select * into terminal from public.quote_recipient_events
  where organization_id = revision.organization_id and quote_id = revision.quote_id
    and revision_id = revision.id
    and event_type in ('change_requested', 'declined', 'accepted');
  return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
    'link_id', access->>'link_id', 'revision_id', revision.id,
    'quote_number', quote_row.number, 'revision_number', revision.revision_number,
    'effective_state', 'issued', 'snapshot', revision.snapshot,
    'snapshot_hash', revision.snapshot_hash,
    'calculation_fingerprint', revision.calculation_fingerprint,
    'valid_until', revision.valid_until, 'response_type', terminal.event_type,
    'acceptance_allowed', terminal.id is null
  ));
end;
$$;

create or replace function public.broker_record_quote_event(
  p_event_type public.quote_recipient_event_type,
  p_selector uuid,
  p_secret text,
  p_subject_hash bytea,
  p_idempotency_key uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access jsonb;
  link public.quote_share_links%rowtype;
  quote_row public.quotes%rowtype;
  revision public.quote_revisions%rowtype;
  existing public.quote_recipient_events%rowtype;
  terminal public.quote_recipient_events%rowtype;
  normalized_message text := case when p_message is null then null
    else pg_catalog.btrim(pg_catalog.normalize(p_message)) end;
  request_hash text;
  event_id uuid;
  operation text := case p_event_type when 'viewed' then 'view'
    when 'change_requested' then 'change_request'
    when 'declined' then 'decline' else p_event_type::text end;
begin
  if p_event_type not in ('viewed', 'change_requested', 'declined')
    or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'recipient_event_request_invalid';
  end if;
  if (p_event_type = 'change_requested'
      and pg_catalog.char_length(coalesce(normalized_message, '')) not between 1 and 2000)
    or (p_event_type in ('viewed', 'declined') and p_message is not null) then
    return pg_catalog.jsonb_build_object('status', 'message_invalid');
  end if;
  access := public.quote_public_link_status(
    p_selector, p_secret, operation, p_subject_hash,
    case when p_event_type = 'viewed' then 60 else 10 end, 60
  );
  if access ? 'link_id' then
    select * into link from public.quote_share_links where id = (access->>'link_id')::uuid;
    request_hash := public.sha256_hex(public.canonical_json_v1(pg_catalog.jsonb_build_object(
      'event_type', p_event_type, 'link_id', link.id,
      'revision_id', link.revision_id, 'message', normalized_message
    )));
    select * into existing from public.quote_recipient_events
    where share_link_id = link.id and idempotency_key = p_idempotency_key;
    if existing.id is not null then
      if existing.request_hash <> request_hash then
        return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
        'event_id', existing.id, 'revision_id', existing.revision_id,
        'link_id', existing.share_link_id, 'type', existing.event_type,
        'message', existing.message, 'created_at', existing.created_at, 'replayed', true
      ));
    end if;
  end if;
  if access->>'status' <> 'ok' then return access; end if;

  select * into quote_row from public.quotes where id = link.quote_id for update;
  select * into revision from public.quote_revisions where id = link.revision_id for share;
  select * into link from public.quote_share_links where id = link.id for update;
  if link.disabled_at is not null then
    return pg_catalog.jsonb_build_object('status', link.disabled_reason::text);
  end if;
  if quote_row.current_revision_id <> revision.id or revision.state <> 'issued' then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  if link.expires_at <= pg_catalog.statement_timestamp()
    or revision.valid_until < public.organization_local_date(
      revision.organization_id, pg_catalog.statement_timestamp()
    ) then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  if quote_row.accepted_revision_id is not null then
    return pg_catalog.jsonb_build_object('status', 'accepted');
  end if;
  if p_event_type in ('change_requested', 'declined') then
    select * into terminal from public.quote_recipient_events
    where organization_id = revision.organization_id and quote_id = revision.quote_id
      and revision_id = revision.id
      and event_type in ('change_requested', 'declined', 'accepted');
    if terminal.id is not null then
      return pg_catalog.jsonb_build_object('status', 'already_responded');
    end if;
  end if;
  insert into public.quote_recipient_events (
    organization_id, quote_id, revision_id, share_link_id,
    event_type, idempotency_key, request_hash, message
  ) values (
    link.organization_id, link.quote_id, link.revision_id, link.id,
    p_event_type, p_idempotency_key, request_hash, normalized_message
  ) returning id into event_id;
  -- A change request is only an immutable recipient event. Only the authenticated
  -- begin_quote_revision command can create or edit a successor working revision.
  return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
    'event_id', event_id, 'revision_id', revision.id, 'link_id', link.id,
    'type', p_event_type, 'message', normalized_message,
    'created_at', pg_catalog.statement_timestamp(), 'replayed', false
  ));
exception when unique_violation then
  select * into existing from public.quote_recipient_events
  where share_link_id = link.id and idempotency_key = p_idempotency_key;
  if existing.id is not null and existing.request_hash = request_hash then
    return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
      'event_id', existing.id, 'revision_id', existing.revision_id,
      'link_id', existing.share_link_id, 'type', existing.event_type,
      'message', existing.message, 'created_at', existing.created_at, 'replayed', true
    ));
  end if;
  return pg_catalog.jsonb_build_object('status', 'already_responded');
end;
$$;

create or replace function public.broker_accept_quote(
  p_selector uuid,
  p_secret text,
  p_subject_hash bytea,
  p_idempotency_key uuid,
  p_buyer_asserted_name text,
  p_buyer_asserted_title text default null,
  p_acceptance_statement_version smallint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access jsonb;
  link public.quote_share_links%rowtype;
  quote_row public.quotes%rowtype;
  revision public.quote_revisions%rowtype;
  existing_event public.quote_recipient_events%rowtype;
  terminal public.quote_recipient_events%rowtype;
  acceptance public.quote_acceptances%rowtype;
  normalized_name text := pg_catalog.btrim(pg_catalog.normalize(coalesce(p_buyer_asserted_name, '')));
  normalized_title text := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_buyer_asserted_title, ''))), '');
  statement_document jsonb;
  statement_bytes bytea;
  statement_hash text;
  request_hash text;
  event_id uuid;
begin
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  if p_acceptance_statement_version <> 1
    or pg_catalog.char_length(normalized_name) not between 1 and 200
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_title is not null and (
      pg_catalog.char_length(normalized_title) not between 1 and 200
      or normalized_title ~ '[[:cntrl:]]'
    )) then
    return pg_catalog.jsonb_build_object('status', 'acceptance_evidence_invalid');
  end if;
  access := public.quote_public_link_status(p_selector, p_secret, 'accept', p_subject_hash, 10, 60);
  if access ? 'link_id' then
    select * into link from public.quote_share_links where id = (access->>'link_id')::uuid;
    select * into revision from public.quote_revisions where id = link.revision_id;
    statement_document := public.quote_acceptance_statement_v1(
      normalized_name, normalized_title, revision.id, revision.snapshot_hash,
      revision.calculation_fingerprint, p_acceptance_statement_version
    );
    statement_bytes := public.canonical_json_v1(statement_document);
    statement_hash := public.sha256_hex(statement_bytes);
    request_hash := public.sha256_hex(public.canonical_json_v1(pg_catalog.jsonb_build_object(
      'event_type', 'accepted', 'link_id', link.id, 'revision_id', revision.id,
      'snapshot_hash', revision.snapshot_hash,
      'calculation_fingerprint', revision.calculation_fingerprint,
      'recipient_email_snapshot', link.recipient_email,
      'acceptance_statement_hash', statement_hash
    )));
    select * into existing_event from public.quote_recipient_events
    where share_link_id = link.id and idempotency_key = p_idempotency_key;
    if existing_event.id is not null then
      if existing_event.request_hash <> request_hash then
        return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
      end if;
      select * into acceptance from public.quote_acceptances
      where recipient_event_id = existing_event.id;
      if acceptance.id is not null then
        return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
          'acceptance_id', acceptance.id, 'quote_id', acceptance.quote_id,
          'revision_id', acceptance.revision_id, 'share_link_id', acceptance.share_link_id,
          'recipient_event_id', acceptance.recipient_event_id,
          'snapshot_hash', acceptance.snapshot_hash,
          'calculation_fingerprint', acceptance.calculation_fingerprint,
          'recipient_email_snapshot', acceptance.recipient_email_snapshot,
          'buyer_asserted_name', acceptance.buyer_asserted_name,
          'buyer_asserted_title', acceptance.buyer_asserted_title,
          'acceptance_statement_version', acceptance.acceptance_statement_version,
          'acceptance_statement', acceptance.acceptance_statement,
          'acceptance_statement_hash', acceptance.acceptance_statement_hash,
          'accepted_at', acceptance.accepted_at, 'replayed', true
        ));
      end if;
    end if;
  end if;
  if access->>'status' <> 'ok' then return access; end if;

  select * into quote_row from public.quotes where id = link.quote_id for update;
  select * into revision from public.quote_revisions where id = link.revision_id for share;
  select * into link from public.quote_share_links where id = link.id for update;
  if quote_row.current_revision_id <> revision.id or revision.state <> 'issued' then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  if quote_row.accepted_revision_id is not null then
    return pg_catalog.jsonb_build_object('status', 'already_accepted');
  end if;
  if link.disabled_at is not null then
    return pg_catalog.jsonb_build_object('status', link.disabled_reason::text);
  end if;
  if link.expires_at <= pg_catalog.statement_timestamp()
    or revision.valid_until < public.organization_local_date(
      revision.organization_id, pg_catalog.statement_timestamp()
    ) then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  select * into terminal from public.quote_recipient_events
  where organization_id = revision.organization_id and quote_id = revision.quote_id
    and revision_id = revision.id
    and event_type in ('change_requested', 'declined', 'accepted');
  if terminal.id is not null then
    return pg_catalog.jsonb_build_object('status', 'already_responded');
  end if;
  insert into public.quote_recipient_events (
    organization_id, quote_id, revision_id, share_link_id,
    event_type, idempotency_key, request_hash
  ) values (
    link.organization_id, link.quote_id, revision.id, link.id,
    'accepted', p_idempotency_key, request_hash
  ) returning id into event_id;
  insert into public.quote_acceptances (
    organization_id, quote_id, revision_id, share_link_id,
    recipient_event_id, idempotency_key, snapshot_format_version,
    calculation_format_version, snapshot_hash, calculation_fingerprint,
    recipient_email_snapshot, buyer_asserted_name, buyer_asserted_title,
    acceptance_statement_version, acceptance_statement,
    acceptance_statement_document, canonical_acceptance_statement,
    acceptance_statement_hash
  ) values (
    link.organization_id, link.quote_id, revision.id, link.id,
    event_id, p_idempotency_key, revision.snapshot_format_version,
    revision.calculation_format_version, revision.snapshot_hash,
    revision.calculation_fingerprint, link.recipient_email,
    normalized_name, normalized_title, p_acceptance_statement_version,
    statement_document->>'statement', statement_document, statement_bytes,
    statement_hash
  ) returning * into acceptance;
  update public.quotes set accepted_revision_id = revision.id, version = version + 1
  where id = quote_row.id;
  update public.quote_share_links set disabled_at = pg_catalog.now(), disabled_reason = 'accepted'
  where quote_id = quote_row.id and disabled_at is null;
  return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
    'acceptance_id', acceptance.id, 'quote_id', acceptance.quote_id,
    'revision_id', acceptance.revision_id, 'share_link_id', acceptance.share_link_id,
    'recipient_event_id', acceptance.recipient_event_id,
    'snapshot_hash', acceptance.snapshot_hash,
    'calculation_fingerprint', acceptance.calculation_fingerprint,
    'recipient_email_snapshot', acceptance.recipient_email_snapshot,
    'buyer_asserted_name', acceptance.buyer_asserted_name,
    'buyer_asserted_title', acceptance.buyer_asserted_title,
    'acceptance_statement_version', acceptance.acceptance_statement_version,
    'acceptance_statement', acceptance.acceptance_statement,
    'acceptance_statement_hash', acceptance.acceptance_statement_hash,
    'accepted_at', acceptance.accepted_at, 'replayed', false
  ));
exception when unique_violation then
  select * into existing_event from public.quote_recipient_events
  where share_link_id = link.id and idempotency_key = p_idempotency_key;
  if existing_event.id is not null and existing_event.request_hash = request_hash then
    select * into acceptance from public.quote_acceptances where recipient_event_id = existing_event.id;
    if acceptance.id is not null then
      return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
        'acceptance_id', acceptance.id, 'quote_id', acceptance.quote_id,
        'revision_id', acceptance.revision_id, 'share_link_id', acceptance.share_link_id,
        'recipient_event_id', acceptance.recipient_event_id,
        'snapshot_hash', acceptance.snapshot_hash,
        'calculation_fingerprint', acceptance.calculation_fingerprint,
        'recipient_email_snapshot', acceptance.recipient_email_snapshot,
        'buyer_asserted_name', acceptance.buyer_asserted_name,
        'buyer_asserted_title', acceptance.buyer_asserted_title,
        'acceptance_statement_version', acceptance.acceptance_statement_version,
        'acceptance_statement', acceptance.acceptance_statement,
        'acceptance_statement_hash', acceptance.acceptance_statement_hash,
        'accepted_at', acceptance.accepted_at, 'replayed', true
      ));
    end if;
  end if;
  select * into terminal from public.quote_recipient_events
  where organization_id = revision.organization_id and quote_id = revision.quote_id
    and revision_id = revision.id
    and event_type in ('change_requested', 'declined', 'accepted');
  return pg_catalog.jsonb_build_object(
    'status', case when terminal.event_type = 'accepted'
      then 'already_accepted' else 'already_responded' end
  );
end;
$$;

create or replace function public.broker_verify_quote(
  p_verification_code text,
  p_subject_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision public.quote_revisions%rowtype;
  quote_row public.quotes%rowtype;
  acceptance public.quote_acceptances%rowtype;
  code_subject bytea := extensions.digest(
    pg_catalog.convert_to(pg_catalog.upper(pg_catalog.btrim(coalesce(p_verification_code, ''))), 'UTF8'),
    'sha256'
  );
begin
  if not public.consume_quote_public_rate_limit('verify', p_subject_hash, 30, 60)
    or not public.consume_quote_public_rate_limit('verify', code_subject, 10, 60) then
    return pg_catalog.jsonb_build_object('status', 'rate_limited');
  end if;
  select * into revision from public.quote_revisions
  where verification_code = pg_catalog.upper(pg_catalog.btrim(p_verification_code))
    and state = 'issued';
  if revision.id is null then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  select * into quote_row from public.quotes where id = revision.quote_id;
  select * into acceptance from public.quote_acceptances where revision_id = revision.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'value', pg_catalog.jsonb_build_object(
    'verified', true, 'quote_number', quote_row.number,
    'revision_number', revision.revision_number,
    'seller_legal_name', revision.snapshot#>>'{seller,legal_name}',
    'currency_code', revision.currency_code, 'total_minor', revision.total_minor,
    'issued_at', revision.issued_at, 'accepted_at', acceptance.accepted_at,
    'snapshot_hash', revision.snapshot_hash,
    'calculation_fingerprint', revision.calculation_fingerprint
  ));
end;
$$;

revoke all on function public.constant_time_bytea_equal(bytea,bytea),
  public.consume_quote_public_rate_limit(text,bytea,integer,integer),
  public.quote_public_link_status(uuid,text,text,bytea,integer,integer),
  public.broker_open_quote(uuid,text,bytea),
  public.broker_record_quote_event(public.quote_recipient_event_type,uuid,text,bytea,uuid,text),
  public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint),
  public.broker_verify_quote(text,bytea)
from public, anon, authenticated, service_role;
grant execute on function public.broker_open_quote(uuid,text,bytea),
  public.broker_record_quote_event(public.quote_recipient_event_type,uuid,text,bytea,uuid,text),
  public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint),
  public.broker_verify_quote(text,bytea)
to service_role;

comment on function public.broker_open_quote(uuid,text,bytea) is
  'Trusted broker boundary only. Stage 2 requires a separate security review and should prefer a Supabase Edge Function. Public clients receive neither broker credentials nor direct EXECUTE; rate subjects must be keyed HMAC digests created by that broker.';
comment on function public.broker_accept_quote(uuid,text,bytea,uuid,text,text,smallint) is
  'Trusted broker boundary only. Buyer name and title are asserted attributes, not certified identity and not legal electronic-signature evidence.';
comment on table public.quote_share_links is
  'Stores SHA-256 token digests only. Raw share secrets are returned once by create_quote_share_link and never persisted.';
comment on table public.quote_public_rate_buckets is
  'Stores opaque 32-byte keyed-HMAC rate subjects only; never raw IP addresses or browser identifiers.';

commit;
