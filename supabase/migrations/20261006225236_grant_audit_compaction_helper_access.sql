begin;

-- Audit completion invokes these private helpers from the compaction trigger.
-- PUBLIC execution was intentionally revoked when the helpers were created, so
-- the Worker service role needs an explicit, narrowly scoped grant.
grant usage on schema private to service_role;
grant execute on function private.audit_category_scores(uuid, jsonb) to service_role;
grant execute on function private.archive_audit_run(public.audit_runs) to service_role;

commit;
