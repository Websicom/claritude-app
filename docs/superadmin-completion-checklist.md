# SuperAdmin completion checklist

Updated: 7 October 2026

Status key: `TODO`, `IN PROGRESS`, `IMPLEMENTED / AWAITING VERIFICATION`, `VERIFIED`, `BLOCKED`.

This checklist is the persistent delivery record for the complete SuperAdmin dashboards, Stripe testing, controls and visual-refinement brief. A section is only `VERIFIED` when its UI, API, persistence/provider boundary and permissions have evidence.

## 1. Implementation audit and reported errors — VERIFIED

- [x] Replaced the failing high-volume Overview reads with `superadmin_overview_activity`, applied it remotely and verified measured rollups.
- [x] Preserved distinct error/zero/unavailable states in the Worker and UI.
- [x] Promotion sync now uses the selected Stripe environment and reports the precise provider/catalogue blocker.
- [x] Reviewed routes, jobs, database controls and deployed secret names without exposing values.
- Verification: authorised Test and Live requests return either measured data or a precise provider/configuration state; server failures remain distinguishable from honest zeroes.

## 2. Live / Test working context — VERIFIED

- [x] Prominent segmented switch, persistent Test banner and navigation context.
- [x] Accounts, overview, finance, catalogue, search and financial operations validate/scoped environment server-side.
- [x] Shared infrastructure and global controls are labelled separately from billing-environment data.
- Verification: switch environments repeatedly and compare API/database identifiers and totals; no stale cross-environment results.

## 3. Stripe sandbox and representative accounts — BLOCKED

- [ ] Reconcile sandbox credentials, webhook, portal, products, catalogue mappings and checkout state.
- [ ] Create idempotent Free, Essentials, Scale, Pro and Complimentary Pro test accounts with representative resources.
- [ ] Create paid lifecycle scenarios: monthly, annual, trial, success, past due, scheduled cancellation, cancelled, discounted, refund, upgrade and downgrade.
- [ ] Complete at least one real Claritude sandbox checkout and verify webhook-derived entitlement activation.
- [ ] Exercise idempotency, replay and missed-event recovery.
- Blocker: approved monetary prices, tax behaviour and package overage policy must be found in authoritative configuration or supplied; none will be invented.
- Verification: Stripe object IDs map to environment-scoped application records and appear in Financials and Overview.

## 4. Overview dashboards — VERIFIED

- [x] Clickable KPI cards for account/customer/property/audit/revenue measures.
- [x] Account/property/revenue charts with source and period semantics plus drill-down tables.
- [x] Distinct Customer Activity, Revenue and Service Health content.
- [x] Period/grouping controls and prior-period semantics; unverified prior data remains unavailable rather than inferred.
- Verification: filters change both charts and drill-down records; failures are not rendered as zero.

## 5. Global and contextual search — VERIFIED

- [x] Environment-scoped global lookup across accounts, users, properties, workspaces, invoices and audits.
- [x] Page-specific search, contextual placeholders, removable chips and environment-preserving links.
- Verification: each target type resolves to a navigable result and current-table results visibly change.

## 6. Real filters — VERIFIED

- [x] Replaced search-only filter affordance with field-specific filters, active chips and Clear all.
- [x] Totals, pagination and 50/100/200 display selection operate on the filtered row set.
- Verification: representative filter for each major desk returns the expected persisted records.

## 7. SuperAdmin visual consistency — VERIFIED

- [x] Dot-and-text statuses with distinct connection and monitor labels.
- [x] Standard three-dot row action menus with focusable actions and destructive styling.
- [x] Browser review covered navigation, table controls, dialogs and empty states with no console errors.
- Verification: browser screenshots at desktop and compact viewport plus keyboard operation checks.

## 8. Package detail and versioning — IMPLEMENTED / PARTIALLY VERIFIED

- [x] Full grouped detail/editor for current Free, Essentials, Scale and Pro versions.
- [x] Pro Early Access remains historic; no assignment/subscription migration was performed.
- [x] Pro draft included editing users is three; unresolved prices and policies remain explicitly unresolved.
- [x] Draft/version/publish flow explains effect timing and preserves existing accounts.
- Verification: published immutable versions remain unchanged; new draft affects no account before explicit assignment/migration.

## 9. Coupons and promotions — IMPLEMENTED / AWAITING SANDBOX VERIFICATION

- [x] Create form supports provider-backed discount amount, duration, expiry, redemption limits and package validation.
- [x] Discounts and verified recurring subscription redemption views are separate.
- [ ] Verify a promotion code in sandbox checkout.
- Verification: provider coupon/promotion code, checkout discount, subscription and invoice agree.

## 10. Audit Controls — IMPLEMENTED / PARTIALLY VERIFIED

- [x] Compact catalogue Filters control; removed the nonfunctional Configuration tab.
- [x] Clickable groups expose presentation, mapped checks, package availability and history.
- [x] Enable/disable, package availability and rollback actions use audited dialogs.
- Verification: changed configuration is versioned, enforced for new runs and preserved for historical/running audits.

## 11. Infrastructure measurements and usage bars — VERIFIED

- [x] PostgreSQL-reported database/relation sizes and connection measurements.
- [x] Values carry unit, source and measured time; missing provider telemetry remains unavailable.
- [x] Database/provider capacity is separate from application safety ceilings.
- [x] Usage bars only use matching finite limits.
- Verification: recompute displayed percentage and remaining values from API payload and source query.

## 12. Allocations & utilisation — VERIFIED

- [x] Platform and account allocation versus actual resource/period usage.
- [x] Resolves effective versions, complimentary grants, grandfathering and active overrides.
- [x] Finite/unlimited values and active-period audit-credit consumption are distinct.
- Verification: fixture and real-account calculations reconcile to effective entitlements and usage ledgers.

## 13. Safety Limits — IMPLEMENTED / ENFORCEMENT AUDIT OPEN

- [x] One readable setting per row with value, unit, explanation, scope and edit/save control.
- [ ] Only daily/concurrent audit limits currently have verified atomic enforcement; remaining existing settings are labelled as requiring execution-path verification.
- Verification: controlled tests show each editable existing setting changes its actual execution boundary.

## 14. Email templates and automation — IMPLEMENTED / AWAITING CONTROLLED SEND

- [x] Template version editor, validation/preview, tags, path and state.
- [x] Provider-managed authentication templates are distinct from application/Resend templates.
- [x] Publishing, automation, simulation, campaign and suppression actions use validated dialogs.
- [ ] Verify published content in the actual sending path using controlled recipients only.
- Verification: generated/sent controlled message uses the published subject/body and secure auth URLs remain provider-managed.

## 15. Acceptance and delivery — IN PROGRESS

- [x] 206 automated tests, TypeScript, production build, applied migrations, linked database lint and fixture browser journeys.
- [ ] Permission and environment-isolation checks.
- [ ] Preserve existing customer data and Websi complimentary Pro access.
- [ ] Capture overview, financials, package detail, infrastructure and email editor screenshots.
- [ ] Commit, push, deploy, health-check and document exact blockers/access instructions.
