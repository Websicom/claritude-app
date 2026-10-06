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

## 2026-10-06 — production release

- GitHub Production run `37402652558` validated, migrated, linted, deployed and health-verified commit `295c352b5049b4c9c3d5b77ea8389e1a629cd922`.
- Supabase applied migrations `20261006005852`, `20261006012241` and `20261006013136`; linked lint reported no schema errors. The first migration is an intentionally empty migration-number placeholder, preventing the discarded email-only prototype from ever being created.
- Cloudflare deployed Worker version `34b5ba95-d331-489c-9cc9-cb2fcad567a8`. The independent production health response reported 306/306 implemented audit checks and the exact release commit.
- The guarded staff migration could only complete if the confirmed `admin@claritude.io` Auth identity existed, so that identity is now an active platform Owner. Adam is an active Owner when his confirmed identity existed at migration time; otherwise the exact-email invitation remains pending and binds only after that identity is confirmed.

## 2026-10-06 — full-brief reconciliation checkpoint

- Account direct communications are draft-only in this checkpoint. This is deliberate: creating and auditing copy is useful, but a separate reviewed recipient preview/send action is required before any real customer contact.
- Manual email confirmation is restricted to a platform Owner, requires a reason plus the exact confirmation phrase, and updates only the Auth identity. It never creates an account, workspace, property or billing membership.
- Account-wide access state and service-specific processing state remain separate. Pausing audits, analytics, uptime, reports or email does not delete data or silently alter package/billing state.
- Saved SuperAdmin views are private to the staff identity. They currently persist page, tab and search state; future numeric/date filters can be added to the same bounded JSON contract.
- Selected/account/query export filters are applied again inside the asynchronous export worker after the staff permission recheck. Account exports therefore cannot rely on client-only filtering.
- Customer-facing audit groups now receive the same reviewed configuration discipline as technical checks: an immutable pre-change snapshot, monotonically increasing configuration version, reasoned rollback and package-level availability overrides. Executable audit logic remains repository-owned.
- Ownership transfer and cross-account property transfer are intentionally not approximated with an unsafe administrator-only reassignment. They remain outstanding until the destination identity can accept a short-lived, account-scoped verification workflow.

## 2026-10-06 — second screenshot review decisions

- The Owner explicitly rejected the Saved view selector. It is removed from the SuperAdmin interface even though the earlier brief requested saved views; this later direction is authoritative.
- Published package definitions remain immutable. Editing allowances, feature flags, retention or hard ceilings always creates the next draft version, preventing silent changes to existing accounts.
- Database size and connection data comes from PostgreSQL through a bounded service-role-only function. Provider CPU, memory, disk quota, billing and backup status are not inferred from relation sizes.
- Operational pause/resume controls have one authoritative home under Infrastructure & Usage. Administration links to configuration editors and no longer duplicates the controls tab.
- Directory row menus expose contextual operations while the primary user/property names are direct links to their settings screens. Mutations still require the existing server permission, MFA and reason checks.
- Production workflow `37456019756` validated, migrated, deployed and health-verified the operational-editor checkpoint at commit `b78b705ec286fbcde0fa7c0f3ff36748df62f346`.
