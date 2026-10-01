# Verification record

## Local/static verification — 1 October 2026

- TypeScript strict check: passed.
- Audit registry tests: 306 entries, unique IDs, exactly six primary categories, no executable database fields.
- Production Vite/Worker build: passed.
- Client output: 374.87 kB JavaScript (113.27 kB gzip) and 9.98 kB CSS (2.87 kB gzip).
- Worker output: 1.05 MB before platform compression.
- Cloudflare runtime used locally supports compatibility date 2025-10-08 and warned while falling back from the configured 2026-10-01 date. Provider build should use the deployed platform runtime; pin to the latest supported provider date if Workers Builds reports the same warning.
- Supabase schema: 24 public tables, 29 RLS policies, 306 seeded registry checks, additive migration ledger present.
- Supabase Security Advisor: zero errors. The intentional authenticated `complete_onboarding` SECURITY DEFINER warning is documented; API/client execution of Supabase's `rls_auto_enable` helper is revoked while its dependent platform event trigger remains intact.

## Live verification still required

Migration/advisors, two-user RLS isolation, real registration email, password reset, queue/cron execution, controlled incident/recovery email, installed tracking script, preview routes, and production custom-domain cutover must be recorded here after provider deployment. Configuration alone is not counted as a pass.
