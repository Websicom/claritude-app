# Controlled cleanup register — 2 October 2026

Starting commit: `39d8cb67598ef6ad238d10299be764ecd8f71c78`

The working tree was clean at the start. The authenticated application and fixture mode both render `ClaritudeApplication` from `src/react-app/RecoveryDashboard.tsx`; fixture mode substitutes data and safe action behaviour without selecting another page tree.

## Baseline

- Entry points: `src/react-app/main.tsx`, `src/react-app/App.tsx`, `src/worker/index.ts`.
- Routes: the React router in `RecoveryDashboard.tsx`; authenticated bootstrap/auth routing in `App.tsx`; Hono API, tracker, queue and scheduled handlers in `src/worker/index.ts`.
- Shared UI: `Tabs`, `Panel`, `Metrics`, `DataTable`, empty states, modal/dialog primitives, charts, analytics filters and analytics tables in `RecoveryDashboard.tsx`.
- Styles: `src/react-app/styles.css`; tokens currently originate in `:root`.
- Jobs: Cloudflare queue consumer plus five-minute uptime and daily report schedule triggers in `wrangler.jsonc`/`src/worker/index.ts`.
- Tests: Vitest unit/regression tests under `src`; the SQL tenant-isolation specification under `supabase/tests` requires a configured database harness.
- Baseline gates: TypeScript passed; 3 Vitest files and 11 tests passed; production build passed. No lint command is configured.
- Baseline client assets: JavaScript 495,081 bytes, CSS 34,625 bytes. Worker bundle: 1,144,286 bytes.
- Browser baseline: authenticated workspace overview and Analytics → Pages captured at the existing branch preview and its current desktop viewport.

## Register

| Target | Evidence | Intended change | Verification |
| --- | --- | --- | --- |
| `BarRows` and `.bar-rows`/`.bar-row`/`.bar-fill` | `tsc --noUnusedLocals` reports the component as unused; no production, fixture, responsive or generated consumer exists | Remove the unreachable component and its private styles | Strict unused check, typecheck, tests, build |
| Repeated analytics bar-cell markup | The Pages, Sources and generic value tables repeat the same positioned bar calculation and markup | Extract one presentation-only `InCellBar` while retaining page-specific tables | Existing analytics tests plus authenticated visual comparison |
| Repeated core style constants | Focus colour, common control/panel radii and analytics bar fill are repeated literals | Name the existing computed values as tokens and replace only exact equivalents | Computed visual comparison at matching viewport |
| API error boundary and configured-event loading | API errors are parsed through `any`; configured-event fetch converts failures to an empty successful table and runs even when only aggregate event reporting is rendered | Parse unknown error payloads safely; add loading/error/empty states; skip the unused request | Focused tests, browser interactions and forced-error fixture/unit coverage where feasible |
| Dialog and toast lifecycle | Dialogs lack Escape/focus restoration; toast timers are not cleared when replaced or unmounted | Add keyboard/focus lifecycle and timer cleanup without markup or visual changes | Keyboard interaction in authenticated preview/local canonical UI |

## Deliberately retained

- `public/reference.html` and deterministic fixtures are design/test resources, not production page implementations.
- PNG logo duplicates are unreferenced by the current bundle, but their external/reference intent is uncertain; they are retained.
- Backend endpoints that are not directly invoked by the current screen remain because tracker, queue, cron and integration callers exist outside the visible route tree.
- Larger audit-engine, tracker and monitoring changes are outside this cleanup. The preview-only cron limitation and database-harness gap remain documented risks.
