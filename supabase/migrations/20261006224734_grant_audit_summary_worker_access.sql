begin;

-- This table was introduced after the platform-wide service-role grants were
-- applied. Audit completion archives the previous detailed run from a trigger,
-- so the worker must be able to write the compact summary in that transaction.
grant select, insert, update, delete on public.audit_run_summaries to service_role;

commit;
