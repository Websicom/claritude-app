# Operations, rollout and rollback

## Rollout

1. Record the current `app.claritude.io` DNS record and Vercel target. Do not delete the Vercel project.
2. Apply the migration to Supabase and run the RLS isolation tests.
3. Configure Resend SMTP in Supabase Auth and set Site URL plus redirect URLs for the Worker preview and `https://app.claritude.io`.
4. Deploy from GitHub to a `claritude-app.*.workers.dev` preview. Set secrets only in Cloudflare.
5. Verify `/health`, deep links, registration, confirmation, reset, onboarding, analytics ingestion, audit queue processing and a controlled uptime incident/recovery.
6. After preview acceptance, add the `app.claritude.io/*` route to `wrangler.jsonc`, deploy it, and enable Cloudflare proxying only on the existing `app` CNAME. Preserve its Vercel target for rollback.
7. Repeat authentication callback, reset and deep-link tests on production.

## Rollback

Remove or disable the `app.claritude.io/*` Worker route and change the existing `app` CNAME from Proxied back to DNS only. Its preserved target is `b1f7ad4d7d266b31.vercel-dns-017.com`; the Vercel project was not deleted. Leave Supabase migrations in place because they are additive. Disable queue producers and cron triggers if jobs must stop. Never roll back by deleting tenant data.

## Alerts and privacy

Resend requests use `Idempotency-Key` and database claims to prevent duplicate incident messages. Failed deliveries are recorded. Logs must not include access tokens, secret keys, email contents, full analytics payloads or raw user-provided URLs with query strings.
