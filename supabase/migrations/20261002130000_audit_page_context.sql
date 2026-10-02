-- Bind audit history and execution to a persisted property page.
-- Existing runs remain available and are backfilled by their normalized path.

begin;

insert into public.property_audit_pages (property_id, name, path, created_by)
select p.id, 'Homepage', '/', coalesce(
  (
    select wm.user_id
    from public.workspace_memberships wm
    where wm.workspace_id = p.workspace_id
      and wm.role = 'owner'
    order by wm.created_at
    limit 1
  ),
  (
    select am.user_id
    from public.workspaces w
    join public.account_memberships am on am.account_id = w.account_id
    where w.id = p.workspace_id
      and am.role = 'owner'
    order by am.created_at
    limit 1
  ),
  (
    select wm.user_id
    from public.workspace_memberships wm
    where wm.workspace_id = p.workspace_id
    order by wm.created_at
    limit 1
  )
)
from public.properties p
where not exists (
  select 1
  from public.property_audit_pages ap
  where ap.property_id = p.id and ap.path = '/'
)
and exists (
  select 1
  from public.workspace_memberships wm
  where wm.workspace_id = p.workspace_id
);

alter table public.audit_runs
  add column if not exists audit_page_id uuid references public.property_audit_pages on delete set null;

create index if not exists audit_runs_page_created_idx
  on public.audit_runs(audit_page_id, created_at desc);

update public.audit_runs r
set audit_page_id = (
  select ap.id
  from public.property_audit_pages ap
  where ap.property_id = r.property_id
    and ap.path = case
      when coalesce((regexp_match(r.page_url, '^https?://[^/]+(/[^?#]*)'))[1], '/') = '/'
        then '/'
      else regexp_replace(coalesce((regexp_match(r.page_url, '^https?://[^/]+(/[^?#]*)'))[1], '/'), '/+$', '') || '/'
    end
  limit 1
)
where r.audit_page_id is null;

-- Explicit grants are required for projects created after the 2026-05-30
-- Supabase Data API permission change.
revoke all on public.audit_runs from anon;
grant select, insert on public.audit_runs to authenticated;

commit;
