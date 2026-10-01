create table if not exists private.app_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);
revoke all on table private.app_migrations from public, anon, authenticated;
insert into private.app_migrations(version,name,checksum) values
  ('20261001230000','stage1_core','git:6a8ff69'),
  ('20261001231500','record_migrations','self')
on conflict(version) do nothing;
