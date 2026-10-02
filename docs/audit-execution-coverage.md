# Audit execution and scoring contract

The authoritative active catalogue contains 306 stable check identifiers across 16 detailed categories and six score categories.

The source/header evaluator currently has reliable executable logic for 126 checks. The remaining 180 entries stay in every full-run snapshot and are persisted as `unable_to_test` with an evidence-backed reason; they are never converted to passes or silently omitted.

Current implementation coverage by declared collection method:

| Collection method | Catalogue | Executable now | Capability gap |
| --- | ---: | ---: | ---: |
| Source HTML | 169 | 90 | 79 |
| Network | 95 | 34 | 61 |
| Rendered browser | 28 | 2 | 26 |
| DNS | 11 | 0 | 11 |
| Lab | 3 | 0 | 3 |
| **Total** | **306** | **126** | **180** |

The two checks declared as rendered-browser checks that execute today use reliable source evidence and do not claim browser-rendered evidence.

## Outcomes and denominators

- `pass`, `warning`, and `fail` are scored outcomes. Weighted score is `sum(outcome value × check weight) / sum(scored check weights)`, where pass is 1, warning is 0.5, and fail is 0.
- `informational` and `not_applicable` are successfully executed, but excluded from the score denominator.
- `unable_to_test` is neither executed nor scored and never counts as a pass.
- Coverage is `(all persisted outcomes except unable_to_test) / snapshotted checks`.
- The Checks pass rate is `passed / (passed + warnings + failures)`. Informational, not applicable, and unable-to-test results are excluded.
- Review status is independent of outcome and may overlap any outcome.

## Check-by-check register

Run `npm run audit:coverage` for the JSON register or `npm run audit:coverage -- --csv` for CSV. The authenticated endpoint `/api/properties/:propertyId/audit-coverage?runId=:runId` adds the actual persisted outcome, execution duration, and inability reason for a selected run.

The register includes each stable identifier, title, detailed category, score-category mapping, scope, collection method, enabled state, implementation status, versions, and capability-gap reason.
