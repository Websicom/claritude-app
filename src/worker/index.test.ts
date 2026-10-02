import { describe, expect, it } from "vitest";
import {
  buildAnalyticsSummary,
  auditCheckHasExecutableLogic,
  canonicalPropertyHost,
  chunkAuditResults,
  cleanPath,
  editableWorkspaceRole,
  evaluateSourceChecks,
  filterAnalyticsEvents,
  isPrivateHost,
  normalizeAnalyticsPath,
  normalizePropertyRelations,
  uptimeDueHorizon,
  validPublicUrl,
  workspaceDeletionError,
} from "./index";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";

describe("worker evidence pipelines", () => {
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

  it("persists audit results in visible bounded progress batches", () => {
    const chunks = chunkAuditResults(Array.from({ length: 306 }, (_, index) => index), 24);
    expect(chunks).toHaveLength(13);
    expect(chunks[0]).toHaveLength(24);
    expect(chunks.at(-1)).toHaveLength(18);
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

  it("executes source and header checks with evidence", () => {
    const html = `<!doctype html><html lang="en"><head><title>Example</title><meta name="description" content="Useful description"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"></head><body><main><h1>Example</h1><p>${"useful content ".repeat(20)}</p></main></body></html>`;
    const response = new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      },
    });
    Object.defineProperty(response, "url", { value: "https://example.com/" });
    const snapshot = [
      { id: "seo.metadata.title.present" },
      { id: "seo.page.metadata.canonical.url.declared" },
      { id: "seo.page.metadata.html.language.declared" },
      { id: "seo.content.structure.and.headings.main.content.landmark.present" },
      { id: "security.headers.hsts" },
      { id: "security.security.and.browser.protections.x.content.type.options.set.to.nosniff" },
    ];
    const results = evaluateSourceChecks(snapshot, response, html, 123);
    expect(results).toHaveLength(snapshot.length);
    expect(results.every((item) => item.outcome === "pass")).toBe(true);
  });

  it("reconciles every active catalogue check to executable logic or an explicit capability gap", () => {
    const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
    const implemented = active.filter((check) => auditCheckHasExecutableLogic(check.id));
    const gaps = active.filter((check) => !auditCheckHasExecutableLogic(check.id));
    expect(active).toHaveLength(306);
    expect(implemented.length).toBeGreaterThanOrEqual(150);
    expect(implemented.length + gaps.length).toBe(active.length);
    expect(gaps.every((check) => ["source_html", "network", "rendered_browser", "dns", "lab"].includes(check.executionMethod))).toBe(true);
  });

  it("records a result for every snapshotted catalogue check without treating gaps as passes", () => {
    const html = "<!doctype html><html lang=\"en\"><head><title>Coverage probe</title></head><body><main>" + "evidence ".repeat(30) + "</main></body></html>";
    const response = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: "https://example.com/" });
    const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
    const results = evaluateSourceChecks(active, response, html, 100);
    expect(results).toHaveLength(306);
    const resultById = new Map(results.map((result) => [result.check_id, result]));
    expect(active.filter((check) => !auditCheckHasExecutableLogic(check.id)).every(
      (check) => resultById.get(check.id)?.outcome === "unable_to_test",
    )).toBe(true);
    expect(results.filter((result) => result.outcome === "pass").length).toBeLessThan(306);
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
  });

  it("protects owner roles and destructive workspace invariants", () => {
    expect(editableWorkspaceRole("member")).toBe("member");
    expect(editableWorkspaceRole("viewer")).toBe("viewer");
    expect(editableWorkspaceRole("owner")).toBeNull();
    expect(workspaceDeletionError(1, 0)).toBe("account_requires_one_workspace");
    expect(workspaceDeletionError(2, 1)).toBe("workspace_must_be_empty_before_deletion");
    expect(workspaceDeletionError(2, 0)).toBeNull();
  });
});
