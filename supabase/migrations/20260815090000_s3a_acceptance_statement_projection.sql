begin;

create or replace function public.quote_acceptance_statement_text_v1(
  p_format_version smallint default 1
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_format_version <> 1 then
    raise exception using errcode = '22023', message = 'acceptance_evidence_invalid';
  end if;
  return 'I accept this exact Tender quotation revision and acknowledge that the name and title provided are buyer-asserted.';
end;
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
  statement text;
begin
  statement := public.quote_acceptance_statement_text_v1(p_format_version);
  if p_revision_id is null
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
    'response_type', terminal.event_type,
    'acceptance_allowed', terminal.id is null,
    'acceptance_statement_version', 1,
    'acceptance_statement', public.quote_acceptance_statement_text_v1(1::smallint)
  ));
end;
$$;

revoke all on function public.quote_acceptance_statement_text_v1(smallint)
from public, anon, authenticated, service_role;
revoke all on function public.quote_acceptance_statement_v1(text,text,uuid,text,text,smallint),
  public.broker_open_quote(uuid,text,bytea)
from public, anon, authenticated, service_role;
grant execute on function public.broker_open_quote(uuid,text,bytea) to service_role;

commit;
