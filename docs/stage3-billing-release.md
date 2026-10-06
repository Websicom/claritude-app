# Stage 3 billing release record

This record deliberately separates application completeness from Stripe-provider acceptance. Live checkout remains disabled.

## Implemented and verified

- **Environment isolation:** accounts, catalogue prices, checkout attempts, customers, subscriptions, events, reconciliation, daily finance, promotions, payouts, scheduled changes and financial operation keys are scoped to `test` or `live`. The migration is applied and linked Supabase lint reports no errors.
- **Stripe key detection:** `sk_test_`, `rk_test_`, `sk_live_` and `rk_live_` are recognised. Test and live use separate keys, webhook secrets and Customer Portal configuration IDs. Missing test configuration never falls back to live.
- **Webhook isolation:** `/webhooks/stripe/test` and `/webhooks/stripe/live` use separate signing secrets and reject an event whose `livemode` does not match its endpoint. The old ambiguous endpoint returns `410`.
- **Seat calculation:** checkout, change previews, subscription changes, projected entitlements and billing views use the selected package version's authoritative `allowances.editingSeats`. Billable seats are `max(0, selected seats - included seats)`; unresolved allowances block the action.
- **Recurring revenue:** every recurring subscription item is persisted. Monthly and annual items, quantities, recurring percent/amount discounts and additional-seat items contribute to MRR. Unit tests cover mixed intervals, multiple items and recurring discounts.
- **Finance isolation and semantics:** dashboards and snapshots are separated by environment and currency. No FX-combined series is rendered. Daily collections, successful refunds, pending refunds, fees and net activity are distinct from current available/pending balances. Only successful refunds reduce completed refund totals.
- **Finance dashboard:** currency/date selectors, previous-period comparisons, readable SVG axes/tooltips, day-level drill-down, MRR, collections/refunds, new/cancelled subscriptions, package revenue, interval mix, recovery, fees/net, payouts and balances are implemented from persisted records.
- **Changes and operations:** upgrade/downgrade preview uses Stripe's proration preview and the same timestamp used for application; immediate and period-end changes are supported. Scheduled changes are persisted and processed every five minutes. Cancellation/undo, checkout, refunds, changes and invoice adjustments use a persisted UUID operation ledger plus Stripe idempotency keys.
- **Invoice adjustments:** authorised SuperAdmins can create a positive charge or negative credit for the next invoice, with confirmation, reason, environment validation, idempotency and immutable admin logging.
- **Test administration:** the SuperAdmin Test/Live view is remembered locally but authorised/scoped on every server request. Test views carry a persistent no-real-payments banner. Authorised staff can create explicitly marked test accounts and enter them through the existing customer-session mechanism.
- **Test data hygiene:** test accounts are omitted from live account queries and exports. Uptime email for a test account is sent only to its designated test recipients and is marked `[TEST]`. Normal service controls and entitlement ceilings still apply.
- **Live activation:** selecting Live does not enable checkout. Activation requires live credentials, live webhook secret, approved catalogue, verified portal configuration, reviewed tax configuration and database-verified sandbox acceptance evidence.
- **Catalogue policy:** the required base catalogue is 18 prices: 3 paid packages × 3 currencies × 2 intervals. The total is 36 only if all 3 packages separately sell additional-seat overage. A package needs a seat price only when its approved seat allowance is finite and its commercial policy explicitly permits billable overage.

Evidence: `npm run check`, 194 Vitest tests, the production build, migration push and linked database lint all pass on 6 October 2026.

## Implemented but awaiting Stripe sandbox verification

- Checkout using a Stripe test card and sandbox Checkout Session.
- Entitlement activation only after a verified sandbox event.
- Sandbox upgrade/downgrade, exact proration invoice, period-end change and cancellation/undo.
- Payment failure/recovery, successful refund, payout/balance retrieval and fee projection using real sandbox objects.
- Customer Portal payment-method and invoice actions against the dedicated sandbox portal configuration.
- Independent processing while the SuperAdmin UI switches between Test and Live.
- Rejection of a test account paired with live Stripe resources at the provider boundary.

The application exposes a **Verify sandbox acceptance evidence** action. It cannot stamp acceptance until the database contains a test account, completed checkout, projected subscription/entitlement, update, cancellation, successful payment, failed payment and successful refund.

## Sandbox provider setup completed on 6 October 2026

- A dedicated Stripe sandbox restricted key is deployed as the encrypted Worker secret `STRIPE_TEST_SECRET_KEY`; no secret value is stored in this repository.
- The isolated sandbox webhook endpoint `we_1UNbFx0N1c5vQhvipKzJSEZD` targets `https://app.claritude.io/webhooks/stripe/test`. Its signing secret is deployed as encrypted `STRIPE_TEST_WEBHOOK_SECRET`.
- The sandbox Customer Portal configuration `bpc_1UNbGa0N1c5vQhvimkvR8FyN` is deployed as `STRIPE_TEST_PORTAL_CONFIGURATION_ID`. It supports customer details, invoices, payment methods and cancellation at period end. Subscription switching remains disabled until prices are approved.
- Sandbox product shells exist without invented prices: Essentials `prod_VOO9u3CFeQkGRA`, Scale `prod_VOOA92ndwQtdih`, and Pro `prod_VOOAJpBfnK01Y6`.
- No live Stripe credential, webhook, portal configuration or live catalogue was created. Live checkout remains disabled.

## Blocked by credentials or commercial decisions

- Sandbox credentials, webhook signing and Customer Portal configuration are deployed. Live credentials and a separate live webhook/portal remain intentionally absent pending live-readiness approval.
- No approved Stripe Product/Price IDs or amounts are present for the required package/currency/interval combinations.
- Published paid package versions still need authoritative included editing-seat allowances and an explicit decision on which packages sell seat overage.
- Stripe Tax registrations, product tax codes and inclusive/exclusive price behaviour have not been approved. No tax values were invented.
- The sandbox Customer Portal configuration is present. The separate live configuration remains blocked with live activation.
- Provider-dependent sandbox acceptance cannot proceed until the approved base prices, included-seat allowances, overage policy and tax behaviour are supplied.

## Still incomplete

- Provider acceptance evidence remains incomplete for the credential-dependent journeys above.
- Live commercial activation remains intentionally incomplete and disabled until every readiness item is satisfied.

## Required configuration names

- Sandbox: `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_PORTAL_CONFIGURATION_ID`
- Live: `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`, `STRIPE_LIVE_PORTAL_CONFIGURATION_ID`

Restricted keys are supported. Each restricted key must have permissions for the Stripe resources exercised by checkout, subscriptions, invoices, refunds, balance transactions, balances, payouts, portal sessions and Tax readiness checks.
