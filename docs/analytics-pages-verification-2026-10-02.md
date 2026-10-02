# Analytics Pages verification — 2 October 2026

Scope: Analytics → Pages and the shared table, filter-menu and period controls required by that tab. This is not an application-wide completion report.

## Reference inspection

The authoritative implementation is `claritude-reference-pack/html-reference-extracted/index.html`:

- `analyticsPages()` supplies the three-column Page / Pageviews / Events table.
- `barTable()` renders the first-cell background at `max(4, value / max * 92)%`.
- `.bar-table`, `.bar-cell` and `.bar-bg` define the pale grey bar, inset and row geometry.
- `sectionFilters()` supplies Add filter, removable chips, Clear all and the right-aligned scope note.
- The reference filter menu uses the “Search values…” field and the five Pages categories.
- `showGroupedPages()` proves that “Other grouped pages” is the sum of real lower-volume rows and opens their breakdown.
- The responsive reference keeps a 360 px minimum table and moves the filter scope note onto its own line.

The live component previously used a generic four-column table, permanent page-search input, per-row overflow buttons and a single cycling device button. It also sent a derived day count instead of the selected date bounds and counted every telemetry row as a Page-row Event.

## Implemented metric definitions

- **Pageviews:** count of persisted `analytics_events` rows whose `event_type` is exactly `pageview`, grouped by normalized path.
- **Pages-table Events:** count of configured/key interactions (`click`, `outbound`, `form_success`) on the normalized path. Scroll depth, active-time samples, web-vital samples and pageviews do not increment this column.
- **Analytics overview Events:** remains the count of all accepted telemetry records; this separate metric was not redefined.
- **Path grouping:** absolute URLs are reduced to their pathname, repeated separators are collapsed, `/` remains `/`, and every other path receives one trailing slash.
- **Other grouped pages:** top five paths remain visible; every lower-volume path is summed into the displayed Other row and remains inspectable in the modal.
- **Date bounds:** explicit `from` and `to` are passed to the API. The server includes `from 00:00:00.000Z` through `to 23:59:59.999Z`, with a maximum 90-day span.
- **Property isolation:** the analytics query always includes the requested `property_id`; authenticated database RLS additionally requires property access.

## Deterministic canonical-component checks

The fixture adapter supplied controlled data to the production React components; there is no alternate fixture page tree.

| Check | Result |
|---|---|
| Default table | PASS — reference rows, three columns, proportional bars and 2,670 Other total |
| Page search `services` | PASS — only `/services/` (6,320 / 72) |
| Exact path `/work` | PASS — normalized to `/work/`, one row |
| Prefix `/work` | PASS — normalized prefix and matching row |
| Device `desktop` | PASS — `/`, `/services/`, `/work/`, `/privacy/` |
| Device + Source + Country | PASS — desktop + Google + GB returned `/` and `/services/` |
| Individual removal | PASS — removing Source retained Device and Country and restored four rows |
| Reset | PASS — cleared all filter query parameters and restored default rows |
| Reload/navigation | PASS — active filter chips and rows survived reload from URL state |
| Empty result | PASS — old rows were removed and “No matching page results” was shown |
| Grouped pages | PASS — modal listed `/privacy/`, `/terms/`, `/about/`, `/video/` |
| External links | PASS — paths resolve against the selected property URL |
| Date dialog | PASS after repair — 1–30 Sep to 15–30 Sep updated the URL and period chip |
| Narrow layout | PASS at 520 × 800 — responsive toolbar, horizontally safe table and readable rows |

The worker unit test also combines prefix, device, source and country filters against controlled event records and checks exact-path/trailing-slash normalization.

## Genuine data evidence

A read-only query against the production Supabase project for `websi.com`, restricted to the last 30 days, returned 13 records. Every record had `event_type = 'pageview'`; no configured/key interaction record exists in that period. The genuine paths were:

- `/`: 8 pageviews (7 mobile, 1 desktop)
- `/articles/`: 1 mobile pageview
- `/we-tried-letting-ai-design-a-brand-heres-what-happened/`: 1 mobile pageview
- `/why-a-websi-retainer-is-the-smartest-move-for-your-website/`: 1 mobile pageview
- `/figma-sites-a-bold-move-but-its-no-replacement-for-professional-web-development/`: 1 mobile pageview
- `/claritude-verification-ff264f9`: 1 desktop pageview, source `claritude-deployment-check`, country `GB`

This explains the old defect: its Events column matched Pageviews because it incremented for every record. Under the repaired definition the same period is 13 Pageviews and 0 Pages-table Events. Historical country values are genuinely absent for 12 records and remain `Unknown`; no country values were invented.

## Automated checks

- `npm run check`: PASS
- `npm test`: PASS — 3 files, 10 tests
- `npm run build`: PASS
- `git diff --check`: PASS before commit

## Changed and removed

- `src/react-app/RecoveryDashboard.tsx`: canonical Pages bar table, grouped rows, complete filter flow, URL persistence, loading/empty/error states, exact date-query propagation and date-dialog stale-value fix.
- `src/react-app/styles.css`: reference bar-table, toolbar, filter menu, chips, column proportions and responsive rules.
- `src/worker/index.ts`: composed Pages filters, available values, path normalization, corrected metric aggregation and truncation disclosure.
- `src/worker/index.test.ts`: Pageviews-versus-Events, path normalization and composed-filter coverage.
- Removed the permanent Pages search field, device-cycle implementation, generic fourth table column, Pages row overflow actions and the previous every-record event increment.

## Blocker

Commit `8ea02fe` exists locally on `repair/stage1-reference-parity`. External code egress to `github.com/Websicom/claritude-app` was not authorized by the execution policy, so the commit was not pushed and the repaired code has not yet been exercised in the authenticated branch deployment. The existing authenticated deployment was used only to confirm genuine stored rows; it still runs the superseded implementation. Production was not promoted.
