# Claritude package allowances

Last reconciled: 9 October 2026  
Code revision: updated with the allocation-capacity correction on 9 October 2026

This document records the package configuration currently represented by the production database migrations and enforced by the application. It is a reference for checking and approving future package changes; the database remains the runtime source of truth.

## Source-of-truth order

Effective access is resolved in this order:

1. An active account package grant, if present.
2. The account's current package assignment.
3. Active account entitlement overrides, applied by key.
4. The package version's allowances, features, retention values and hard ceilings.
5. Global emergency controls and platform safety ceilings, which may temporarily restrict a capability without changing the package.

Analytics quotas and analytics retention are enforced from `analytics_plan_rules` and projected into `package_versions` for display. Account overrides can therefore make an individual account differ from the standard values below.

## Public packages

All four public packages are version 1 and currently `published`.

| Allowance | Free | Essentials | Scale | Pro |
|---|---:|---:|---:|---:|
| Properties per account | 2 | 5 | 50 | 200 |
| Workspaces per account | 1 | 3 | Unlimited | Unlimited |
| Included editing users | 1 | 1 | 2 | 3 |
| Audit pages per property | 2 | 5 | 15 | 25 |
| Audit credits per week, pooled across the account | 10 | 25 | 100 | 250 |
| Custom analytics event definitions per property | 2 | 5 | 10 | 25 |
| Uptime alert contacts per property | 1 | 2 | 5 | 10 |
| Fastest uptime check interval | 15 minutes | 5 minutes | 2 minutes | 1 minute |
| Tracked pageviews per UTC month, pooled across the account | 10,000 | 100,000 | 1,000,000 | 5,000,000 |
| Pageview grace above the nominal allowance | 0% | 5% | 5% | 5% |
| Enforced pageview hard stop including grace | 10,000 | 105,000 | 1,050,000 | 5,250,000 |

`Unlimited` workspaces are stored as JSON `null`. This is intentional and does not mean the value is missing. In the SuperAdmin allocation-capacity view only, Scale is capped at 50 workspaces and Pro at 200 workspaces so a maximum-property account cannot imply more workspaces than properties. This does not change customer-facing package wording or enforcement.

The pageview grace is applied by the ingestion function before analytics collection is paused. Warnings are recorded when usage crosses 70%, 80%, 90% and 100% of the nominal allowance, with a further hard-limit event when the grace ceiling is reached.

## Package-specific analytics retention

| Retention layer | Free | Essentials | Scale | Pro |
|---|---:|---:|---:|---:|
| Detailed analytics events | 30 days | 30 days | 30 days | 30 days |
| Hourly analytics rollups | 30 days | 30 days | 30 days | 30 days |
| Exact daily rollups | 13 months | 36 months | 60 months | 84 months |
| Exact monthly rollups | 24 months | 60 months | 84 months | Account lifetime |
| Yearly rollups | Account lifetime | Account lifetime | Account lifetime | Account lifetime |

At the pageview hard cap, only analytics ingestion is paused. The rest of the account remains available.

## Complimentary access

`pro_early_access` version 1 is still a published internal/legacy package named **Pro early access**. It is excluded from the normal public package list, but remains available for historical grants.

Its standard allowances currently mirror Pro:

- 200 properties
- Unlimited workspaces
- 3 included editing users
- 25 audit pages per property
- 250 audit credits per week
- 25 custom event definitions per property
- 1-minute minimum uptime interval
- Pro analytics quotas and retention
- Feature flag: `complimentaryEarlyAccess: true`

Websi and Claritude each have a permanent complimentary grant to the published standard Pro package. Neither grant has an account-specific allowance override, so both receive the full standard Pro allowances. The grants do not create, change or cancel Stripe subscriptions. Websi's former `propertiesPerAccount: 25` legacy override is revoked as part of the replacement grant.

## SuperAdmin allocation-capacity arithmetic

The allocation view reports the maximum configured customer capacity, not physical infrastructure capacity. Per-property allowances are multiplied by each account's effective maximum property allowance. Audit credits are shown as a four-week equivalent so the displayed period matches the sum of four weekly allowance windows. Analytics events use the global safety ceiling of 50,000 accepted events per property per UTC day and are not presented as a monthly package allowance.

For the current live mix of two Free accounts and two complimentary Pro accounts, the expected totals are:

| Resource | Calculation | Expected allocation |
|---|---:|---:|
| Properties | `(2 × 2) + (2 × 200)` | 404 |
| Workspaces, capacity-view cap | `(2 × 1) + (2 × 200)` | 402 |
| Included editing users | `(2 × 1) + (2 × 3)` | 8 |
| Tracked pageviews / month | `(2 × 10,000) + (2 × 5,000,000)` | 10,020,000 |
| Analytics events / UTC day ceiling | `404 × 50,000` | 20,200,000 |
| Custom event definitions | `(2 × 2 × 2) + (2 × 200 × 25)` | 10,008 |
| Audit pages | `(2 × 2 × 2) + (2 × 200 × 25)` | 10,008 |
| Uptime alert contacts | `(2 × 2 × 1) + (2 × 200 × 10)` | 4,004 |
| Audit credits / 4 weeks | `(2 × 10 × 4) + (2 × 250 × 4)` | 2,080 |

## Billing and commercial configuration

- Free has no paid Stripe price.
- Live prices for Essentials, Scale and Pro are not approved/configured as complete production catalogue values.
- Live checkout remains disabled.
- No package currently enables `billableAdditionalEditingSeats`; only the included editing users above can be selected in the sandbox base-subscription scenario.
- Additional-seat eligibility, pricing and billing rules remain unresolved.
- Live tax configuration remains unresolved.
- Property-viewer allowances remain unresolved for every package.
- The package records still carry a broader `retention` unresolved marker even though the analytics retention layers above are configured. Non-analytics/package-level retention policy needs an explicit commercial/product decision before that marker should be cleared.
- Package feature maps are otherwise empty; capabilities such as audits, analytics, uptime and reports currently rely on allowances and global service controls rather than tier-specific feature flags.

The unresolved markers currently expected on the package versions are:

| Package | Unresolved markers |
|---|---|
| Free | `propertyViewers`, `retention` |
| Essentials | `price`, `propertyViewers`, `retention` |
| Scale | `price`, `propertyViewers`, `retention` |
| Pro | `price`, `propertyViewers`, `retention` |
| Pro early access | `futurePrice`, `propertyViewers`, `retention` |

### Test-only Stripe catalogue fixtures

These are isolated sandbox values, not approved prices or exchange-rate conversions. The same numeric amount is used separately in GBP, EUR and USD. Tax and additional paid seats are disabled in this scenario.

| Package | Monthly fixture | Annual fixture |
|---|---:|---:|
| Essentials | 1 currency unit | 10 currency units |
| Scale | 2 currency units | 20 currency units |
| Pro | 3 currency units | 30 currency units |

Test catalogue records and transactions must never be included in live revenue, customer counts or exports.

## Change procedure

When changing a package:

1. Confirm whether the change affects new customers only or existing assignments too.
2. Create a new immutable package version instead of rewriting historical commercial terms.
3. Update `analytics_plan_rules` when changing properties, pageviews, grace or analytics retention.
4. Add or update verified Stripe catalogue mappings separately from entitlement changes.
5. Keep Test and Live catalogue records isolated.
6. Review account grants and overrides, especially the permanent complimentary Pro grants for Websi and Claritude.
7. Run entitlement, checkout and usage-limit tests before publishing and deploying.

## Implementation references

- `supabase/migrations/20261009123000_publish_pro_and_correct_plan_allowances.sql`
- `supabase/migrations/20261009130000_correct_allocation_capacity_and_complimentary_pro.sql`
- `supabase/migrations/20261007211210_analytics_retention_rollups_and_limits.sql`
- `supabase/migrations/20261008152841_fix_free_account_provisioning.sql`
- `supabase/migrations/20261006092610_grant_websi_permanent_complimentary_pro.sql`
- `src/worker/index.ts`
