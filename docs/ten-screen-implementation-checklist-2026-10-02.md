# Ten-screen implementation checklist — 2 October 2026

The original extracted HTML/CSS/JavaScript and the approved portion of each supplied comparison board are the contract. Fixture and authenticated modes render the same React components; only the data adapter and safe action adapter differ.

## Shared foundations

- [x] Reference metric rows, filter menus, bar tables, charts, responsive rules, uptime panels and audit findings inspected before editing.
- [x] Shared searched/nested filter toolbar with URL persistence, removable chips, clear-all and request-specific loading/error/empty states.
- [x] Shared responsive in-cell bar tables, genuine grouped rows, icons/fallbacks and external links.
- [x] Shared current/previous time-series chart with labelled axes, units, focus/hover values and insufficient-data state.
- [x] Selected property, date window and active filters scope every analytics query and affected panel.
- [x] Authenticated and deterministic modes use the same page/component tree; deterministic actions do not write to production.

## Analytics overview — `Analytics .png`

- [x] Approved four KPIs, traffic panel, three series switches, filter toolbar, legend and context menu.
- [x] Avg daily visitors is an anonymous daily-session estimate only when a bounded session signal exists; legacy data is explicitly unavailable.
- [x] Top pages, mutually exclusive traffic sources, key events, devices and countries use genuine scoped aggregates.
- [x] Chart menu toggles comparison and exports the displayed series; filters and external page links work.

## Analytics pages — `Pages.png`

- [x] Approved three-column bar table, column proportions, row rhythm and external links; no row overflow buttons or permanent search box.
- [x] Search, exact path, arbitrary prefix, device, source and country filters combine, remove and reset correctly.
- [x] Pageviews count only `pageview`; Events count only key interactions on the normalized page path.
- [x] Other grouped pages is the sum beyond the visible top-five rows and is inspectable rather than linked to the homepage.
- [x] Loading, empty and failed-request states do not leave stale unfiltered results.

## Analytics sources — `Sources.png`

- [x] Approved filter toolbar, source/referrer table, source icons/fallbacks, in-cell bars and dynamic reconciliation footer.
- [x] Direct/unknown, Google, LinkedIn, Instagram and Other referrals are mutually exclusive.
- [x] Source, source type, UTM source/medium/campaign, page and device filters use genuine dimensions and persist in the URL.

## Analytics events — `Events.png`

- [x] Reporting table uses Event, Count and Share rather than the configured-event management table.
- [x] Count/share use only click, outbound and confirmed form-success events in the selected scope.
- [x] Event name, page, source, device and country filters share the canonical filter flow.
- [x] Setup navigation and the complete create dialog are implemented; validated trigger settings persist in `match_settings` and produce installation instructions.
- [ ] A live definition was not created solely for verification because there is no delete endpoint and that would leave a fictional production record.

## Analytics audience — `Audience.png`

- [x] Devices, Countries, Browsers and Screen categories retain the approved order and panel structure.
- [x] Shares use pageviews as their denominator; unknown historical dimensions remain Unknown.
- [x] Device/browser/country/page filters update all four breakdowns; recognised and fallback icon mappings are present.

## Analytics engagement — `Engagement.png`

- [x] Approved KPIs, four scroll thresholds, most-engaging pages and additional insights restored.
- [x] New collection uses anonymous per-view `view_id`, 25/50/75/90 scroll milestones, bounded active time, labelled visible sections and message-free JS error signals.
- [x] Pageviews with key events are deduplicated per `view_id`; medians are not replaced by averages.
- [x] Historical records without correlation display explicit unavailable states.
- [ ] The live tenant has no post-change correlated engagement record yet; no historical value was invented.

## Analytics performance — `Performance.png`

- [x] LCP/INP/CLS positions, per-metric samples, p75 calculations, thresholds and units restored.
- [x] Good experiences requires LCP, INP and CLS on the same eligible `view_id`.
- [x] Metric filter, current/previous chart, axes, tooltip and honest 75-sample threshold are implemented.
- [ ] The live tenant has no post-change field-vital samples yet; the approved positions remain visible as insufficient data.

## Uptime overview — `Uptime.png`

- [x] Approved Online badge, four KPIs, response chart, median/P95, context menu, daily blocks and three lower cards.
- [x] Daily blocks distinguish successful, incident, suppressed and missing dates; unmonitored dates are never green.
- [x] Check now persisted an HTTP 200 check; incident/settings navigation and the related tabs/actions are wired to live APIs.
- [x] A five-minute boundary race was identified from persisted data and corrected with a bounded one-minute due horizon plus regression test.
- [ ] Preview Worker versions do not receive production cron traffic. The scheduler fix cannot be observed end to end until this version is explicitly accepted and promoted.
- [ ] No real incident opened during verification, so incident recovery and delivery of down/recovery email were not claimed as verified.

## Audit overview — `Audit.png`

- [x] Page selector, Add page, Run audit, six category positions, actionable Fix these first, filters and lab/real-user panels restored.
- [x] A score is complete only when catalogue coverage is adequate and all six approved score categories have evidence.
- [x] Live run now shows Partial (2/6 categories), rather than a green 100, while unimplemented lab metrics remain explicit.
- [x] Catalogue entries, implemented, snapshot, attempted, successfully executed and passed counts are reported separately.
- [x] A genuine run persisted 16 attempted/successfully executed checks from 306 catalogue entries and 16 implemented checks.

## Audit expanded finding — `Audit detail.png`

- [x] Approved accordion detail has severity, state/review text, explanation, bounded escaped evidence, recommendation, Re-test and authoritative Learn more.
- [x] Re-test starts a new audit without deleting prior history.
- [x] Expanded visual state verified through deterministic data in the same production component; the latest live run had no actionable finding to expand.

## Verification and handover

- [x] `npm run check`, 11 unit tests and the production build pass.
- [x] Normal authenticated preview (no `fixture=1`) inspected across all ten default screens; menus, combined filters, empty states and live actions exercised where genuine state exists.
- [x] Canonical responsive Pages layout verified at 390×844 and viewport restored afterward.
- [x] Genuine pageview ingestion is visible (13 scoped pageviews); Page Events remains zero because no key event was recorded.
- [x] Superseded analytics implementation removed; no reference iframe or second interface tree serves the live application.
- [x] Isolated preview uploaded; production promotion remains intentionally untouched.
- [ ] Post-change engagement/vital collection, scheduler cadence, incident/recovery and alert delivery require genuine future observations or explicit production acceptance.
