begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(9);

select is(
  pg_get_indexdef(to_regclass('public.quotes_org_updated_at_idx')),
  'CREATE INDEX quotes_org_updated_at_idx ON public.quotes USING btree (organization_id, updated_at DESC)',
  'quote list has an organization-scoped newest-first index'
);

select is(
  pg_get_indexdef(to_regclass('public.quotes_org_waiting_submitted_at_idx')),
  'CREATE INDEX quotes_org_waiting_submitted_at_idx ON public.quotes USING btree (organization_id, submitted_at) WHERE (state = ''waiting''::quote_state)',
  'approval queue has an organization-scoped waiting-state order index'
);

select is(
  pg_get_indexdef(to_regclass('public.quote_activity_org_quote_created_at_idx')),
  'CREATE INDEX quote_activity_org_quote_created_at_idx ON public.quote_activity USING btree (organization_id, quote_id, created_at DESC)',
  'commercial activity has an organization-and-quote newest-first index'
);

select is(
  pg_get_indexdef(to_regclass('public.tax_profiles_org_active_code_idx')),
  'CREATE INDEX tax_profiles_org_active_code_idx ON public.tax_profiles USING btree (organization_id, active DESC, code)',
  'tax profile selectors have an organization-scoped active-first code index'
);

select is(
  pg_get_indexdef(to_regclass('public.products_org_active_idx')),
  'CREATE INDEX products_org_active_idx ON public.products USING btree (organization_id, active, sku)',
  'product selectors retain organization, active, and SKU coverage'
);

select is(
  pg_get_indexdef(to_regclass('public.customers_org_active_name_idx')),
  'CREATE INDEX customers_org_active_name_idx ON public.customers USING btree (organization_id, active, name)',
  'customer selectors retain organization, active, and name coverage'
);

select is(
  pg_get_indexdef(to_regclass('public.command_receipts_scope_command_key')),
  'CREATE UNIQUE INDEX command_receipts_scope_command_key ON public.command_receipts USING btree (scope_type, scope_id, command_id)',
  'command receipt replay lookups retain their scoped uniqueness index'
);

select is(
  pg_get_indexdef(
    to_regclass(
      'public.quote_items_organization_id_quote_id_position_key'
    )
  ),
  'CREATE UNIQUE INDEX quote_items_organization_id_quote_id_position_key ON public.quote_items USING btree (organization_id, quote_id, "position")',
  'quote item hydration retains organization, quote, and position coverage'
);

select is(
  pg_get_indexdef(
    to_regclass(
      'public.quote_charges_organization_id_quote_id_position_key'
    )
  ),
  'CREATE UNIQUE INDEX quote_charges_organization_id_quote_id_position_key ON public.quote_charges USING btree (organization_id, quote_id, "position")',
  'quote charge hydration retains organization, quote, and position coverage'
);

select * from finish();
rollback;
