begin;

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
  customer_active boolean;
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

  select customer.active
  into customer_active
  from public.customers customer
  where customer.organization_id = p_organization_id
    and customer.id = p_customer_id
  for share;
  if customer_active is false then
    raise exception using errcode = '55000', message = 'CUSTOMER_ARCHIVED';
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

revoke all on function public.create_quote_draft(
  uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
) from public, anon, authenticated;
grant execute on function public.create_quote_draft(
  uuid, uuid, text, text, text, public.tax_price_basis, date, date, uuid
) to authenticated;

commit;
