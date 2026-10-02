-- Persist truthful audit execution progress and deliberate finding review state.

begin;

alter table public.audit_runs
  add column if not exists execution_stage text not null default 'queued',
  add column if not exists progress_completed integer not null default 0 check (progress_completed >= 0),
  add column if not exists progress_total integer check (progress_total is null or progress_total >= 0),
  add column if not exists heartbeat_at timestamptz,
  add column if not exists retry_of uuid references public.audit_runs on delete set null;

alter table public.audit_results
  add column if not exists review_status text not null default 'not_reviewed'
    check (review_status in ('not_reviewed', 'reviewed', 'fixed', 'accepted')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users on delete set null;

create index if not exists audit_runs_active_page_idx
  on public.audit_runs(audit_page_id, status, created_at desc)
  where status in ('queued', 'running');

revoke all on public.audit_results from anon;
grant select on public.audit_results to authenticated;

commit;
