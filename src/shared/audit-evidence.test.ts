import { describe, expect, it } from "vitest";
import { AUDIT_REGISTRY } from "./audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "./audit-evaluator-map.generated";
import {
  classifyDestination,
  headerMultimap,
  parseFontFaces,
  parseSitemapXml,
  parseSourceDom,
  type DestinationEvidence,
} from "./audit-evidence";
import {
  evaluateAuditCheck,
  validateAuditEvaluatorRegistry,
  type AuditEvidenceBundle,
  type RenderedViewportEvidence,
} from "./audit-evaluators";
import { collectLinkInventory, collectResourceInventory, inspectDestination } from "./audit-collectors";

const destination = (overrides: Partial<DestinationEvidence> = {}): DestinationEvidence => ({
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  state: "success",
  status: 200,
  redirectTrace: [],
  contentType: "text/html",
  headers: [],
  body: "<html></html>",
  bodyTruncated: false,
  error: null,
  ...overrides,
});

const renderedViewport = (overrides: Partial<RenderedViewportEvidence> = {}): RenderedViewportEvidence => ({
  collection: { status: "complete" },
  durationMs: 10,
  metrics: {},
  occurrences: {},
  networkResources: [],
  axe: { version: "4.13.0", violations: [], passes: [], incomplete: [] },
  axeError: null,
  ...overrides,
});

function bundle(html: string, overrides: Partial<AuditEvidenceBundle> = {}): AuditEvidenceBundle {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  return {
    http: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      redirectTrace: [],
      responseMs: 50,
      headers: headerMultimap(headers),
      contentType: "text/html; charset=utf-8",
      encodedBytes: html.length,
      decodedBytes: html.length,
      collection: { status: "complete" },
    },
    source: parseSourceDom(html, "https://example.com/"),
    rendered: null,
    links: { declarations: [], results: [], totalDiscovered: 0, retained: 0, truncated: false, requests: 0 },
    resources: { declarations: [], results: [], totalDiscovered: 0, retained: 0, truncated: false, requests: 0 },
    canonical: null,
    dns: [],
    robots: null,
    sitemaps: [],
    fontFaces: [],
    ...overrides,
  };
}

describe("audit v2 evidence architecture", () => {
  it("registers every active ID exactly once and rejects unknown IDs", () => {
    expect(validateAuditEvaluatorRegistry()).toEqual({ active: 306, duplicateIds: [], missing: [], unknown: [] });
    expect(Object.keys(AUDIT_EVALUATOR_KEYS)).toHaveLength(AUDIT_REGISTRY.length);
    expect(() => evaluateAuditCheck("unknown.check", bundle("<html></html>"))).toThrow(/Unknown active audit check/);
  });

  it("does not count a source-extended route as implemented without an explicit evaluator branch", () => {
    const evidence = bundle("<html><head></head><body><main>Readable main content for deterministic evaluator routing.</main></body></html>");
    const missing = Object.entries(AUDIT_EVALUATOR_KEYS)
      .filter(([, key]) => key === "source_extended")
      .filter(([id]) => evaluateAuditCheck(id, evidence).reason === "This check has no completed evidence evaluator")
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it("has no generic fall-through result among checks counted as implemented", () => {
    const booleanMetrics = new Set(["lcpImageLazy", "viewportRestrictsZoom", "viewportDeviceWidth", "horizontalOverflow", "visibleMainHeading"]);
    const metrics = new Proxy<Record<string, number | string | boolean | null>>({}, {
      get: (_target, property) => property === "lcpElement" ? "img#hero" : booleanMetrics.has(String(property)) ? false : 0,
    });
    const axeRules = ["input-image-alt", "button-name", "aria-required-attr", "aria-valid-attr", "aria-valid-attr-value", "aria-roles", "aria-allowed-attr", "aria-required-parent", "aria-required-children", "duplicate-id-aria", "aria-hidden-focus", "nested-interactive", "tabindex", "scrollable-region-focusable", "label", "select-name", "form-field-multiple-labels", "td-headers-attr", "empty-table-header", "definition-list", "list", "meta-refresh", "svg-img-alt", "color-contrast"];
    const viewport = renderedViewport({ metrics, axe: { version: "4.13.0", violations: [], incomplete: [], passes: axeRules.map((id) => ({ id, nodes: 1 })) } });
    const broad = bundle('<html lang="en"><head><title>Page</title><meta name="description" content="Description"><link rel="canonical" href="/"></head><body><main><h1>Heading</h1><p>Readable content for complete route dispatch validation.</p></main></body></html>', {
      rendered: { desktop: viewport, mobile: viewport },
      canonical: destination({ body: "<html><head></head><body>Canonical</body></html>" }),
      dns: ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "NS", "SOA"].map((recordType) => ({ queriedHostname: "example.com", recordType, responseCode: 0, authenticatedData: false, records: [{ value: recordType === "TXT" ? "v=spf1 -all" : "value", ttl: 300 }], error: null })),
      robots: { url: "https://example.com/robots.txt", destination: destination({ requestedUrl: "https://example.com/robots.txt", finalUrl: "https://example.com/robots.txt", body: "User-agent: *\nAllow: /" }), decisions: Object.fromEntries(["Googlebot", "Bingbot", "OAI-SearchBot", "GPTBot", "ClaudeBot", "Claude-SearchBot"].map((agent) => [agent, { allowed: true, matchedBy: "2" }])), sitemaps: [], parseError: null },
      sitemaps: [{ sourceUrl: "https://example.com/sitemap.xml", destinationState: "success", status: 200, urls: [{ loc: "https://example.com/", lastmod: "2026-10-01" }], error: null }],
    });
    const generic = Object.entries(AUDIT_EVALUATOR_KEYS)
      .filter(([, key]) => key !== "unsupported")
      .map(([id]) => evaluateAuditCheck(id, broad))
      .filter((evaluated) => /still needs|no dedicated|no completed evidence evaluator/i.test(evaluated.reason || ""))
      .map((evaluated) => evaluated.check_id);
    expect(generic).toEqual([]);
  });

  it("preserves source attribute order, duplicate elements and stable source offsets", () => {
    const parsed = parseSourceDom('<html><body><img data-z="1" alt="A" src="a.png"><img alt="B" src="b.png"></body></html>', "https://example.com/");
    const images = parsed.elements.filter((element) => element.tagName === "img");
    expect(images).toHaveLength(2);
    expect(images[0].attributes.map((attribute) => attribute.name)).toEqual(["data-z", "alt", "src"]);
    expect(images[0].sourceOffset).toBeTypeOf("number");
    expect(images[0].locator).not.toBe(images[1].locator);
  });

  it("recovers malformed HTML without inventing a collection failure", () => {
    const parsed = parseSourceDom("<html><body><main><h1>Broken<p>still content", "https://example.com/");
    expect(parsed.collection).toEqual({ status: "complete" });
    expect(parsed.elements.some((element) => element.tagName === "h1")).toBe(true);
  });

  it("parses independent JSON-LD scripts, arrays, @graph and nested entities", () => {
    const parsed = parseSourceDom(`<script type="application/ld+json">[{"@type":"Article","author":{"@type":"Person","@id":"#a"}}]</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","@id":"#o"},{"@type":"WebSite","publisher":{"@id":"#o"}}]}</script>`, "https://example.com/");
    expect(parsed.structuredData).toHaveLength(2);
    const entities = parsed.structuredData.flatMap((block) => block.entities);
    expect(entities.map((entity) => entity.types).flat()).toEqual(expect.arrayContaining(["Article", "Person", "Organization", "WebSite"]));
    expect(entities.find((entity) => entity.id === "#a")?.pointer).toBe("/0/author");
    expect(entities.find((entity) => entity.id === "#o")?.block).toBe(1);
  });

  it.each([
    [401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [410, "gone"], [429, "rate_limited"], [500, "server_error"],
  ] as const)("distinguishes HTTP %s destination outcomes", (status, expected) => {
    expect(classifyDestination(status, null)).toBe(expected);
  });

  it.each([
    ["redirect_loop detected", "redirect_loop"],
    ["redirect_limit exceeded after five hops", "redirect_limit_exceeded"],
    ["DNS ENOTFOUND", "dns_failure"],
    ["TLS certificate failure", "tls_failure"],
    ["request timed out", "timeout"],
  ] as const)("distinguishes collector error %s", (error, expected) => {
    expect(classifyDestination(null, error)).toBe(expected);
  });

  it.each([
    ["redirect_loop", "redirect_loop"],
    ["redirect_limit_exceeded", "redirect_limit_exceeded"],
    ["DNS ENOTFOUND", "dns_failure"],
    ["TLS certificate failure", "tls_failure"],
    ["request timed out", "timeout"],
  ] as const)("retains the destination collector state for %s", async (error, expected) => {
    const inspected = await inspectDestination("https://example.com/", async () => {
      throw new Error(error);
    });
    expect(inspected.state).toBe(expected);
    expect(inspected.status).toBeNull();
    expect(inspected.error).toContain(error);
  });

  it("detects a bot challenge from a bounded destination probe", async () => {
    const inspected = await inspectDestination("https://example.com/", async () => ({
      response: new Response("<title>Verify you are human</title><div class='captcha'></div>", { status: 403, headers: { "content-type": "text/html" } }),
      redirects: [],
    }), { probeChallenge: true, bodyBytes: 16_384 });
    expect(inspected.state).toBe("bot_challenge");
    expect(inspected.body).toBeNull();
  });

  it("turns a stalled destination body into unavailable evidence", async () => {
    const inspected = await inspectDestination("https://example.com/slow", async () => ({
      response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 }),
      redirects: [],
    }), { probeChallenge: true, bodyTimeoutMs: 10 });
    expect(inspected.state).toBe("timeout");
    expect(inspected.error).toMatch(/body timed out/i);
  });

  it("applies one absolute deadline to a continuously streaming body", async () => {
    const encoder = new TextEncoder();
    const inspected = await inspectDestination("https://example.com/drip", async () => ({
      response: new Response(new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.enqueue(encoder.encode("x"));
        },
      }), { status: 200 }),
      redirects: [],
    }), { probeChallenge: true, bodyBytes: 1_024, bodyTimeoutMs: 20 });
    expect(inspected.state).toBe("timeout");
    expect(inspected.error).toMatch(/body timed out/i);
  });

  it("bounds the complete destination inspection when a platform operation never settles", async () => {
    const inspected = await inspectDestination("https://example.com/platform-stall", () => new Promise(() => {}), {
      totalTimeoutMs: 10,
    });
    expect(inspected.state).toBe("timeout");
    expect(inspected.error).toMatch(/inspection timed out/i);
  });

  it("shares validated hosts across link and resource inventories", async () => {
    const validatedHosts = new Set<string>();
    const observedSets: Array<Set<string> | undefined> = [];
    let batches = 0;
    const fetchTrace = async (_url: string, _init?: RequestInit, hosts?: Set<string>) => {
      observedSets.push(hosts);
      return { response: new Response("ok", { status: 200 }), redirects: [] };
    };
    await Promise.all([
      collectLinkInventory([{ originalUrl: "/a", resolvedUrl: "https://example.com/a", sourceElement: "a", locator: "a", internal: true, source: "html", accessibleName: "A" }], fetchTrace, undefined, validatedHosts, async () => { batches += 1; }),
      collectResourceInventory([{ declaredUrl: "/app.css", resolvedUrl: "https://example.com/app.css", declarationType: "stylesheet", locator: "link", source: "html" }], fetchTrace, undefined, validatedHosts, async () => { batches += 1; }),
    ]);
    expect(observedSets).toHaveLength(2);
    expect(observedSets.every((hosts) => hosts === validatedHosts)).toBe(true);
    expect(batches).toBe(2);
  });

  it("reuses BrowserLab response metadata for resources that do not require a body", async () => {
    let fetches = 0;
    const resources = await collectResourceInventory(
      [{ declaredUrl: "/hero.png", resolvedUrl: "https://example.com/hero.png", declarationType: "image", locator: "img", source: "html" }],
      async () => {
        fetches += 1;
        return { response: new Response("unexpected", { status: 200 }), redirects: [] };
      },
      undefined,
      new Set(["example.com"]),
      undefined,
      new Map([["https://example.com/hero.png", { status: 200, headers: { "content-type": "image/png" }, resourceType: "image" }]]),
    );
    expect(fetches).toBe(0);
    expect(resources.requests).toBe(0);
    expect(resources.results[0]).toMatchObject({ status: 200, state: "success", contentType: "image/png", body: null });
  });

  it("parses namespaced sitemap XML without discarding lastmod provenance", () => {
    const parsed = parseSitemapXml(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><lastmod>2026-10-01</lastmod></url></urlset>`, "https://example.com/sitemap.xml");
    expect(parsed.error).toBeNull();
    expect(parsed.sourceUrl).toBe("https://example.com/sitemap.xml");
    expect(parsed.urls).toEqual([{ loc: "https://example.com/a", lastmod: "2026-10-01" }]);
  });

  it("parses font-face declarations with CSS provenance", () => {
    expect(parseFontFaces(`@font-face { font-family: "Inter"; src: url('/inter.woff2') format('woff2'); font-display: swap; }`, "https://example.com/app.css"))
      .toMatchObject([{ stylesheetUrl: "https://example.com/app.css", fontDisplay: "swap", fontSources: ["/inter.woff2"] }]);
  });

  it("uses rendered evidence before failing a client-rendered H1", () => {
    const evidence = bundle("<html><body><div id='app'></div></body></html>", {
      rendered: {
        desktop: renderedViewport({ occurrences: { h1: [{ locator: "h1", html: "<h1>Client title</h1>", source: "rendered", viewport: "desktop" }] } }),
        mobile: renderedViewport({ occurrences: { h1: [{ locator: "h1", html: "<h1>Client title</h1>", source: "rendered", viewport: "mobile" }] } }),
      },
    });
    expect(evaluateAuditCheck("seo.content.h1.present", evidence).outcome).toBe("passed");
  });

  it("uses the canonical target body rather than selected-page noindex evidence", () => {
    const selected = "<html><head><meta name='robots' content='noindex'><link rel='canonical' href='/canonical'></head></html>";
    const safeTarget = bundle(selected, { canonical: destination({ requestedUrl: "https://example.com/canonical", finalUrl: "https://example.com/canonical", body: "<html><head><meta name='robots' content='index'></head></html>" }) });
    const blockedTarget = bundle(selected, { canonical: destination({ requestedUrl: "https://example.com/canonical", finalUrl: "https://example.com/canonical", body: "<html><head><meta name='robots' content='noindex'></head></html>" }) });
    expect(evaluateAuditCheck("seo.page.metadata.canonical.target.contains.a.noindex.directive", safeTarget).outcome).toBe("passed");
    expect(evaluateAuditCheck("seo.page.metadata.canonical.target.contains.a.noindex.directive", blockedTarget).outcome).toBe("failed");
  });

  it("evaluates duplicate metadata, canonical declarations and HTML language from collected source", () => {
    const evidence = bundle(`<html lang="en-GB"><head><title>One</title><title>Two</title><meta name="description" content="One"><meta name="description" content="Two"><link rel="canonical" href="/page"></head></html>`);
    expect(evaluateAuditCheck("seo.page.metadata.multiple.page.titles.detected", evidence).outcome).toBe("failed");
    expect(evaluateAuditCheck("seo.page.metadata.multiple.meta.descriptions.detected", evidence).outcome).toBe("failed");
    expect(evaluateAuditCheck("seo.page.metadata.canonical.url.declared", evidence).outcome).toBe("passed");
    expect(evaluateAuditCheck("seo.page.metadata.canonical.url.format.valid", evidence).outcome).toBe("passed");
    expect(evaluateAuditCheck("seo.page.metadata.html.language.declared", evidence).outcome).toBe("passed");
    expect(evaluateAuditCheck("seo.page.metadata.html.language.code.valid", evidence).outcome).toBe("passed");
  });

  it("keeps HTML language evidence compact even when the document is large", () => {
    const evidence = bundle(`<html lang="en-GB"><body>${"Large document content ".repeat(10_000)}</body></html>`);
    const evaluated = evaluateAuditCheck("seo.page.metadata.html.language.declared", evidence);
    expect(evaluated.outcome).toBe("passed");
    expect(evaluated.evidence).toMatchObject({
      language: "en-GB",
      occurrences: [{ locator: "html", html: '<html lang="en-GB">', source: "html", values: { language: "en-GB" } }],
    });
    expect(JSON.stringify(evaluated.evidence).length).toBeLessThan(300);
  });

  it("fails required metadata when it is missing and uses not-applicable only for a dependent check", () => {
    const evidence = bundle("<html><head></head><body></body></html>");
    expect(evaluateAuditCheck("seo.page.metadata.canonical.url.declared", evidence).outcome).toBe("failed");
    expect(evaluateAuditCheck("seo.page.metadata.html.language.declared", evidence).outcome).toBe("failed");
    const dependent = evaluateAuditCheck("seo.page.metadata.canonical.url.format.valid", evidence);
    expect(dependent.outcome).toBe("not_applicable");
    expect(dependent.evidence.reason).toMatch(/No canonical declaration/);
  });

  it("does not pass a canonical target check when destination evidence is unavailable", () => {
    const evidence = bundle('<html><head><link rel="canonical" href="/target"></head></html>', {
      canonical: destination({ state: "dns_failure", status: null, finalUrl: null, body: null, error: "DNS ENOTFOUND" }),
    });
    expect(evaluateAuditCheck("seo.page.metadata.canonical.target.reachable", evidence).outcome).toBe("unable_to_test");
  });

  it("evaluates image-button names independently from generic buttons", () => {
    const evidence = bundle("<html><body><button>Ordinary</button><input type='image' src='submit.png'><input type='image' alt='Send' src='send.png'></body></html>");
    const result = evaluateAuditCheck("accessibility.accessibility.image.buttons.have.accessible.names", evidence);
    expect(result.outcome).toBe("failed");
    expect((result.evidence.occurrences as unknown[])).toHaveLength(1);
  });

  it("turns incomplete required evidence into unable-to-test with a reason", () => {
    const evidence = bundle("<html></html>");
    evidence.source.collection = { status: "failed", reason: "parser crashed" };
    const result = evaluateAuditCheck("seo.metadata.title.present", evidence);
    expect(result.outcome).toBe("unable_to_test");
    expect(result.reason).toMatch(/did not complete/);
  });

  it("does not infer a clean header result from a failed HTTP collection", () => {
    const evidence = bundle("<html></html>");
    evidence.http.collection = { status: "failed", reason: "upstream reset" };
    evidence.http.status = null;
    expect(evaluateAuditCheck("infrastructure.server.and.http.information.server.software.header.detected", evidence).outcome).toBe("unable_to_test");
    expect(evaluateAuditCheck("security.headers.hsts", evidence).outcome).toBe("unable_to_test");
  });

  it("uses advisory rather than failure for missing optional resources", () => {
    const result = evaluateAuditCheck("seo.social.sharing.and.site.identity.declared.favicon.reachable", bundle("<html></html>"));
    expect(result.outcome).toBe("advisory");
  });

  it("retains every occurrence without a UI-sized ten-item truncation", () => {
    const html = `<html><body>${Array.from({ length: 47 }, (_, index) => `<img src="${index}.png">`).join("")}</body></html>`;
    const result = evaluateAuditCheck("accessibility.images.and.media.images.contain.alt.attributes", bundle(html));
    expect(result.outcome).toBe("failed");
    expect(result.evidence.totalDiscovered).toBe(47);
    expect((result.evidence.occurrences as unknown[])).toHaveLength(47);
    expect(result.evidence.truncated).toBe(false);
  });

  it("isolates performance evidence to the requested metric", () => {
    const viewport = renderedViewport({ metrics: { lcp: 2_900, cls: 0.31, consoleErrors: 9, imageCount: 42 } });
    const result = evaluateAuditCheck("performance.performance.largest.contentful.paint.measured", bundle("<html></html>", { rendered: { desktop: viewport, mobile: viewport } }));
    expect(result.evidence).toEqual({ desktop: { value: 2900, unit: "ms" }, mobile: { value: 2900, unit: "ms" }, threshold: { good: 2500, poor: 4000 } });
    expect(JSON.stringify(result.evidence)).not.toContain("consoleErrors");
    expect(JSON.stringify(result.evidence)).not.toContain("imageCount");
  });

  it("does not coerce a missing browser metric to zero and pass it", () => {
    const viewport = renderedViewport({ metrics: { lcp: null } });
    const evaluated = evaluateAuditCheck("performance.performance.largest.contentful.paint.measured", bundle("<html></html>", { rendered: { desktop: viewport, mobile: viewport } }));
    expect(evaluated.outcome).toBe("unable_to_test");
  });

  it("distinguishes axe passes, incomplete checks and inapplicable rules", () => {
    const passing = renderedViewport({ axe: { version: "4.13.0", violations: [], incomplete: [], passes: [{ id: "button-name", nodes: 2 }] } });
    expect(evaluateAuditCheck("accessibility.accessibility.buttons.have.accessible.names", bundle("<button>Save</button>", { rendered: { desktop: passing, mobile: passing } })).outcome).toBe("passed");
    const incomplete = renderedViewport({ axe: { version: "4.13.0", violations: [], passes: [], incomplete: [{ id: "button-name", impact: null, nodes: [{ source: "accessibility", locator: "button" }] }] } });
    expect(evaluateAuditCheck("accessibility.accessibility.buttons.have.accessible.names", bundle("<button></button>", { rendered: { desktop: incomplete, mobile: incomplete } })).outcome).toBe("unable_to_test");
    const inapplicable = renderedViewport();
    expect(evaluateAuditCheck("accessibility.accessibility.buttons.have.accessible.names", bundle("<p>No buttons</p>", { rendered: { desktop: inapplicable, mobile: inapplicable } })).outcome).toBe("not_applicable");
    const failing = renderedViewport({ axe: { version: "4.13.0", passes: [], incomplete: [], violations: [{ id: "button-name", impact: "critical", nodes: [{ source: "accessibility", locator: "#save", html: '<button id="save"></button>' }] }] } });
    const failed = evaluateAuditCheck("accessibility.accessibility.buttons.have.accessible.names", bundle('<button id="save"></button>', { rendered: { desktop: failing, mobile: failing } }));
    expect(failed.outcome).toBe("failed");
    expect(failed.evidence).toMatchObject({ rule: "button-name", occurrences: [{ locator: "#save" }, { locator: "#save" }] });
    expect(failed.evidence).toMatchObject({ retained: 2, truncated: false });
  });

  it("does not pass checked-link findings when destination collection is partial", () => {
    const evidence = bundle('<a href="https://outside.example/a">A</a>', {
      links: {
        declarations: parseSourceDom('<a href="https://outside.example/a">A</a>', "https://example.com/").links,
        results: [destination({ requestedUrl: "https://outside.example/a", state: "timeout", status: null, finalUrl: null, error: "request timed out" })],
        totalDiscovered: 1,
        retained: 1,
        truncated: false,
        requests: 1,
      },
    });
    expect(evaluateAuditCheck("seo.links.and.navigation.checked.links.returning.http.404.detected", evidence).outcome).toBe("unable_to_test");
  });

  it("never turns incomplete browser evidence or missing axe output into a pass", () => {
    const partial = renderedViewport({ collection: { status: "partial", reason: "timeout" } });
    expect(evaluateAuditCheck("performance.performance.largest.contentful.paint.measured", bundle("<html></html>", { rendered: { desktop: partial, mobile: partial } })).outcome).toBe("unable_to_test");
    const noAxe = renderedViewport({ axe: null });
    expect(evaluateAuditCheck("accessibility.accessibility.text.contrast.measured.where.calculable", bundle("<html></html>", { rendered: { desktop: noAxe, mobile: noAxe } })).outcome).toBe("unable_to_test");
  });
});
