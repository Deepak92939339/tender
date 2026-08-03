create index quotes_org_updated_at_idx
  on public.quotes (organization_id, updated_at desc);

create index quotes_org_waiting_submitted_at_idx
  on public.quotes (organization_id, submitted_at)
  where state = 'waiting';

create index quote_activity_org_quote_created_at_idx
  on public.quote_activity (organization_id, quote_id, created_at desc);

create index tax_profiles_org_active_code_idx
  on public.tax_profiles (organization_id, active desc, code);
