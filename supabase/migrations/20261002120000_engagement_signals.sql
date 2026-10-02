begin;

alter table public.analytics_events
  drop constraint if exists analytics_events_event_type_check;

alter table public.analytics_events
  add constraint analytics_events_event_type_check
  check (
    event_type in (
      'pageview',
      'click',
      'outbound',
      'scroll',
      'active_time',
      'form_success',
      'web_vital',
      'js_error',
      'visible_section'
    )
  );

comment on column public.analytics_events.metadata is
  'Bounded anonymous context. New tracker records include a per-page-view view_id so aggregate engagement and vital signals can be correlated without creating a person profile.';

insert into private.app_migrations(version, name, checksum)
values ('20261002120000', 'engagement_signals', 'self')
on conflict (version) do nothing;

commit;
