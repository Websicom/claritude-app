# Canonical interface verification — 2 October 2026

This record covers the removal of the split between the approved reference and
the authenticated application. It deliberately distinguishes implementation,
persisted evidence and workflows that could not yet be proven end to end.

## Canonical frontend

- `App.tsx` mounts `ClaritudeApplication` for authenticated and deterministic
  visual-test modes.
- `reference.html` is not imported, embedded or linked by the application. It
  remains comparison material only.
- Both modes use the same routes, navigation, tabs, menus, dialogs, tables,
  charts, responsive CSS and page components.
- Deterministic mode supplies fixture data at the bootstrap/API-adapter boundary
  and prevents production writes when no authenticated session exists.
- Live Mobile and Desktop health scores derive from collected Core Web Vitals.
  Live SEO derives from executed audit results. Missing samples render a pending
  state and an audit without that capability renders “not implemented”; neither
  path substitutes demo numbers.

## Local verification

- `npm run check`: passed.
- `npm test`: 9/9 tests passed across three test files.
- `npm run build`: passed for Worker SSR and client bundles.
- Legacy iframe implementation, `.reference-fixture` styles and the alternative
  static chart implementation: removed.

## Persisted production evidence inspected read-only

The Supabase production project was queried on 2 October 2026.

| Workflow | Evidence | Status |
| --- | --- | --- |
| Scheduled uptime | 65 persisted checks; 64 successful and 1 failed; latest check at 2026-10-02 10:01:12 UTC | Scheduled execution and persistence evidenced |
| Incident open/recovery | No incident rows exist | Not end-to-end verified |
| Analytics ingestion | 13 persisted pageviews; latest received at 2026-10-02 08:44:14 UTC; property marked as receiving tracking | Pageview ingestion evidenced |
| Core Web Vitals | 0 persisted web-vital events | No genuine performance sample available; UI must remain pending |
| Audit execution | 5 historical partial runs, each with 306 rows: 15 pass and 290 `unable_to_test`; one remaining result is informational | Historical runner executed a 15-check subset; 306 working checks is disproven |
| Reports | 0 saved reports and 0 report schedules | Not end-to-end verified |
| Notification delivery | 10 delivery rows marked sent and 0 failed | Persisted provider-send state evidenced; inbox receipt was not re-proven in this pass |
| Settings | One verified property with persisted update and live tracking state | Data exists; each settings mutation still requires UI-level verification |

The corrected worker snapshots only the 16 registry entries whose current
implementation status is `implemented`. A post-deployment run is still required
to produce evidence using that corrected accounting.

## Remaining blockers / unverified work

- Authenticated screenshots of the corrected branch require either a session on
  that branch origin or test credentials. A fixture screenshot does not satisfy
  this requirement.
- The tenant-isolation harness requires `SUPABASE_SECRET_KEY`; that credential is
  not present in the local environment and no result is claimed.
- Signup/reset email delivery requires controlled recipient access. Persisted
  delivery rows alone do not prove inbox receipt.
- Incident opening/recovery requires an isolated controllable target. No
  production incident was manufactured.
- Report generation and schedule delivery have no persisted production records.
- Browser/lab performance auditing is not implemented by the current source-only
  runner.

Production promotion remains explicitly out of scope until these items are
closed or accepted as documented limitations.
