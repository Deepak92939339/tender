begin;

alter table public.organizations
  drop constraint organizations_timezone_check;

alter table public.organizations
  alter column timezone set default 'UTC',
  alter column timezone set not null;

create or replace function public.normalize_organization_settings_payload(
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  name_value text;
  currency_value text;
  locale_value text;
  timezone_value text;
  threshold_value integer;
  normalized jsonb;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 8192
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'name',
        'default_currency_code',
        'default_locale',
        'timezone',
        'approval_threshold_bps'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  name_value := btrim(coalesce(p_payload ->> 'name', ''));
  currency_value := upper(
    btrim(coalesce(p_payload ->> 'default_currency_code', ''))
  );
  locale_value := btrim(coalesce(p_payload ->> 'default_locale', ''));
  timezone_value := btrim(coalesce(p_payload ->> 'timezone', ''));

  if char_length(name_value) not between 1 and 120
    or name_value ~ '[[:cntrl:]]'
    or currency_value !~ '^[A-Z]{3}$'
    or char_length(locale_value) > 35
    or locale_value !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    or (
      p_payload ? 'timezone'
      and (
        char_length(timezone_value) not between 1 and 64
        or timezone_value !~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)*$'
        or timezone_value ~ '^(posix|right)/'
      )
    )
    or coalesce(p_payload ->> 'approval_threshold_bps', '')
      !~ '^[0-9]{1,5}$' then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  threshold_value := (p_payload ->> 'approval_threshold_bps')::integer;
  if threshold_value not between 0 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'organization_settings_payload_invalid';
  end if;

  normalized := jsonb_build_object(
    'name', name_value,
    'default_currency_code', currency_value,
    'default_locale', locale_value,
    'approval_threshold_bps', threshold_value
  );
  if p_payload ? 'timezone' then
    normalized := normalized || jsonb_build_object(
      'timezone',
      timezone_value
    );
  end if;
  return normalized;
end;
$$;

create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
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
  request := jsonb_build_object(
    'name', btrim(p_name),
    'slug', lower(btrim(p_slug))
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'user:' || caller::text || ':' || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'user',
    caller,
    p_command_id,
    'organization.create',
    'organization',
    null,
    request
  );
  if replay is not null then
    return replay;
  end if;

  if not public.is_valid_iana_timezone('UTC') then
    raise exception using
      errcode = '55000',
      message = 'organization_timezone_catalog_unavailable';
  end if;

  perform public.set_command_receipt_context(
    'user',
    caller,
    p_command_id,
    request
  );
  result := public.create_organization_c0_impl(
    p_name,
    p_slug,
    gen_random_uuid()
  );
  return result;
end;
$$;

create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  organization_row public.organizations%rowtype;
  request jsonb;
  normalized jsonb;
  timezone_value text;
  replay jsonb;
  result jsonb;
begin
  if caller is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into organization_row
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if organization_row.id is null
    or not public.has_org_capability(
      p_organization_id,
      'organization.manage'
    ) then
    raise exception using
      errcode = '42501',
      message = 'organization_settings_update_forbidden';
  end if;

  request := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'expected_version',
    p_expected_version,
    'payload',
    p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:'
        || p_organization_id::text
        || ':'
        || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization',
    p_organization_id,
    p_command_id,
    'organization.settings.update',
    'organization',
    p_organization_id,
    request
  );
  if replay is not null then
    return replay;
  end if;

  if organization_row.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'organization_version_stale';
  end if;

  normalized := public.normalize_organization_settings_payload(p_payload);
  timezone_value := coalesce(
    normalized ->> 'timezone',
    organization_row.timezone
  );
  if not public.is_valid_iana_timezone(timezone_value) then
    raise exception using
      errcode = '22023',
      message = 'organization_timezone_invalid';
  end if;

  update public.organizations organization
  set
    name = normalized ->> 'name',
    default_currency_code = normalized ->> 'default_currency_code',
    default_locale = normalized ->> 'default_locale',
    timezone = timezone_value,
    approval_threshold_bps =
      (normalized ->> 'approval_threshold_bps')::integer
  where organization.id = p_organization_id;

  result := jsonb_build_object(
    'id',
    p_organization_id,
    'version',
    organization_row.version + 1
  );
  perform public.record_organization_command(
    p_organization_id,
    p_command_id,
    'organization.settings.update',
    'organization',
    p_organization_id,
    caller,
    request,
    result
  );
  return result;
end;
$$;

revoke update on public.organizations from authenticated;
revoke all on function
  public.normalize_organization_settings_payload(jsonb)
from public, anon, authenticated;
revoke all on function
  public.create_organization(text, text, uuid),
  public.update_organization_settings(uuid, integer, jsonb, uuid)
from public, anon, authenticated;
grant execute on function
  public.create_organization(text, text, uuid),
  public.update_organization_settings(uuid, integer, jsonb, uuid)
to authenticated;

commit;
