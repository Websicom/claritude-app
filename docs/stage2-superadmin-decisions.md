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
