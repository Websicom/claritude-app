alter table public.email_campaigns
  add column if not exists html_body text,
  add column if not exists text_body text,
  add column if not exists variables text[] not null default '{}';

create or replace function public.execute_account_master_deletion_internal(
  p_request_id uuid,
  p_actor uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid;
  target_account_name text;
  current_state text;
  workspace_count integer;
  property_count integer;
  removed_membership_count integer;
  preserved_owner_count integer;
begin
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'reason_required';
  end if;

  select request.account_id, account.name, request.state
  into target_account_id, target_account_name, current_state
  from public.deletion_requests request
  join public.accounts account on account.id = request.account_id
  where request.id = p_request_id
  for update of request, account;

  if target_account_id is null then raise exception 'deletion_request_not_found'; end if;
  if current_state not in ('preview', 'review_hold', 'approved') then
    raise exception 'deletion_request_not_executable';
  end if;

  select count(*) into workspace_count from public.workspaces where account_id = target_account_id;
  select count(*) into property_count from public.properties where account_id = target_account_id;
  select count(*) into removed_membership_count from public.account_memberships where account_id = target_account_id and role <> 'owner';
  select count(*) into preserved_owner_count from public.account_memberships where account_id = target_account_id and role = 'owner';
  if preserved_owner_count = 0 then raise exception 'account_owner_membership_required'; end if;

  delete from public.analytics_storage_snapshots
  where (scope_type = 'account' and scope_id = target_account_id)
     or (scope_type = 'property' and scope_id in (select id from public.properties where account_id = target_account_id));
  delete from public.delegation_sessions where account_id = target_account_id;
  delete from public.notifications where account_id = target_account_id;
  delete from public.account_inactivity where account_id = target_account_id;
  delete from public.audit_catalogue_account_availability where account_id = target_account_id;
  delete from public.customer_messages where account_id = target_account_id;
  delete from public.account_billing_memberships where account_id = target_account_id;
  delete from public.account_memberships where account_id = target_account_id and role <> 'owner';
  delete from public.workspaces where account_id = target_account_id;

  insert into public.account_service_controls(account_id, service, paused, reason, changed_by, changed_at)
  select target_account_id, service, true, trim(p_reason), p_actor, now()
  from unnest(array['audits','analytics','uptime','reports','email']) service
  on conflict (account_id, service) do update
    set paused = true, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at;

  update public.accounts
  set access_state = 'blocked',
      access_state_reason = trim(p_reason),
      access_state_changed_at = now(),
      scheduled_deletion_at = null
  where id = target_account_id;

  update public.deletion_requests
  set state = 'completed', approved_by = p_actor, scheduled_at = now(),
      dry_run = dry_run || jsonb_build_object(
        'completedAt', now(),
        'removed', jsonb_build_object('workspaces', workspace_count, 'properties', property_count, 'nonOwnerMemberships', removed_membership_count),
        'preserved', jsonb_build_object('account', true, 'ownerMemberships', preserved_owner_count, 'authenticationIdentities', true, 'billingHistory', true, 'usageLedger', true, 'administrativeHistory', true)
      )
  where id = p_request_id;

  return jsonb_build_object(
    'requestId', p_request_id,
    'accountId', target_account_id,
    'accountName', target_account_name,
    'removed', jsonb_build_object('workspaces', workspace_count, 'properties', property_count, 'nonOwnerMemberships', removed_membership_count),
    'preservedOwnerMemberships', preserved_owner_count
  );
end
$$;

revoke all on function public.execute_account_master_deletion_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.execute_account_master_deletion_internal(uuid, uuid, text) to service_role;

comment on function public.execute_account_master_deletion_internal(uuid, uuid, text) is
  'Executes an owner-approved master cleanup while retaining the account, owner login relationship, billing, usage and immutable administrative history.';
