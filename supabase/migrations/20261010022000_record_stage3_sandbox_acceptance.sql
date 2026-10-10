-- Record Stage 3 sandbox acceptance only when the production database already
-- contains every evidence item required by the application verifier.
-- Provider-side identifiers below are non-secret Stripe sandbox evidence.
do $$
declare
  v_test_account boolean;
  v_checkout boolean;
  v_entitlement_subscription boolean;
  v_upgrade_or_change boolean;
  v_cancellation boolean;
  v_successful_payment boolean;
  v_payment_failure boolean;
  v_successful_refund boolean;
  v_evidence jsonb;
  v_completed_at timestamptz := clock_timestamp();
begin
  select exists (
    select 1 from public.accounts
    where billing_environment = 'test' and is_test_account = true
  ) into v_test_account;

  select exists (
    select 1 from public.billing_events
    where billing_environment = 'test'
      and processing_state = 'processed'
      and event_type = 'checkout.session.completed'
  ) into v_checkout;

  select exists (
    select 1 from public.billing_subscriptions
    where billing_environment = 'test'
      and status in ('active', 'trialing', 'past_due', 'unpaid', 'canceled')
  ) into v_entitlement_subscription;

  select exists (
    select 1 from public.billing_events
    where billing_environment = 'test'
      and processing_state = 'processed'
      and event_type = 'customer.subscription.updated'
  ) into v_upgrade_or_change;

  select (
    exists (
      select 1 from public.billing_events
      where billing_environment = 'test'
        and processing_state = 'processed'
        and event_type = 'customer.subscription.deleted'
    )
    or exists (
      select 1 from public.billing_subscriptions
      where billing_environment = 'test'
        and (cancel_at_period_end = true or status = 'canceled')
    )
  ) into v_cancellation;

  select exists (
    select 1 from public.billing_payments
    where billing_environment = 'test' and status = 'succeeded'
  ) into v_successful_payment;

  select (
    exists (
      select 1 from public.billing_events
      where billing_environment = 'test'
        and processing_state = 'processed'
        and event_type = 'invoice.payment_failed'
    )
    or exists (
      select 1 from public.billing_payments
      where billing_environment = 'test'
        and status in ('requires_payment_method', 'canceled')
    )
  ) into v_payment_failure;

  select exists (
    select 1 from public.billing_refunds
    where billing_environment = 'test' and status = 'succeeded'
  ) into v_successful_refund;

  v_evidence := jsonb_build_object(
    'testAccount', v_test_account,
    'checkout', v_checkout,
    'entitlementSubscription', v_entitlement_subscription,
    'upgradeOrChange', v_upgrade_or_change,
    'cancellation', v_cancellation,
    'successfulPayment', v_successful_payment,
    'paymentFailure', v_payment_failure,
    'successfulRefund', v_successful_refund,
    'providerAcceptance', jsonb_build_object(
      'recordedAt', v_completed_at,
      'catalogue', jsonb_build_object(
        'environment', 'test',
        'currency', 'gbp',
        'taxBehavior', 'exclusive',
        'activeApprovedPrices', 6,
        'additionalSeatPrices', 0
      ),
      'checkoutSessions', jsonb_build_array(
        'cs_test_b1nd7GQ2hNnf5IAUB9QYZlLyfLLFDHQEop2Vj9jX5tZEkB6n7nxMRqXR9G',
        'cs_test_b16DhTeidIrjtb7nQawRoPgO4G7q84sv0hmmLB7bCm5SWPE1wMKxLx9cxZ'
      ),
      'taxCalculations', jsonb_build_object(
        'ukMonthly', 'taxcalc_1UOpNW0N1c5vQhviyIyDSTOY',
        'ukAnnual', 'taxcalc_1UOpNY0N1c5vQhviG8rh8sZt',
        'germanConsumer', 'taxcalc_1UOpNa0N1c5vQhviLg8iFjvx',
        'germanBusinessReverseCharge', 'taxcalc_1UOpNc0N1c5vQhvi7Sd9UMtQ',
        'usConsumer', 'taxcalc_1UOpNe0N1c5vQhvindCwOBad'
      ),
      'paidInvoice', 'in_1UOpOZ0N1c5vQhviurMiPIaO',
      'upgradeInvoice', 'in_1UOpOs0N1c5vQhvitbdEzvkH',
      'subscription', 'sub_1UOpOZ0N1c5vQhviG3ombG11',
      'refund', 're_3UOpOZ0N1c5vQhvi0uTbIjLt',
      'promotionCode', 'STAGE3ACCEPT20',
      'webhookPendingCount', 0,
      'portalQuantityChangesEnabled', false
    )
  );

  if not (
    v_test_account
    and v_checkout
    and v_entitlement_subscription
    and v_upgrade_or_change
    and v_cancellation
    and v_successful_payment
    and v_payment_failure
    and v_successful_refund
  ) then
    raise exception 'sandbox acceptance evidence incomplete: %', v_evidence;
  end if;

  if exists (
    select 1 from public.billing_environment_configurations
    where environment = 'live' and checkout_enabled = true
  ) then
    raise exception 'live checkout must remain disabled during Stage 3 acceptance';
  end if;

  update public.billing_environment_configurations
  set sandbox_acceptance_completed_at = coalesce(sandbox_acceptance_completed_at, v_completed_at),
      sandbox_acceptance_evidence = coalesce(sandbox_acceptance_evidence, '{}'::jsonb) || v_evidence,
      updated_at = v_completed_at
  where environment in ('test', 'live');
end
$$;
