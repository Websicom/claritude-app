alter table public.properties
  add column if not exists last_tracker_heartbeat_at timestamptz;

comment on column public.properties.last_tracker_heartbeat_at is
  'Latest accepted privacy-safe tracker initialisation heartbeat. This is installation health evidence, not an analytics event or customer usage.';
