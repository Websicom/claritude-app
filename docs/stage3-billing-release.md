# Stage 3 billing release record

## Implemented

- Stripe SDK is pinned to `22.6.0` and API version `2026-08-26.dahlia`.
- Signature-verified Stripe events are durably persisted, deduplicated, queued, retried with bounded backoff and replayable by authorised finance staff.
- Server-owned projections cover customers, subscriptions, invoices, payments, refunds and disputes. Daily finance snapshots and live dashboard calculations remain separated by currency.
- Customer billing supports permission-checked Checkout, Customer Portal, invoice history, payment-method management through Stripe, cancellation at period end and undo.
- SuperAdmin supports verified Price ID mapping, billing readiness, account reconciliation, cancellation scheduling/undo, immutable activity logging and finance views.
- Entitlements change only after a verified Stripe subscription maps to an active package price. Checkout success URLs never grant access.
- Complimentary grants remain independent. The permanent Websi Pro early-access grant and its 25-property allowance are unchanged and excluded from recurring revenue.
- Downgrades/cancellations preserve workspaces, properties, reports, audits and analytics history.

## Calculation policy

- MRR is the sum of active, trialling and past-due recurring line amounts after recorded recurring discounts. Annual recurring amounts are divided by 12.
- ARR is MRR multiplied by 12.
- Invoice totals, cash collected, refunds and open dispute exposure are separate measures. Refunds never silently reduce the historical invoice total.
- GBP, EUR and USD are reported independently. No FX conversion or fabricated base-currency total is produced.
- Complimentary accounts do not create provider subscriptions and are excluded from MRR/ARR.

## Safety and activation gates

Checkout defaults to disabled. It cannot be enabled until all Essentials, Scale and Pro base and additional-seat mappings exist for GBP, EUR and USD, for monthly and annual billing, in the current Stripe environment. Every mapping is verified from Stripe; entered amounts are never trusted.

Automatic tax defaults to disabled. Enabling it additionally requires active Stripe Tax registrations, an explicit tax behaviour on every price and a product tax code. Claritude does not infer tax registrations, tax codes, inclusive/exclusive pricing or legal obligations.

## Known commercial blockers

The repository and supplied brief do not contain approved paid prices, product/price IDs, tax registrations, tax codes, statement descriptor, trial policy or final promotion rules. Those values were deliberately not invented. Live billing therefore remains disabled until an authorised operator supplies and verifies them in Stripe.

## Required sandbox verification before live activation

1. Configure restricted Stripe sandbox credentials and the webhook secret in Cloudflare.
2. Create or approve separate Stripe Products for Essentials, Scale and Pro and recurring Prices for every required currency/interval/component combination.
3. Add each Price ID through SuperAdmin and confirm the catalogue readiness gate.
4. Test new checkout, asynchronous payment success/failure, renewal, payment failure/recovery, cancellation/undo, refund, dispute, webhook duplicate/out-of-order delivery, replay and reconciliation.
5. Confirm customer notifications, invoice links, portal return paths, mobile layouts and keyboard navigation.
6. Review Stripe Tax registrations, tax codes and price tax behaviour with the responsible tax adviser before enabling automatic tax.
7. Enable sandbox checkout, run the full acceptance suite, then repeat the verified catalogue mapping in live mode under a separate change approval.
