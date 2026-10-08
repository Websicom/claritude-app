-- Correct daily outcome attribution and expose the exact series rendered by
-- the SuperAdmin overview. Audit outcomes belong to completed_at, while starts
-- remain on created_at. Analytics sessions and uptime pass/fail values are
-- calculated from their authoritative source records.
create or replace function public.superadmin_overview_activity(
  p_billing_environment text,
  p_from date,
  p_to date
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped_accounts as (
    select id from public.accounts where billing_environment = p_billing_environment
  ),
  scoped_properties as (
    select property.id
    from public.properties property
    join scoped_accounts account on account.id = property.account_id
  ),
  days as (
    select generated_day::date as "day"
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') generated_day
  ),
  audit_starts as (
    select run.created_at::date as "day", count(*) audits
    from public.audit_runs run
    join scoped_properties property on property.id = run.property_id
    where run.created_at >= p_from::timestamptz and run.created_at < (p_to + 1)::timestamptz
    group by 1
  ),
  audit_outcomes as (
    select run.completed_at::date as "day",
      count(*) filter (where run.status = 'completed') audits_completed,
      count(*) filter (where run.status = 'failed') audits_failed,
      count(*) filter (where run.status = 'partial') audits_partial
    from public.audit_runs run
    join scoped_properties property on property.id = run.property_id
    where run.completed_at >= p_from::timestamptz and run.completed_at < (p_to + 1)::timestamptz
    group by 1
  ),
  audit_evaluations as (
    select result.created_at::date as "day", count(*) evaluations
    from public.audit_results result
    join public.audit_runs run on run.id = result.audit_run_id
    join scoped_properties property on property.id = run.property_id
    where result.created_at >= p_from::timestamptz and result.created_at < (p_to + 1)::timestamptz
    group by 1
  ),
  analytics_activity as (
    select event.occurred_at::date as "day",
      count(*) events,
      count(*) filter (where event.event_type = 'pageview') pageviews,
      count(distinct nullif(event.metadata ->> 'session', '')) sessions
    from public.analytics_events event
    join scoped_properties property on property.id = event.property_id
    where event.occurred_at >= p_from::timestamptz and event.occurred_at < (p_to + 1)::timestamptz
    group by 1
  ),
  uptime_activity as (
    select check_row.checked_at::date as "day",
      count(*) checks,
      count(*) filter (where check_row.success) passed,
      count(*) filter (where not check_row.success) failed
    from public.uptime_checks check_row
    join public.uptime_monitors monitor on monitor.id = check_row.monitor_id
    join scoped_properties property on property.id = monitor.property_id
    where check_row.checked_at >= p_from::timestamptz and check_row.checked_at < (p_to + 1)::timestamptz
    group by 1
  ),
  incident_activity as (
    select incident.opened_at::date as "day", count(*) incidents
    from public.incidents incident
    join scoped_properties property on property.id = incident.property_id
    where incident.opened_at >= p_from::timestamptz and incident.opened_at < (p_to + 1)::timestamptz
    group by 1
  ),
  report_activity as (
    select report.created_at::date as "day", count(*) reports
    from public.saved_reports report
    join scoped_properties property on property.id = report.property_id
    where report.created_at >= p_from::timestamptz and report.created_at < (p_to + 1)::timestamptz
    group by 1
  ),
  notification_activity as (
    select delivery.created_at::date as "day", count(*) filter (where delivery.status = 'sent') notifications
    from public.notification_deliveries delivery
    join scoped_accounts account on account.id = delivery.account_id
    where delivery.created_at >= p_from::timestamptz and delivery.created_at < (p_to + 1)::timestamptz
    group by 1
  ),
  daily as (
    select days."day", jsonb_build_object(
      'audits', coalesce(audit_starts.audits, 0),
      'auditsCompleted', coalesce(audit_outcomes.audits_completed, 0),
      'auditsFailed', coalesce(audit_outcomes.audits_failed, 0),
      'auditsPartial', coalesce(audit_outcomes.audits_partial, 0),
      'auditEvaluations', coalesce(audit_evaluations.evaluations, 0),
      'analyticsEvents', coalesce(analytics_activity.events, 0),
      'analyticsPageviews', coalesce(analytics_activity.pageviews, 0),
      'analyticsSessions', coalesce(analytics_activity.sessions, 0),
      'uptimeChecks', coalesce(uptime_activity.checks, 0),
      'uptimePassed', coalesce(uptime_activity.passed, 0),
      'uptimeFailed', coalesce(uptime_activity.failed, 0),
      'incidents', coalesce(incident_activity.incidents, 0),
      'reports', coalesce(report_activity.reports, 0),
      'notifications', coalesce(notification_activity.notifications, 0)
    ) workload
    from days
    left join audit_starts using ("day")
    left join audit_outcomes using ("day")
    left join audit_evaluations using ("day")
    left join analytics_activity using ("day")
    left join uptime_activity using ("day")
    left join incident_activity using ("day")
    left join report_activity using ("day")
    left join notification_activity using ("day")
    order by days."day"
  ),
  relevant_operational as (
    select distinct on (event.service, event.metric)
      event.service, event.metric, event.value, event.unit, event.source,
      event.account_id, event.property_id, event.observed_at,
      case when event.account_id is null and event.property_id is null then 'global' else p_billing_environment end scope
    from public.operational_events event
    where event.observed_at >= p_from::timestamptz
      and event.observed_at < (p_to + 1)::timestamptz
      and (
        (event.account_id is null and event.property_id is null)
        or event.account_id in (select id from scoped_accounts)
        or event.property_id in (select id from scoped_properties)
      )
    order by event.service, event.metric, event.observed_at desc
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', "day", 'workload', workload) order by "day") from daily), '[]'::jsonb),
    'operational', coalesce((select jsonb_agg(to_jsonb(relevant_operational) order by service, metric) from relevant_operational), '[]'::jsonb),
    'source', 'postgres_aggregated',
    'generatedAt', now()
  );
$$;

revoke all on function public.superadmin_overview_activity(text, date, date) from public, anon, authenticated;
grant execute on function public.superadmin_overview_activity(text, date, date) to service_role;

comment on function public.superadmin_overview_activity(text, date, date) is
  'Environment-scoped SuperAdmin activity with outcomes attributed to their authoritative timestamps.';
