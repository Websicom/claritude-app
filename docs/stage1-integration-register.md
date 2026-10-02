# Stage 1 integration register

The authenticated application and `?fixture=1` visual-test mode now mount the
same `ClaritudeApplication` React component tree. Fixture mode changes only the
bootstrap data and safe action adapters; it does not render `reference.html` or
an alternative page hierarchy. Production routes never read deterministic
fixture data. `public/reference.html` is retained as a comparison resource and
is not an application entry point.

| Surface | Live source | Write/action path | Honest empty/error state |
| --- | --- | --- | --- |
| Authentication | Supabase Auth session | Sign up, sign in, sign out, recovery | Auth errors are surfaced; no demo login |
| Account/profile | `profiles`, `account_memberships` | `PATCH /api/profile` | Missing profile fields render blank |
| Workspaces/users | `workspaces`, `workspace_memberships` | workspace create/update/member invite APIs | Shared-property users do not enter onboarding |
| Properties | `properties`, `property_memberships` | create/update/verify/viewer invite APIs | No sample properties or synthetic scores |
| Uptime | `uptime_monitors`, `uptime_checks`, `incidents`, `maintenance_windows` | monitor update/check, maintenance schedule, test alert | No checks/incidents produces an explicit empty state |
| Analytics | `analytics_events`, `analytics_daily`, `event_definitions` | public `/collect`, configured-event API | Unknown visitor counts and unsupported dimensions show `—` |
| Audits | versioned check registry, `audit_runs`, `audit_results`, `property_audit_pages` | queued audit and saved-page APIs | Catalogue size, implemented checks, attempted checks and successful execution are reported separately; unsupported checks are not snapshotted into new runs |
| Reports | saved reports/templates/schedules and live report snapshot | save/schedule APIs; scheduled Resend delivery | Failed delivery is retained in `last_error` |
| Notifications/activity | `notifications`, `notification_deliveries`, `activity_log` | mark-read/read-all; system event writers | Empty feeds remain empty |
| Privacy/settings | property `settings` and profile preferences | property/profile update APIs | Defaults are schema-backed, not UI-only |

## Limits enforced server-side

- 25 properties per account.
- 20 audit runs per property per UTC day.
- 50,000 accepted analytics events per property per UTC day.
- Event names must be configured and enabled before non-pageview events are accepted.

## Trust boundaries

- Supabase Row Level Security is the tenant-isolation boundary for browser and user-token access.
- Worker service-role operations re-check account/workspace/property authorization before privileged writes.
- Outbound verification, audit and uptime requests reject loopback, link-local, private and non-public DNS resolutions.
- Alert/report delivery is deduplicated and recorded before retry decisions.

## Deferred on purpose

Stripe billing is not active in Stage 1. Live billing controls are informational and must not imply that a plan, payment method or invoice action occurred. The deterministic fixture keeps the approved billing layout only for visual review.

## Audit implementation accounting

- Catalogue entries: 306 active definitions.
- Implemented by the current source runner: 16 checks.
- New-run snapshot size: 16 implemented checks.
- A result is counted as successfully executed only when its outcome is not
  `unable_to_test`.
- Historical runs are preserved. Runs created before this correction contain
  306 result rows, of which 290 are `unable_to_test`; those rows are evidence of
  non-execution, not working implementations.
