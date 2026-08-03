begin;

-- The authoritative calculator is an internal commercial authority used by
-- database routines and local owner-only verification. It is not a browser RPC.
revoke all on function public.calculate_quote_payload(jsonb)
  from public, anon, authenticated;

comment on function public.calculate_quote_payload(jsonb) is
  'Internal authoritative quote calculator. Browser roles are revoked; local parity verification uses the database owner path.';

commit;
