import { describe, expect, it } from "vitest";
import {
  buildAnalyticsSummary,
  evaluateSourceChecks,
  normalizePropertyRelations,
} from "./index";

describe("worker evidence pipelines", () => {
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
          metadata: { browser: "Chrome", screen: "large", session: "tab-1" },
          occurred_at: "2026-10-02T00:00:00Z",
        },
        {
          event_type: "scroll",
          path: "/",
          value: 75,
          metadata: {},
          occurred_at: "2026-10-02T00:00:10Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "LCP",
          value: 2100,
          metadata: {},
          occurred_at: "2026-10-02T00:00:12Z",
        },
      ],
      30,
    );
    expect(summary.pageviews).toBe(1);
    expect(summary.pages[0]).toMatchObject({ path: "/", pageviews: 1, events: 3 });
    expect(summary.sources[0]).toEqual({ name: "Google", count: 1 });
    expect(summary.countries[0]).toEqual({ name: "GB", count: 1 });
    expect(summary.engagement.scroll75Rate).toBe(100);
    expect(summary.vitals[0]).toMatchObject({ name: "LCP", value: 2100, samples: 1 });
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
});
