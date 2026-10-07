-- JavaScript errors are outside Claritude's supported analytics product scope.
-- Stop retaining legacy raw/rollup events and clear compact per-view counters.
-- The compatibility columns remain temporarily so previously deployed RPCs and
-- cached tracker payloads can be handled safely during rollout.

delete from public.analytics_events
where event_type = 'js_error';

delete from public.analytics_hourly
where event_type = 'js_error';

delete from public.analytics_daily
where event_type = 'js_error';

update public.analytics_view_states
set javascript_errors = 0
where javascript_errors <> 0;

update public.analytics_view_daily
set javascript_errors = 0
where javascript_errors <> 0;
