# Stage 2 SuperAdmin implementation checklist

Last updated: 6 October 2026

Status key: `[ ]` not started, `[~]` partially implemented, `[x]` implemented and locally verified, `[!]` intentionally disabled or blocked by missing provider configuration/policy.

This is an acceptance record, not a marketing checklist. A page or schema foundation alone is not marked complete. Provider-backed actions are marked blocked until they can be verified safely against the configured provider.

## Baseline and release discipline

- [x] Confirm `Websicom/claritude-app`, `main`, Supabase project `dfaxmxschvzmlozxjaxf`, Cloudflare Worker deployment, queues, cron, browser binding and Resend integration.
- [x] Inspect authentication, database, audit engine, analytics, uptime, email and deployment paths before changing them.
- [x] Use additive, service-role-only migrations for privileged state and preserve existing customer data.
- [x] Run type checks, 190 unit tests, production build, production dependency audit and responsive browser smoke tests.
- [x] Production applied the expected migrations through `20261006093839`; the current checkpoint adds one additive audit-group history migration for the same migration-first workflow.
- [x] Push through `main`, observe migration-first deployment and verify the exact deployed commit on `/health`.

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
- [x] Add working internal notes, tags, account state, explicit billing-permission display, service-specific pause/resume controls, reviewed scheduled deletion and activity/communication views.
- [x] Add freeze/block/restore/pending-deletion operations with required reasons and Owner-only destructive scheduling.
- [x] Add account deletion dry-run and Owner reactivation without resetting usage.
- [x] Enforce full normalised URL identity within an account without revealing cross-account matches.
- [x] Account detail uses the nine specified tabs, separating Package & Limits from Billing and exposing source-aware limits, communications, activity and data/access controls.
- [x] Add logged verification resend and restricted Owner-only manual confirmation; confirmation explicitly does not create account membership.
- [~] Scoped workspace/property invitation flows exist and identity is separate from membership; ownership transfer and cross-account property transfer still need their recipient-verification and review UI.
- [~] Direct account messages can be created as audited drafts. Sending remains intentionally unavailable until recipient preview and safe policy are approved.

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
- [x] Check and customer-facing group lifecycle/default availability can be changed safely; group versions support immutable history/rollback and package availability rules are editable.
- [~] Dependency and check-level runtime/error/outcome distribution views remain limited to the application-measured audit-run aggregates currently captured.
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
- [x] Add template version editors/previews/publishing, automation controls/simulation, campaign draft/duplicate/safe simulation, delivery classification and filtering, suppressions, alert-rule editing/evaluation, alert lifecycle actions and digest settings.
- [~] Campaign audience resolution is simulation-only and new campaign/digest sends remain disabled until safe recipients and policy are configured.
- [!] New outbound automation requires approved templates, preferences/suppression policy and safe test recipients.

## Stage H — exports, retention and shared controls

- [x] Add server-side account pagination/search/filter/sort and global search across accounts, users, domains, workspaces, billing events and audit IDs.
- [x] Add queued CSV/JSON exports for accounts, users, properties, audits and admin activity with progress, private storage, seven-day expiry and a new permission check before a 60-second signed download.
- [x] Neutralise spreadsheet formula injection and omit sensitive before/after payloads from administrative-log export.
- [x] Add retention settings, cleanup/deletion review data and honest backup-unavailable state.
- [x] Add per-staff saved-view create/apply/remove controls for page, tab and search state.
- [~] Export jobs accept selected IDs, account scope and query filters; account-specific and filtered-user export controls are exposed, while checkbox selection/current-page controls are not yet consistent across every directory.
- [!] Cleanup execution and provider backup/PITR claims remain disabled pending policy and verified provider access.

## Stage I — command centre and navigation

- [x] Build the dedicated, permission-gated SuperAdmin sidebar with every specified group, page and tab.
- [x] Add persistent global search, environment, service health and unresolved-alert context.
- [x] Use live application data and explicit loading, empty, unavailable, denied and error states; fixtures are isolated to `?fixture` visual testing and cannot mutate data.
- [x] Build overview/customer/revenue/service panels from functioning data sources and show unavailable financial/provider metrics honestly.
- [x] Verify desktop and 565px layouts, tab/table containment and key Financials, Customer sessions and Safety limits views with zero browser console errors.
- [~] Some summary rows do not yet deep-link with persisted filters; the overview is operational but not every requested analytic trend is available from existing data.

## Release activation gates

- [x] Production workflow applied all three migrations. Its guarded seed proves a verified `admin@claritude.io` identity existed and was bound as Owner; Adam is bound if verified or otherwise has the exact-identity pending Owner invitation.
- [x] Cloudflare Worker version `8bb3d429-77cb-401d-90aa-253ac1770017` reports commit `4fd59aeda18b4ec0443a9f83bb61014cac1cfa3a` on `/health` before this checkpoint.
- [ ] Deploy and health-verify the containing customer-operations/audit-controls checkpoint and migration `20261006114500`.
- [ ] Owner signs in, completes AAL2 and verifies staff directory plus a read-only delegated-session smoke test.
- [ ] Stripe, new outbound automation, automatic deletion, cleanup and unverified provider controls remain off until their individual prerequisites are satisfied.

## 2026-10-06 — operational editor and directory usability checkpoint

- [x] Add consistent table filtering, 50/100/200 page-size selection, visible record totals, pagination and three-dot row actions to SuperAdmin data tables.
- [x] Remove the Saved view selector at the Owner's direction; the underlying private saved-view records are not surfaced in this release.
- [x] Link user names to identity/profile settings and property names to property settings, with reasoned server-side edits and administrative activity.
- [x] Add versioned package allowance/feature/retention/hard-ceiling editing. Published versions are immutable; edits create drafts and publication remains explicit.
- [x] Add a structured, validated global safety-ceiling editor rather than a raw JSON display.
- [x] Add PostgreSQL-reported database size, relation size and connection metrics through a service-role-only function. Supabase CPU/memory, quota and backup/PITR telemetry remain explicitly unavailable without provider access.
- [x] Replace repeated Platform Health and Infrastructure tab bodies with distinct service, queue, error, incident, release, audit, browser, database, usage and operational-control views.
- [x] Keep operational controls authoritative under Infrastructure & Usage and remove the duplicate Administration feature-controls tab.
- [x] Add editable versioned templates plus automation and campaign actions; new outbound execution remains behind the existing safe-recipient and policy gates.
- [ ] Production migration, deployment workflow and exact-commit health verification for this checkpoint.
