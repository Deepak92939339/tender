-- A portfolio reviewer may inspect the seeded organization but cannot mutate
-- commercial state. Existing RLS policies and guarded RPCs use these
-- capabilities as the database-enforced authorization boundary.
insert into public.roles (key, label)
values ('reviewer', 'Read-only reviewer')
on conflict (key) do update set label = excluded.label;

insert into public.role_capabilities (role_id, capability_key)
select role.id, capability.key
from public.roles role
join public.capabilities capability on capability.key in (
  'organization.read',
  'catalog.read',
  'customer.read',
  'quote.read'
)
where role.key = 'reviewer'
on conflict (role_id, capability_key) do nothing;
