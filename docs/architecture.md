# Stage 1 architecture

## Request flow

The browser authenticates directly with Supabase using its publishable key. It sends the access token to `/api/*`; the Worker calls `auth.getUser` and uses a user-scoped Supabase client so RLS remains the final authorization boundary. Public analytics ingestion uses a public property identifier and a server-side client, validates origin and payload shape, and stores no cookie, persistent visitor identifier, full IP address, form value, or query string.

Audit and manual uptime requests create a database record and enqueue only its ID. Queue consumers fetch configuration server-side, use bounded requests and update the durable record. Cron dispatches due monitors in bounded batches. Incident mail is claimed with a unique idempotency key before Resend is called.

## Audit model

`docs/audit-checklist-source.md` is preserved verbatim. `scripts/generate-audit-registry.mjs` maps every entry to a stable ID and produces the TypeScript registry, JSON registry and CSV traceability map. A run snapshots ID, logic version, configuration version, title and weight before execution. Historical result rows snapshot the title and versions. Disabling or changing a registry entry therefore cannot rewrite an existing run.

Only allowlisted modules in `src/worker/index.ts` execute. Database configuration never contains executable source. Stage 2 may update validated metadata and open reviewable code changes against known module paths, but must not add `eval`, arbitrary SQL, or a general repository editor.

## Scoring and coverage

Pass = 1, warning = 0.5 and fail = 0 for executable scored checks. Informational, not-applicable and unable-to-test results are excluded from the score. Coverage is the proportion of the snapshotted active registry that produced pass, warning or fail. A higher score with changed coverage is not presented as a like-for-like improvement.

## Retention

- Raw analytics events: target 30 days, followed by daily aggregation; implement the scheduled deletion only after production reporting is verified.
- Daily analytics aggregates: 25 months by default.
- Uptime checks: 13 months; incidents retained until account deletion.
- Audit findings: retained with the audit run; large raw HTML is never stored.
- Soft-retire checks with historical results. Hard deletion is limited to unused drafts.

## Quotas

The early-access entitlement is independent of Stripe. Application limits should default to 25 properties/account, 20 audits/property/day, five-minute minimum monitoring and 50,000 analytics events/property/day. Enforce these counters before wider access; they are documented here rather than represented as a paid subscription.
