# Prototype feature inventory

Status values describe the committed Stage 1 implementation before live-provider verification.

| Prototype location | Intended behaviour | Data/service | Implementation | Verification / limitation |
|---|---|---|---|---|
| Login, registration, recovery | Confirmed accounts and secure sessions | Supabase Auth + Resend SMTP | Implemented | Live email pending provider configuration |
| Onboarding | Account, workspace, optional property | Supabase RPC | Implemented | Live migration required |
| All properties | Searchable tenant property overview | Postgres/RLS | Implemented | Pagination is not yet required for empty production data |
| Property overview/activity/setup | Real setup state and latest measurements | Properties, monitors, audits | Implemented | Activity feed table is present; UI detail is minimal |
| Uptime overview | Latest real HTTP status and response time | Cron + Queue + Worker fetch | Implemented | Region is intentionally not claimed |
| Incidents | Consecutive-threshold open/recover lifecycle | Postgres + Resend | Implemented | Controlled target test pending |
| Maintenance | Scheduled exclusions | Postgres | Schema/RLS implemented | Consumer exclusion logic remains to connect |
| Alerts/settings | Recipients, intervals, thresholds, pause/check now | Postgres + Worker | API implemented | UI edits are partially connected |
| Audit overview/history | Queued evidence-backed source checks | Queue + versioned registry | Implemented subset | Rendered browser/lab checks return unable-to-test until Browser Rendering is configured |
| Audit findings/checks/compare | Outcomes, coverage and version-aware history | Audit tables | Data model implemented | Detailed comparison UI remains minimal |
| Analytics overview/pages/events | First-party cookieless events and summaries | `/tracker.js`, `/collect`, Postgres | Implemented | Geographic grouping requires trusted Cloudflare location mapping |
| Sources/audience/engagement/performance | Sanitised referrer/device/event/vital data | Event payloads and aggregates | Collection implemented | Detail UI remains minimal; exact unique visitors are not claimed |
| Reports/templates/preview/schedules/branding | Data-backed period report | Postgres + report endpoint | Preview implemented; schema ready | PDF/email scheduling worker remains to connect |
| Property settings | General, tracking, uptime, sharing, advanced | Postgres/RLS | Read UI implemented | Several save controls remain unconnected |
| Account profile/workspace/users | Profile and tenant access | Supabase/Postgres | Read UI + schema implemented | Invitation flow remains to connect |
| Billing & plan | Genuine early-access entitlement | Accounts table | Implemented | No Stripe actions, invoices or renewal dates |
| Notifications/activity/security/privacy | Durable status and safe controls | Postgres | Schema and navigation implemented | Export/deletion/reauth flows remain to connect |
| Empty/loading/error/permission states | Honest application states | UI | Implemented core states | Per-panel partial states can be expanded |
| Responsive navigation and dialogs | Keyboard/mobile accessible shell | React/CSS | Implemented | Full assistive-technology pass pending |

No fictional prototype measurements are included in production data paths. The supplied reference remains a comparison-only static resource and is never mounted by the application. Deterministic visual tests use the same React components as authenticated users.
