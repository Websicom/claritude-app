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

## Live verification still required

Two-user RLS isolation, real registration email, password reset, queue/cron job execution against a configured property, controlled incident/recovery email, installed tracking script ingestion, and production custom-domain cutover must be recorded here. Configuration alone is not counted as a pass.
