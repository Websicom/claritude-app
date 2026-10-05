import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditDisplayProgress,
  auditHistoryStatus,
  auditScoreBand,
  buildAuditFixPrompt,
  auditSeverityGroup,
  filterProperties,
  filterAuditSubfindings,
  filterUserFacingAuditResults,
  filterWorkspaceMemberships,
  isPrimaryAuditPage,
  isFixFirstAuditResult,
  paginateResults,
  prepareAvatarImage,
  performanceTargetStatus,
  propertyOnboardingChecks,
  shouldShowAuditQuickFilters,
  propertyFaviconSources,
  squareImageCrop,
  trafficSeriesKey,
} from "./RecoveryDashboard";

afterEach(() => vi.unstubAllGlobals());

describe("top selector searches", () => {
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
    expect(auditDisplayProgress(0, 0, false)).toBe(10);
    expect(auditDisplayProgress(10, 0, false, true)).toBe(15);
    expect(auditDisplayProgress(55, 20, false, true)).toBe(60);
    expect(auditDisplayProgress(60, 82, false, true)).toBe(82);
    expect(auditDisplayProgress(82, 40, false, true)).toBe(82);
    expect(auditDisplayProgress(99, 100, false)).toBe(99);
    expect(auditDisplayProgress(87, 100, true)).toBe(100);
  });

  it("assigns healthy, moderate and poor score-bar states", () => {
    expect(auditScoreBand(91)).toBe("healthy");
    expect(auditScoreBand(68)).toBe("moderate");
    expect(auditScoreBand(34)).toBe("poor");
    expect(auditScoreBand(null)).toBe("unknown");
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
  });

  it("keeps critical and security group severity visually distinct", () => {
    expect(auditSeverityGroup({ outcome: "failed", severity: "Critical", category: "SEO" })).toBe("critical");
    expect(auditSeverityGroup({ outcome: "failed", severity: "Security", category: "Security" })).toBe("security");
    expect(auditSeverityGroup({ outcome: "failed", severity: "Warning", category: "SEO" })).toBe("warning");
  });
});
