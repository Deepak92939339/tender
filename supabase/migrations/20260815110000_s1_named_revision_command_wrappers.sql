begin;

create or replace function public.submit_quote_revision(
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_quote_revision_command(
    'submit', p_quote_id, p_revision_id, p_expected_version, p_command_id, null
  );
$$;

create or replace function public.approve_quote_revision(
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_quote_revision_command(
    'approve', p_quote_id, p_revision_id, p_expected_version, p_command_id, null
  );
$$;

create or replace function public.reject_quote_revision(
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_quote_revision_command(
    'reject', p_quote_id, p_revision_id, p_expected_version, p_command_id, p_reason
  );
$$;

create or replace function public.issue_quote_revision(
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.execute_quote_revision_command(
    'issue', p_quote_id, p_revision_id, p_expected_version, p_command_id, null
  );
$$;

revoke all on function
  public.submit_quote_revision(uuid, uuid, integer, uuid),
  public.approve_quote_revision(uuid, uuid, integer, uuid),
  public.reject_quote_revision(uuid, uuid, integer, uuid, text),
  public.issue_quote_revision(uuid, uuid, integer, uuid)
from public, anon, authenticated;
grant execute on function
  public.submit_quote_revision(uuid, uuid, integer, uuid),
  public.approve_quote_revision(uuid, uuid, integer, uuid),
  public.reject_quote_revision(uuid, uuid, integer, uuid, text),
  public.issue_quote_revision(uuid, uuid, integer, uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
