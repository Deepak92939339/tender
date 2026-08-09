begin;

create or replace function public.currency_minor_unit_exponent(p_currency_code text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case p_currency_code
    when 'INR' then 2 when 'USD' then 2 when 'EUR' then 2
    when 'GBP' then 2 when 'RUB' then 2 when 'CAD' then 2
    when 'KWD' then 3 when 'JPY' then 0
    else null
  end;
$$;
revoke all on function public.currency_minor_unit_exponent(text) from public, anon, authenticated;

create or replace function public.is_supported_currency(p_currency_code text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select public.currency_minor_unit_exponent(p_currency_code) is not null;
$$;

create or replace function public.parse_currency_minor(
  p_value text,
  p_currency_code text
)
returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  exponent integer := public.currency_minor_unit_exponent(p_currency_code);
  scale numeric;
begin
  if exponent is null then return null; end if;
  if exponent = 0 then
    if p_value !~ '^[0-9]{1,15}$' then return null; end if;
  elsif p_value !~ ('^[0-9]{1,' || (15 - exponent)::text || '}(\.[0-9]{1,' || exponent::text || '})?$') then
    return null;
  end if;
  scale := power(10::numeric, exponent);
  if p_value::numeric * scale > 9007199254740991::numeric then return null; end if;
  return (p_value::numeric * scale)::bigint;
end;
$$;
revoke all on function public.parse_currency_minor(text, text) from public, anon, authenticated;

do $$
declare
  definition text;
  original text;
begin
  definition := pg_get_functiondef('public.prepare_catalog_import(uuid,text,jsonb)'::regprocedure);
  original := definition;
  definition := replace(
    definition,
    'if price_text ~ ''^([0-9]{1,13})(\.[0-9]{1,2})?$'' then price_minor := round(price_text::numeric * 100)::bigint; else codes := array_append(codes, ''UNIT_PRICE_INVALID''); fields := array_append(fields, ''unit_price''); end if;',
    'price_minor := public.parse_currency_minor(price_text, currency_value); if price_minor is null then codes := array_append(codes, ''UNIT_PRICE_INVALID''); fields := array_append(fields, ''unit_price''); end if;'
  );
  if definition = original then
    raise exception 'prepare_catalog_import currency parser source did not match expected predecessor';
  end if;
  execute definition;
end;
$$;

commit;
