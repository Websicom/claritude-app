# Security and performance audit · 13 October 2026

## Scope

Claritude application, Cloudflare Worker API, Supabase schema/RLS, property deletion,
analytics and notification read paths, and the public tracker.

## Security results

- `npm audit --omit=dev --audit-level=moderate`: no known dependency vulnerabilities.
- Supabase database lint: no schema or function errors.
- Supabase security advisor: no exposed tables with RLS disabled and no critical findings.
- The five authenticated `SECURITY DEFINER` RPCs reported by the advisor are intentional
  privilege boundaries. They authenticate with `auth.uid()`, validate account/workspace
  access, use an empty search path, and do not grant execution to anonymous users.
- Overlapping permissive RLS policies were consolidated into one read policy plus
  explicit insert/update/delete policies. This keeps viewer reads and manager writes
  separate while reducing policy evaluation work.
- Supabase leaked-password protection is disabled in the hosted Auth configuration.
  This is a provider-dashboard setting and should be enabled before public launch.
- Report logos accept PNG/JPEG/WebP only, are signature checked, capped at 512 KB,
  restricted to Scale/Pro, and stored outside PostgreSQL in a dedicated bucket.

## Property deletion

Property-owned analytics, rollups, view state, uptime, incidents, audits, event
definitions, notifications, schedules, reports and memberships use `ON DELETE CASCADE`.
Operational diagnostic rows now cascade as well. Account-level usage ledgers remain:

- `account_usage_periods` retains consumed audit/page allowances.
- `account_analytics_monthly_usage` retains monthly accepted/rejected pageview totals.
- `audit_credit_reservations` may retain a trace with a null property reference.
- audit/activity administration logs retain their account history with a null property
  reference, rather than retaining property-owned measurement data.

This preserves plan-limit enforcement without retaining deleted property analytics.

## Performance findings and changes

- Workspace Overview made two requests per property. It now makes one aggregate request
  per workspace against existing daily totals and returns a compact series/property map.
- Pageviews, unique visits and events now select distinct aggregate series rather than
  changing only the control label.
- Uptime explicitly reloaded on both `focus` and `visibilitychange`. Those handlers were
  removed; explicit actions and route/date changes remain refresh points.
- Analytics/AI/workspace aggregate GETs use a five-minute in-memory cache with in-flight
  de-duplication. Relevant mutations invalidate the matching property/workspace cache.
- Notifications no longer reload the full bootstrap after marking an item read, use a
  50-row page, and refresh only the unread summary.
- Partial notification indexes cover active account, active property and archived-user
  reads.
- The tracker already batches up to 20 events, bounds its queue at 200, lazily loads Web
  Vitals and uses `sendBeacon` on page hide. Mutation work is now coalesced to one
  animation frame and the script uses short cache + stale revalidation.

## Storage and ingest impact

- Workspace aggregation reuses `analytics_compact_totals`; it adds no aggregate table,
  raw event, scheduled ingest or duplicated analytics row.
- Read caching and request consolidation reduce database reads.
- Three partial notification indexes add a modest amount of database storage. They are
  the only database-size increase in this change and are bounded by notification rows.
- Optional report logos add at most 512 KB per property to Supabase object storage, not
  PostgreSQL. No logo is stored unless a Scale/Pro user uploads one.
- No tracker event types, sampling frequency or ingestion limits were increased.

## Build measurements

- Client application entry: approximately 112 KB gzip.
- Recovery dashboard chunk: approximately 162 KB gzip.
- Country/browser visual assets remain in a lazy-loaded dimension chunk and do not block
  the initial application route.
- The Worker bundle contains browser-audit dependencies; it is server-side and is not
  downloaded by tracked websites or application visitors.

## Follow-up

Enable leaked-password protection in Supabase Auth. Continue using the SuperAdmin
storage and capacity refresh controls to watch index/database growth and aggregate-read
latency after real traffic increases.
