begin;

create or replace function public.search_products(
  p_organization_id uuid,
  p_query text,
  p_state text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  sku text,
  description text,
  unit_code public.unit_code,
  quantity_precision smallint,
  unit_price_minor bigint,
  currency_code char(3),
  tax_profile_id uuid,
  tax_code text,
  tax_label text,
  active boolean,
  version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null
    or not public.has_org_capability(p_organization_id, 'catalog.read') then
    raise exception using errcode = '42501', message = 'product_search_forbidden';
  end if;
  if char_length(search_term) > 100 or search_term ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'search_query_invalid';
  end if;
  if p_state not in ('active', 'inactive', 'all')
    or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'search_bounds_invalid';
  end if;
  return query
  select
    product.id,
    product.sku,
    product.description,
    product.unit_code,
    product.quantity_precision,
    product.unit_price_minor,
    product.currency_code,
    product.tax_profile_id,
    profile.code,
    profile.label,
    product.active,
    product.version
  from public.products product
  join public.tax_profiles profile
    on profile.organization_id = product.organization_id
    and profile.id = product.tax_profile_id
  where product.organization_id = p_organization_id
    and (p_state = 'all' or product.active = (p_state = 'active'))
    and (
      search_term = ''
      or pg_catalog.strpos(lower(product.sku), lower(search_term)) > 0
      or pg_catalog.strpos(lower(product.description), lower(search_term)) > 0
    )
  order by product.sku, product.id
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.search_customers(
  p_organization_id uuid,
  p_query text,
  p_state text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  name text,
  contact_name text,
  email text,
  phone text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_region text,
  billing_postal_code text,
  billing_country_code char(2),
  locale text,
  preferred_currency_code char(3),
  tax_treatment public.tax_treatment,
  tax_identifier text,
  active boolean,
  version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null
    or not public.has_org_capability(p_organization_id, 'customer.read') then
    raise exception using errcode = '42501', message = 'customer_search_forbidden';
  end if;
  if char_length(search_term) > 100 or search_term ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'search_query_invalid';
  end if;
  if p_state not in ('active', 'inactive', 'all')
    or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'search_bounds_invalid';
  end if;
  return query
  select
    customer.id,
    customer.name,
    customer.contact_name,
    customer.email,
    customer.phone,
    customer.billing_address_line1,
    customer.billing_address_line2,
    customer.billing_city,
    customer.billing_region,
    customer.billing_postal_code,
    customer.billing_country_code,
    customer.locale,
    customer.preferred_currency_code,
    customer.tax_treatment,
    customer.tax_identifier,
    customer.active,
    customer.version
  from public.customers customer
  where customer.organization_id = p_organization_id
    and (p_state = 'all' or customer.active = (p_state = 'active'))
    and (
      search_term = ''
      or pg_catalog.strpos(lower(customer.name), lower(search_term)) > 0
      or pg_catalog.strpos(lower(customer.contact_name), lower(search_term)) > 0
      or pg_catalog.strpos(lower(customer.email), lower(search_term)) > 0
    )
  order by customer.name, customer.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function
  public.search_products(uuid, text, text, integer, integer),
  public.search_customers(uuid, text, text, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.search_products(uuid, text, text, integer, integer),
  public.search_customers(uuid, text, text, integer, integer)
to authenticated;

commit;
