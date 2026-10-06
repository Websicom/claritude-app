# SuperAdmin operating guide

## Access and MFA

SuperAdmin access is attached to a confirmed Supabase Auth identity, never an email string or customer role. The four staff roles are Owner, Support, Finance and Engineering. A request must have a live active staff record, the relevant permission and Authenticator Assurance Level 2 (AAL2).

On first entry, enrol a TOTP authenticator in the SuperAdmin gate and complete the challenge. Owners should enrol more than one factor where practical. If a staff member loses every factor, an Owner can remove the unusable factor from **Administration → Staff & Permissions** after independently verifying the person. The affected staff member must then enrol and challenge a replacement factor. The last active Owner cannot be removed or demoted.

The initial migration binds `admin@claritude.io` only when that verified Auth identity exists. It activates `adam.jordan@websi.com` only when verified; otherwise it leaves an identity-bound pending invitation for the exact confirmed identity.

## Customer sessions

Use **Administration → Customer sessions** to select an account and represented user/role. Sessions default to read-only and expire in at most 60 minutes. Write mode requires the appropriate staff permission and a reason. A persistent banner shows the account, represented identity, mode and expiry.

Exit the session as soon as the investigation is complete. Finance, ownership and destructive operations are never available through delegation; use their dedicated privileged workflow. Every request rechecks staff permission, account membership, expiry and revocation.

## Emergency controls and safety limits

**Infrastructure & Usage → Safety limits** and **Administration → Feature controls** expose independent controls for new audits, scheduled audits, browser collection, uptime checks, uptime notifications, analytics ingestion, reports and campaigns. Every change requires a reason and is written to the administrative activity log.

Pausing a control prevents new work in that path and preserves existing data. It does not delete queued records or customer history. Safety settings are validated against server-side ranges. If safety accounting is unavailable, expensive new work fails closed while safe reads, authentication and recovery remain available.

Customer audit credits and platform capacity are separate. Customer credits are reserved atomically by page and consumed once at execution; cancelled pre-execution work releases them. Retries do not charge the customer twice. Platform daily/concurrent accounting still records retries and failed work.

## Account state and inactivity

Account freeze, block, restore and pending deletion require a reason. Pending deletion is Owner-only. Always run the deletion preview and inspect preserved global identities, usage ledgers and administrative records before scheduling anything.

Free-account lifecycle defaults are day 60 warning, day 90 reminder, day 100 reversible freeze and day 121 eligibility. Exemptions, grace periods, failed notices, active analytics and uncertain state hold the account for review. Automatic irreversible deletion is disabled. Owner reactivation does not reset consumed allowances.

## Financial operations

Stripe events enter through `/webhooks/stripe`, are signature verified, deduplicated and applied in provider-created order. The command centre must show **Unconfigured** until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, sandbox products/prices and reporting policy are present and verified.

Do not enable subscription changes, refunds, credits, retries or promotion creation against live data during verification. Complimentary/beta access is independent of billing state. Keep currencies separate unless a labelled conversion policy is configured. Stripe Tax remains unconfigured until registrations and policy are confirmed.

## Exports, retention and recovery

Exports run asynchronously, are stored in the private `admin-exports` bucket, expire after seven days and require a fresh permission check before a 60-second signed download is returned. CSV values that could execute as spreadsheet formulas are neutralised. Administrative activity exports intentionally omit before/after payloads.

An account export is not a database backup. Do not claim backup or point-in-time recovery coverage until the Supabase project capability has been inspected and a restoration drill has succeeded. Cleanup and destructive retention execution remain preview/review-only.

## Release and rollback

Production releases use `.github/workflows/production.yml`: validate the exact commit, apply and lint migrations, stamp the commit into the Worker, deploy, then verify `/health`. A successful Git push is not a successful release.

If migration fails, do not deploy the new Worker. If Worker deployment fails after migration, diagnose schema compatibility before selecting an older Worker version; never blindly roll back the database. Confirm the live commit, SuperAdmin AAL2 entry, staff bindings, emergency controls and one read-only customer-session smoke test after release.
