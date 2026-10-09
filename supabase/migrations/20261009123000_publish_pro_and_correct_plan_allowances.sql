begin;

alter table public.email_campaigns
  add column if not exists result jsonb not null default '{}'::jsonb;

update public.package_versions
set
  allowances = coalesce(allowances, '{}'::jsonb) || jsonb_build_object(
    'workspacesPerAccount', case
      when package_key = 'free' then to_jsonb(1)
      when package_key = 'essentials' then to_jsonb(3)
      else 'null'::jsonb
    end,
    'editingSeats', case
      when package_key in ('pro', 'pro_early_access') then 3
      when package_key = 'scale' then 2
      else 1
    end,
    'auditPagesPerProperty', case
      when package_key in ('pro', 'pro_early_access') then 25
      when package_key = 'scale' then 15
      when package_key = 'essentials' then 5
      else 2
    end,
    'auditCreditsPerWeek', case
      when package_key in ('pro', 'pro_early_access') then 250
      when package_key = 'scale' then 100
      when package_key = 'essentials' then 25
      else 10
    end,
    'customEventsPerProperty', case
      when package_key in ('pro', 'pro_early_access') then 25
      when package_key = 'scale' then 10
      when package_key = 'essentials' then 5
      else 2
    end
  ),
  hard_ceilings = coalesce(hard_ceilings, '{}'::jsonb) || jsonb_build_object(
    'propertiesPerAccount', case
      when package_key in ('pro', 'pro_early_access') then 200
      when package_key = 'scale' then 50
      when package_key = 'essentials' then 5
      else 2
    end
  ),
  unresolved_values = array_remove(
    array_remove(
      array_remove(coalesce(unresolved_values, '{}'::text[]), 'editingSeats'),
      'auditCreditsPerWeek'
    ),
    'workspacesPerAccount'
  ),
  state = case when package_key = 'pro' and version = 1 then 'published' else state end,
  effective_at = case when package_key = 'pro' and version = 1 then coalesce(effective_at, now()) else effective_at end
where package_key in ('free', 'essentials', 'scale', 'pro', 'pro_early_access')
  and (state = 'published' or (package_key = 'pro' and version = 1));

comment on column public.email_campaigns.result is
  'Latest controlled execution summary. Recipient-level provider outcomes remain in notification_deliveries.';

commit;
