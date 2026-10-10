-- Fail closed unless the remaining Stage 3 billing invariants are present.
do $$
declare
  v_scheduled_downgrade boolean;
  v_included_seats boolean;
  v_no_additional_seat_sales boolean;
  v_websi_complimentary_pro boolean;
  v_invariants jsonb;
begin
  select exists (
    select 1
    from public.billing_scheduled_changes
    where billing_environment = 'test'
      and state = 'scheduled'
      and requested_change ? 'packageVersionId'
      and requested_change ->> 'sandboxAcceptanceScenario' = 'true'
  ) into v_scheduled_downgrade;

  select count(*) = 4
    and bool_and(
      (package_key = 'free' and (allowances ->> 'editingSeats')::integer = 1)
      or (package_key = 'essentials' and (allowances ->> 'editingSeats')::integer = 1)
      or (package_key = 'scale' and (allowances ->> 'editingSeats')::integer = 2)
      or (package_key = 'pro' and (allowances ->> 'editingSeats')::integer = 3)
    )
  into v_included_seats
  from (
    select distinct on (package_key) package_key, allowances
    from public.package_versions
    where package_key in ('free', 'essentials', 'scale', 'pro')
      and state = 'published'
      and effective_at <= now()
    order by package_key, version desc
  ) latest_packages;

  select not exists (
    select 1
    from public.billing_catalogue_prices
    where active = true
      and component = 'additional_editing_seat'
  ) into v_no_additional_seat_sales;

  select exists (
    select 1
    from public.accounts account
    join public.account_package_grants grant_row
      on grant_row.account_id = account.id
    join public.package_versions package_version
      on package_version.id = grant_row.package_version_id
    where account.billing_environment = 'live'
      and lower(trim(account.name)) = 'websi'
      and grant_row.status = 'active'
      and grant_row.arrangement = 'complimentary'
      and grant_row.expires_at is null
      and package_version.package_key = 'pro'
  ) into v_websi_complimentary_pro;

  v_invariants := jsonb_build_object(
    'scheduledDowngrade', v_scheduled_downgrade,
    'includedEditingSeats', jsonb_build_object(
      'free', 1,
      'essentials', 1,
      'scale', 2,
      'pro', 3,
      'verified', v_included_seats
    ),
    'additionalSeatSalesDisabled', v_no_additional_seat_sales,
    'websiComplimentaryPro', v_websi_complimentary_pro
  );

  if not (
    v_scheduled_downgrade
    and v_included_seats
    and v_no_additional_seat_sales
    and v_websi_complimentary_pro
  ) then
    raise exception 'Stage 3 final billing invariants incomplete: %', v_invariants;
  end if;

  update public.billing_environment_configurations
  set sandbox_acceptance_evidence =
        coalesce(sandbox_acceptance_evidence, '{}'::jsonb)
        || jsonb_build_object('invariants', v_invariants),
      updated_at = clock_timestamp()
  where environment in ('test', 'live');
end
$$;
