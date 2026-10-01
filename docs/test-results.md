# Verification record

## Local/static verification — 1 October 2026

- TypeScript strict check: passed.
- Audit registry tests: 306 entries, unique IDs, exactly six primary categories, no executable database fields.
- Production Vite/Worker build: passed.
- Client output: 374.87 kB JavaScript (113.27 kB gzip) and 9.98 kB CSS (2.87 kB gzip).
- Worker output: 1.05 MB before platform compression.
- Cloudflare compatibility date is pinned to the provider-supported `2025-10-08` runtime.
- Supabase schema: 24 public tables, 29 RLS policies, 306 seeded registry checks, additive migration ledger present.
- Supabase Security Advisor: zero errors. The intentional authenticated `complete_onboarding` SECURITY DEFINER warning is documented; API/client execution of Supabase's `rls_auto_enable` helper is revoked while its dependent platform event trigger remains intact.

## Cloudflare preview verification — 1 October 2026

- GitHub-connected Workers build passed TypeScript, all registry tests and the production Vite build.
- Preview: `https://claritude-app.morning-sea-c704.workers.dev`.
- `/`, `/health`, `/api/config` and `/tracker.js`: HTTP 200.
- `/api/bootstrap` without a bearer token: HTTP 401 as expected.
- Sign-in screen rendered successfully in Chrome.
- `claritude-jobs` producer/consumer and `claritude-jobs-dlq` bindings are active; both cron triggers are installed.
- Supabase secret and scoped Resend sending key are stored as encrypted Cloudflare secrets.
- Resend `claritude.io` domain is verified; sender is `Claritude <alerts@claritude.io>`.
- Supabase redirect allowlist contains both the Workers preview and `app.claritude.io` wildcard paths.

## Live acceptance and production cutover — 2 October 2026

- The disposable `scripts/verify-live.mjs` acceptance harness passed first on the Worker preview and again on `https://app.claritude.io`; it removes only the exact accounts and auth users it creates and restores the registry check it toggles.
- Three confirmed test users completed onboarding into separate accounts and workspaces with `pro_early_access`; a second tenant could neither read nor start an audit against the first tenant's property.
- A cookieless pageview was accepted by `/collect` and appeared in the authenticated analytics summary. A separate public property completed tracking/header verification.
- A queued audit completed as `partial` with all 306 catalogue entries represented. The run recorded immutable title, logic-version and configuration-version snapshots.
- Disabling `seo.metadata.title.present` in the database excluded it from the next audit snapshot; restoring it to active included it again. The original lifecycle was restored before cleanup.
- A controlled HTTP 503 target reached the configured two-failure threshold, opened one incident and sent a downtime alert. Changing the same target to HTTP 200 closed the incident and sent one recovery notice.
- Resend shows `Delivered` for the production run's confirmation email, password-reset email, downtime alert and recovery notice.
- Supabase Auth Site URL is `https://app.claritude.io`; both the production and Workers preview wildcard redirect URLs remain allowlisted.
- Production DNS preserves the previous CNAME target `b1f7ad4d7d266b31.vercel-dns-017.com` for rollback, with Cloudflare proxying enabled. The version-controlled route `app.claritude.io/*` sends production traffic to `claritude-app`.
- Production `/`, `/health`, `/audit` and `/tracker.js` return HTTP 200; unauthenticated `/api/bootstrap` returns HTTP 401; `/api/config` reports `https://app.claritude.io` as the application origin.
- Chrome rendered the production sign-in route at `https://app.claritude.io/auth/sign-in` successfully.
