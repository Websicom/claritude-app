import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterProperties,
  filterWorkspaceMemberships,
  isPrimaryAuditPage,
  paginateResults,
  prepareAvatarImage,
  propertyOnboardingChecks,
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
});
