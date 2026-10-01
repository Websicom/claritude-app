# Operations, rollout and rollback

## Rollout

1. Record the current `app.claritude.io` DNS record and Vercel target. Do not delete the Vercel project.
2. Apply the migration to Supabase and run the RLS isolation tests.
3. Configure Resend SMTP in Supabase Auth and set Site URL plus redirect URLs for the Worker preview and `https://app.claritude.io`.
4. Deploy from GitHub to a `claritude-app.*.workers.dev` preview. Set secrets only in Cloudflare.
5. Verify `/health`, deep links, registration, confirmation, reset, onboarding, analytics ingestion, audit queue processing and a controlled uptime incident/recovery.
6. After preview acceptance, add the `app.claritude.io` custom-domain route to `wrangler.jsonc`, deploy, and change only the replaced app subdomain record.
7. Repeat authentication callback, reset and deep-link tests on production.

## Rollback

Detach the Worker custom domain or restore the recorded `app` DNS record to the existing Vercel target. Leave Supabase migrations in place; they are additive. Disable queue producers and cron triggers if jobs must stop. Never roll back by deleting tenant data. The previous Vercel deployment remains the application rollback target through Stage 1 verification.

## Alerts and privacy

Resend requests use `Idempotency-Key` and database claims to prevent duplicate incident messages. Failed deliveries are recorded. Logs must not include access tokens, secret keys, email contents, full analytics payloads or raw user-provided URLs with query strings.
