-- Included seats are now approved independently of additional paid-seat
-- eligibility or pricing. Later commercial configuration may enable overage.
update public.package_versions
set allowances = jsonb_set(
      coalesce(allowances, '{}'::jsonb),
      '{editingSeats}',
      to_jsonb(case package_key
        when 'free' then 1
        when 'essentials' then 1
        when 'scale' then 2
        when 'pro' then 3
      end),
      true
    ),
    unresolved_values = array_remove(unresolved_values, 'editingSeats')
where package_key in ('free', 'essentials', 'scale', 'pro');
