begin;

grant select (
  organization_id, quote_id
) on public.quote_share_links to authenticated;

commit;
