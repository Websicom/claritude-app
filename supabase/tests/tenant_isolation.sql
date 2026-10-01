begin;
select plan(6);

-- The CI database test harness should set authenticated JWTs for user_a and user_b.
-- These assertions document the expected tenant boundary and fail closed without a JWT.
select is((select auth.uid()), null::uuid, 'unauthenticated test starts without a user');
select is((select count(*) from public.accounts), 0::bigint, 'anonymous cannot read accounts');
select is((select count(*) from public.workspaces), 0::bigint, 'anonymous cannot read workspaces');
select is((select count(*) from public.properties), 0::bigint, 'anonymous cannot read properties');
select is((select count(*) from public.audit_runs), 0::bigint, 'anonymous cannot read audit runs');
select is((select count(*) from public.analytics_events), 0::bigint, 'anonymous cannot read analytics events');

select * from finish();
rollback;
