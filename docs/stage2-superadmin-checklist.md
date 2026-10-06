# Stage 2 SuperAdmin implementation checklist

Last updated: 6 October 2026

Status key: `[ ]` not started, `[~]` in progress or partially implemented, `[x]` implemented and locally verified, `[!]` blocked or intentionally disabled.

## Baseline and release discipline

- [x] Confirm `Websicom/claritude-app`, `main`, Supabase project `dfaxmxschvzmlozxjaxf`, Cloudflare Worker deployment, queues, cron, browser binding and Resend integration.
- [x] Preserve the clean production baseline; Stage 2 remains local until the complete release gate passes.
- [x] Read current Supabase MFA/RLS and Stripe billing/security guidance.
- [x] Add this committed checklist and `docs/stage2-superadmin-decisions.md`.
- [ ] Reconcile every specification section before release.
- [ ] Run the full type, unit, build, migration, advisor and browser suites.
- [ ] Push through the established `main` production workflow and verify the deployed commit and live behaviour.

## Stage A — staff security, MFA and administrative logging

- [~] Replace the initial two-email allowlist with identity-bound staff records and pending verified invitations.
- [ ] Support Owner, Support, Finance and Engineering permission sets independently of customer roles.
- [ ] Require AAL2/TOTP for privileged reads and writes, with enrolment, challenge and secure owner-assisted recovery.
- [ ] Enforce permission checks on every privileged backend operation.
- [ ] Add immutable administrative activity records with actor, target, reason, before/after snapshots, outcome and correlation ID.
- [ ] Prevent last-Owner removal and self-escalation.
- [ ] Implement time-limited customer delegation sessions, read-only by default, with explicit write activation and persistent UI banner.
- [ ] Test role denial, revocation, MFA, last-owner and delegation expiry paths.

## Stage B — customer administration

- [~] Accounts and users have a read-only aggregate directory from the foundation commit.
- [ ] Add server-side search, filters, sorting, pagination and saved views for accounts, users, workspaces and properties.
- [ ] Add account detail tabs and effective-setting sources.
- [ ] Implement notes, tags, invitations, billing permissions, included editing seats and ownership-transfer workflow.
- [ ] Implement service pauses, freeze/block/restore and reviewed scheduled deletion.
- [ ] Implement safe direct messages and asynchronous account exports.
- [ ] Implement verification resend and restricted logged manual confirmation without membership creation.
- [ ] Enforce duplicate-property identity rules across an account without cross-account disclosure.
- [ ] Implement safe within-account moves and explicit cross-account transfer workflow.

## Stage C — entitlements, lifecycle and durable usage

- [ ] Add versioned package definitions, package versions, account assignments and expiring overrides.
- [ ] Implement one effective-entitlements resolver used by UI, API, collectors, schedulers and jobs.
- [ ] Separate pricing grandfathering, allowance grandfathering, billing state and complimentary access.
- [ ] Add package publication/migration preview and scheduled changes.
- [ ] Add downgrade resource selection/locking without deletion or usage reset.
- [ ] Add account-level page-audit reservation/consumption ledger with idempotency and one-time restoration.
- [ ] Preserve usage after deletion, replacement and package changes; expose reset schedule.
- [ ] Add property/domain activation and audit-page replacement limits.

## Free-account inactivity

- [ ] Add configurable 60/90/100/121-day policy and per-account meaningful-activity tracking.
- [ ] Add exemptions, grace extensions, analytics-activity review and delivery holds.
- [ ] Implement owner export/reactivation while frozen.
- [ ] Implement warning history, countdown and deletion dry-run preview.
- [ ] Keep irreversible automatic production deletion disabled pending Owner activation.

## Stage D — audit controls

- [ ] Preserve the 306 technical checks / 121 customer-facing groups and repository-owned executable logic.
- [ ] Add search/filtering and effective availability by global, package and account scope.
- [ ] Add safe threshold, severity and scoring configuration where supported.
- [ ] Add configuration versions, history, rollback and dependency visibility.
- [ ] Add runtime, error-rate and outcome-distribution health.
- [ ] Test disabled checks, snapshot consistency, scoring/coverage and incomplete-collection outcomes.

## Stage E — operations, health and infrastructure safety

- [ ] Add service, job/queue, error, incident and release views with bounded recovery controls.
- [ ] Add application-measured operational telemetry and honest unavailable provider states.
- [ ] Add account drilldowns, refresh timestamps, sources, units and periods.
- [ ] Add configurable hard ceilings and atomic leases/reservations across all expensive paths.
- [ ] Add per-account fairness and protected read/auth/billing-recovery capacity.
- [ ] Add independent, logged emergency controls for audits, browser, uptime, analytics, reports, campaigns and scoped resources.
- [ ] Preserve SSRF, unsafe-port, credential-in-URL and redirect protections.

## Uptime incident safety

- [ ] Model Up, Suspected down, Confirmed down, Monitoring unavailable/delayed and Paused.
- [ ] Add bounded confirmation and platform-wide failure correlation.
- [ ] Suppress unsupported customer outage mail during platform monitoring failures.
- [ ] Expose monitoring gaps/coverage and gradual recovery.
- [ ] Verify incident and recipient deduplication and genuine recovery-only messages.

## Stage F — Stripe financials, coupons and billing operations

- [ ] Detect/configure Stripe sandbox and restricted server key; keep unconfigured states honest.
- [ ] Add verified, idempotent and out-of-order-safe webhook ingestion.
- [ ] Add subscriptions, invoices/payments, recovery, refunds/credits, revenue analysis and reconciliation views.
- [ ] Add subscription previews, serialization and scheduled lifecycle changes without fabricated paid access.
- [ ] Define currency-aware MRR/ARR/cash/refund calculations.
- [ ] Add coupon and promotion-code management with application eligibility and no stacking by default.
- [ ] Keep all real charges/refunds disabled during implementation verification.
- [ ] Document Stripe Tax as unconfigured until registrations and policy are explicitly confirmed.

## Stage G — email, alerts and digest

- [ ] Add versioned templates, variable validation, previews and safe test sends.
- [ ] Add automation execution history and preserve existing production sends.
- [ ] Add bounded campaigns with recipient preview, deduplication, preferences, suppression, scheduling and cancellation.
- [ ] Add configurable alert rules, cooldowns, acknowledgements, snooze and history.
- [ ] Add weekly SuperAdmin digest.
- [ ] Leave new outbound automations disabled until recipient/policy activation.

## Stage H — shared controls, exports and retention

- [ ] Standardise server-side pagination, filters, sorting, saved views and date/numeric ranges.
- [ ] Add selected/current/all-filtered exports with asynchronous jobs and expiring permission checks.
- [ ] Prevent CSV spreadsheet formula injection.
- [ ] Add retention settings, cleanup preview and deletion requests while preserving usage ledgers.
- [ ] Display real backup status/capability and recovery documentation without calling exports backups.

## Stage I — command centre and complete navigation

- [ ] Build the dedicated grouped SuperAdmin sidebar and every specified page/tab.
- [ ] Add persistent global search across accounts, users, domains, workspaces, invoices and audit IDs.
- [ ] Show environment, service health and unresolved alerts globally.
- [ ] Build summary, customer activity, revenue and service-health overview from the functioning systems.
- [ ] Link every summary to supporting filtered records and persist relevant filters.
- [ ] Verify responsive navigation, tabs, long tables, loading, empty, unavailable, denied and error states.

