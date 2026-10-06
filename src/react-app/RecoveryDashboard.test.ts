import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditDisplayProgress,
  analyticsComparisonModel,
  auditHistoryStatus,
  auditProgressCeiling,
  auditProgressMessagePool,
  auditRunCategoryScores,
  auditScoreBand,
  buildAuditFixPrompt,
  customEventUsageText,
  durationLabel,
  eventLabel,
  auditSeverityGroup,
  filterProperties,
  filterAuditSubfindings,
  filterUserFacingAuditResults,
  filterWorkspaceMemberships,
  isPrimaryAuditPage,
  isFixFirstAuditResult,
  paginateResults,
  pageActiveTimeLabel,
  periodLabel,
  prepareAvatarImage,
  performanceTargetStatus,
  performanceTargetLabel,
  propertyOnboardingChecks,
  shouldShowAuditQuickFilters,
  suggestedAiPhrase,
  propertyFaviconSources,
  squareImageCrop,
  sortWorkspaceProperties,
  supportedTimezones,
  trafficSeriesKey,
  uptimePeriodQuery,
  responseChartLabel,
  workspaceKeyEventCount,
} from "./RecoveryDashboard";

afterEach(() => vi.unstubAllGlobals());

describe("top selector searches", () => {
  it("builds unbranded local discovery phrases and a natural property fallback", () => {
    expect(suggestedAiPhrase({ name: "Websi", settings: { ai_visibility: { industry: "web-design", location: "Cambridge", country: "GB" } } } as any)).toBe("Web design agency in Cambridge");
    expect(suggestedAiPhrase({ name: "Websi", settings: {} } as any)).toBe("What services does Websi offer?");
  });
  const workspaces = [
    { role: "owner", workspaces: { id: "one", name: "Websi Agency" } },
    { role: "member", workspaces: { id: "two", name: "Client Sandbox" } },
  ];
  const properties = [
    { id: "one", name: "EdgeTier", canonical_host: "edgetier.com" },
    { id: "two", name: "North Commerce", canonical_host: "shop.example" },
  ] as any[];

  it("filters workspaces case-insensitively and ignores surrounding whitespace", () => {
    expect(filterWorkspaceMemberships(workspaces, "  AGENCY ")).toEqual([
      workspaces[0],
    ]);
    expect(filterWorkspaceMemberships(workspaces, "   ")).toEqual(workspaces);
    expect(filterWorkspaceMemberships(workspaces, "missing")).toEqual([]);
  });

  it("searches property names and displayed domains", () => {
    expect(filterProperties(properties, " EDGE ")).toEqual([properties[0]]);
    expect(filterProperties(properties, "EXAMPLE")).toEqual([properties[1]]);
    expect(filterProperties(properties, "")).toEqual(properties);
  });

  it("loads property favicons directly with independent provider fallbacks", () => {
    expect(propertyFaviconSources("https://www.example.com/path")).toEqual([
      "https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fwww.example.com&sz=64",
      "https://icons.duckduckgo.com/ip3/www.example.com.ico",
      "https://www.example.com/favicon.ico",
    ]);
    expect(propertyFaviconSources("not a url")).toEqual([]);
  });

  it("offers the runtime timezone catalogue with safe global fallbacks", () => {
    const zones = supportedTimezones();
    expect(zones).toContain("Europe/London");
    expect(zones.length).toBeGreaterThan(10);
  });

  it("protects the homepage and center-crops avatar source images", () => {
    expect(isPrimaryAuditPage({ path: "/" })).toBe(true);
    expect(isPrimaryAuditPage({ path: "/about/" })).toBe(false);
    expect(squareImageCrop(1200, 800)).toEqual({ x: 200, y: 0, size: 800 });
    expect(squareImageCrop(600, 900)).toEqual({ x: 0, y: 150, size: 600 });
  });

  it("resizes and compresses avatar uploads to a 256px WebP square", async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        callback(new Blob(["compressed-avatar"], { type }));
      }),
    };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1200, height: 800, close })));
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });

    const result = await prepareAvatarImage({} as File);

    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 256, 256);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.82);
    expect(result.type).toBe("image/webp");
    expect(close).toHaveBeenCalledOnce();
  });

  it("maps traffic toggles to measured series and uses completed onboarding evidence", () => {
    expect(trafficSeriesKey("Pageviews")).toBe("pageviews");
    expect(trafficSeriesKey("Unique Visits")).toBe("dailyVisitors");
    expect(trafficSeriesKey("Events")).toBe("events");
    expect(paginateResults(Array.from({ length: 45 }, (_, index) => index + 1), 2)).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
    const checks = propertyOnboardingChecks({
      verification_status: "verified",
      tracking_last_received_at: "2026-10-04T09:00:00Z",
      uptime_monitors: [{ enabled: true, last_checked_at: "2026-10-04T09:00:00Z" }],
      audit_runs: [{ status: "completed", score: 84 }],
    } as any);
    expect(checks.map((check) => check.complete)).toEqual([true, true, true, true]);
    expect(propertyOnboardingChecks({ verification_status: "pending" } as any).map((check) => check.complete)).toEqual([false, false, false, false]);
  });

  it("prioritises offline workspace properties and otherwise sorts alphabetically", () => {
    const ordered = sortWorkspaceProperties([
      { id: "z", name: "Zulu", uptime_monitors: [{ last_status: "online" }] },
      { id: "b", name: "Beta", uptime_monitors: [{ last_status: "offline" }] },
      { id: "a", name: "Alpha", uptime_monitors: [{ last_status: "offline" }] },
      { id: "e", name: "Echo", uptime_monitors: [{ last_status: "pending" }] },
    ] as any[]);
    expect(ordered.map((property) => property.name)).toEqual(["Alpha", "Beta", "Echo", "Zulu"]);
  });

  it("does not replace a legitimate zero key-event count with broader analytics events", () => {
    expect(workspaceKeyEventCount({ keyEvents: 0, events: 637 })).toBe(0);
    expect(workspaceKeyEventCount({ events: 5 })).toBe(5);
  });

  it("formats page active time with one decimal below ten seconds and compact units", () => {
    expect(pageActiveTimeLabel(4.24)).toBe("4.2 s");
    expect(pageActiveTimeLabel(9.96)).toBe("10.0 s");
    expect(pageActiveTimeLabel(10.2)).toBe("10 s");
    expect(pageActiveTimeLabel(60)).toBe("60 s");
    expect(pageActiveTimeLabel(78)).toBe("1 min 18 s");
  });

  it("pluralises active session seconds and preserves readable custom event casing", () => {
    expect(durationLabel(1)).toBe("1 sec");
    expect(durationLabel(42)).toBe("42 secs");
    expect(durationLabel(78)).toBe("1 min 18 secs");
    expect(eventLabel("www.google.com")).toBe("www.google.com");
    expect(eventLabel("Www.Google.Com")).toBe("www.google.com");
    expect(eventLabel("Need Convincing Clicked")).toBe("Need Convincing Clicked");
  });

  it("uses individual checks by default and medians only for a selected uptime range", () => {
    expect(uptimePeriodQuery("?property=property-1")).toBe("days=1&response_mode=checks");
    expect(uptimePeriodQuery("?from=2026-10-01&to=2026-10-06")).toBe("from=2026-10-01&to=2026-10-06");
    expect(responseChartLabel("check")).toBe("Response time by monitor check");
    expect(responseChartLabel("day")).toBe("Median response time by day");
  });

  it("shows finite custom-event usage and Pro's separate unlimited entitlement", () => {
    expect(customEventUsageText({ plan: "Essentials", used: 2, limit: 5, remaining: 3, unlimited: false, canCreate: true }))
      .toBe("2 of 5 events used");
    expect(customEventUsageText({ plan: "Pro", used: 37, limit: null, remaining: null, unlimited: true, canCreate: true }))
      .toBe("37 events used · Unlimited on Pro");
  });

  it("spaces date-range separators consistently", () => {
    expect(periodLabel("2026-09-06", "2026-10-05")).toBe("6 Sep – 5 Oct 2026");
    expect(periodLabel("2026-10-01", "2026-10-05")).toBe("1 – 5 Oct 2026");
  });

  it("filters the rationalised audit catalogue by category, subcategory and outcome", () => {
    const results = [
      { category: "SEO", subcategory: "Page Metadata", outcome: "failed" },
      { category: "SEO", subcategory: "Links & Navigation", outcome: "passed" },
      { category: "Security", subcategory: "Security Headers", outcome: "failed" },
    ];
    expect(filterUserFacingAuditResults(results, { category: "SEO" })).toHaveLength(2);
    expect(filterUserFacingAuditResults(results, { subcategory: "Security Headers" })).toEqual([results[2]]);
    expect(filterUserFacingAuditResults(results, { category: "SEO", outcome: "passed" })).toEqual([results[1]]);
  });

  it("hides unable-to-test results by default and exposes them only through an explicit filter", () => {
    const results = [
      { title: "Canonical target", category: "SEO", subcategory: "Indexing", outcome: "passed" },
      { title: "Page redirects", category: "SEO", subcategory: "Links", outcome: "unable_to_test" },
    ];
    expect(filterUserFacingAuditResults(results, {}, { hideUnableByDefault: true })).toEqual([results[0]]);
    expect(filterUserFacingAuditResults(results, { types: ["unable_to_test"] }, { hideUnableByDefault: true })).toEqual([results[1]]);
    expect(filterUserFacingAuditResults(results, { search: "canonical" })).toEqual([results[0]]);
  });

  it("keeps Fix these first limited to failed Critical, Security and Warning groups", () => {
    expect(isFixFirstAuditResult({ outcome: "failed", severity: "Critical", category: "SEO" })).toBe(true);
    expect(isFixFirstAuditResult({ outcome: "failed", severity: "Security", category: "Security" })).toBe(true);
    expect(isFixFirstAuditResult({ outcome: "failed", severity: "Warning", category: "SEO" })).toBe(true);
    expect(isFixFirstAuditResult({ outcome: "advisory", severity: "Warning", category: "SEO" })).toBe(false);
    expect(isFixFirstAuditResult({ outcome: "unable_to_test", severity: "Critical", category: "SEO" })).toBe(false);
  });

  it("only shows Overview severity shortcuts when more than one type is present", () => {
    expect(shouldShowAuditQuickFilters({ critical: 0, security: 0, warning: 8 })).toBe(false);
    expect(shouldShowAuditQuickFilters({ critical: 0, security: 1, warning: 8 })).toBe(true);
    expect(shouldShowAuditQuickFilters({ critical: 0, security: 0, warning: 0 })).toBe(false);
  });

  it("builds an AI fix prompt from actionable findings and every stored occurrence only", () => {
    const prompt = buildAuditFixPrompt({
      pageName: "Homepage",
      pageUrl: "https://example.com/",
      runId: "run-123",
      results: [
        {
          title: "Broken internal links",
          outcome: "failed",
          severity: "Warning",
          category: "SEO",
          result_summary: "Two links return HTTP 404.",
          recommendation: "Update or remove each broken link.",
          example_fix: '<a href="/working-page/">Working page</a>',
          subfindings: [{ title: "Links returning HTTP 404", outcome: "failed", evidence_summary: "2 affected links" }],
          occurrences: [
            { check_title: "Links returning HTTP 404", occurrence: { url: "https://example.com/missing-one" } },
            { check_title: "Links returning HTTP 404", occurrence: { url: "https://example.com/missing-two" } },
          ],
        },
        { title: "Optional metadata", outcome: "advisory", severity: "Advisory", category: "SEO" },
        { title: "Clean headings", outcome: "passed", severity: "Warning", category: "SEO" },
      ],
    });
    expect(prompt).toContain("https://example.com/missing-one");
    expect(prompt).toContain("https://example.com/missing-two");
    expect(prompt).toMatch(/preserve the website's existing functionality/i);
    expect(prompt).not.toContain("Optional metadata");
    expect(prompt).not.toContain("Clean headings");
  });

  it("advances display progress smoothly without moving backwards or finishing early", () => {
    expect(auditDisplayProgress(0, 0, false, 12, 10)).toBe(10);
    expect(auditDisplayProgress(10, 0, false, 28, 1.37)).toBe(11.37);
    expect(auditDisplayProgress(55, 20, false, 65, 2.2)).toBe(57.2);
    expect(auditDisplayProgress(60, 82, false, 85, 1)).toBe(82);
    expect(auditDisplayProgress(82, 40, false, 85, 2.5)).toBe(84.5);
    expect(auditDisplayProgress(99, 100, false, 90, 2)).toBe(99);
    expect(auditDisplayProgress(87, 100, true)).toBe(100);
  });

  it("paces simulated audit progress by elapsed time and reserves completion for the backend", () => {
    expect(auditProgressCeiling(0)).toBe(12);
    expect(auditProgressCeiling(5_000)).toBe(28);
    expect(auditProgressCeiling(20_000)).toBe(65);
    expect(auditProgressCeiling(60_000)).toBe(85);
    expect(auditProgressCeiling(120_000)).toBe(90);
    expect(auditProgressCeiling(1_000, true)).toBe(97);
  });

  it("uses preparing, checking and final status pools as progress advances", () => {
    expect(auditProgressMessagePool("queued", 70)).toContain("Preparing your audit");
    expect(auditProgressMessagePool("running", 20)).toContain("Collecting page evidence");
    expect(auditProgressMessagePool("running", 60)).toContain("Checking under the bonnet");
    expect(auditProgressMessagePool("running", 85)).toContain("Saving everything for you");
    expect(auditProgressMessagePool("running", 40, true)).toContain("Doing the final checks");
    const journey = [
      ...auditProgressMessagePool("queued", 10),
      ...auditProgressMessagePool("running", 20),
      ...auditProgressMessagePool("running", 60),
      ...auditProgressMessagePool("running", 85),
    ];
    expect(new Set(journey).size).toBe(journey.length);
    expect(auditProgressMessagePool("running", 85).at(-1)).toBe("Saving everything for you");
  });

  it("assigns healthy, moderate and poor score-bar states", () => {
    expect(auditScoreBand(100)).toBe("healthy");
    expect(auditScoreBand(80)).toBe("healthy");
    expect(auditScoreBand(91)).toBe("healthy");
    expect(auditScoreBand(79)).toBe("moderate");
    expect(auditScoreBand(60)).toBe("moderate");
    expect(auditScoreBand(68)).toBe("moderate");
    expect(auditScoreBand(59)).toBe("poor");
    expect(auditScoreBand(34)).toBe("poor");
    expect(auditScoreBand(null)).toBe("unknown");
  });

  it("uses the same stored category scores as the overview, including measured performance", () => {
    const scores = auditRunCategoryScores({
      category_scores: {
        SEO: 54,
        Accessibility: 61,
        Performance: 22,
        Security: 80,
        Technical: 79,
        "AI & Crawler Readiness": 92,
      },
      performance_metrics: { scores: { desktop: 72, mobile: 64 } },
    } as any);
    expect(scores.SEO).toBe(54);
    expect(scores.Security).toBe(80);
    expect(scores.Performance).toBe(68);
  });

  it("presents terminal partial runs as successful without changing their stored status", () => {
    expect(auditHistoryStatus("completed")).toBe("Successful");
    expect(auditHistoryStatus("partial")).toBe("Successful");
    expect(auditHistoryStatus("failed")).toBe("Failed");
    expect(auditHistoryStatus("running")).toBe("In progress");
  });

  it("keeps expanded technical sub-findings aligned with the active result filter", () => {
    const subfindings = [
      { check_id: "failed", outcome: "failed" },
      { check_id: "passed", outcome: "passed" },
      { check_id: "advisory", outcome: "advisory" },
      { check_id: "unable", outcome: "unable_to_test" },
    ];
    expect(filterAuditSubfindings(subfindings, ["warning"]).map((item) => item.check_id)).toEqual(["failed"]);
    expect(filterAuditSubfindings(subfindings, ["passed"]).map((item) => item.check_id)).toEqual(["passed"]);
    expect(filterAuditSubfindings(subfindings, ["advisory"]).map((item) => item.check_id)).toEqual(["failed", "advisory"]);
    expect(filterAuditSubfindings(subfindings, [])).toEqual(subfindings);
  });

  it("uses green, grey and red performance target states", () => {
    expect(performanceTargetStatus("LCP", "2.5 s")).toBe("good");
    expect(performanceTargetStatus("LCP", "2.7 s")).toBe("close");
    expect(performanceTargetStatus("LCP", "3.6 s")).toBe("failed");
    expect(performanceTargetStatus("INP", "205 ms")).toBe("close");
    expect(performanceTargetStatus("CLS", "0.00")).toBe("good");
    expect(performanceTargetLabel("LCP")).toBe("≤ 2.5 s");
    expect(performanceTargetLabel("INP")).toBe("≤ 200 ms");
  });

  it("keeps critical and security group severity visually distinct", () => {
    expect(auditSeverityGroup({ outcome: "failed", severity: "Critical", category: "SEO" })).toBe("critical");
    expect(auditSeverityGroup({ outcome: "failed", severity: "Security", category: "Security" })).toBe("security");
    expect(auditSeverityGroup({ outcome: "failed", severity: "Warning", category: "SEO" })).toBe("warning");
  });
});

describe("analytics previous-period comparisons", () => {
  it("colours volume and directional changes by whether they improved", () => {
    expect(analyticsComparisonModel(112, 100)).toEqual({
      text: "↑ 12% vs previous period",
      tone: "favourable",
    });
    expect(analyticsComparisonModel(45, 50, "lower")).toEqual({
      text: "↓ 10% vs previous period",
      tone: "favourable",
    });
    expect(analyticsComparisonModel(55, 50, "lower")).toEqual({
      text: "↑ 10% vs previous period",
      tone: "unfavourable",
    });
    expect(analyticsComparisonModel(65, 50, "higher")).toEqual({
      text: "↑ 30% vs previous period",
      tone: "favourable",
    });
  });

  it("keeps unavailable comparisons explicit and handles a zero baseline without inventing a percentage", () => {
    expect(analyticsComparisonModel(12, null).text).toBe("-- vs previous period");
    expect(analyticsComparisonModel(12, 0)).toEqual({
      text: "↑ from 0 vs previous period",
      tone: "favourable",
    });
    expect(analyticsComparisonModel(12, 0, "lower")).toEqual({
      text: "↑ from 0 vs previous period",
      tone: "unfavourable",
    });
    expect(analyticsComparisonModel(0, 0)).toEqual({
      text: "→ 0% vs previous period",
      tone: "neutral",
    });
  });
});
