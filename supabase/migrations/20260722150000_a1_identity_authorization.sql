begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.membership_status as enum ('active', 'invited', 'suspended');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  default_locale text not null default 'en-IN' check (default_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug::text ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  default_currency_code char(3) not null default 'INR' check (default_currency_code ~ '^[A-Z]{3}$'),
  default_locale text not null default 'en-IN' check (default_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  approval_threshold_bps integer not null default 1000 check (approval_threshold_bps between 0 and 10000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.capabilities (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.role_capabilities (
  role_id uuid not null references public.roles(id) on delete cascade,
  capability_key text not null references public.capabilities(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, capability_key)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create table public.command_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_id uuid not null,
  command_type text not null check (char_length(command_type) between 1 and 80),
  aggregate_type text not null check (char_length(aggregate_type) between 1 and 80),
  aggregate_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 8192),
  created_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (actor_user_id, command_id)
);

create index organization_memberships_user_active_idx
  on public.organization_memberships (user_id, organization_id)
  where status = 'active';
create index role_capabilities_capability_idx on public.role_capabilities (capability_key, role_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.organization_memberships
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_name text;
begin
  safe_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Tender user'), '@', 1))), 100);
  if safe_name = '' then safe_name := 'Tender user'; end if;
  insert into public.profiles (user_id, display_name)
  values (new.id, safe_name)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_active_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    ),
    false
  );
$$;

create or replace function public.has_org_capability(p_organization_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null and exists (
      select 1
      from public.organization_memberships membership
      join public.role_capabilities mapping on mapping.role_id = membership.role_id
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and mapping.capability_key = p_capability_key
    ),
    false
  );
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
  normalized_name text := btrim(p_name);
  normalized_slug text := lower(btrim(p_slug));
  admin_role_id uuid;
  organization_id uuid;
  existing_result jsonb;
  safe_result jsonb;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'command_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || p_command_id::text, 0));

  select receipt.result into existing_result
  from public.command_receipts receipt
  where receipt.actor_user_id = caller and receipt.command_id = p_command_id;
  if existing_result is not null then return existing_result; end if;

  if char_length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'organization_name_invalid';
  end if;
  if normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception using errcode = '22023', message = 'organization_slug_invalid';
  end if;

  select role.id into admin_role_id from public.roles role where role.key = 'organization_admin';
  if admin_role_id is null then
    raise exception using errcode = '55000', message = 'authorization_dictionary_missing';
  end if;

  insert into public.organizations (slug, name, created_by)
  values (normalized_slug, normalized_name, caller)
  returning id into organization_id;

  insert into public.organization_memberships (organization_id, user_id, role_id, status)
  values (organization_id, caller, admin_role_id, 'active');

  safe_result := jsonb_build_object(
    'organization_id', organization_id,
    'slug', normalized_slug,
    'name', normalized_name,
    'role', 'organization_admin'
  );

  insert into public.command_receipts (
    organization_id, command_id, command_type, aggregate_type, aggregate_id, actor_user_id, result
  ) values (
    organization_id, p_command_id, 'organization.create', 'organization', organization_id, caller, safe_result
  );

  return safe_result;
exception
  when unique_violation then
    if exists (select 1 from public.organizations organization where organization.slug = normalized_slug::extensions.citext) then
      raise exception using errcode = '23505', message = 'organization_slug_taken';
    end if;
    raise;
end;
$$;

insert into public.roles (key, label) values
  ('operator', 'Operator'),
  ('manager', 'Manager'),
  ('organization_admin', 'Organization admin');

insert into public.capabilities (key, label) values
  ('organization.read', 'Read organization settings'),
  ('organization.manage', 'Manage organization settings'),
  ('membership.read', 'Read organization memberships'),
  ('membership.manage', 'Manage organization memberships'),
  ('catalog.read', 'Read catalog'),
  ('catalog.manage', 'Manage catalog'),
  ('catalog.import', 'Import catalog'),
  ('customer.read', 'Read customers'),
  ('customer.manage', 'Manage customers'),
  ('quote.read', 'Read quotations'),
  ('quote.create', 'Create quotations'),
  ('quote.edit', 'Edit draft quotations'),
  ('quote.submit', 'Submit quotations'),
  ('quote.approve', 'Approve quotations'),
  ('quote.reject', 'Reject quotations'),
  ('quote.issue', 'Issue approved quotations'),
  ('quote.print', 'Print issued quotations');

insert into public.role_capabilities (role_id, capability_key)
select role.id, capability.key
from public.roles role
cross join public.capabilities capability
where
  (role.key = 'operator' and capability.key in (
    'catalog.read', 'catalog.manage', 'catalog.import',
    'customer.read', 'customer.manage',
    'quote.read', 'quote.create', 'quote.edit', 'quote.submit', 'quote.issue', 'quote.print'
  ))
  or (role.key = 'manager' and capability.key in (
    'catalog.read', 'catalog.manage', 'catalog.import',
    'customer.read', 'customer.manage',
    'quote.read', 'quote.create', 'quote.edit', 'quote.submit', 'quote.approve', 'quote.reject', 'quote.issue', 'quote.print'
  ))
  or role.key = 'organization_admin';

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.capabilities enable row level security;
alter table public.role_capabilities enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.command_receipts enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated
using (user_id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy organizations_select_member on public.organizations for select to authenticated
using (public.is_active_org_member(id));
create policy organizations_update_manager on public.organizations for update to authenticated
using (public.has_org_capability(id, 'organization.manage'))
with check (public.has_org_capability(id, 'organization.manage'));

create policy roles_read_dictionary on public.roles for select to authenticated using (true);
create policy capabilities_read_dictionary on public.capabilities for select to authenticated using (true);
create policy role_capabilities_read_dictionary on public.role_capabilities for select to authenticated using (true);

create policy memberships_select_authorized on public.organization_memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.has_org_capability(organization_id, 'membership.read')
);

revoke all on public.profiles, public.organizations, public.roles, public.capabilities,
  public.role_capabilities, public.organization_memberships, public.command_receipts from anon, authenticated;
grant select, update (display_name, default_locale) on public.profiles to authenticated;
grant select, update (name, default_currency_code, default_locale, approval_threshold_bps) on public.organizations to authenticated;
grant select on public.roles, public.capabilities, public.role_capabilities, public.organization_memberships to authenticated;

revoke all on function public.is_active_org_member(uuid) from public;
revoke all on function public.has_org_capability(uuid, text) from public;
revoke all on function public.create_organization(text, text, uuid) from public;
grant execute on function public.is_active_org_member(uuid) to authenticated;
grant execute on function public.has_org_capability(uuid, text) to authenticated;
grant execute on function public.create_organization(text, text, uuid) to authenticated;

commit;
