# Claritude Stage 1 reference-parity repair

## Baseline and cause

- Repair branch: `repair/stage1-reference-parity`
- Worker version preview URLs are explicitly enabled; repair builds remain outside production traffic until promotion.
- The build patches the Vite plugin's generated deploy config so Cloudflare receives the `preview_urls` flag instead of silently dropping it.
- Rejected production baseline: `6365b65312dea5e29a27683dda2aba6ca7e4dca9`
- Authoritative visual source: the supplied `HTML reference pack.zip` (`index.html`, CSS, interaction code, and supplied brand assets).
- Root cause: the original React implementation used a generic dark application shell and broad placeholder components instead of translating the supplied 50px header, 270px light sidebar, compact type scale, flat metric rows, thin tab underline, bordered panels, and page-specific interaction model.
- Data policy: the HTML pack's fictional figures are used only by the local development fixture (`?fixture=1` and `import.meta.env.DEV`). Production views use authenticated API data and explicit empty/partial states.

## Shared visual contract

| Reference element | Repaired implementation | Verification |
| --- | --- | --- |
| 50px continuous header | `.top` with workspace, property selector, centred page title, Claritude logo | Computed height: 50px |
| 270px light sidebar | Sticky white sidebar with supplied nav order and user strip | Computed `--side`: 270px |
| Compact typography | 12px base, 15px page title, 23px metric values | Computed metric value: 23px |
| Compact content rhythm | 20px/22px content padding, 14px panel gaps | Browser-computed padding confirmed |
| Flat metric row | Four metrics separated by vertical rules | Present on overview, uptime, analytics, portfolio |
| Thin underlined tabs | Stateful `role=tab` controls with selected state | Exercised in browser on overview and uptime |
| Bordered white panels | 10px radius, `#e4e4e7` borders, subtle shadow | Computed radius: 10px |
| Responsive sidebar/tables | Mobile media rules, off-canvas navigation, scrollable tabs/tables | CSS breakpoint implemented at 760px |

## Page and interaction parity matrix

| Page | Reference tabs / surfaces | Repaired status | Live behaviour |
| --- | --- | --- | --- |
| All properties | Properties, Traffic, Incidents, Reports, Members | Implemented | Search filters real properties; Add property posts to `/api/properties`; unsupported aggregate tabs show honest empty states |
| Property overview | Overview, Activity, Setup | Implemented first | Real uptime, analytics, audit and tracking state; chart/empty state; setup checklist; links into audit/settings |
| Uptime | Overview, Incidents, Maintenance, Alerts, Monitor settings | Implemented | Check now queues the monitor; incident timeline uses persisted records; interval/threshold/pause persist through the monitor API; maintenance/recipient drafts are explicitly session-only |
| Audit | Overview, Findings, Checks, History, Compare | Implemented | Real audit queue and result history; evidence rows; filters; comparisons; coverage is prominent and scores are labelled partial below 80% |
| Analytics | Overview, Pages, Sources, Events, Audience, Engagement, Performance | Implemented | Real aggregate totals and observed paths; exact installation snippet; freshness; unsupported dimensions never display fictional totals |
| Reports | Quick reports, Saved reports, Schedules, Branding | Implemented | Real report endpoint powers previews; schedules are explicitly unavailable rather than simulated |
| Property settings | General, Tracking, Uptime, Events, Sharing, Advanced | Implemented | Property name, monitor configuration and verification are live; tracking/event code can be copied; unsupported sharing/destructive actions are clearly disabled |
| Account settings | Profile, Workspace, Billing & plan, Users, Notification preferences, Activity logs, Security, Data & privacy | Implemented | Profile persistence is live; role-aware tabs; billing/invitations/destructive actions are labelled as unavailable in Stage 1 |
| Authentication | Login, registration, recovery, password update | Re-styled to reference | Existing Supabase flows preserved |
| Onboarding | Account, workspace, property | Re-styled to reference | Existing atomic onboarding RPC preserved |

## Browser verification

- Local visual fixture: `http://127.0.0.1:5173/overview?fixture=1`
- Viewport visually inspected at 2560×1305.
- Property overview screenshot captured during browser verification.
- Computed reference measurements confirmed: header 50px, sidebar 270px, content padding 20px 22px, metric value 23px, panel radius 10px.
- Navigation verified for Overview, Uptime, Audit, Analytics, Reports, Property settings, and Account settings.
- Tab state verified on Overview and Uptime; all page-specific tab sets were enumerated after their rendered headings became visible.
- Browser console: no warnings or errors.

## Automated verification

- `npm run check`: passed.
- `npm run build`: passed.
- `npm test`: 2 files, 5 tests passed.
- `git diff --check`: passed.

## Honest Stage 1 limitations

- The current analytics RPC returns aggregate pageviews, total events, and unique paths only. Source, audience, engagement and performance breakdowns remain explicit empty states.
- Maintenance-window and alert-recipient controls are session-local drafts until their API routes are added; the UI says this directly.
- Report scheduling, invitations, billing operations, account export and destructive account/property controls are not enabled.
- Audit category score splits are not produced by the current engine. The UI shows the overall score, evidence and coverage without inventing category figures.

## Rollback

Production is not changed by this branch. If a later promotion must be rolled back, redeploy baseline commit `6365b65312dea5e29a27683dda2aba6ca7e4dca9` (the pre-repair state).
