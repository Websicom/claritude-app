import { describe, expect, it } from "vitest";
import {
  analyticsRollupPlan,
  auditOutcomeNotification,
  buildAnalyticsEventDetailSummary,
  buildAnalyticsOccurrenceContext,
  buildAnalyticsSummary,
  auditCheckHasExecutableLogic,
  canonicalPropertyHost,
  chunkAuditResults,
  compactAuditResult,
  cleanPath,
  editableWorkspaceRole,
  encodeAuditContinuationPayload,
  decodeAuditContinuationPayload,
  filterAnalyticsEvents,
  isFreshAuditRun,
  isPrivateHost,
  isProtectedAuditPagePath,
  normalizeAnalyticsPath,
  normalizePropertyRelations,
  TRACKER_SOURCE,
  uptimeDueHorizon,
  validAvatarBytes,
  validPublicUrl,
  withAuditDeadline,
  closeBrowserWithDeadline,
  workspaceDeletionError,
  renderUptimeAlertEmail,
  schemaCompatibleSharedEvidenceRows,
} from "./index";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "../shared/audit-evaluator-map.generated";

describe("worker evidence pipelines", () => {
  it("renders test alerts from the shared uptime template without implying delivery", () => {
    const html = renderUptimeAlertEmail({
      property: { id: "property-1", name: "Controlled property", url: "https://example.com" },
      incident: { opened_at: "2026-10-03T10:00:00Z", cause: "HTTP 500" },
      kind: "down",
      appOrigin: "https://app.claritude.io",
      test: true,
    });
    expect(html).toContain("TEST ALERT");
    expect(html).toContain("Controlled property");
    expect(html).toContain("https://example.com");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("/uptime?property=property-1");
    expect(html).toContain("did not create an incident");
  });

  it("emits a tracker script that browsers can parse", () => {
    expect(() => new Function(TRACKER_SOURCE)).not.toThrow();
    expect(TRACKER_SOURCE).toContain("/Chrome\\//.test");
  });

  it("uses bounded audit result batches", () => {
    expect(chunkAuditResults(Array.from({ length: 131 }, (_, index) => index), 64))
      .toEqual([
        Array.from({ length: 64 }, (_, index) => index),
        Array.from({ length: 64 }, (_, index) => index + 64),
        [128, 129, 130],
      ]);
  });

  it("keeps new evidence summaries within the deployed shared-evidence schema", () => {
    const rows = schemaCompatibleSharedEvidenceRows([
      { evidence_type: "http", summary: { status: 200 }, byte_size: 10, collection_status: "complete", error: null },
      { evidence_type: "resources", summary: { retained: 2 }, byte_size: 20, collection_status: "complete", error: null },
      { evidence_type: "alternate_origins", summary: { probes: 3 }, byte_size: 30, collection_status: "complete", error: null },
      { evidence_type: "ai_resources", summary: { resources: 2 }, byte_size: 40, collection_status: "partial", error: "rate limited" },
    ]);
    expect(rows.map((row) => row.evidence_type)).toEqual(["http", "resources"]);
    expect(rows[0]).toMatchObject({ summary: { status: 200, alternateOrigins: { probes: 3 } }, byte_size: 40, collection_status: "complete" });
    expect(rows[1]).toMatchObject({ summary: { retained: 2, aiResources: { resources: 2 } }, byte_size: 60, collection_status: "partial", error: "rate limited" });
    expect(() => schemaCompatibleSharedEvidenceRows([{ evidence_type: "unknown" }])).toThrow(/unsupported_types/);
  });

  it("persists reasons inside evidence without writing an obsolete result column", () => {
    expect(compactAuditResult({
      check_id: "check-1",
      outcome: "unable_to_test",
      reason: "Rendered evidence was incomplete",
      evidence: { reason: "Rendered evidence was incomplete" },
      duration_ms: 1,
    })).toEqual({
      check_id: "check-1",
      outcome: "unable_to_test",
      evidence: { reason: "Rendered evidence was incomplete" },
      duration_ms: 1,
    });
  });

  it("round-trips a compressed audit persistence continuation within the queue ceiling", async () => {
    const source = {
      startedAt: 1_750_000_000_000,
      propertyId: "property-1",
      createdBy: "user-1",
      resultCount: 306,
      testedCount: 301,
      sharedEvidence: [{ evidence_type: "http", summary: { status: 200 } }],
      telemetry: { architectureVersion: "2.0.0", queueMessagesUsed: 2 },
      score: 78,
      coverage: 100,
      finalStatus: "completed" as const,
      totalChecks: 306,
    };
    const encoded = await encodeAuditContinuationPayload(source);
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(120_000);
    await expect(decodeAuditContinuationPayload(encoded)).resolves.toEqual(source);
  });

  it("fails a stalled audit operation at its hard deadline and runs cleanup", async () => {
    let cleanedUp = false;
    await expect(withAuditDeadline(
      new Promise<never>(() => undefined),
      5,
      "collector timed out",
      () => { cleanedUp = true; },
    )).rejects.toThrow("collector timed out");
    expect(cleanedUp).toBe(true);
  });

  it("does not let stalled BrowserLab cleanup block the audit", async () => {
    const startedAt = Date.now();
    await closeBrowserWithDeadline(() => new Promise<never>(() => undefined), 5);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it("expires audit runs on a stale heartbeat or the hard runtime deadline", () => {
    const now = Date.parse("2026-10-03T18:30:00Z");
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:27:00Z",
      heartbeat_at: "2026-10-03T18:29:00Z",
    }, now)).toBe(true);
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:27:00Z",
      heartbeat_at: "2026-10-03T18:21:59Z",
    }, now)).toBe(false);
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:19:59Z",
      heartbeat_at: "2026-10-03T18:29:59Z",
    }, now)).toBe(false);
  });

  it("normalizes property hosts consistently for duplicate protection", () => {
    expect(canonicalPropertyHost("WWW.EdgeTier.COM.")).toBe("edgetier.com");
    expect(canonicalPropertyHost("edgetier.com")).toBe("edgetier.com");
  });
  it("normalizes Supabase one-to-one monitor embeds for the dashboard", () => {
    expect(
      normalizePropertyRelations([
        { id: "with-monitor", uptime_monitors: { id: "monitor-1", last_status: "online" } },
        { id: "without-monitor", uptime_monitors: null },
      ]),
    ).toEqual([
      { id: "with-monitor", uptime_monitors: [{ id: "monitor-1", last_status: "online" }] },
      { id: "without-monitor", uptime_monitors: [] },
    ]);
  });

  it("aggregates measured analytics dimensions and engagement", () => {
    const summary = buildAnalyticsSummary(
      [
        {
          event_type: "pageview",
          path: "/",
          source: "Google",
          device: "desktop",
          country_code: "GB",
          metadata: { browser: "Chrome", screen: "large", session: "tab-1", view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:00Z",
        },
        {
          event_type: "scroll",
          path: "/",
          value: 75,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:10Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "LCP",
          value: 2100,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:12Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "INP",
          value: 180,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:13Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "CLS",
          value: 0.08,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:14Z",
        },
        {
          event_type: "pageview",
          path: "/services",
          source: "Direct",
          device: "mobile",
          country_code: "US",
          metadata: { session: "tab-2", view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:00Z",
        },
        {
          event_type: "click",
          path: "/services/",
          name: "contact-click",
          device: "mobile",
          country_code: "US",
          metadata: { view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:05Z",
        },
        {
          event_type: "outbound",
          path: "https://example.com/services",
          name: "example.org",
          device: "mobile",
          country_code: "US",
          metadata: { view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:08Z",
        },
      ],
      30,
    );
    expect(summary.pageviews).toBe(2);
    expect(summary.keyEvents).toBe(2);
    expect(summary.pages.find((page) => page.path === "/")).toMatchObject({
      pageviews: 1,
      events: 0,
    });
    expect(summary.pages.find((page) => page.path === "/services/")).toMatchObject({
      pageviews: 1,
      events: 2,
    });
    expect(summary.sources[0]).toEqual({ name: "Google", pageviews: 1, events: 0 });
    expect(summary.countries).toContainEqual({ name: "GB", count: 1 });
    expect(summary.engagement.engagedPageviews).toBe(2);
    expect(summary.engagement.pageviewsWithKeyEvents).toBe(1);
    expect(summary.engagement.scrollDepth.find((row) => row.depth === 75)?.pageviews).toBe(1);
    expect(summary.vitals).toContainEqual({ name: "LCP", value: 2100, samples: 1, percentile: 75 });
    expect(summary.vitals).toContainEqual({ name: "INP", value: 180, samples: 1, percentile: 75 });
    expect(summary.performance.minimumSamples).toBe(1);
    expect(summary.performance.goodExperiencesPercent).toBe(100);
  });

  it("keeps prior compatible tracker observations available after a tracker upgrade", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "legacy", view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:00Z" },
      { event_type: "scroll", path: "/", value: 90, metadata: { view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:02Z" },
      { event_type: "active_time", path: "/", value: 12, metadata: { view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:12Z" },
    ], 1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z", "UTC");
    expect(summary.engagement.eligiblePageviews).toBe(1);
    expect(summary.engagement.medianScrollDepth).toBe(90);
    expect(summary.engagement.medianActiveSeconds).toBe(12);
  });

  it("builds compact event drill-down summaries from raw and rolled observations", () => {
    const summary = buildAnalyticsEventDetailSummary([
      {
        event_type: "click",
        name: "Need Convincing Clicked",
        path: "/pricing/",
        source: "Google",
        device: "desktop",
        country_code: "GB",
        metadata: { browser: "Chrome" },
        occurred_at: "2026-10-01T09:00:00Z",
        _aggregateCount: 3,
      },
      {
        event_type: "click",
        name: "Need Convincing Clicked",
        path: "/contact/",
        source: "LinkedIn",
        device: "mobile",
        country_code: "US",
        metadata: { browser: "Safari", session: "anonymous-tab" },
        occurred_at: "2026-10-02T10:00:00Z",
      },
      { event_type: "click", name: "Other event", path: "/", occurred_at: "2026-10-02T11:00:00Z" },
    ], "Need Convincing Clicked", "Europe/London");
    expect(summary.totalCount).toBe(4);
    expect(summary.uniqueSessions).toBeNull();
    expect(summary.topPage).toEqual({ name: "/pricing/", count: 3 });
    expect(summary.topSource).toEqual({ name: "Google", count: 3 });
    expect(summary.series).toEqual([
      { day: "2026-10-01", count: 3 },
      { day: "2026-10-02", count: 1 },
    ]);
    expect(summary.aggregateCoverage).toBe("hybrid_rollups_and_raw");
  });

  it("counts anonymous sessions only when raw event session evidence is complete", () => {
    const summary = buildAnalyticsEventDetailSummary([
      { event_type: "click", name: "lead", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T10:00:00Z" },
      { event_type: "click", name: "lead", path: "/", metadata: { session: "two" }, occurred_at: "2026-10-02T10:01:00Z" },
      { event_type: "click", name: "lead", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T10:02:00Z" },
    ], "lead");
    expect(summary.totalCount).toBe(3);
    expect(summary.uniqueSessions).toBe(2);
    expect(summary.aggregateCoverage).toBe("raw");
  });

  it("derives occurrence context only from matching anonymous view and session events", () => {
    const pageview = {
      id: 1,
      event_type: "pageview",
      path: "/pricing/",
      source: "Google",
      referrer_host: "google.com",
      device: "mobile",
      country_code: "GB",
      metadata: { session: "tab-one", view_id: "view-one", browser: "Safari", screen: "small", language: "en-GB", utm_campaign: "spring" },
      occurred_at: "2026-10-02T10:00:00Z",
    };
    const occurrence = {
      id: 5,
      event_type: "click",
      name: "Need Convincing Clicked",
      path: "/pricing/",
      metadata: { session: "tab-one", view_id: "view-one" },
      occurred_at: "2026-10-02T10:00:20Z",
      received_at: "2026-10-02T10:00:21Z",
    };
    const viewEvents = [
      pageview,
      { id: 2, event_type: "active_time", path: "/pricing/", value: 12, metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:12Z" },
      { id: 3, event_type: "scroll", path: "/pricing/", value: 90, metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:15Z" },
      { id: 4, event_type: "visible_section", name: "pricing", path: "/pricing/", metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:16Z" },
      occurrence,
      { id: 6, event_type: "web_vital", name: "LCP", value: 2200, path: "/pricing/", metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:25Z" },
    ];
    const sessionEvents = [
      ...viewEvents,
      { id: 7, event_type: "pageview", path: "/contact/", metadata: { session: "tab-one", view_id: "view-two" }, occurred_at: "2026-10-02T10:01:00Z" },
    ];
    const context = buildAnalyticsOccurrenceContext(occurrence, viewEvents, sessionEvents);
    expect(context.acquisition).toMatchObject({ source: "Google", referrer: "google.com", utmCampaign: "spring" });
    expect(context.visitor).toMatchObject({ country: "GB", device: "mobile", browser: "Safari", screen: "Small · under 768px" });
    expect(context.behaviour).toMatchObject({ activeSeconds: 12, maxScroll: 90, visibleSections: ["pricing"] });
    expect(context.behaviour.pageSequence).toEqual(["/pricing/", "/contact/"]);
    expect(context.webVitals).toEqual([{ name: "LCP", value: 2200 }]);
    expect(context.behaviour.journey.at(-1)).toEqual({ type: "event", label: "Need Convincing Clicked" });
  });

  it("does not invent occurrence context when anonymous correlation evidence is absent", () => {
    const context = buildAnalyticsOccurrenceContext({
      id: 9,
      event_type: "form_success",
      name: "lead",
      path: "/contact/",
      occurred_at: "2026-10-02T10:00:00Z",
      received_at: "2026-10-02T10:00:01Z",
      metadata: {},
    });
    expect(context.contextAvailability).toEqual({ view: false, session: false });
    expect(context.behaviour).toMatchObject({ activeSeconds: 0, maxScroll: 0, visibleSections: [], relatedKeyEvents: [] });
    expect(context.webVitals).toEqual([]);
  });

  it("merges historical rollups with the same analytics result as raw events", () => {
    const raw = [
      { event_type: "pageview", path: "/", source: "Google", device: "desktop", country_code: "GB", metadata: { browser: "Chrome", screen: "large", session: "tab-1", view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:00Z" },
      { event_type: "scroll", path: "/", value: 75, metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:10Z" },
      { event_type: "web_vital", path: "/", name: "LCP", value: 2100, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:12Z" },
      { event_type: "web_vital", path: "/", name: "INP", value: 180, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:13Z" },
      { event_type: "web_vital", path: "/", name: "CLS", value: 0.08, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:14Z" },
      { event_type: "pageview", path: "/services/", source: "Direct", device: "mobile", country_code: "US", metadata: { session: "tab-2", view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:00Z" },
      { event_type: "click", path: "/services/", name: "contact-click", device: "mobile", country_code: "US", metadata: { view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:05Z" },
      { event_type: "outbound", path: "/services/", name: "example.org", device: "mobile", country_code: "US", metadata: { view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:08Z" },
    ];
    const rollups = raw.map((event) => ({
      event_type: event.event_type,
      path: event.path,
      name: event.name || "",
      device: event.device || "",
      source: event.source || "",
      country_code: event.country_code || "",
      browser: event.metadata.browser || "",
      screen: event.metadata.screen || "",
      tracker_version: event.metadata.tracker_version || "",
      bucket_start: "2026-10-02T00:00:00Z",
      event_count: 1,
      value_sum: event.value ?? null,
      values_json: event.event_type === "web_vital" ? [event.value] : [],
    }));
    const views = [
      { day: "2026-10-02", view_key: "view-1", occurred_at: "2026-10-02T00:00:00Z", path: "/", tracker_version: "2.1.0", session_id: "tab-1", active_seconds: 0, max_scroll: 75, key_events: 0, javascript_errors: 0, visible_sections: [], vitals: { LCP: [2100], INP: [180], CLS: [0.08] } },
      { day: "2026-10-02", view_key: "view-2", occurred_at: "2026-10-02T00:01:00Z", path: "/services/", tracker_version: "2.1.0", session_id: "tab-2", active_seconds: 0, max_scroll: 0, key_events: 2, javascript_errors: 0, visible_sections: [], vitals: {} },
    ];
    const args = [1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59.999Z", "UTC"] as const;
    expect(buildAnalyticsSummary([], ...args, rollups, views)).toEqual(
      buildAnalyticsSummary(raw, ...args),
    );
  });

  it("uses rollups only for complete UTC days and leaves boundary ranges raw", () => {
    const plan = analyticsRollupPlan(
      "2026-09-03T23:00:00.000Z",
      "2026-10-03T22:59:59.999Z",
      Date.parse("2026-10-03T20:00:00.000Z"),
    );
    expect(plan.rollupFrom).toBe("2026-09-04T00:00:00.000Z");
    expect(plan.rollupTo).toBe("2026-10-03T00:00:00.000Z");
    expect(plan.expectedDays).toHaveLength(29);
    expect(plan.rawRanges).toEqual([
      { from: "2026-09-03T23:00:00.000Z", to: "2026-09-03T23:59:59.999Z" },
      { from: "2026-10-03T00:00:00.000Z", to: "2026-10-03T22:59:59.999Z" },
    ]);
  });

  it("produces desktop and mobile performance from the same analytics pass", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "web_vital", path: "/", name: "LCP", value: 2100, device: "desktop", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:00Z" },
      { event_type: "web_vital", path: "/", name: "LCP", value: 3400, device: "mobile", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:01Z" },
      { event_type: "web_vital", path: "/", name: "INP", value: 180, device: "desktop", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:02Z" },
    ], 1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z", "UTC");
    expect(summary.performanceByDevice.desktop.vitals).toContainEqual({
      name: "LCP",
      value: 2100,
      samples: 1,
      percentile: 75,
    });
    expect(summary.performanceByDevice.mobile.vitals).toContainEqual({
      name: "LCP",
      value: 3400,
      samples: 1,
      percentile: 75,
    });
  });

  it("normalizes paths and combines analytics page filters", () => {
    const events = [
      { event_type: "pageview", path: "/work", device: "desktop", source: "Google", country_code: "GB" },
      { event_type: "pageview", path: "/work/case-study/", device: "mobile", source: "Google", country_code: "GB" },
      { event_type: "pageview", path: "/services/", device: "desktop", source: "Direct", country_code: "US" },
    ];
    expect(normalizeAnalyticsPath("https://example.com/work")).toBe("/work/");
    expect(
      filterAnalyticsEvents(events, {
        pathMode: "prefix",
        pathValue: "/work",
        device: "mobile",
        source: "Google",
        country: "GB",
      }),
    ).toEqual([events[1]]);
    expect(
      filterAnalyticsEvents(events, { pathMode: "exact", pathValue: "/work/" }),
    ).toEqual([events[0]]);
    expect(
      filterAnalyticsEvents(events, { pathMode: "prefix", pathValue: "/wor" }),
    ).toEqual([events[0], events[1]]);
  });

  it("keeps pageviews separate from key events and preserves fractional average daily visitors", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "one", view_id: "a", tracker_version: "2.1.0" }, occurred_at: "2026-09-01T09:00:00Z" },
      { event_type: "scroll", path: "/", value: 50, metadata: { view_id: "a", tracker_version: "2.1.0" }, occurred_at: "2026-09-01T09:00:05Z" },
      { event_type: "pageview", path: "/", metadata: { session: "two", view_id: "b", tracker_version: "2.1.0" }, occurred_at: "2026-09-02T09:00:00Z" },
      { event_type: "click", path: "/", name: "cta", metadata: { view_id: "b", tracker_version: "2.1.0" }, occurred_at: "2026-09-02T09:00:05Z" },
    ], 4, "2026-08-31T23:00:00Z", "2026-09-04T22:59:59.999Z", "Europe/London");
    expect(summary.pageviews).toBe(2);
    expect(summary.keyEvents).toBe(1);
    expect(summary.pages[0]).toMatchObject({ pageviews: 2, events: 1 });
    expect(summary.averageDailyVisitors).toBe(0.5);
    expect(summary.performance.minimumSamples).toBe(1);
  });

  it("fits a full audit into five bounded persistence requests", () => {
    const chunks = chunkAuditResults(Array.from({ length: 306 }, (_, index) => index), 64);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toHaveLength(64);
    expect(chunks.at(-1)).toHaveLength(50);
    expect(chunks.flat()).toHaveLength(306);
  });

  it("returns hourly points for a single local calendar day", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T09:15:00Z" },
    ], 1, "2026-10-01T23:00:00Z", "2026-10-02T22:59:59.999Z", "Europe/London");
    expect(summary.series).toHaveLength(24);
    expect(summary.series.reduce((total, point) => total + point.pageviews, 0)).toBe(1);
    expect(summary.series.every((point) => point.day.includes("T"))).toBe(true);
  });

  it("uses 23 and 25 hourly points across Europe/London DST transitions", () => {
    const springForward = buildAnalyticsSummary(
      [],
      1,
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T22:59:59.999Z",
      "Europe/London",
    );
    const fallBack = buildAnalyticsSummary(
      [],
      1,
      "2026-10-24T23:00:00.000Z",
      "2026-10-25T23:59:59.999Z",
      "Europe/London",
    );
    expect(springForward.series).toHaveLength(23);
    expect(fallBack.series).toHaveLength(25);
  });

  it("routes every active catalogue check through one explicit evaluator key", () => {
    const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
    const implemented = active.filter((check) => auditCheckHasExecutableLogic(check.id));
    const gaps = active.filter((check) => !auditCheckHasExecutableLogic(check.id));
    expect(active).toHaveLength(306);
    expect(Object.keys(AUDIT_EVALUATOR_KEYS)).toHaveLength(306);
    expect(implemented).toHaveLength(306);
    expect(gaps).toEqual([]);
    expect(implemented.length + gaps.length).toBe(active.length);
    expect(gaps.every((check) => AUDIT_EVALUATOR_KEYS[check.id] === "unsupported")).toBe(true);
  });

  it("has no checks left on the unsupported evaluator route", () => {
    const unsupported = AUDIT_REGISTRY.filter((check) => AUDIT_EVALUATOR_KEYS[check.id] === "unsupported");
    expect(unsupported).toEqual([]);
  });

  it("rejects private, credentialed and non-HTTP audit targets", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fd00::1",
    ])
      expect(isPrivateHost(host)).toBe(true);
    expect(validPublicUrl("http://127.0.0.1/admin")).toBeNull();
    expect(validPublicUrl("https://user:secret@example.com/")).toBeNull();
    expect(validPublicUrl("file:///etc/passwd")).toBeNull();
    expect(validPublicUrl("https://example.com/path")?.hostname).toBe("example.com");
  });

  it("gives five-minute uptime cron ticks a bounded due horizon", () => {
    expect(uptimeDueHorizon(Date.parse("2026-10-02T12:25:00.000Z"))).toBe(
      "2026-10-02T12:26:00.000Z",
    );
  });

  it("normalizes saved audit pages to property-relative paths", () => {
    expect(cleanPath("about/team")).toBe("/about/team/");
    expect(cleanPath("https://example.com/contact?source=test")).toBe("/contact/");
    expect(cleanPath("/")).toBe("/");
    expect(isProtectedAuditPagePath("/")).toBe(true);
    expect(isProtectedAuditPagePath("/about/")).toBe(false);
  });

  it("protects owner roles and destructive workspace invariants", () => {
    expect(editableWorkspaceRole("member")).toBe("member");
    expect(editableWorkspaceRole("viewer")).toBe("viewer");
    expect(editableWorkspaceRole("owner")).toBeNull();
    expect(workspaceDeletionError(1, 0)).toBe("account_requires_one_workspace");
    expect(workspaceDeletionError(2, 1)).toBe("workspace_must_be_empty_before_deletion");
    expect(workspaceDeletionError(2, 0)).toBeNull();
  });

  it("accepts avatar bytes only when their signature matches the declared image type", () => {
    expect(validAvatarBytes("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(validAvatarBytes("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(validAvatarBytes("image/gif", new TextEncoder().encode("GIF89a"))).toBe(true);
    expect(validAvatarBytes("image/webp", new TextEncoder().encode("RIFF0000WEBP"))).toBe(true);
    expect(validAvatarBytes("image/png", new TextEncoder().encode("<script>"))).toBe(false);
  });

  it("only creates audit notifications for failure or a score below 50", () => {
    expect(auditOutcomeNotification("completed", 92, 100)).toBeNull();
    expect(auditOutcomeNotification("partial", 64, 82)).toBeNull();
    expect(auditOutcomeNotification("completed", 49, 100)).toMatchObject({ title: "Audit score below 50", severity: "critical" });
    expect(auditOutcomeNotification("failed", null, 0, "browser unavailable")).toMatchObject({ title: "Audit failed", severity: "warning" });
  });
});
