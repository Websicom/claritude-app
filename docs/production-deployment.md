# Production deployment

Claritude production is deployed by `.github/workflows/production.yml`.

## Trigger and order

- Every push to `main` and a manual `workflow_dispatch` run validates the exact commit.
- Validation runs without production credentials: locked install, generated-registry check, TypeScript, automated tests and production build.
- The protected `production` job then checks migration history, performs a migration dry run, applies pending migrations, verifies the history is synchronized, and runs schema lint.
- Only after the database stage succeeds does Wrangler deploy the validated build.
- `/health` must report the exact deployed Git commit before the workflow succeeds.
- Production runs are serialized and an in-progress migration/deployment is never cancelled. A stale queued push is rejected before it can migrate.

## GitHub production environment

The `production` environment is restricted to `main` and contains:

Variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_PROJECT_ID`

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Never commit these secrets or expose the production environment to pull-request workflows.

## Least-privilege credentials

The Cloudflare token should be scoped to the Claritude account and existing `claritude-app` Worker with:

- Worker role: `Editor` on the individual `claritude-app` Worker.
- Zone permission: `Zone > Workers Routes > Write` on `claritude.io`, because the Wrangler configuration contains a Worker route.

Do not use a Global API Key or product-wide `Admin` role.

The Supabase token should be a scoped token limited to the production project with read access to:

- Project Settings
- API Keys
- API Key Secrets

The database password authorizes the database migration connection. Rotate all three secrets through the GitHub `production` environment without changing the workflow.

## Migration and rollback safety

- Migration history is never repaired automatically.
- A remote-only or mismatched migration aborts the deployment before any schema or Worker change.
- The Worker is not deployed unless migration application and schema lint both succeed.
- No automatic Worker rollback runs after a migration. A previous Worker version is safe only when it is compatible with the current database schema.
- If the migration succeeds but Worker deployment or health verification fails, inspect the workflow summary and logs, then deploy a known schema-compatible commit. Do not blindly restore a pre-migration Worker.

## Audit trail

Each successful workflow summary records:

- full Git commit SHA
- Cloudflare Worker version ID
- migrations applied, or `none`
- production health result

