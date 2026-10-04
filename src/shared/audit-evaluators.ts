import { AUDIT_REGISTRY, type AuditCheck } from "./audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS, type AuditCheckId, type AuditEvaluatorKey } from "./audit-evaluator-map.generated";
import {
  headerValues,
  occurrenceEnvelope,
  parseSourceDom,
  type AuditOccurrence,
  type AuditOutcome,
  type DestinationEvidence,
  type DnsEvidence,
  type FontFaceEvidence,
  type HttpEvidence,
  type LinkDeclaration,
  type ResourceEvidence,
  type ResourceDeclaration,
  type SitemapEvidence,
  type SourceDomEvidence,
} from "./audit-evidence";
import type { InventoryCollection, RobotsEvidence } from "./audit-collectors";

export type RenderedViewportEvidence = {
  collection: { status: "complete" | "partial" | "failed"; reason?: string };
  durationMs: number;
  metrics: Record<string, number | string | boolean | null>;
  occurrences: Record<string, AuditOccurrence[]>;
  networkResources: Array<{
    url: string;
    resourceType: string;
    status: number | null;
    headers: Record<string, string>;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  }>;
  axe: { version: string; violations: Array<{ id: string; impact: string | null; nodes: AuditOccurrence[] }> } | null;
};

export type AuditEvidenceBundle = {
  http: HttpEvidence;
  source: SourceDomEvidence;
  rendered: { desktop: RenderedViewportEvidence; mobile: RenderedViewportEvidence } | null;
  links: InventoryCollection<DestinationEvidence, LinkDeclaration>;
  resources: InventoryCollection<ResourceEvidence, ResourceDeclaration>;
  canonical: DestinationEvidence | null;
  dns: DnsEvidence[];
  robots: RobotsEvidence | null;
  sitemaps: SitemapEvidence[];
  fontFaces: FontFaceEvidence[];
};

export type TypedAuditResult = {
  check_id: string;
  outcome: AuditOutcome;
  reason?: string;
  evidence: Record<string, unknown>;
  duration_ms: number;
};

type AuditEvaluator = (check: AuditCheck, evidence: AuditEvidenceBundle) => Omit<TypedAuditResult, "check_id" | "duration_ms">;

const sourceElements = (evidence: AuditEvidenceBundle, tagName: string) => evidence.source.elements.filter((element) => element.tagName === tagName);
const attr = (element: SourceDomEvidence["elements"][number], name: string) => element.attributes.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
const occurrence = (element: SourceDomEvidence["elements"][number], values?: Record<string, unknown>): AuditOccurrence => ({ locator: element.locator, html: element.html, source: "html", values });
const result = (outcome: AuditOutcome, evidence: Record<string, unknown>, reason?: string) => ({ outcome, evidence, ...(reason ? { reason } : {}) });
const unable = (reason: string, evidence: Record<string, unknown> = {}) => result("unable_to_test", { ...evidence, reason }, reason);
const optionalMissing = (feature: string) => result("advisory", { present: false, feature }, `${feature} is optional and was not detected`);

function sourceCoreEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete") return unable("Source HTML collection or parsing did not complete", { collection: evidence.source.collection });
  const titles = sourceElements(evidence, "title");
  const title = titles[0]?.text.trim() || "";
  const metas = sourceElements(evidence, "meta");
  const meta = (name: string) => metas.find((element) => [attr(element, "name"), attr(element, "property")].some((value) => value?.toLowerCase() === name.toLowerCase()));
  const description = meta("description");
  const h1s = sourceElements(evidence, "h1");
  switch (check.id) {
    case "seo.metadata.title.present":
    case "accessibility.document.title":
      return result(title ? "passed" : "failed", { title: title || null, occurrences: titles.map((item) => occurrence(item)) });
    case "seo.metadata.title.not_empty":
      return result(!titles.length ? "not_applicable" : title ? "passed" : "failed", { length: title.length, occurrences: titles.map((item) => occurrence(item)) });
    case "seo.metadata.title.length":
      return result(!title ? "not_applicable" : title.length <= 60 ? "passed" : "advisory", { length: title.length, threshold: 60 });
    case "seo.metadata.description.present":
      return result(description ? "passed" : "failed", { present: Boolean(description), occurrences: description ? [occurrence(description)] : [] });
    case "seo.metadata.description.not_empty": {
      const value = description ? attr(description, "content") || "" : null;
      return result(value == null ? "not_applicable" : value.trim() ? "passed" : "failed", { length: value?.trim().length || 0, occurrences: description ? [occurrence(description)] : [] });
    }
    case "seo.crawling.http_status":
      if (evidence.http.status == null) return unable("The selected page did not return an HTTP response", { http: evidence.http.collection });
      return result(evidence.http.status >= 200 && evidence.http.status < 400 ? "passed" : "failed", { status: evidence.http.status, finalUrl: evidence.http.finalUrl });
    case "seo.crawling.html_content": {
      const contentType = evidence.http.contentType || "";
      return result(/(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? "passed" : "failed", { contentType });
    }
    case "seo.content.h1.present": {
      if (h1s.length) return result("passed", { sourceCount: h1s.length, occurrences: h1s.map((item) => occurrence(item)) });
      if (!evidence.rendered) return unable("No H1 was present in source HTML and rendered DOM evidence was unavailable", { sourceCount: 0 });
      const rendered = ["desktop", "mobile"].flatMap((viewport) => evidence.rendered?.[viewport as "desktop" | "mobile"].occurrences.h1 || []);
      return result(rendered.length ? "passed" : "failed", { sourceCount: 0, ...occurrenceEnvelope(rendered) });
    }
    case "seo.content.h1.multiple":
      return result(h1s.length <= 1 ? "passed" : "advisory", { count: h1s.length, ...occurrenceEnvelope(h1s.map((item) => occurrence(item))) });
    case "seo.content.structure.and.headings.empty.h1.headings.detected": {
      const empty = h1s.filter((item) => !item.text.trim());
      return result(empty.length ? "failed" : "passed", occurrenceEnvelope(empty.map((item) => occurrence(item))));
    }
    case "seo.content.structure.and.headings.empty.h2.to.h6.headings.detected": {
      const headings = ["h2", "h3", "h4", "h5", "h6"].flatMap((tag) => sourceElements(evidence, tag));
      const empty = headings.filter((item) => !item.text.trim());
      return result(empty.length ? "failed" : "passed", occurrenceEnvelope(empty.map((item) => occurrence(item))));
    }
    case "accessibility.mobile.viewport":
      return result(meta("viewport") ? "passed" : "failed", { occurrences: meta("viewport") ? [occurrence(meta("viewport")!)] : [] });
    case "security.https.selected":
      return result(evidence.http.finalUrl?.startsWith("https://") ? "passed" : "failed", { finalUrl: evidence.http.finalUrl });
    case "security.headers.hsts": {
      const values = headerValues(evidence.http.headers, "strict-transport-security");
      return result(values.length ? "passed" : "advisory", { values });
    }
    case "security.headers.csp": {
      const values = headerValues(evidence.http.headers, "content-security-policy");
      return result(values.length ? "passed" : "advisory", { values });
    }
    case "infrastructure.http.content_type":
      return result(evidence.http.contentType ? "passed" : "unable_to_test", { contentType: evidence.http.contentType });
    case "ai.content.source_extractable": {
      const main = sourceElements(evidence, "main");
      const length = main.map((item) => item.text).join(" ").trim().length;
      return result(length >= 100 ? "passed" : "advisory", { mainTextLength: length });
    }
    case "accessibility.images.and.media.images.contain.alt.attributes": {
      const images = sourceElements(evidence, "img");
      if (!images.length) return result("not_applicable", { images: 0 });
      const missing = images.filter((item) => attr(item, "alt") == null);
      return result(missing.length ? "failed" : "passed", { images: images.length, ...occurrenceEnvelope(missing.map((item) => occurrence(item))) });
    }
    case "accessibility.accessibility.image.buttons.have.accessible.names": {
      const inputs = sourceElements(evidence, "input").filter((item) => attr(item, "type")?.toLowerCase() === "image");
      if (!inputs.length) return result("not_applicable", { imageButtons: 0 });
      const unnamed = inputs.filter((item) => !["alt", "aria-label", "title"].some((name) => (attr(item, name) || "").trim()));
      return result(unnamed.length ? "failed" : "passed", { imageButtons: inputs.length, ...occurrenceEnvelope(unnamed.map((item) => occurrence(item))) });
    }
    case "seo.page.metadata.canonical.target.contains.a.noindex.directive": {
      if (!evidence.canonical) return result("not_applicable", { canonical: null });
      if (["dns_failure", "tls_failure", "timeout", "unable_to_test", "bot_challenge"].includes(evidence.canonical.state))
        return unable("Canonical target could not be inspected", { canonical: evidence.canonical });
      const robotsHeader = headerValues(evidence.canonical.headers, "x-robots-tag").join(",");
      const canonicalDom = evidence.canonical.body && evidence.canonical.finalUrl
        ? parseSourceDom(evidence.canonical.body, evidence.canonical.finalUrl)
        : null;
      const parsedTarget = canonicalDom?.elements.some((element) =>
        element.tagName === "meta"
        && [attr(element, "name"), attr(element, "property")].some((value) => value?.toLowerCase() === "robots")
        && /\bnoindex\b/i.test(attr(element, "content") || "")) || false;
      const noindex = /\bnoindex\b/i.test(robotsHeader) || parsedTarget;
      return result(noindex ? "failed" : "passed", { canonicalUrl: evidence.canonical.finalUrl, xRobotsTag: robotsHeader || null, metaNoindex: parsedTarget, inspectedTarget: true });
    }
    default:
      return unable("No dedicated source evaluator is registered for this check");
  }
}

function linkInventoryEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  const discovered = evidence.links.declarations;
  const checked = evidence.links.results;
  const byUrl = new Map(checked.map((item) => [item.requestedUrl, item]));
  const occurrencesFor = (items: typeof discovered) => occurrenceEnvelope(items.map((item) => ({ locator: item.locator, url: item.resolvedUrl || item.originalUrl, source: item.source, values: { originalUrl: item.originalUrl } } as AuditOccurrence)));
  const checkedOccurrences = (states: string[]) => checked.filter((item) => states.includes(item.state)).map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, status: item.status, finalUrl: item.finalUrl, error: item.error, redirects: item.redirectTrace } } as AuditOccurrence));
  const completePass = (failures: AuditOccurrence[], failedOutcome: AuditOutcome = "failed") => failures.length
    ? result(failedOutcome, occurrenceEnvelope(failures))
    : evidence.links.truncated
      ? unable("Link sampling limit was reached; the retained sample contained no issue", { totalDiscovered: evidence.links.totalDiscovered, retained: evidence.links.retained, truncated: true })
      : result("passed", { checked: checked.length, totalDiscovered: evidence.links.totalDiscovered });
  switch (check.id) {
    case "seo.links.and.navigation.links.have.non.empty.destinations": {
      const empty = discovered.filter((item) => !item.originalUrl.trim());
      return completePass(occurrencesFor(empty).occurrences);
    }
    case "seo.links.and.navigation.links.have.accessible.names": {
      const unnamed = discovered.filter((item) => !item.accessibleName);
      return completePass(occurrencesFor(unnamed).occurrences);
    }
    case "seo.links.and.navigation.empty.anchor.text.detected": {
      const unnamed = discovered.filter((item) => !item.accessibleName);
      return completePass(occurrencesFor(unnamed).occurrences);
    }
    case "seo.links.and.navigation.placeholder.link.destinations.detected": {
      const matches = discovered.filter((item) => ["#", "javascript:void(0)", "javascript:;"].includes(item.originalUrl.trim().toLowerCase()));
      return completePass(occurrencesFor(matches).occurrences);
    }
    case "seo.links.and.navigation.internal.links.identified":
      return result(discovered.some((item) => item.internal) ? "passed" : "not_applicable", { count: discovered.filter((item) => item.internal).length });
    case "seo.links.and.navigation.external.links.identified":
      return result(discovered.some((item) => item.internal === false) ? "passed" : "not_applicable", { count: discovered.filter((item) => item.internal === false).length });
    case "seo.links.and.navigation.checked.links.returning.http.404.detected": return completePass(checkedOccurrences(["not_found"]));
    case "seo.links.and.navigation.checked.links.returning.http.410.detected": return completePass(checkedOccurrences(["gone"]));
    case "seo.links.and.navigation.checked.links.returning.server.errors.detected": return completePass(checkedOccurrences(["server_error"]));
    case "seo.links.and.navigation.checked.links.failing.dns.resolution.detected": return completePass(checkedOccurrences(["dns_failure"]));
    case "seo.links.and.navigation.checked.links.failing.https.connections.detected": return completePass(checkedOccurrences(["tls_failure"]));
    case "seo.links.and.navigation.checked.links.timing.out.detected": return completePass(checkedOccurrences(["timeout"]));
    case "seo.links.and.navigation.checked.links.blocked.by.access.restrictions.detected": return completePass(checkedOccurrences(["unauthorized", "forbidden", "bot_challenge"]));
    case "seo.links.and.navigation.checked.links.encountering.rate.limits.detected": return completePass(checkedOccurrences(["rate_limited"]));
    case "seo.links.and.navigation.checked.links.containing.redirect.loops.detected": return completePass(checkedOccurrences(["redirect_loop"]));
    case "seo.links.and.navigation.checked.links.exceeding.the.redirect.limit.detected": return completePass(checkedOccurrences(["redirect_limit_exceeded"]));
    case "seo.links.and.navigation.checked.links.redirecting.to.broken.destinations.detected":
      return completePass(checked.filter((item) => item.redirectTrace.length && ["not_found", "gone", "server_error"].includes(item.state)).map((item) => ({ url: item.requestedUrl, source: "network", values: { finalUrl: item.finalUrl, state: item.state } })));
    case "seo.links.and.navigation.redirecting.internal.links.detected":
    case "seo.links.and.navigation.redirecting.external.links.detected": {
      const internal = check.id === "seo.links.and.navigation.redirecting.internal.links.detected";
      const urls = new Set(discovered.filter((item) => item.internal === internal).map((item) => item.resolvedUrl));
      const redirected = checked.filter((item) => urls.has(item.requestedUrl) && item.redirectTrace.length).map((item) => ({ url: item.requestedUrl, source: "network", values: { finalUrl: item.finalUrl, redirects: item.redirectTrace } } as AuditOccurrence));
      return completePass(redirected, "advisory");
    }
    case "seo.links.and.navigation.checked.and.unchecked.link.totals.recorded":
      return result(evidence.links.truncated ? "unable_to_test" : "passed", { discovered: evidence.links.totalDiscovered, checked: checked.length, unchecked: Math.max(0, evidence.links.totalDiscovered - checked.length), truncated: evidence.links.truncated });
    case "seo.links.and.navigation.https.page.links.to.http.destinations": {
      const matches = evidence.http.finalUrl?.startsWith("https://") ? discovered.filter((item) => item.resolvedUrl?.startsWith("http://")) : [];
      return completePass(occurrencesFor(matches).occurrences);
    }
    case "seo.links.and.navigation.on.page.fragment.links.point.to.existing.elements": {
      const ids = new Set(evidence.source.elements.map((item) => attr(item, "id")).filter(Boolean));
      const broken = discovered.filter((item) => item.originalUrl.startsWith("#") && !ids.has(decodeURIComponent(item.originalUrl.slice(1))));
      return completePass(occurrencesFor(broken).occurrences);
    }
    case "seo.links.and.navigation.download.links.identified":
      return result("passed", { count: evidence.source.elements.filter((item) => item.tagName === "a" && attr(item, "download") != null).length });
    case "seo.links.and.navigation.telephone.link.formats.checked": {
      const tel = discovered.filter((item) => item.originalUrl.startsWith("tel:"));
      const invalid = tel.filter((item) => !/^tel:\+?[0-9().\s-]+$/i.test(item.originalUrl));
      return tel.length ? completePass(occurrencesFor(invalid).occurrences) : result("not_applicable", { count: 0 });
    }
    case "seo.links.and.navigation.email.link.formats.checked": {
      const mail = discovered.filter((item) => item.originalUrl.startsWith("mailto:"));
      const invalid = mail.filter((item) => !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/i.test(item.originalUrl));
      return mail.length ? completePass(occurrencesFor(invalid).occurrences) : result("not_applicable", { count: 0 });
    }
    default:
      return unable("This link check has an explicit route but still needs a dedicated evaluator", { discovered: discovered.length, checked: checked.length, deduplicated: byUrl.size });
  }
}

function resourceInventoryEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  const typeFor: Record<string, string> = {
    "accessibility.images.and.media.caption.track.resources.reachable": "caption",
    "seo.structured.data.checked.structured.data.image.urls.reachable": "structured-data-image",
    "seo.social.sharing.and.site.identity.open.graph.image.reachable": "social-image",
    "seo.social.sharing.and.site.identity.declared.favicon.reachable": "favicon",
    "seo.social.sharing.and.site.identity.declared.apple.touch.icon.reachable": "apple-touch-icon",
    "seo.social.sharing.and.site.identity.linked.web.app.manifest.reachable": "manifest",
    "seo.social.sharing.and.site.identity.web.app.manifest.contains.valid.json": "manifest",
    "ai_readiness.optional.resources.declared.markdown.alternative.reachable": "markdown-alternative",
    "ai_readiness.optional.resources.declared.markdown.alternative.contains.readable.content": "markdown-alternative",
  };
  const kind = typeFor[check.id];
  if (!kind) return unable("No resource type is registered for this check");
  const declarations = evidence.resources.declarations.filter((item) => item.declarationType === kind);
  const rows = evidence.resources.results.filter((item) => item.declarations.some((declaration) => declaration.declarationType === kind));
  if (!declarations.length) return optionalMissing(kind);
  if (!rows.length) return unable(`Declared ${kind} resources were not collected`, { declarations: declarations.length, collectionTruncated: evidence.resources.truncated });
  if (check.id === "seo.social.sharing.and.site.identity.web.app.manifest.contains.valid.json") {
    if (rows.some((item) => item.bodyTruncated)) return unable("A manifest exceeded the bounded response-body limit", { manifests: rows.length });
    const invalid = rows.filter((item) => { try { JSON.parse(item.body || ""); return false; } catch { return true; } });
    return result(invalid.length ? "failed" : "passed", occurrenceEnvelope(invalid.map((item) => ({ url: item.requestedUrl, source: "network", values: { status: item.status, error: item.error } }))));
  }
  if (check.id === "ai_readiness.optional.resources.declared.markdown.alternative.contains.readable.content") {
    if (rows.some((item) => item.bodyTruncated)) return unable("A Markdown alternative exceeded the bounded response-body limit", { alternatives: rows.length });
    const unreadable = rows.filter((item) => (item.body || "").replace(/[#*`>\[\]()_-]/g, "").trim().length < 80);
    return result(unreadable.length ? "advisory" : "passed", occurrenceEnvelope(unreadable.map((item) => ({ url: item.requestedUrl, source: "network", values: { characters: item.body?.length || 0 } }))));
  }
  const failures = rows.filter((item) => !["success", "redirect"].includes(item.state));
  const untestable = failures.filter((item) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(item.state));
  if (untestable.length) return unable("One or more declared resources could not be confidently tested", occurrenceEnvelope(untestable.map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, error: item.error } }))));
  return result(failures.length ? "failed" : "passed", { checked: rows.length, ...occurrenceEnvelope(failures.map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, status: item.status } }))) });
}

function structuredDataEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  const blocks = evidence.source.structuredData;
  const entities = blocks.flatMap((block) => block.entities);
  switch (check.id) {
    case "seo.structured.data.json.ld.blocks.detected":
      return result(blocks.length ? "passed" : "not_applicable", { blocks: blocks.length });
    case "seo.structured.data.json.ld.syntax.valid": {
      if (!blocks.length) return result("not_applicable", { blocks: 0 });
      const invalid = blocks.filter((block) => block.error);
      return result(invalid.length ? "failed" : "passed", occurrenceEnvelope(invalid.map((block) => ({ locator: block.locator, source: "html", values: { block: block.index, error: block.error } }))));
    }
    case "seo.structured.data.schema.org.types.identified":
      return result(entities.length ? "passed" : "not_applicable", { types: [...new Set(entities.flatMap((entity) => entity.types))], entities: entities.length });
    case "seo.structured.data.duplicate.entity.identifiers.contain.conflicting.values": {
      const grouped = new Map<string, string[]>();
      for (const entity of entities) if (entity.id) grouped.set(entity.id, [...(grouped.get(entity.id) || []), JSON.stringify(entity.value)]);
      const conflicts = [...grouped.entries()].filter(([, values]) => new Set(values).size > 1).map(([id]) => id);
      return result(conflicts.length ? "failed" : "passed", { conflicts });
    }
    default:
      return unable("This structured-data check has an explicit route but still needs a dedicated evaluator", { blocks: blocks.length, entities: entities.length });
  }
}

const performanceMetrics: Record<string, { field: string; good: number; poor: number; unit: string }> = {
  "performance.performance.document.response.time.measured": { field: "documentResponseMs", good: 800, poor: 1800, unit: "ms" },
  "performance.performance.first.contentful.paint.measured": { field: "fcp", good: 1800, poor: 3000, unit: "ms" },
  "performance.performance.largest.contentful.paint.measured": { field: "lcp", good: 2500, poor: 4000, unit: "ms" },
  "performance.performance.cumulative.layout.shift.measured": { field: "cls", good: .1, poor: .25, unit: "score" },
  "performance.performance.total.blocking.time.measured": { field: "tbt", good: 200, poor: 600, unit: "ms" },
  "performance.performance.total.transferred.page.size.measured": { field: "bytes", good: 1_600_000, poor: 3_000_000, unit: "bytes" },
  "performance.performance.total.resource.request.count.measured": { field: "requests", good: 50, poor: 100, unit: "count" },
  "performance.performance.javascript.transfer.size.measured": { field: "scriptBytes", good: 600_000, poor: 1_000_000, unit: "bytes" },
  "performance.performance.css.transfer.size.measured": { field: "cssBytes", good: 150_000, poor: 300_000, unit: "bytes" },
  "performance.performance.image.transfer.size.measured": { field: "imageBytes", good: 1_000_000, poor: 2_000_000, unit: "bytes" },
  "performance.performance.font.transfer.size.measured": { field: "fontBytes", good: 200_000, poor: 500_000, unit: "bytes" },
  "performance.performance.third.party.request.count.measured": { field: "thirdPartyRequests", good: 10, poor: 25, unit: "count" },
  "performance.performance.render.blocking.resources.detected": { field: "renderBlocking", good: 0, poor: 5, unit: "count" },
  "performance.performance.long.main.thread.tasks.detected": { field: "longTasks", good: 0, poor: 5, unit: "count" },
  "performance.performance.unused.javascript.estimated": { field: "unusedJavaScriptBytes", good: 20_000, poor: 100_000, unit: "bytes" },
  "performance.performance.unused.css.estimated": { field: "unusedCssBytes", good: 10_000, poor: 50_000, unit: "bytes" },
  "performance.performance.largest.contentful.paint.resource.discovery.delay.measured": { field: "lcpDiscoveryDelay", good: 500, poor: 1500, unit: "ms" },
  "performance.performance.layout.shift.contributors.identified": { field: "layoutShiftContributors", good: 0, poor: 4, unit: "count" },
  "performance.performance.failed.network.requests.detected": { field: "failedRequests", good: 0, poor: 2, unit: "count" },
  "performance.performance.browser.console.errors.detected": { field: "consoleErrors", good: 0, poor: 3, unit: "count" },
  "performance.performance.uncaught.javascript.exceptions.detected": { field: "uncaughtExceptions", good: 0, poor: 1, unit: "count" },
  "performance.performance.repeated.downloads.of.the.same.resource.detected": { field: "repeatedDownloads", good: 0, poor: 3, unit: "count" },
  "performance.performance.preloaded.resources.unused.during.the.test.detected": { field: "unusedPreloads", good: 0, poor: 2, unit: "count" },
};

function performanceMetricEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.rendered) return unable("Rendered browser evidence was unavailable");
  if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("One or more browser viewport collections were incomplete", { desktop: evidence.rendered.desktop.collection, mobile: evidence.rendered.mobile.collection });
  if (check.id === "performance.performance.largest.contentful.paint.element.identified") {
    const desktop = evidence.rendered.desktop.metrics.lcpElement || null;
    const mobile = evidence.rendered.mobile.metrics.lcpElement || null;
    return result(desktop || mobile ? "passed" : "unable_to_test", { desktop: { element: desktop }, mobile: { element: mobile } }, desktop || mobile ? undefined : "The browser did not expose an LCP element");
  }
  if (check.id === "performance.performance.resource.preload.declarations.inspected")
    return result("passed", { desktop: { count: evidence.rendered.desktop.metrics.preloads || 0 }, mobile: { count: evidence.rendered.mobile.metrics.preloads || 0 } });
  const config = performanceMetrics[check.id];
  if (!config) return unable("No dedicated performance metric evaluator is registered for this check");
  const desktop = Number(evidence.rendered.desktop.metrics[config.field]);
  const mobile = Number(evidence.rendered.mobile.metrics[config.field]);
  if (!Number.isFinite(desktop) || !Number.isFinite(mobile)) return unable(`Required browser metric ${config.field} was missing`);
  const worst = Math.max(desktop, mobile);
  const outcome: AuditOutcome = worst <= config.good ? "passed" : worst >= config.poor ? "failed" : "advisory";
  return result(outcome, { desktop: { value: desktop, unit: config.unit }, mobile: { value: mobile, unit: config.unit }, threshold: { good: config.good, poor: config.poor } });
}

function textCompressionEvaluator(_check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.rendered) return unable("Browser network evidence was unavailable");
  if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("Browser network evidence was incomplete");
  const rows = [...evidence.rendered.desktop.networkResources, ...evidence.rendered.mobile.networkResources]
    .filter((item) => /(?:document|script|stylesheet|xhr|fetch)/i.test(item.resourceType));
  if (!rows.length) return unable("No text resources were captured by the browser network collector");
  const unique = [...new Map(rows.map((row) => [row.url, row])).values()];
  const occurrences = unique.filter((row) => row.decodedBodySize > 1024 && !/\b(?:br|gzip|deflate|zstd)\b/i.test(row.headers["content-encoding"] || "")).map((row) => ({ url: row.url, resourceType: row.resourceType, source: "network", values: { contentEncoding: row.headers["content-encoding"] || null, encodedBytes: row.encodedBodySize, decodedBytes: row.decodedBodySize } } as AuditOccurrence));
  return result(occurrences.length ? "advisory" : "passed", { checked: unique.length, ...occurrenceEnvelope(occurrences) });
}

function staticResourceCacheEvaluator(_check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.rendered) return unable("Browser network evidence was unavailable");
  if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("Browser network evidence was incomplete");
  const rows = [...evidence.rendered.desktop.networkResources, ...evidence.rendered.mobile.networkResources].filter((item) => !/document|xhr|fetch/i.test(item.resourceType));
  if (!rows.length) return result("not_applicable", { checked: 0 });
  const unique = [...new Map(rows.map((row) => [row.url, row])).values()];
  const weak = unique.filter((row) => {
    const cacheControl = row.headers["cache-control"] || "";
    const expires = row.headers.expires || "";
    return !/(?:max-age|s-maxage|immutable)/i.test(cacheControl) && !expires;
  });
  return result(weak.length ? "advisory" : "passed", { checked: unique.length, ...occurrenceEnvelope(weak.map((row) => ({ url: row.url, resourceType: row.resourceType, source: "network", values: { cacheControl: row.headers["cache-control"] || null, expires: row.headers.expires || null, age: row.headers.age || null, etag: row.headers.etag || null } }))) });
}

function fontDisplayEvaluator(_check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.resources.truncated) return unable("Stylesheet collection was truncated", { totalDiscovered: evidence.resources.totalDiscovered, retained: evidence.resources.retained });
  if (!evidence.fontFaces.length) return result("not_applicable", { rules: 0 });
  const missing = evidence.fontFaces.filter((face) => !face.fontDisplay || face.fontDisplay === "auto");
  return result(missing.length ? "advisory" : "passed", { rules: evidence.fontFaces.length, ...occurrenceEnvelope(missing.map((face) => ({ url: face.stylesheetUrl, resourceType: "font-face", source: "css", values: { fontFamily: face.fontFamily, fontSources: face.fontSources, fontDisplay: face.fontDisplay, rule: face.rule } }))) });
}

function renderedEvidenceEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.rendered) return unable("Rendered browser evidence was unavailable");
  if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("One or more rendered viewport collections were incomplete", { desktop: evidence.rendered.desktop.collection, mobile: evidence.rendered.mobile.collection });
  const axeRuleByCheck: Record<string, string> = {
    "accessibility.accessibility.image.buttons.have.accessible.names": "input-image-alt",
    "accessibility.accessibility.buttons.have.accessible.names": "button-name",
    "accessibility.accessibility.required.aria.attributes.present": "aria-required-attr",
    "accessibility.accessibility.aria.attribute.names.valid": "aria-valid-attr",
    "accessibility.accessibility.aria.attribute.values.valid": "aria-valid-attr-value",
    "accessibility.accessibility.aria.roles.valid": "aria-roles",
    "accessibility.accessibility.text.contrast.measured.where.calculable": "color-contrast",
  };
  const axeId = axeRuleByCheck[check.id];
  if (axeId) {
    if (!evidence.rendered.desktop.axe || !evidence.rendered.mobile.axe) return unable("axe-core did not complete for both viewports", { desktop: Boolean(evidence.rendered.desktop.axe), mobile: Boolean(evidence.rendered.mobile.axe) });
    const axe = [evidence.rendered.desktop, evidence.rendered.mobile].flatMap((viewport) => viewport.axe?.violations.filter((violation) => violation.id === axeId) || []);
    const occurrences = axe.flatMap((violation) => violation.nodes);
    return result(occurrences.length ? "failed" : "passed", { rule: axeId, axeVersion: evidence.rendered.desktop.axe?.version || evidence.rendered.mobile.axe?.version || null, ...occurrenceEnvelope(occurrences) });
  }
  const viewports = [
    ["desktop", evidence.rendered.desktop],
    ["mobile", evidence.rendered.mobile],
  ] as const;
  const metric = (name: string) => viewports.map(([viewport, row]) => ({ viewport, value: row.metrics[name] }));
  const occurrences = (name: string) => viewports.flatMap(([, row]) => row.occurrences[name] || []);
  switch (check.id) {
    case "seo.content.structure.and.headings.content.added.only.after.javascript.rendering.detected":
    case "seo.content.structure.and.headings.original.html.and.rendered.text.differences.detected": {
      const sourceLength = evidence.source.text.length;
      const values = metric("renderedTextLength");
      if (values.some((item) => !Number.isFinite(Number(item.value)))) return unable("Rendered text length was not available");
      const largestDifference = Math.max(...values.map((item) => Math.abs(Number(item.value) - sourceLength)));
      return result(largestDifference > 100 ? "advisory" : "passed", { sourceLength, rendered: values, largestDifference });
    }
    case "accessibility.images.and.media.image.display.dimensions.recorded": {
      const images = occurrences("images");
      return images.length ? result("passed", occurrenceEnvelope(images)) : result("not_applicable", { images: 0 });
    }
    case "accessibility.images.and.media.oversized.images.relative.to.display.dimensions.detected": {
      const oversized = occurrences("images").filter((item) => item.values?.oversized === true);
      return result(oversized.length ? "advisory" : "passed", occurrenceEnvelope(oversized));
    }
    case "accessibility.images.and.media.largest.contentful.paint.image.uses.lazy.loading": {
      const values = metric("lcpImageLazy");
      return result(values.some((item) => item.value === true) ? "failed" : "passed", { viewports: values });
    }
    case "accessibility.accessibility.touch.target.size.and.spacing.checked": {
      const small = occurrences("smallTouchTargets");
      return result(small.length ? "advisory" : "passed", occurrenceEnvelope(small));
    }
    case "accessibility.accessibility.viewport.settings.restrict.zoom":
      return result(metric("viewportRestrictsZoom").some((item) => item.value === true) ? "failed" : "passed", { viewports: metric("viewportRestrictsZoom") });
    case "accessibility.mobile.and.responsive.layout.multiple.viewport.declarations.detected": {
      const values = metric("viewportMetaCount");
      return result(values.some((item) => Number(item.value) > 1) ? "advisory" : "passed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.viewport.width.configured.for.device.width": {
      const values = metric("viewportDeviceWidth");
      return result(values.every((item) => item.value === true) ? "passed" : "failed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.elements.extend.beyond.tested.viewports": {
      const overflowing = occurrences("overflow");
      return result(overflowing.length ? "failed" : "passed", occurrenceEnvelope(overflowing));
    }
    case "accessibility.mobile.and.responsive.layout.fixed.elements.geometrically.overlap.main.content.at.tested.widths": {
      const values = metric("fixedContentOverlaps");
      return result(values.some((item) => Number(item.value) > 0) ? "failed" : "passed", { viewports: values });
    }
    case "ai_readiness.content.and.attribution.main.content.extractable.after.javascript.rendering": {
      const values = metric("mainTextLength");
      return result(values.some((item) => Number(item.value) >= 100) ? "passed" : "advisory", { viewports: values, minimumCharacters: 100 });
    }
    default:
      return unable("This rendered check has an explicit route but still needs a dedicated standards-based evaluator");
  }
}

function dnsEvidenceEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.dns.length) return unable("DNS evidence was not collected");
  const failures = evidence.dns.filter((query) => query.error);
  const byType = (recordType: string, hostnamePrefix?: string) => evidence.dns.filter((query) => query.recordType === recordType && (!hostnamePrefix || query.queriedHostname.startsWith(hostnamePrefix)));
  const records = (rows: DnsEvidence[]) => rows.flatMap((row) => row.records.map((record) => ({ ...record, queriedHostname: row.queriedHostname, recordType: row.recordType })));
  const complete = (rows: DnsEvidence[]) => rows.length > 0 && rows.every((row) => !row.error);
  switch (check.id) {
    case "infrastructure.dns.and.domain.configuration.dns.resolver.errors.detected":
      return result(failures.length ? "failed" : "passed", { failures });
    case "infrastructure.dns.and.domain.configuration.returned.dns.record.ttls.recorded": {
      if (failures.length) return unable("One or more DNS queries failed", { failures });
      const found = records(evidence.dns);
      return found.length ? result("passed", { records: found }) : unable("The resolver returned no DNS records");
    }
    case "infrastructure.dns.and.domain.configuration.domain.nameservers.recorded": {
      const rows = byType("NS");
      if (!complete(rows)) return unable("Nameserver evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "failed", { records: found });
    }
    case "infrastructure.dns.and.domain.configuration.domain.soa.record.recorded": {
      const rows = byType("SOA");
      if (!complete(rows)) return unable("SOA evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "failed", { records: found });
    }
    case "infrastructure.dns.and.domain.configuration.dnssec.validation.status.reported.by.the.resolver": {
      if (failures.length) return unable("DNSSEC status was incomplete", { failures });
      return result("passed", { queries: evidence.dns.map((query) => ({ queriedHostname: query.queriedHostname, recordType: query.recordType, authenticatedData: query.authenticatedData })) });
    }
    case "infrastructure.dns.and.domain.configuration.spf.record.detected": {
      const rows = byType("TXT").filter((row) => !row.queriedHostname.startsWith("_dmarc."));
      if (!complete(rows)) return unable("SPF evidence was incomplete", { queries: rows });
      const spf = records(rows).filter((record) => /\bv=spf1\b/i.test(record.value));
      return result(spf.length ? "passed" : "advisory", { records: spf });
    }
    case "infrastructure.dns.and.domain.configuration.multiple.spf.records.detected": {
      const rows = byType("TXT").filter((row) => !row.queriedHostname.startsWith("_dmarc."));
      if (!complete(rows)) return unable("SPF evidence was incomplete", { queries: rows });
      const spf = records(rows).filter((record) => /\bv=spf1\b/i.test(record.value));
      return result(!spf.length ? "not_applicable" : spf.length > 1 ? "failed" : "passed", { records: spf });
    }
    case "infrastructure.dns.and.domain.configuration.dmarc.record.detected":
    case "infrastructure.dns.and.domain.configuration.dmarc.policy.recorded": {
      const rows = byType("TXT", "_dmarc.");
      if (!complete(rows)) return unable("DMARC evidence was incomplete", { queries: rows });
      const dmarc = records(rows).filter((record) => /\bv=dmarc1\b/i.test(record.value));
      if (check.id.endsWith("dmarc.record.detected")) return result(dmarc.length ? "passed" : "advisory", { records: dmarc });
      if (!dmarc.length) return result("not_applicable", { records: [] });
      const policies = dmarc.map((record) => record.value.match(/(?:^|;)\s*p=([^;\s]+)/i)?.[1] || null);
      return result(policies.every(Boolean) ? "passed" : "advisory", { policies, records: dmarc });
    }
    case "infrastructure.dns.and.domain.configuration.caa.certificate.authority.restrictions.detected": {
      const rows = byType("CAA");
      if (!complete(rows)) return unable("CAA evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "not_applicable", { records: found });
    }
    default:
      return unable("This DNS check has an explicit route but no dedicated evaluator");
  }
}

function robotsEvidenceEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.robots) return unable("robots.txt evidence was not collected");
  const destination = evidence.robots.destination;
  if (check.id === "seo.crawling.and.indexing.meta.robots.directives.detected") {
    const metas = evidence.source.elements.filter((element) => element.tagName === "meta" && attr(element, "name")?.toLowerCase() === "robots");
    return result(metas.length ? "passed" : "not_applicable", { ...occurrenceEnvelope(metas.map((element) => occurrence(element, { content: attr(element, "content") }))) });
  }
  if (check.id === "seo.crawling.and.indexing.x.robots.tag.directives.detected") {
    const values = headerValues(evidence.http.headers, "x-robots-tag");
    return result(values.length ? "passed" : "not_applicable", { values });
  }
  if (destination.state === "not_found") return optionalMissing("robots.txt");
  if (!["success", "redirect"].includes(destination.state)) return unable("robots.txt could not be confidently inspected", { state: destination.state, status: destination.status, error: destination.error });
  if (destination.bodyTruncated) return unable("robots.txt exceeded the bounded response-body limit");
  if (evidence.robots.parseError) return check.id === "seo.crawling.and.indexing.robots.txt.parsing.errors.detected"
    ? result("failed", { error: evidence.robots.parseError })
    : unable("robots.txt parsing failed", { error: evidence.robots.parseError });
  const text = destination.body || "";
  const decisionFor = (agent: string) => evidence.robots!.decisions[agent];
  const agentForCheck: Record<string, string> = {
    "seo.crawling.and.indexing.selected.page.allowed.by.googlebot.robots.rules": "Googlebot",
    "seo.crawling.and.indexing.selected.page.allowed.by.bingbot.robots.rules": "Bingbot",
    "ai_readiness.crawler.permissions.selected.page.allowed.by.oai.searchbot.robots.rules": "OAI-SearchBot",
    "ai_readiness.crawler.permissions.selected.page.allowed.by.gptbot.robots.rules": "GPTBot",
    "ai_readiness.crawler.permissions.selected.page.allowed.by.claude.searchbot.robots.rules": "Claude-SearchBot",
    "ai_readiness.crawler.permissions.selected.page.allowed.by.claudebot.robots.rules": "ClaudeBot",
  };
  const agent = agentForCheck[check.id];
  if (agent) {
    const decision = decisionFor(agent);
    if (!decision) return unable(`No robots decision was collected for ${agent}`);
    return result(decision.allowed ? "passed" : "failed", { agent, ...decision });
  }
  switch (check.id) {
    case "seo.crawling.and.indexing.robots.txt.file.reachable": return result("passed", { status: destination.status, finalUrl: destination.finalUrl });
    case "seo.crawling.and.indexing.robots.txt.contains.readable.text": return result(text.trim().length ? "passed" : "advisory", { characters: text.trim().length });
    case "seo.crawling.and.indexing.robots.txt.parsing.errors.detected": return result("passed", { parseError: null });
    case "seo.crawling.and.indexing.sitemap.url.declared.in.robots.txt": return result(evidence.robots.sitemaps.length ? "passed" : "advisory", { sitemaps: evidence.robots.sitemaps });
    case "ai_readiness.crawler.permissions.explicit.chatgpt.user.robots.rules.detected": return result(/^\s*user-agent\s*:\s*chatgpt-user\s*$/im.test(text) ? "passed" : "advisory", { explicit: /^\s*user-agent\s*:\s*chatgpt-user\s*$/im.test(text) });
    case "ai_readiness.crawler.permissions.explicit.claude.user.robots.rules.detected": return result(/^\s*user-agent\s*:\s*claude-user\s*$/im.test(text) ? "passed" : "advisory", { explicit: /^\s*user-agent\s*:\s*claude-user\s*$/im.test(text) });
    case "ai_readiness.crawler.permissions.googlebot.robots.access.for.the.selected.page.checked": return result(decisionFor("Googlebot") ? "passed" : "unable_to_test", { decision: decisionFor("Googlebot") }, decisionFor("Googlebot") ? undefined : "No Googlebot decision was collected");
    default: return unable("This robots check has an explicit route but no dedicated evaluator");
  }
}

function sitemapEvidenceEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.sitemaps.length) return result("not_applicable", { sitemaps: 0 });
  const successful = evidence.sitemaps.filter((sitemap) => ["success", "redirect"].includes(sitemap.destinationState || "") && !sitemap.error);
  const failed = evidence.sitemaps.filter((sitemap) => !["success", "redirect"].includes(sitemap.destinationState || ""));
  switch (check.id) {
    case "seo.crawling.and.indexing.conventional.sitemap.locations.checked":
      return result("passed", { checked: evidence.sitemaps.map((sitemap) => ({ url: sitemap.sourceUrl, state: sitemap.destinationState, status: sitemap.status })) });
    case "seo.crawling.and.indexing.referenced.xml.sitemap.reachable":
      if (successful.length) return result("passed", { reachable: successful.map((sitemap) => sitemap.sourceUrl) });
      if (failed.some((sitemap) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(sitemap.destinationState || ""))) return unable("No sitemap destination could be confidently reached", { sitemaps: evidence.sitemaps });
      return result("failed", { sitemaps: evidence.sitemaps });
    case "seo.crawling.and.indexing.referenced.sitemap.xml.valid": {
      const reachable = evidence.sitemaps.filter((sitemap) => ["success", "redirect"].includes(sitemap.destinationState || ""));
      if (!reachable.length) return unable("No reachable sitemap was available for XML validation", { sitemaps: evidence.sitemaps });
      return result(reachable.some((sitemap) => !sitemap.error) ? "passed" : "failed", { sitemaps: reachable });
    }
    case "seo.crawling.and.indexing.selected.page.found.in.checked.sitemap.files": {
      if (!successful.length) return unable("No valid sitemap was available for page lookup", { sitemaps: evidence.sitemaps });
      const normalize = (value: string) => { try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return value; } };
      const selected = normalize(evidence.source.documentUrl);
      const matches = successful.flatMap((sitemap) => sitemap.urls).filter((entry) => normalize(entry.loc) === selected);
      return result(matches.length ? "passed" : "advisory", { selectedUrl: evidence.source.documentUrl, matches, urlsChecked: successful.reduce((total, sitemap) => total + sitemap.urls.length, 0) });
    }
    case "seo.crawling.and.indexing.sitemap.lastmod.date.formats.valid": {
      if (!successful.length) return unable("No valid sitemap was available for lastmod validation");
      const values = successful.flatMap((sitemap) => sitemap.urls).map((entry) => entry.lastmod).filter((value): value is string => Boolean(value));
      if (!values.length) return result("not_applicable", { values: 0 });
      const invalid = values.filter((value) => !Number.isFinite(Date.parse(value)));
      return result(invalid.length ? "failed" : "passed", { values: values.length, invalid });
    }
    default:
      return unable("This sitemap check has an explicit route but no dedicated evaluator");
  }
}

const unsupportedEvaluator: AuditEvaluator = (check) => unable(`No reliable v2 evaluator has been implemented for ${check.id}`);

export const auditEvaluators: Record<AuditEvaluatorKey, AuditEvaluator> = {
  source_core: sourceCoreEvaluator,
  link_inventory: linkInventoryEvaluator,
  resource_inventory: resourceInventoryEvaluator,
  structured_data: structuredDataEvaluator,
  performance_metric: performanceMetricEvaluator,
  text_compression: textCompressionEvaluator,
  static_resource_cache: staticResourceCacheEvaluator,
  font_display: fontDisplayEvaluator,
  rendered_evidence: renderedEvidenceEvaluator,
  dns_evidence: dnsEvidenceEvaluator,
  robots_evidence: robotsEvidenceEvaluator,
  sitemap_evidence: sitemapEvidenceEvaluator,
  unsupported: unsupportedEvaluator,
};

export function validateAuditEvaluatorRegistry(checks: AuditCheck[] = AUDIT_REGISTRY) {
  const active = checks.filter((check) => check.lifecycle === "active");
  const ids = active.map((check) => check.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missing = active.filter((check) => !AUDIT_EVALUATOR_KEYS[check.id as AuditCheckId] || !auditEvaluators[AUDIT_EVALUATOR_KEYS[check.id as AuditCheckId]]).map((check) => check.id);
  const unknown = Object.keys(AUDIT_EVALUATOR_KEYS).filter((id) => !ids.includes(id));
  if (duplicateIds.length || missing.length || unknown.length) throw new Error(JSON.stringify({ duplicateIds, missing, unknown }));
  return { active: active.length, duplicateIds, missing, unknown };
}

export function evaluateAuditCheck(checkId: string, evidence: AuditEvidenceBundle): TypedAuditResult {
  const started = performance.now();
  const check = AUDIT_REGISTRY.find((entry) => entry.lifecycle === "active" && entry.id === checkId);
  if (!check) throw new Error(`Unknown active audit check: ${checkId}`);
  const key = AUDIT_EVALUATOR_KEYS[check.id as AuditCheckId];
  if (!key || !auditEvaluators[key]) throw new Error(`Missing evaluator for active audit check: ${check.id}`);
  const evaluated = auditEvaluators[key](check, evidence);
  if (!check.allowedOutcomes.includes(evaluated.outcome)) throw new Error(`Evaluator returned disallowed outcome ${evaluated.outcome} for ${check.id}`);
  if (evaluated.outcome === "unable_to_test" && !evaluated.reason) throw new Error(`Unable-to-test result requires a reason for ${check.id}`);
  return { check_id: check.id, ...evaluated, duration_ms: Math.max(0, Math.round(performance.now() - started)) };
}

export function evaluateAuditCatalogue(checkIds: string[], evidence: AuditEvidenceBundle) {
  return checkIds.map((checkId) => evaluateAuditCheck(checkId, evidence));
}
