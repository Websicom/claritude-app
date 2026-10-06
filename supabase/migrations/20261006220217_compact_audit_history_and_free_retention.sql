begin;

alter table public.audit_runs
  add column if not exists category_scores jsonb not null default '{}'::jsonb,
  add column if not exists outcome_counts jsonb not null default '{}'::jsonb;

create table public.audit_run_summaries (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid not null unique,
  property_id uuid not null references public.properties(id) on delete cascade,
  audit_page_id uuid not null references public.property_audit_pages(id) on delete cascade,
  page_url text not null,
  status public.audit_status not null,
  score integer check (score between 0 and 100),
  seo_score integer check (seo_score between 0 and 100),
  accessibility_score integer check (accessibility_score between 0 and 100),
  performance_score integer check (performance_score between 0 and 100),
  security_score integer check (security_score between 0 and 100),
  technical_score integer check (technical_score between 0 and 100),
  ai_crawler_readiness_score integer check (ai_crawler_readiness_score between 0 and 100),
  coverage integer check (coverage between 0 and 100),
  duration_ms integer,
  automated_check_count integer not null default 0,
  passed_count integer not null default 0,
  issues_count integer not null default 0,
  not_applicable_count integer not null default 0,
  not_tested_count integer not null default 0,
  created_at timestamptz not null,
  completed_at timestamptz
);

create index audit_run_summaries_property_created_idx on public.audit_run_summaries(property_id, created_at desc);
create index audit_run_summaries_page_created_idx on public.audit_run_summaries(audit_page_id, created_at desc);

alter table public.audit_run_summaries enable row level security;
revoke all on public.audit_run_summaries from anon, authenticated;
grant select on public.audit_run_summaries to authenticated;
create policy audit_run_summaries_select on public.audit_run_summaries
  for select to authenticated using ((select private.can_access_property(property_id)));

create or replace function private.audit_category_scores(p_run_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  group_row jsonb;
  group_outcomes text[];
  group_outcome text;
  category_name text;
  group_weight numeric;
  achieved jsonb := '{}'::jsonb;
  totals jsonb := '{}'::jsonb;
begin
  for group_row in select value from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) loop
    category_name := group_row->>'category';
    group_weight := greatest(0, coalesce((group_row->>'weight')::numeric, 0));
    if category_name is null or group_weight = 0 then continue; end if;
    select array_agg(coalesce(result.outcome::text, 'unable_to_test'))
      into group_outcomes
      from jsonb_array_elements(coalesce(group_row->'technicalChecks', '[]'::jsonb)) mapping
      left join public.audit_results result
        on result.audit_run_id = p_run_id and result.check_id = mapping->>'checkId';
    if group_outcomes is null or cardinality(group_outcomes) = 0 then
      group_outcome := 'unable_to_test';
    elsif group_row->>'outcomePolicy' = 'Passed / Failed / Not applicable / Unable to test' and 'failed' = any(group_outcomes) then
      group_outcome := 'failed';
    elsif 'unable_to_test' = any(group_outcomes) then group_outcome := 'unable_to_test';
    elsif (select bool_and(item = 'not_applicable') from unnest(group_outcomes) item) then group_outcome := 'not_applicable';
    elsif group_row->>'outcomePolicy' = 'Passed / Failed / Not applicable / Unable to test' then
      group_outcome := case when 'advisory' = any(group_outcomes) then 'advisory'
        when (select bool_and(item in ('passed','not_applicable')) from unnest(group_outcomes) item) then 'passed'
        else 'unable_to_test' end;
    else
      group_outcome := case when 'failed' = any(group_outcomes) or 'advisory' = any(group_outcomes) then 'advisory'
        when (select bool_and(item in ('passed','not_applicable')) from unnest(group_outcomes) item) then 'passed'
        else 'unable_to_test' end;
    end if;
    if group_outcome in ('passed','advisory','failed') then
      totals := jsonb_set(totals, array[category_name], to_jsonb(coalesce((totals->>category_name)::numeric, 0) + group_weight));
      achieved := jsonb_set(achieved, array[category_name], to_jsonb(coalesce((achieved->>category_name)::numeric, 0) + group_weight * case group_outcome when 'passed' then 1 when 'advisory' then 0.5 else 0 end));
    end if;
  end loop;
  return coalesce((select jsonb_object_agg(key, round(100 * coalesce((achieved->>key)::numeric, 0) / nullif(value::numeric, 0))) from jsonb_each_text(totals)), '{}'::jsonb);
end
$$;

update public.audit_runs run
set category_scores = private.audit_category_scores(run.id, run.user_facing_snapshot),
    outcome_counts = (
      select jsonb_build_object(
        'automated', count(*),
        'passed', count(*) filter (where outcome = 'passed'),
        'issues', count(*) filter (where outcome in ('failed','advisory')),
        'notApplicable', count(*) filter (where outcome = 'not_applicable'),
        'notTested', count(*) filter (where outcome = 'unable_to_test')
      ) from public.audit_results where audit_run_id = run.id
    );

create or replace function private.archive_audit_run(p_run public.audit_runs)
returns void
language plpgsql
set search_path = ''
as $$
declare
  scores jsonb := case when p_run.category_scores = '{}'::jsonb then private.audit_category_scores(p_run.id, p_run.user_facing_snapshot) else p_run.category_scores end;
  counts jsonb := p_run.outcome_counts;
begin
  if counts = '{}'::jsonb then
    select jsonb_build_object(
      'automated', count(*), 'passed', count(*) filter (where outcome = 'passed'),
      'issues', count(*) filter (where outcome in ('failed','advisory')),
      'notApplicable', count(*) filter (where outcome = 'not_applicable'),
      'notTested', count(*) filter (where outcome = 'unable_to_test')
    ) into counts from public.audit_results where audit_run_id = p_run.id;
  end if;
  insert into public.audit_run_summaries (
    source_run_id, property_id, audit_page_id, page_url, status, score,
    seo_score, accessibility_score, performance_score, security_score, technical_score, ai_crawler_readiness_score,
    coverage, duration_ms, automated_check_count, passed_count, issues_count, not_applicable_count, not_tested_count,
    created_at, completed_at
  ) values (
    p_run.id, p_run.property_id, p_run.audit_page_id, p_run.page_url, p_run.status, p_run.score,
    (scores->>'SEO')::integer, (scores->>'Accessibility')::integer,
    (scores->>'Performance')::integer, (scores->>'Security')::integer,
    (scores->>'Technical')::integer, (scores->>'AI & Crawler Readiness')::integer,
    p_run.coverage, p_run.duration_ms, coalesce((counts->>'automated')::integer, 0),
    coalesce((counts->>'passed')::integer, 0), coalesce((counts->>'issues')::integer, 0),
    coalesce((counts->>'notApplicable')::integer, 0), coalesce((counts->>'notTested')::integer, 0),
    p_run.created_at, p_run.completed_at
  ) on conflict (source_run_id) do nothing;
end
$$;

do $$
declare old_run public.audit_runs;
begin
  for old_run in
    select run.* from public.audit_runs run
    where run.status = 'failed'
      or (run.status in ('completed','partial') and exists (
        select 1 from public.audit_runs newer
        where newer.audit_page_id = run.audit_page_id
          and newer.status in ('completed','partial')
          and (newer.created_at, newer.id) > (run.created_at, run.id)
      ))
  loop
    perform private.archive_audit_run(old_run);
    delete from public.audit_runs where id = old_run.id;
  end loop;
end
$$;

create or replace function private.compact_previous_page_audits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare old_run public.audit_runs;
begin
  if new.status not in ('completed','partial') or old.status = new.status then return new; end if;
  for old_run in select * from public.audit_runs where audit_page_id = new.audit_page_id and id <> new.id and status not in ('queued','running') loop
    perform private.archive_audit_run(old_run);
    delete from public.audit_runs where id = old_run.id;
  end loop;
  return new;
end
$$;

create trigger compact_previous_page_audits
after update of status on public.audit_runs
for each row execute function private.compact_previous_page_audits();

revoke all on function private.audit_category_scores(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.archive_audit_run(public.audit_runs) from public, anon, authenticated;
revoke all on function private.compact_previous_page_audits() from public, anon, authenticated;

update public.platform_settings
set value = value || '{"freeAuditExpiryEnabled":true,"freeAuditExpiryDays":30}'::jsonb,
    description = 'Retention controls. Free-account audits can be automatically expired; paid accounts retain compact history and one full audit per page.'
where key = 'retention_policy';

comment on table public.audit_run_summaries is 'Compact KPI-only audit history. Only the latest audit_run per page retains detailed results and evidence.';

commit;
