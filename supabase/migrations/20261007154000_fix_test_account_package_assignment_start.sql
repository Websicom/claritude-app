create or replace function public.create_superadmin_test_account(p_name text, p_owner uuid, p_test_recipients text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  workspace_id uuid;
  package_version_id uuid;
begin
  if p_owner is null or not exists(select 1 from auth.users where id = p_owner) then raise exception 'owner user is required'; end if;
  if length(trim(p_name)) < 2 or length(trim(p_name)) > 100 then raise exception 'valid account name is required'; end if;
  if coalesce(array_length(p_test_recipients, 1), 0) = 0 then raise exception 'at least one designated test recipient is required'; end if;
  if exists(select 1 from unnest(p_test_recipients) recipient where recipient !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid test recipient'; end if;
  select id into package_version_id from public.package_versions where package_key = 'free' and state = 'published' order by version desc limit 1;
  if package_version_id is null then raise exception 'published free package is required'; end if;
  insert into public.accounts(name, entitlement, billing_environment, is_test_account, test_notification_recipients)
    values(trim(p_name), 'free', 'test', true, p_test_recipients) returning id into account_id;
  insert into public.account_memberships(account_id, user_id, role) values(account_id, p_owner, 'owner');
  insert into public.workspaces(account_id, name) values(account_id, trim(p_name) || ' workspace') returning id into workspace_id;
  insert into public.workspace_memberships(workspace_id, user_id, role) values(workspace_id, p_owner, 'owner');
  insert into public.account_package_assignments(account_id, package_version_id, billing_state, complimentary, starts_at)
    values(account_id, package_version_id, 'unconfigured', false, now());
  return jsonb_build_object('accountId', account_id, 'workspaceId', workspace_id, 'billingEnvironment', 'test');
end $$;

revoke all on function public.create_superadmin_test_account(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.create_superadmin_test_account(text, uuid, text[]) to service_role;
