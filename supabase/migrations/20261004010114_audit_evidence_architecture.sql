-- Replace the development-era audit result contract with the typed v2 model.
-- Historical audit execution data is deliberately removed because its generic
-- BrowserLab payloads and ambiguous outcomes are incompatible with v2.
-- Account, auth, workspace, property and property audit-page data are untouched.

begin;

delete from public.audit_results;
delete from public.audit_runs;
delete from public.audit_check_history;

drop table public.audit_check_history;

alter table public.audit_results
  alter column outcome type text using outcome::text;
drop type public.check_outcome;
create type public.check_outcome as enum (
  'passed',
  'failed',
  'advisory',
  'not_applicable',
  'unable_to_test'
);
alter table public.audit_results
  alter column outcome type public.check_outcome using outcome::public.check_outcome;

alter table public.audit_check_definitions
  add column focus text,
  add column passed_message text,
  add column failed_message text,
  add column advisory_message text,
  add column not_applicable_message text,
  add column unable_to_test_message text,
  add column example_fix text,
  add column reference_url text,
  add column evidence_schema text not null default 'audit.unsupported.v1',
  add column evidence_requirement text not null default 'source'
    check (evidence_requirement in ('source','rendered','source_and_rendered','http_network','dns','robots','sitemap','css','accessibility')),
  add column allowed_outcomes public.check_outcome[] not null default enum_range(null::public.check_outcome),
  add column group_id text;

-- Preserve the authoritative 306 catalogue rows while moving every live row
-- onto the v2 contract. The generated seed supplies the more specific schema
-- and grouping values on fresh/local resets.
update public.audit_check_definitions
set logic_version = '2.0.0',
    configuration_version = 2,
    evidence_requirement = case
      when execution_method in ('rendered_browser', 'lab') then 'rendered'
      when execution_method = 'dns' then 'dns'
      when execution_method = 'network' then 'http_network'
      else 'source'
    end,
    evidence_schema = case
      when execution_method in ('rendered_browser', 'lab') then 'audit.rendered.v2'
      when execution_method = 'dns' then 'audit.dns.v2'
      when execution_method = 'network' then 'audit.network.v2'
      else 'audit.source-dom.v2'
    end,
    allowed_outcomes = enum_range(null::public.check_outcome),
    changed_at = now();

alter table public.audit_runs
  add column telemetry jsonb not null default '{}',
  add column architecture_version text not null default '2.0.0';

alter table public.audit_runs
  drop constraint if exists audit_runs_audit_page_id_fkey;
alter table public.audit_runs
  alter column audit_page_id set not null,
  add constraint audit_runs_audit_page_id_fkey
    foreign key (audit_page_id) references public.property_audit_pages(id) on delete cascade;

alter table public.audit_results
  add constraint audit_results_check_id_fkey
    foreign key (check_id) references public.audit_check_definitions(id) on delete restrict;

create table public.audit_run_evidence (
  id bigint generated always as identity primary key,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  evidence_type text not null check (evidence_type in (
    'http','source','rendered_desktop','rendered_mobile','network','links',
    'resources','dns','robots','sitemaps','css','accessibility'
  )),
  schema_version text not null,
  summary jsonb not null default '{}',
  byte_size integer not null default 0 check (byte_size >= 0),
  collection_status text not null check (collection_status in ('complete','partial','failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (audit_run_id, evidence_type)
);

create index audit_run_evidence_run_idx
  on public.audit_run_evidence(audit_run_id);

alter table public.audit_run_evidence enable row level security;
revoke all on public.audit_run_evidence from anon, authenticated;
grant select on public.audit_run_evidence to authenticated;

create policy audit_run_evidence_select on public.audit_run_evidence
  for select to authenticated
  using (
    exists (
      select 1
      from public.audit_runs r
      where r.id = audit_run_id
        and (select private.can_access_property(r.property_id))
    )
  );

comment on table public.audit_run_evidence is
  'One compact shared evidence summary per collector/run. Raw browser payloads are not duplicated into result rows.';
comment on column public.audit_runs.telemetry is
  'Compact v2 audit cost and phase telemetry.';

commit;
