-- Every property must have exactly one uptime monitor. This repairs legacy rows
-- and keeps the invariant when properties are inserted through any trusted path.
insert into public.uptime_monitors(property_id)
select p.id
from public.properties p
left join public.uptime_monitors m on m.property_id = p.id
where m.id is null
on conflict(property_id) do nothing;

create or replace function public.create_property_uptime_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.uptime_monitors(property_id)
  values (new.id)
  on conflict(property_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_property_uptime_monitor() from public, anon, authenticated;

drop trigger if exists property_uptime_monitor_created on public.properties;
create trigger property_uptime_monitor_created
after insert on public.properties
for each row execute function public.create_property_uptime_monitor();

insert into private.app_migrations(version, name, checksum)
values ('20261002040000', 'property_monitor_invariant', 'self')
on conflict(version) do nothing;
