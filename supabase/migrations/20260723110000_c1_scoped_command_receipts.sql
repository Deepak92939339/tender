begin;

alter table public.command_receipts
  add column scope_type text,
  add column scope_id uuid,
  add column request_hash text;

update public.command_receipts receipt
set
  scope_type = case
    when receipt.command_type = 'organization.create' then 'user'
    else 'organization'
  end,
  scope_id = case
    when receipt.command_type = 'organization.create' then receipt.actor_user_id
    else receipt.organization_id
  end,
  request_hash = encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'legacy_receipt_id', receipt.id,
          'command_type', receipt.command_type,
          'aggregate_type', receipt.aggregate_type,
          'aggregate_id', receipt.aggregate_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

alter table public.command_receipts
  alter column scope_type set not null,
  alter column scope_id set not null,
  alter column request_hash set not null,
  drop constraint if exists command_receipts_organization_id_command_id_key,
  drop constraint if exists command_receipts_actor_user_id_command_id_key,
  add constraint command_receipts_scope_type_check
    check (scope_type in ('user', 'organization')),
  add constraint command_receipts_scope_owner_check
    check (
      (scope_type = 'user' and scope_id = actor_user_id)
      or (scope_type = 'organization' and scope_id = organization_id)
    ),
  add constraint command_receipts_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  add constraint command_receipts_scope_command_key
    unique (scope_type, scope_id, command_id);

create index command_receipts_organization_created_idx
  on public.command_receipts (organization_id, created_at desc);

create or replace function public.command_request_hash(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      pg_catalog.convert_to(coalesce(p_request, 'null'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.command_receipt_replay(
  p_scope_type text,
  p_scope_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.command_receipts%rowtype;
begin
  select *
  into existing
  from public.command_receipts receipt
  where receipt.scope_type = p_scope_type
    and receipt.scope_id = p_scope_id
    and receipt.command_id = p_command_id;

  if not found then
    return null;
  end if;

  if existing.command_type <> p_command_type
    or existing.aggregate_type <> p_aggregate_type
    or (p_aggregate_id is not null and existing.aggregate_id <> p_aggregate_id)
    or existing.request_hash <> public.command_request_hash(p_request) then
    raise exception using errcode = '22023', message = 'command_id_collision';
  end if;

  return existing.result;
end;
$$;

create or replace function public.set_command_receipt_context(
  p_scope_type text,
  p_scope_id uuid,
  p_command_id uuid,
  p_request jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope_type not in ('user', 'organization')
    or p_scope_id is null
    or p_command_id is null then
    raise exception using errcode = '22023', message = 'command_scope_invalid';
  end if;
  perform pg_catalog.set_config('tender.command_scope_type', p_scope_type, true);
  perform pg_catalog.set_config('tender.command_scope_id', p_scope_id::text, true);
  perform pg_catalog.set_config('tender.command_id', p_command_id::text, true);
  perform pg_catalog.set_config(
    'tender.command_request_hash',
    public.command_request_hash(p_request),
    true
  );
end;
$$;

create or replace function public.apply_command_receipt_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_scope_type text :=
    nullif(pg_catalog.current_setting('tender.command_scope_type', true), '');
  configured_scope_id text :=
    nullif(pg_catalog.current_setting('tender.command_scope_id', true), '');
  configured_command_id text :=
    nullif(pg_catalog.current_setting('tender.command_id', true), '');
  configured_request_hash text :=
    nullif(pg_catalog.current_setting('tender.command_request_hash', true), '');
begin
  if configured_scope_type is not null then
    new.scope_type := configured_scope_type;
    new.scope_id := configured_scope_id::uuid;
    new.command_id := configured_command_id::uuid;
    new.request_hash := configured_request_hash;
  else
    new.scope_type := coalesce(
      new.scope_type,
      case when new.command_type = 'organization.create' then 'user' else 'organization' end
    );
    new.scope_id := coalesce(
      new.scope_id,
      case when new.scope_type = 'user' then new.actor_user_id else new.organization_id end
    );
    new.request_hash := coalesce(
      new.request_hash,
      public.command_request_hash(jsonb_build_object(
        'command_type', new.command_type,
        'aggregate_type', new.aggregate_type,
        'aggregate_id', new.aggregate_id,
        'result', new.result
      ))
    );
  end if;
  return new;
end;
$$;

create trigger command_receipts_apply_context
before insert on public.command_receipts
for each row execute function public.apply_command_receipt_context();

alter function public.create_organization(text, text, uuid)
  rename to create_organization_c0_impl;
alter function public.commit_catalog_import(uuid, boolean, uuid)
  rename to commit_catalog_import_c0_impl;
alter function public.create_quote_draft(
  uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
) rename to create_quote_draft_c0_impl;
alter function public.save_quote_draft(uuid, integer, uuid, jsonb)
  rename to save_quote_draft_c1_payload_impl;
alter function public.submit_quote(uuid, integer, uuid)
  rename to submit_quote_c0_impl;
alter function public.approve_quote(uuid, integer, uuid)
  rename to approve_quote_c0_impl;
alter function public.reject_quote(uuid, integer, uuid, text)
  rename to reject_quote_c0_impl;
alter function public.issue_quote(uuid, integer, uuid)
  rename to issue_quote_c0_impl;

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
    pg_catalog.hashtextextended('user:' || caller::text || ':' || p_command_id::text, 0)
  );
  replay := public.command_receipt_replay(
    'user', caller, p_command_id, 'organization.create', 'organization', null, request
  );
  if replay is not null then
    return replay;
  end if;
  perform public.set_command_receipt_context('user', caller, p_command_id, request);
  result := public.create_organization_c0_impl(p_name, p_slug, gen_random_uuid());
  return result;
end;
$$;

create or replace function public.commit_catalog_import(
  p_batch_id uuid,
  p_allow_partial boolean,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  organization_id uuid;
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
  select batch.organization_id
  into organization_id
  from public.catalog_import_batches batch
  where batch.id = p_batch_id;
  if organization_id is null then
    raise exception using errcode = 'P0002', message = 'catalog_import_not_found';
  end if;
  if not public.has_org_capability(organization_id, 'catalog.import') then
    raise exception using errcode = '42501', message = 'catalog_import_forbidden';
  end if;
  request := jsonb_build_object(
    'batch_id', p_batch_id,
    'allow_partial', p_allow_partial
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || organization_id::text || ':' || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization', organization_id, p_command_id, 'catalog.import.commit',
    'catalog_import', p_batch_id, request
  );
  if replay is not null then
    return replay;
  end if;
  perform public.set_command_receipt_context(
    'organization', organization_id, p_command_id, request
  );
  result := public.commit_catalog_import_c0_impl(
    p_batch_id, p_allow_partial, gen_random_uuid()
  );
  return result;
end;
$$;

create or replace function public.create_quote_draft(
  p_organization_id uuid,
  p_customer_id uuid,
  p_currency_code text,
  p_locale text,
  p_tax_label text,
  p_tax_mode public.tax_price_basis,
  p_issue_date date,
  p_valid_until date,
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
  if caller is null
    or not public.has_org_capability(p_organization_id, 'quote.create') then
    raise exception using errcode = '42501', message = 'quote_create_forbidden';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;
  request := jsonb_build_object(
    'organization_id', p_organization_id,
    'customer_id', p_customer_id,
    'currency_code', upper(btrim(p_currency_code)),
    'locale', btrim(p_locale),
    'tax_label', btrim(p_tax_label),
    'tax_mode', p_tax_mode,
    'issue_date', p_issue_date,
    'valid_until', p_valid_until
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || p_organization_id::text || ':' || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization', p_organization_id, p_command_id, 'quote.create_draft',
    'quote', null, request
  );
  if replay is not null then
    return replay;
  end if;
  perform public.set_command_receipt_context(
    'organization', p_organization_id, p_command_id, request
  );
  result := public.create_quote_draft_c0_impl(
    p_organization_id, p_customer_id, p_currency_code, p_locale, p_tax_label,
    p_tax_mode, p_issue_date, p_valid_until, gen_random_uuid()
  );
  return result;
end;
$$;

create or replace function public.save_quote_draft(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  organization_id uuid;
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
  select quote.organization_id
  into organization_id
  from public.quotes quote
  where quote.id = p_quote_id;
  if organization_id is null
    or not public.has_org_capability(organization_id, 'quote.edit') then
    raise exception using errcode = '42501', message = 'quote_edit_forbidden';
  end if;
  request := jsonb_build_object(
    'quote_id', p_quote_id,
    'expected_version', p_expected_version,
    'payload', p_payload
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization:' || organization_id::text || ':' || p_command_id::text,
      0
    )
  );
  replay := public.command_receipt_replay(
    'organization', organization_id, p_command_id, 'quote.save_draft',
    'quote', p_quote_id, request
  );
  if replay is not null then
    return replay;
  end if;
  perform public.set_command_receipt_context(
    'organization', organization_id, p_command_id, request
  );
  result := public.save_quote_draft_c1_payload_impl(
    p_quote_id, p_expected_version, gen_random_uuid(), p_payload
  );
  return result;
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
  select quote.organization_id
  into organization_id
  from public.quotes quote
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

create or replace function public.submit_quote(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_scoped_quote_command(
    'submit', p_quote_id, p_expected_version, p_command_id, null
  );
$$;

create or replace function public.approve_quote(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_scoped_quote_command(
    'approve', p_quote_id, p_expected_version, p_command_id, null
  );
$$;

create or replace function public.reject_quote(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_scoped_quote_command(
    'reject', p_quote_id, p_expected_version, p_command_id, p_reason
  );
$$;

create or replace function public.issue_quote(
  p_quote_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_scoped_quote_command(
    'issue', p_quote_id, p_expected_version, p_command_id, null
  );
$$;

revoke all on function
  public.command_request_hash(jsonb),
  public.command_receipt_replay(text, uuid, uuid, text, text, uuid, jsonb),
  public.set_command_receipt_context(text, uuid, uuid, jsonb),
  public.apply_command_receipt_context(),
  public.create_organization_c0_impl(text, text, uuid),
  public.commit_catalog_import_c0_impl(uuid, boolean, uuid),
  public.create_quote_draft_c0_impl(
    uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
  ),
  public.save_quote_draft_c1_payload_impl(uuid, integer, uuid, jsonb),
  public.submit_quote_c0_impl(uuid, integer, uuid),
  public.approve_quote_c0_impl(uuid, integer, uuid),
  public.reject_quote_c0_impl(uuid, integer, uuid, text),
  public.issue_quote_c0_impl(uuid, integer, uuid),
  public.execute_scoped_quote_command(text, uuid, integer, uuid, text)
from public, anon, authenticated;

revoke all on function
  public.create_organization(text, text, uuid),
  public.commit_catalog_import(uuid, boolean, uuid),
  public.create_quote_draft(
    uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
  ),
  public.save_quote_draft(uuid, integer, uuid, jsonb),
  public.submit_quote(uuid, integer, uuid),
  public.approve_quote(uuid, integer, uuid),
  public.reject_quote(uuid, integer, uuid, text),
  public.issue_quote(uuid, integer, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_organization(text, text, uuid),
  public.commit_catalog_import(uuid, boolean, uuid),
  public.create_quote_draft(
    uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
  ),
  public.save_quote_draft(uuid, integer, uuid, jsonb),
  public.submit_quote(uuid, integer, uuid),
  public.approve_quote(uuid, integer, uuid),
  public.reject_quote(uuid, integer, uuid, text),
  public.issue_quote(uuid, integer, uuid)
to authenticated;

commit;
