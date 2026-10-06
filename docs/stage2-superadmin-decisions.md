# Stage 2 SuperAdmin decision log

## 2026-10-06 — implementation baseline

- Production is the Cloudflare Worker at `app.claritude.io`, backed by Supabase project `dfaxmxschvzmlozxjaxf`. Pushes to `main` run the protected migration-first production workflow. Stage 2 will remain local until the complete release gate passes.
- The existing application is one React/Vite client and one Hono Worker. Stage 2 will keep that deployable shape and use additive Supabase migrations.
- Privileged staff authorization will be stored in server-controlled database records bound to `auth.users.id`. Customer memberships and user-editable metadata will never confer staff access.
- `admin@claritude.io` is the existing verified platform-owner candidate supplied by the Owner. The migration must bind it only to an already confirmed Auth identity. `adam.jordan@websi.com` may remain a pending staff invitation until a confirmed matching Auth identity accepts it; an email string alone never authorizes a request.
- Privileged endpoints will require a live staff record and Supabase AAL2. The application will provide TOTP enrolment/challenge. Supabase supports multiple factors but not stable recovery codes by default, so owner-assisted factor deletion plus multiple-factor enrolment will form the recovery path.
- New public-schema tables will have explicit grants and RLS because current Supabase projects no longer guarantee automatic Data API exposure. Administrative tables will normally be service-role-only and accessed through the Worker.
- Executable audit logic remains repository-owned. Database configuration may change validated metadata/availability only; Stage 2 will not introduce `eval`, arbitrary SQL or a general code editor.
- Existing complementary/early-access entitlements remain authoritative until versioned packages are introduced. Undecided commercial values will be nullable/configurable and visibly unresolved.
- Stripe operations will be server-only, webhook-driven and sandbox-verified. No real charge, refund or subscription mutation will be used for implementation tests. Stripe Tax remains disabled/unconfigured until registrations and policy are confirmed.
- New campaigns, inactivity deletion and other outbound/destructive automations will ship disabled. Dry-run/preview and explicit Owner activation are required before production execution.
- Provider-only telemetry that is unavailable through configured access will be shown as unavailable, never estimated as an exact provider invoice or fabricated.

## Known provider/configuration questions

- Stripe keys, webhook secret, product/price catalogue and production billing activation are not present in the repository or Worker configuration inspected so far.
- Resend is configured for existing uptime/report delivery, but safe test recipients and campaign policy are not yet declared.
- Cloudflare provider-level queue/browser/account analytics access must be verified; application-measured telemetry will be implemented independently.
- Supabase backup/point-in-time-recovery capability and database CPU/memory access must be read from the provider rather than inferred.

## 2026-10-06 — implementation and release decisions

- Staff access is fail-closed. Every SuperAdmin API request resolves the current Auth identity, the live staff record, role permission and AAL2; browser-visible state never grants authority.
- `admin@claritude.io` is seeded only when a matching confirmed Auth identity exists. `adam.jordan@websi.com` is activated only if already confirmed; otherwise the migration creates an identity-bound pending Owner invitation which the exact confirmed identity must accept.
- Delegation is a scoped administrative context, not password impersonation. Sessions expire in at most 60 minutes, default to read-only, are rechecked on each request and cannot enter finance, ownership or destructive workflows.
- Customer audit quota and platform capacity use separate atomic ledgers. A page execution consumes one customer credit once; retries still consume infrastructure but do not double-charge. Eligible platform failures may restore the customer credit once.
- The initial daily/concurrent processing values are documented safety candidates, not commercial promises. Overrides are clamped to hard ceilings.
- URL identity intentionally preserves scheme, host form, path and query while normalising parseable URL representation and a trailing root slash. It does not collapse HTTP/HTTPS or `www` variants.
- Free-account automatic deletion, cleanup, new lifecycle mail, campaigns and weekly digest remain disabled. The first release provides state, dry-run and review controls only.
- Stripe uses the current SDK/API configuration, a signature-verified `/webhooks/stripe` route and provider-event ordering. With no Stripe credentials or catalogue available, financial mutations and calculated revenue remain unavailable instead of simulated.
- Provider metrics are labelled by source. Cloudflare CPU/browser/queue billing, Supabase CPU/memory and backup status remain unavailable until provider access exposes authoritative values.
- Production Hono and React Router dependencies were upgraded after audit findings. `npm audit --omit=dev` now reports zero vulnerabilities.
- The normal `agent-browser` executable was unavailable, so the same built fixture route was verified through the controlled browser surface at desktop and 565px widths. Console warnings/errors were zero.
- Local Docker was unavailable. Supabase CLI dry-run confirmed the pending migration set, while SQL execution, linked lint and post-migration checks are intentionally delegated to the existing migration-first production workflow.
