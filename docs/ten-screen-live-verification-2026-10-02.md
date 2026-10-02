# Ten-screen live verification — 2 October 2026

## Preview under test

- Alias: <https://repair-stage1-reference-parity-claritude-app.morning-sea-c704.workers.dev>
- Worker version: `caed5651-8ad6-4eb3-9361-d1c9ca5d4e90`
- Property: Websi (`9de38e48-57d8-4b17-820a-b9eedaf63f65`)
- Authenticated verification: normal application URLs, with no `fixture=1`.
- Production route: unchanged.

## Reference-versus-live result

| Reference | Authenticated route/state | Result |
| --- | --- | --- |
| `Analytics .png` | `/analytics`, 3 Sep–2 Oct | Approved KPI/panel order restored; 13 genuine pageviews, 0 key events, unknown legacy visitor identity shown as unavailable. |
| `Pages.png` | `/analytics?analyticsTab=Pages` | Approved bars/columns/toolbar restored; genuine paths total 13 pageviews; top-five plus one genuine grouped remainder. |
| `Sources.png` | `analyticsTab=Sources` | 12 Direct/unknown and 1 Other referral reconcile to 13 pageviews; no fake recognised sources. |
| `Events.png` | `analyticsTab=Events` | Approved reporting layout retained with a genuine zero-state and complete create/setup controls. |
| `Audience.png` | `analyticsTab=Audience` | Four approved panels retained; Mobile 85%, Desktop 15%; Unknown country remains explicit. |
| `Engagement.png` | `analyticsTab=Engagement` | Approved structure retained; legacy rows without `view_id` show unavailable rather than fabricated engagement. |
| `Performance.png` | `analyticsTab=Performance` | Approved metric positions and chart retained; no field samples, so all metrics are explicitly insufficient/unavailable. |
| `Uptime.png` | `/uptime`, 3 Sep–2 Oct | Persisted checks, response chart/daily blocks and lower cards restored. Manual live check: HTTP 200, 515 ms. |
| `Audit.png` | `/audit`, 3 Sep–2 Oct | Partial grade, 2/6 category coverage and pending lab capability shown honestly. |
| `Audit detail.png` | Canonical fixture interaction state | Approved expanded accordion verified through the same React component; latest live run had no actionable finding, so none was fabricated. |

Browser captures were taken during verification for live Analytics Overview, Pages with the filter menu open, live Audit Overview, and the 390×844 canonical Pages layout. The remaining live tabs were inspected in the same authenticated browser session at the reference viewport.

## Metric definitions

- **Pageviews:** count of accepted `analytics_events.event_type = 'pageview'` in the selected property/date/filter scope.
- **Key events / Page Events:** count of `click`, `outbound` and confirmed `form_success` only. Scroll, active-time, web-vital, error and pageview signals are excluded. On Pages, a key event is attributed to its normalized recorded path.
- **Avg daily visitors:** mean daily count of distinct bounded anonymous session IDs. If the scoped records predate that signal, the value is unavailable.
- **Source:** mutually exclusive category derived in order from explicit source/UTM source/referrer; direct/unknown is its own category and all residual recognised/unrecognised referrals fall into exactly one category.
- **Audience shares:** dimension pageviews divided by scoped pageviews. They are not labelled unique visitors.
- **Engaged pageview:** a `view_id` with at least one of: 25% scroll, 10 seconds bounded foreground active time, or a key event. Engagement rate is engaged pageviews divided by correlated eligible pageviews.
- **Median scroll depth / active time:** medians across correlated view IDs; key-event pageviews are deduplicated by view ID.
- **Performance:** LCP, INP and CLS use the 75th percentile. A metric is unavailable below 75 samples. Good experiences uses only view IDs carrying all three metrics and is unavailable below the same eligible-population threshold.
- **Uptime availability:** successful non-maintenance checks divided by eligible checks. Average, median and P95 response time use successful checks only. Estimated downtime is the sum of durations of genuine resolved incidents in the selected period.
- **Audit score:** shown as complete only when run coverage is at least 80% and all six approved category positions have evidence.

## Filter behaviour verified

| Case | Result |
| --- | --- |
| Unfiltered Pages | Root 8 plus five one-view paths; sixth one-view path grouped as Other; total 13. |
| Page search `articles` | One `/articles/` row, 1 pageview, 0 events. |
| Exact path `/` | Root only, 8 pageviews. |
| Prefix `/why` | One matching long-form page after correcting trailing-slash canonicalisation. |
| Device + source + country | Mobile + Direct/unknown + Unknown returned five genuine paths totalling 11 pageviews. |
| Impossible combination | Explicit “No matching page results”; stale unfiltered rows removed. |
| Remove one filter | URL and result scope retained the remaining filters. |
| Clear all | Filter parameters removed and the unfiltered root row returned. |
| Date window ending 30 Sep | Explicit “No pageviews in this period”. |
| External root link | `https://websi.com/`; grouped Other is not a homepage link. |

## Backend evidence

- Migrations `20261002120000` (`engagement_signals`) and `20261002123000` (`event_definition_match`) are recorded in `private.app_migrations`.
- `event_definitions.match_settings` is present as non-null `jsonb` with an object constraint.
- Manual uptime action persisted an HTTP 200 check with a 515 ms response and immediately updated the Latest check panel.
- Pre-fix scheduler evidence over six hours: 37 checks; average gap 9.71 min, median 10.00 min, maximum 10.30 min. Root cause was the cron/due-time boundary. The preview contains the bounded due-horizon correction, but preview versions do not receive the production cron trigger.
- Genuine audit action completed. Checks tab reported: catalogue 306; implemented 16; snapshot 16; attempted 16; successfully executed 16; passed 15.
- Genuine analytics ingestion is visible as 13 scoped pageviews across six explicit paths plus the grouped remainder. No key-event, correlated engagement or field-vital record exists in the tenant for this window.

## Validation

- `npm run check` — pass.
- `npm test` — 11/11 pass across three test files.
- `npm run build` — pass.
- Responsive check — 390×844 pass; toolbar, headers, bars, values and links remain usable.

## Exact remaining blockers

1. The scheduler fix cannot be observed on the branch preview because Cloudflare preview versions do not receive production cron traffic. Production promotion was expressly excluded pending acceptance.
2. There was no real incident during verification, so incident opening/recovery and down/recovery email delivery are not described as verified.
3. Existing live pageviews predate the new `view_id`, scroll, active-time and field-vital collector. Engagement and performance remain unavailable until genuine post-change signals are collected after an accepted tracker deployment.
4. A live configured event was not created just for evidence because the current API has no delete endpoint; doing so would leave a fictional production definition.
