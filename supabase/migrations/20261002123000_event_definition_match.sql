begin;

alter table public.event_definitions
  add column if not exists match_settings jsonb not null default '{}'::jsonb;

alter table public.event_definitions
  drop constraint if exists event_definitions_match_settings_object;

alter table public.event_definitions
  add constraint event_definitions_match_settings_object
  check (jsonb_typeof(match_settings) = 'object');

comment on column public.event_definitions.match_settings is
  'Validated trigger matching configuration. Page views use mode/path; clicks use the stable data-claritude-event attribute; confirmed forms use an explicit success callback.';

insert into private.app_migrations(version, name, checksum)
values ('20261002123000', 'event_definition_match', 'self')
on conflict (version) do nothing;

commit;
