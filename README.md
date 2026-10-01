# Claritude V2 — Stage 1

Claritude is a Cloudflare Workers application for privacy-conscious uptime monitoring, website audits, cookieless analytics and reports. The UI follows the supplied HTML reference pack; Supabase provides authentication and the relational data model.

## Architecture

- React + Vite for the responsive application UI.
- Hono on one Cloudflare Worker for authenticated APIs, `/tracker.js`, `/collect`, cron dispatch and queue consumers.
- Supabase Auth and Postgres with tenant-scoped RLS.
- Cloudflare Queues for bounded audit and uptime jobs; Cron Triggers dispatch due monitors and daily analytics aggregation.
- Resend for downtime and recovery email. Supabase Auth uses Resend SMTP, configured in the Supabase dashboard.

This is deliberately one deployable service and one database. There are no duplicate stores or general-purpose proxy endpoints.

## Provider-managed deployment

1. Apply `supabase/migrations/20261001230000_stage1_core.sql` to project `dfaxmxschvzmlozxjaxf` through the recorded migration workflow.
2. Seed the versioned audit metadata with `npm run audit:registry` then `node scripts/seed-audit-registry.mjs` in CI using the Supabase secret key.
3. In Cloudflare Workers Builds connect `Websicom/claritude-app`, build with `npm ci && npm run check && npm test && npm run build`, and deploy with `npx wrangler deploy`.
4. Configure Worker secrets `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, and `RESEND_FROM`.
5. Configure the two queues named by `wrangler.jsonc` before the first deploy.
6. Verify the `workers.dev` preview before attaching `app.claritude.io`.

Never commit secret keys. The Supabase publishable key is intentionally public; RLS and server authorization protect tenant data.

## Useful commands

```sh
npm ci
npm run audit:registry
npm run check
npm test
npm run build
```

See `docs/operations.md` for rollout and rollback, `docs/feature-inventory.md` for prototype coverage, and `docs/audit-check-map.csv` for all 306 supplied checklist entries.
