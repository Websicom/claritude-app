# Claritude V2 recovery parity register

Reference baseline: `HTML reference pack.zip` / `html-reference-extracted/index.html` and the hosted interactive reference. Fixture data is isolated behind `?fixture=1` on development and `workers.dev` previews only. It uses the same page components as the authenticated application; only its deterministic data and safe action adapters differ. Production accounts never receive fictional metrics.

## Shell and context

| Surface | Expected behaviour | Implementation | Visual | Functional |
| --- | --- | --- | --- | --- |
| Workspace header | Workspace selector, plan, property selector, centred page name, Claritude mark | Reference-derived header and custom selectors | Verified | Verified |
| Workspace navigation | Overview and Notifications only | Context-specific workspace sidebar | Verified | Verified |
| Property navigation | Your properties, Overview, Uptime, Analytics, Audit, Reports | Context-specific property sidebar | Verified | Verified |
| Property selector | Searchable property list, status, selected state, add property | Custom searchable popover; authorised live properties | Verified | Verified |
| User strip | Profile, account menu, notifications count | Bottom user strip and account menu | Verified | Verified |
| Alert strip | Current alert, review and snooze actions | Workspace/property-specific strip | Verified | Verified |
| Direct navigation | Property identity survives links and reload | `property` query parameter on every property route | Verified | Verified |

## Workspace pages

| Page/tab | Implemented content and controls | Visual | Functional |
| --- | --- | --- | --- |
| Overview / Properties | Metrics, search, monitor filter, sortable-shape table, row actions, seven-row pagination | Verified | Verified |
| Overview / Traffic | Workspace metrics, series selector and chart | Verified | Verified fixture; live totals remain property-scoped |
| Overview / Incidents | Incident table with state and duration | Verified | Verified |
| Overview / Reports | Honest saved-report empty state | Verified | Verified |
| Overview / Members | Member role and property scope | Verified | Verified |
| Notifications | All/Unread/Monitoring/Audits/Analytics/Account tabs, property/status filters, read actions | Verified | Verified |

## Property pages

| Page/tab | Implemented content and controls | Visual | Functional |
| --- | --- | --- | --- |
| Overview / Overview | Period, summary strip, four metrics, traffic series, RUM, top pages, health metrics | Verified | Live analytics query |
| Overview / Activity | Uptime, audit and analytics activity | Verified | Live timestamps |
| Overview / Setup | Four-step setup checklist | Verified | Live property state |
| Uptime / Overview | Availability metrics, 30-day strip, latest check, incidents, configuration | Verified | Live monitor state |
| Uptime / Incidents | Incident history | Verified | Live incident query |
| Uptime / Maintenance | Window list and complete add dialog | Verified | Persists through the authenticated maintenance API |
| Uptime / Alerts | Recipients, policy and test control | Verified | Recipient management persists; delivery is deduplicated through Resend |
| Uptime / Monitor settings | Interval, threshold, pause/resume and save | Verified | Persists through monitor PATCH |
| Analytics / Overview | Pageviews/events/tracking metrics, chart, pages and sources | Verified | Live aggregate query |
| Analytics / Pages | Filter, pageviews/events table and row actions | Verified | Live observed paths; per-page counts need expanded RPC |
| Analytics / Sources | Ranked source breakdown | Verified | Fixture verified; live dimension needs expanded RPC |
| Analytics / Events | Event definitions, create dialog and privacy copy | Verified | Definitions load and persist through authenticated APIs |
| Analytics / Audience | Countries and devices | Verified | Fixture verified; live dimension needs expanded RPC |
| Analytics / Engagement | Active time, scroll and key-event metrics | Verified | Tracker emits supported events; expanded RPC pending |
| Analytics / Performance | Core Web Vitals and browser breakdown | Verified | Tracker emits LCP; complete percentile RPC pending |
| Audit / Overview | Page picker, overall/six-category scores, findings, desktop/mobile performance | Verified | Live runs and honest partial coverage |
| Audit / Findings | Filterable evidence hierarchy | Verified | Live audit results |
| Audit / Checks | Six-category catalogue execution table | Verified | Registry-backed |
| Audit / History | Status, score, coverage and duration | Verified | Live audit history |
| Audit / Compare | Latest/previous comparison or required-run state | Verified | Live audit history |
| Reports / Quick reports | Six templates and report preview | Verified | Live report endpoint |
| Reports / Saved reports | Saved-report table/empty state, save, reopen and CSV/print export | Verified | Persists through authenticated APIs |
| Reports / Schedules | Schedule table and add dialog | Verified | Loads and persists through authenticated APIs |
| Reports / Branding | Agency form and report preview | Verified | Preview-local; API pending |

## Property and account settings

| Surface | Tabs covered | Visual | Functional |
| --- | --- | --- | --- |
| Property settings | General, Tracking, Uptime, Events, Sharing, Advanced | Verified | General and uptime persist; other API gaps are identified in-page |
| Account settings | Profile, Workspace, Billing & plan, Users, Notification preferences, Activity logs, Security, Data & privacy | Verified | Profile persists; billing is honest early-access state for live accounts |
| Billing reference fixture | Subscription, usage, payment method, invoices and four plan cards | Verified | Isolated visual fixture only; Stripe remains deferred |
| Help & setup | Search field and links to onboarding, tracking, uptime and audit | Verified | Verified |

## Backend evidence

- Uptime: cron `*/5 * * * *` selects due monitors, queue executes HTTP checks, stores response time, opens/recover incidents and deduplicates Resend delivery with `claim_notification`.
- Analytics: deployed script records pageviews, SPA URL changes, configured clicks, outbound links, scroll thresholds, active time, form success and LCP. `/collect` validates property/origin and stores accepted events.
- Audits: authorised queue flow stores registry snapshot, evidence, score, coverage, duration and status. The supplied 306-entry checklist is mapped to stable IDs. The current runner implements 16 checks, and corrected new runs snapshot only those checks. Historical 306-row runs are retained and report their 290 `unable_to_test` rows as non-execution.
- Tenant isolation: all tenant tables have RLS enabled; property access is mediated by `private.can_access_property`; destructive service operations use the Worker secret only.

## Remaining verified limitations

- The full 306-check audit catalogue is mapped, but the current source-only runner cannot execute browser, DNS, network-waterfall and lab-performance checks. The UI labels material coverage gaps as partial instead of showing a misleading complete score.
- Live analytics aggregation currently returns totals and unique page paths. Source, audience, engagement, browser and percentile breakdowns require expanded database RPCs.
- Workspace-user and notification-preference tables exist with RLS, but their complete management APIs are not exposed yet.
- Stripe is intentionally deferred. Live billing never displays fictional payment or invoice data.

## Verification record

- `npm run check`: passed.
- `npm test`: 9/9 passed.
- `npm run build`: passed.
- Canonical deterministic browser verification completed for workspace and property overviews. The isolated corrected-branch preview was also verified through an authenticated session without `fixture=1`: all 44 approved tab states loaded through the canonical application, desktop workspace/property/audit screenshots were captured, no iframe was present and the audited page produced no console warnings or errors.
