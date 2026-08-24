begin;

revoke select (
  selector, created_by
) on public.quote_share_links from authenticated;

grant select (
  id, revision_id, recipient_email, expires_at, created_at,
  disabled_at, disabled_reason
) on public.quote_share_links to authenticated;

commit;
