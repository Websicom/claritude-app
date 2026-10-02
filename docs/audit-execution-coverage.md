# Audit execution and scoring contract

The authoritative active catalogue contains 306 stable check identifiers across 16 detailed categories and six score categories.

The audit worker currently has reliable executable logic for 213 checks. It combines source/header analysis with bounded public-network collection for redirects, canonical targets, robots.txt, sitemaps, DNS records and optional AI resources. The remaining 93 entries stay in every full-run snapshot and are persisted as `unable_to_test` with an evidence-backed reason; they are never converted to passes or silently omitted.

Current implementation coverage by declared collection method:

| Collection method | Catalogue | Executable now | Capability gap |
| --- | ---: | ---: | ---: |
| Source HTML | 169 | 138 | 31 |
| Network | 95 | 63 | 32 |
| Rendered browser | 28 | 2 | 26 |
| DNS | 11 | 10 | 1 |
| Lab | 3 | 0 | 3 |
| **Total** | **306** | **213** | **93** |

Current implementation coverage by score category:

| Score category | Catalogue | Executable now |
| --- | ---: | ---: |
| SEO | 122 | 97 |
| Accessibility | 62 | 29 |
| Performance | 28 | 6 |
| Security | 23 | 16 |
| Infrastructure | 31 | 29 |
| AI Readiness | 40 | 36 |

The two checks declared as rendered-browser checks that execute today use reliable source evidence and do not claim browser-rendered evidence.

## Outcomes and denominators

- `pass`, `warning`, and `fail` are scored outcomes. Weighted score is `sum(outcome value × check weight) / sum(scored check weights)`, where pass is 1, warning is 0.5, and fail is 0.
- `informational` and `not_applicable` are successfully executed, but excluded from the score denominator.
- `unable_to_test` is neither executed nor scored and never counts as a pass.
- Coverage is `(all persisted outcomes except unable_to_test) / snapshotted checks`.
- The Checks pass rate is `passed / (passed + warnings + failures)`. Informational, not applicable, and unable-to-test results are excluded.
- Review status is independent of outcome and may overlap any outcome.

## Check-by-check register

Run `npm run audit:coverage` for the JSON register, `npm run audit:coverage -- --csv` for CSV, `npm run audit:coverage -- --summary` for compact totals, or `npm run audit:coverage -- --gaps` for the remaining capability gaps. The authenticated endpoint `/api/properties/:propertyId/audit-coverage?runId=:runId` adds the actual persisted outcome, execution duration, and inability reason for a selected run.

The register includes each stable identifier, title, detailed category, score-category mapping, scope, collection method, enabled state, implementation status, versions, and capability-gap reason.
