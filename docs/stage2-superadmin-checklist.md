# Stage 2 SuperAdmin implementation checklist

Last updated: 6 October 2026

Status key: `[ ]` not started, `[~]` partially implemented, `[x]` implemented and locally verified, `[!]` intentionally disabled or blocked by missing provider configuration/policy.

This is an acceptance record, not a marketing checklist. A page or schema foundation alone is not marked complete. Provider-backed actions are marked blocked until they can be verified safely against the configured provider.

## Baseline and release discipline

- [x] Confirm `Websicom/claritude-app`, `main`, Supabase project `dfaxmxschvzmlozxjaxf`, Cloudflare Worker deployment, queues, cron, browser binding and Resend integration.
- [x] Inspect authentication, database, audit engine, analytics, uptime, email and deployment paths before changing them.
- [x] Use additive, service-role-only migrations for privileged state and preserve existing customer data.
- [x] Run type checks, 183 unit tests, production build, production dependency audit and responsive browser smoke tests.
- [~] Migration dry-run lists the expected three migrations; final SQL execution and linked database lint occur in the production workflow because the local Docker daemon is unavailable.
- [ ] Push through `main`, observe migration-first deployment, verify the deployed commit and run linked database lint/advisors.

## Stage A — staff security, MFA and administrative logging

- [x] Replace the email allowlist with staff records bound to confirmed `auth.users.id` identities and identity-bound pending invitations.
- [x] Support independent Owner, Support, Finance and Engineering permission sets.
- [x] Require a live staff record and AAL2/TOTP for every SuperAdmin endpoint, with enrolment/challenge UI and Owner-assisted factor reset.
- [x] Enforce permissions server-side and keep service credentials server-only.
- [x] Add append-only administrative activity with actor, delegated identity, target, reason, before/after, outcome and correlation ID.
- [x] Prevent self-role changes and removal/demotion of the last active Owner.
- [x] Add time-limited delegated customer sessions, read-only by default, explicit reasoned write activation, request-time rechecks and a persistent exit banner.
- [~] Unit coverage exists for role permissions and assurance parsing; MFA enrolment/recovery and identity-bound invitation acceptance still require production identity smoke tests after deployment.

## Stage B — customer administration

- [x] Add account directory search, state/package filters, sorting, pagination, aggregate counts and account detail aggregation.
- [x] Add internal notes, tags/state fields, billing-permission data, service controls, scheduled deletion records and activity/communication data foundations.
- [x] Add freeze/block/restore/pending-deletion operations with required reasons and Owner-only destructive scheduling.
- [x] Add account deletion dry-run and Owner reactivation without resetting usage.
- [x] Enforce full normalised URL identity within an account without revealing cross-account matches.
- [~] Account detail data contains the specified domains, but the first UI release presents compact command-centre panels rather than every requested dedicated detail tab and mutation form.
- [~] Ownership-transfer, scoped invitation, verification-resend/manual-confirmation and cross-account transfer state are modelled or compatible with existing membership flows, but dedicated reviewed SuperAdmin workflows are not enabled.
- [!] Direct customer messaging remains disabled until approved templates, recipient policy and safe test recipients exist.

## Stage C — entitlements, lifecycle and durable usage

- [x] Add versioned package definitions, account assignments and expiring account overrides.
- [x] Resolve effective entitlements with source attribution and hard-ceiling clamping, and use them in property, audit and custom-event paths.
- [x] Preserve separate package, billing and complimentary-access state; unresolved paid values remain null rather than invented.
- [x] Add package migration conflict previews and resource-lock data foundations.
- [x] Add atomic page-credit reservations, one-time consumption/release/restoration and idempotent retry behaviour.
- [x] Add atomic platform daily/concurrency accounting and expiring processing leases.
- [x] Preserve account usage independently of property deletion and package changes.
- [~] Downgrade selection/locking is modelled, but scheduling and Owner selection UI are not enabled without confirmed commercial package transitions.
- [!] Proration, paid seats, currency changes and payment-gated upgrades are disabled until Stripe products/prices and billing policy are configured.

## Free-account inactivity

- [x] Add configurable 60/90/100/121-day policy, account-scoped meaningful activity, exemptions, grace, analytics review and delivery-hold states.
- [x] Add warning/state history, countdown data, reactivation and deletion dry-run.
- [x] Exclude viewer visits, system activity and automatic jobs from reset activity.
- [x] Keep irreversible automatic deletion disabled and recheck eligible records in bounded daily evaluation.
- [!] Real notices remain disabled until lifecycle templates, recipient policy and delivery handling are approved.

## Stage D — audit controls

- [x] Preserve 306 repository-owned technical checks and 121 customer-facing groups; no arbitrary stored code is executed.
- [x] Add catalogue search/filtering, lifecycle/configuration versions, change history and rollback.
- [x] Exclude effectively disabled checks from new execution snapshots while preserving historical snapshots and five-outcome semantics.
- [~] Check-level lifecycle, weight and supported metadata can be changed safely; group/package availability editors and dependency/runtime distribution views are read-only or not yet exposed.
- [~] Existing audit suites cover scoring, coverage and incomplete collection; Stage 2 configuration rollback has backend coverage but not a linked-database integration test.

## Stage E — operations, health and infrastructure safety

- [x] Add application-measured services, audit/job state, incidents, alerts and provider-capability views with explicit unavailable states.
- [x] Add validated safety settings, atomic reservations/leases and conservative failure when expensive-work safety state is unavailable.
- [x] Add separately logged emergency controls for new/scheduled audits, browser, uptime checks/notifications, analytics, reports and campaigns.
- [x] Apply controls to audit submission, analytics collection, uptime, notifications and scheduled reports.
- [x] Preserve private-network, unsafe-port, credentials-in-URL and redirect protections.
- [~] Account fairness is bounded by account quota plus global leases; provider queue/browser/CPU and deployment release controls remain observational because provider telemetry/API access is not configured in the application.

## Uptime incident safety

- [x] Model pending/up, suspected down, confirmed down, monitoring unavailable/delayed and paused states.
- [x] Require a bounded failure threshold before confirmed-down state.
- [x] Correlate unrelated simultaneous failures, suppress unsupported customer outage mail and raise a platform alert.
- [x] Treat paused/unavailable monitoring as missing coverage rather than downtime and retain existing incident/property/recipient deduplication.
- [~] Gradual recovery uses the existing bounded scheduler; independent external evidence beyond Claritude collectors is unavailable.

## Stage F — Stripe financials and promotions

- [x] Add current server-side Stripe SDK integration and an unauthenticated, Worker-first `/webhooks/stripe` endpoint with signature verification.
- [x] Add idempotent event storage, provider-created ordering, local billing projection and permissioned event reprocessing.
- [x] Add Financials and Coupons navigation/data views with clear currency separation and honest unconfigured states.
- [x] Preserve complimentary/beta access and never fabricate paid subscriptions.
- [!] Stripe secret/webhook secret, sandbox account and product/price catalogue are not configured; subscription mutations, previews, retries, refunds/credits, reconciliation and promotion creation are therefore disabled and unverified.
- [!] Revenue calculations and Stripe Tax remain unconfigured until currencies, product catalogue, registrations and reporting policy are approved.

## Stage G — email, alerts and digest

- [x] Add versioned template, automation, campaign, alert-rule and alert-history data models.
- [x] Show existing delivery history and preserve established uptime/report sends.
- [x] Seed new campaigns, lifecycle notices and weekly digest disabled.
- [~] The command centre can inspect templates, delivery, campaigns and alerts; editors, audience preview, test-send, acknowledgement/snooze and digest assembly are not enabled.
- [!] New outbound automation requires approved templates, preferences/suppression policy and safe test recipients.

## Stage H — exports, retention and shared controls

- [x] Add server-side account pagination/search/filter/sort and global search across accounts, users, domains, workspaces, billing events and audit IDs.
- [x] Add queued CSV/JSON exports for accounts, users, properties, audits and admin activity with progress, private storage, seven-day expiry and a new permission check before a 60-second signed download.
- [x] Neutralise spreadsheet formula injection and omit sensitive before/after payloads from administrative-log export.
- [x] Add retention settings, cleanup/deletion review data and honest backup-unavailable state.
- [~] Saved-view storage exists; full saved-view UI and selected/current-page export controls are not yet exposed.
- [!] Cleanup execution and provider backup/PITR claims remain disabled pending policy and verified provider access.

## Stage I — command centre and navigation

- [x] Build the dedicated, permission-gated SuperAdmin sidebar with every specified group, page and tab.
- [x] Add persistent global search, environment, service health and unresolved-alert context.
- [x] Use live application data and explicit loading, empty, unavailable, denied and error states; fixtures are isolated to `?fixture` visual testing and cannot mutate data.
- [x] Build overview/customer/revenue/service panels from functioning data sources and show unavailable financial/provider metrics honestly.
- [x] Verify desktop and 565px layouts, tab/table containment and key Financials, Customer sessions and Safety limits views with zero browser console errors.
- [~] Some summary rows do not yet deep-link with persisted filters; the overview is operational but not every requested analytic trend is available from existing data.

## Release activation gates

- [ ] Production workflow applies all three migrations, including verified `admin@claritude.io` Owner binding and `adam.jordan@websi.com` verified binding or pending identity-bound invitation.
- [ ] Cloudflare deploy reports the exact commit and `/health` returns it.
- [ ] Owner signs in, completes AAL2 and verifies staff directory plus a read-only delegated-session smoke test.
- [ ] Stripe, new outbound automation, automatic deletion, cleanup and unverified provider controls remain off until their individual prerequisites are satisfied.
