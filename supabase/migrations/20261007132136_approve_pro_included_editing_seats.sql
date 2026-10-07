-- The Stage 3/command-centre brief explicitly approves three included editing
-- seats for Pro. Record that single resolved allowance on the existing Pro
-- draft only. Published early-access versions and account assignments/grants
-- remain immutable and are not migrated by this change.
update public.package_versions
set allowances = jsonb_set(coalesce(allowances, '{}'::jsonb), '{editingSeats}', '3'::jsonb, true),
    unresolved_values = array_remove(unresolved_values, 'editingSeats')
where package_key = 'pro'
  and state = 'draft';
