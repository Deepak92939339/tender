begin;

create or replace function public.is_valid_iana_timezone(p_timezone text)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  select char_length(p_timezone) between 1 and 64
    and p_timezone ~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)*$'
    and p_timezone !~ '^(posix|right)/'
    and exists (
      select 1
      from pg_catalog.pg_timezone_names timezone
      where timezone.name = p_timezone
    );
$$;

alter table public.organizations
  add column timezone text not null default 'UTC';

alter table public.organizations
  add constraint organizations_timezone_check
  check (public.is_valid_iana_timezone(timezone)) not valid;
alter table public.organizations
  validate constraint organizations_timezone_check;

-- The enum value remains available as a derived API value, but persisted quote
-- state is always a real workflow state. Expiry is derived from date/timezone.
alter table public.quotes
  add constraint quotes_stored_state_not_expired_check
  check (state <> 'expired') not valid;
alter table public.quotes
  validate constraint quotes_stored_state_not_expired_check;

create or replace function public.organization_local_date(
  p_organization_id uuid,
  p_at timestamptz
)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone organization.timezone)::date
  from public.organizations organization
  where organization.id = p_organization_id;
$$;

create or replace function public.quote_effective_state(
  p_state public.quote_state,
  p_valid_until date,
  p_timezone text,
  p_at timestamptz
)
returns public.quote_state
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_valid_iana_timezone(p_timezone) then
    raise exception using errcode = '22023', message = 'organization_timezone_invalid';
  end if;
  if p_state in ('draft', 'waiting', 'approved')
    and (p_at at time zone p_timezone)::date > p_valid_until then
    return 'expired'::public.quote_state;
  end if;
  return p_state;
end;
$$;

create or replace function public.execute_scoped_quote_command(
  p_action text,
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  organization_id uuid;
  stored_state public.quote_state;
  quote_valid_until date;
  organization_timezone text;
  command_type text;
  capability text;
  request jsonb;
  replay jsonb;
  result jsonb;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;
  if p_action not in ('submit', 'approve', 'reject', 'issue') then
    raise exception using errcode = '22023', message = 'quote_action_invalid';
  end if;
  select quote.organization_id, quote.state, quote.valid_until, organization.timezone
  into organization_id, stored_state, quote_valid_until, organization_timezone
  from public.quotes quote
  join public.organizations organization on organization.id = quote.organization_id
  where quote.id = p_quote_id;
  command_type := 'quote.' || p_action;
  capability := command_type;
  if organization_id is null
    or not public.has_org_capability(organization_id, capability) then
    raise exception using
      errcode = '42501',
      message = 'quote_' || p_action || '_forbidden';
  end if;
  request := jsonb_build_object(
    'quote_id', p_quote_id,
    'expected_version', p_expected_version
  );
  if p_action = 'reject' then
    request := request || jsonb_build_object('reason', btrim(coalesce(p_reason, '')));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || organization_id::text || ':' || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization', organization_id, p_command_id, command_type,
    'quote', p_quote_id, request
  );
  if replay is not null then
    return replay;
  end if;
  if p_action in ('submit', 'approve', 'issue')
    and public.quote_effective_state(
      stored_state,
      quote_valid_until,
      organization_timezone,
      statement_timestamp()
    ) = 'expired' then
    raise exception using errcode = '22023', message = 'QUOTE_EXPIRED';
  end if;
  perform public.set_command_receipt_context(
    'organization', organization_id, p_command_id, request
  );
  case p_action
    when 'submit' then
      result := public.submit_quote_c0_impl(
        p_quote_id, p_expected_version, gen_random_uuid()
      );
    when 'approve' then
      result := public.approve_quote_c0_impl(
        p_quote_id, p_expected_version, gen_random_uuid()
      );
    when 'reject' then
      result := public.reject_quote_c0_impl(
        p_quote_id, p_expected_version, gen_random_uuid(), p_reason
      );
    when 'issue' then
      result := public.issue_quote_c0_impl(
        p_quote_id, p_expected_version, gen_random_uuid()
      );
  end case;
  return result;
end;
$$;

revoke execute on function public.is_valid_iana_timezone(text) from public, anon;
revoke execute on function public.organization_local_date(uuid, timestamptz) from public, anon;
revoke execute on function public.quote_effective_state(public.quote_state, date, text, timestamptz) from public, anon;
grant execute on function public.is_valid_iana_timezone(text) to authenticated;
grant execute on function public.organization_local_date(uuid, timestamptz) to authenticated;
grant execute on function public.quote_effective_state(public.quote_state, date, text, timestamptz) to authenticated;

commit;
