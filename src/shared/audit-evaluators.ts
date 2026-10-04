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
import type { InventoryCollection, OptionalAiResourceEvidence, RobotsEvidence } from "./audit-collectors";

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
  axe: {
    version: string;
    violations: Array<{ id: string; impact: string | null; nodes: AuditOccurrence[] }>;
    passes: Array<{ id: string; nodes: number }>;
    incomplete: Array<{ id: string; impact: string | null; nodes: AuditOccurrence[] }>;
  } | null;
  axeError: string | null;
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
  alternateOrigins: {
    httpToHttps: DestinationEvidence;
    apexHttp: DestinationEvidence;
    wwwHttp: DestinationEvidence;
  } | null;
  nxdomainControl: DnsEvidence | null;
  aiResources: {
    llmsTxt: OptionalAiResourceEvidence;
    llmsFullTxt: OptionalAiResourceEvidence;
  } | null;
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
const occurrence = (element: SourceDomEvidence["elements"][number], values?: Record<string, unknown>): AuditOccurrence => {
  const maxHtmlBytes = 1_000;
  if (element.html.length <= maxHtmlBytes)
    return { locator: element.locator, html: element.html, source: "html", values };
  const openingTag = element.html.match(/^<[^>]+>/)?.[0] || `<${element.tagName}>`;
  return {
    locator: element.locator,
    html: `${openingTag}…</${element.tagName}>`,
    source: "html",
    values: {
      ...values,
      textSample: element.text.slice(0, 300),
      htmlTruncated: true,
      originalHtmlBytes: element.html.length,
    },
  };
};
const result = (outcome: AuditOutcome, evidence: Record<string, unknown>, reason?: string) => ({ outcome, evidence, ...(reason ? { reason } : {}) });
const unable = (reason: string, evidence: Record<string, unknown> = {}) => result("unable_to_test", { ...evidence, reason }, reason);
const optionalMissing = (feature: string) => result("advisory", { present: false, feature }, `${feature} is optional and was not detected`);

const compactDestination = (destination: DestinationEvidence) => ({
  requestedUrl: destination.requestedUrl,
  finalUrl: destination.finalUrl,
  state: destination.state,
  status: destination.status,
  redirectTrace: destination.redirectTrace,
  contentType: destination.contentType,
  bodyTruncated: destination.bodyTruncated,
  error: destination.error,
});

const incompleteDestinationStates = new Set(["rate_limited", "server_error", "dns_failure", "tls_failure", "timeout", "redirect_loop", "redirect_limit_exceeded", "bot_challenge", "unable_to_test"]);

function alternateOriginEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (!evidence.alternateOrigins) return unable("Alternate-origin HTTP probes were not collected");
  if (check.id === "security.security.and.browser.protections.http.version.redirects.to.https") {
    const probe = evidence.alternateOrigins.httpToHttps;
    const compact = compactDestination(probe);
    if (incompleteDestinationStates.has(probe.state) || probe.status == null)
      return unable(`The HTTP alternate-origin probe did not complete (${probe.state})`, { probe: compact });
    if (probe.status >= 400)
      return result("failed", { probe: compact }, `The HTTP alternate origin returned HTTP ${probe.status}`);
    const redirectedToHttps = Boolean(probe.finalUrl?.startsWith("https://") && probe.redirectTrace.length);
    return result(redirectedToHttps ? "passed" : "failed", { probe: compact, redirectedToHttps });
  }
  if (check.id === "infrastructure.dns.and.domain.configuration.apex.and.www.http.redirect.behaviour.compared") {
    const probes = [evidence.alternateOrigins.apexHttp, evidence.alternateOrigins.wwwHttp];
    const compact = probes.map(compactDestination);
    const incomplete = probes.filter((probe) => incompleteDestinationStates.has(probe.state) || probe.status == null);
    if (incomplete.length) return unable("Apex and www redirect comparison did not complete for both origins", { probes: compact });
    const badHttp = probes.filter((probe) => (probe.status || 0) >= 400);
    if (badHttp.length) return result("failed", { probes: compact, failedOrigins: badHttp.map((probe) => probe.requestedUrl) });
    const normalizedFinals = probes.map((probe) => {
      try {
        const url = new URL(probe.finalUrl || probe.requestedUrl);
        return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "") || "/"}`;
      } catch {
        return null;
      }
    });
    const converged = Boolean(normalizedFinals[0] && normalizedFinals[0] === normalizedFinals[1]);
    return result(converged ? "passed" : "failed", { probes: compact, normalizedFinals, converged });
  }
  throw new Error(`Unexpected alternate-origin check: ${check.id}`);
}

function nxdomainControlEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (check.id !== "infrastructure.dns.and.domain.configuration.non.existent.hostname.response.detected")
    throw new Error(`Unexpected NXDOMAIN control check: ${check.id}`);
  const control = evidence.nxdomainControl;
  if (!control) return unable("The deliberate NXDOMAIN control query was not collected");
  const compact = {
    queriedHostname: control.queriedHostname,
    recordType: control.recordType,
    responseCode: control.responseCode,
    authenticatedData: control.authenticatedData,
    records: control.records,
    error: control.error,
  };
  if (control.error || control.responseCode == null)
    return unable("The deliberate NXDOMAIN control query did not complete", { control: compact });
  if (control.responseCode === 3 && control.records.length === 0)
    return result("passed", { control: compact, nxdomain: true });
  if (control.responseCode === 0)
    return result("failed", { control: compact, nxdomain: false }, control.records.length ? "The deliberately non-existent hostname resolved, indicating wildcard DNS" : "The control hostname returned NOERROR instead of NXDOMAIN");
  return unable(`The DNS resolver returned response code ${control.responseCode} for the control query`, { control: compact });
}

function aiResourceOccurrence(resource: OptionalAiResourceEvidence, values: Record<string, unknown>, locator?: string): AuditOccurrence {
  return { source: "ai_resource", url: resource.sourceUrl, locator, values };
}

function requireAiResource(resource: OptionalAiResourceEvidence | undefined, label: string) {
  if (!resource) return unable(`${label} evidence was not collected`);
  return null;
}

function aiResourceEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  const resources = evidence.aiResources;
  if (!resources) return unable("Optional AI resource evidence was not collected");
  const isFull = check.id === "ai_readiness.optional.resources.llms.full.txt.file.reachable"
    || check.id === "ai_readiness.optional.resources.llms.full.txt.returned.as.readable.text";
  const resource = isFull ? resources.llmsFullTxt : resources.llmsTxt;
  const missingEvidence = requireAiResource(resource, isFull ? "llms-full.txt" : "llms.txt");
  if (missingEvidence) return missingEvidence;
  const destination = compactDestination(resource.destination);
  const base = { sourceUrl: resource.sourceUrl, presence: resource.presence, destination };
  const missing = () => result("not_applicable", base, `${resource.kind} is optional and was not published`);
  const unreachable = () => {
    if (["unauthorized", "forbidden"].includes(resource.destination.state) || (resource.destination.status != null && resource.destination.status >= 400 && resource.destination.status < 500))
      return result("failed", base, `${resource.kind} returned HTTP ${resource.destination.status}`);
    return unable(`${resource.kind} could not be collected (${resource.destination.state})`, base);
  };
  switch (check.id) {
    case "ai_readiness.optional.resources.llms.txt.file.reachable":
    case "ai_readiness.optional.resources.llms.full.txt.file.reachable":
      if (resource.presence === "missing") return result("advisory", base, `${resource.kind} is optional and was not published`);
      if (resource.presence === "unavailable") return unreachable();
      return result("passed", base);
    case "ai_readiness.optional.resources.llms.txt.returned.as.readable.text":
    case "ai_readiness.optional.resources.llms.full.txt.returned.as.readable.text":
      if (resource.presence === "missing") return missing();
      if (resource.presence === "unavailable") return unreachable();
      if (resource.readable == null) return unable(`${resource.kind} readability could not be established`, { ...base, readabilityReason: resource.readabilityReason });
      return result(resource.readable ? "passed" : "failed", { ...base, readable: resource.readable, readabilityReason: resource.readabilityReason });
    case "ai_readiness.optional.resources.llms.txt.title.detected":
      if (resource.presence === "missing") return missing();
      if (resource.presence === "unavailable" || resource.readable !== true || !resource.parse)
        return unable("llms.txt title could not be evaluated because readable, complete text was unavailable", { ...base, readable: resource.readable, readabilityReason: resource.readabilityReason });
      if (resource.parse.collection.status !== "complete") return unable("llms.txt parsing did not complete", { ...base, collection: resource.parse.collection });
      return result(resource.parse.title ? "passed" : "failed", { ...base, title: resource.parse.title, bom: resource.parse.bom });
    case "ai_readiness.optional.resources.llms.txt.summary.detected":
      if (resource.presence === "missing") return missing();
      if (resource.presence === "unavailable" || resource.readable !== true || !resource.parse)
        return unable("llms.txt summary could not be evaluated because readable, complete text was unavailable", { ...base, readable: resource.readable, readabilityReason: resource.readabilityReason });
      if (resource.parse.collection.status !== "complete") return unable("llms.txt parsing did not complete", { ...base, collection: resource.parse.collection });
      return result(resource.parse.summary ? "passed" : "advisory", { ...base, summary: resource.parse.summary }, resource.parse.summary ? undefined : "The optional llms.txt summary was not detected");
    case "ai_readiness.optional.resources.llms.txt.markdown.links.parse.correctly": {
      if (resource.presence === "missing") return missing();
      if (resource.presence === "unavailable" || resource.readable !== true || !resource.parse)
        return unable("llms.txt links could not be parsed because readable, complete text was unavailable", { ...base, readable: resource.readable, readabilityReason: resource.readabilityReason });
      if (resource.parse.collection.status !== "complete") return unable("llms.txt parsing did not complete", { ...base, collection: resource.parse.collection });
      const occurrences = resource.parse.errors.map((error) => aiResourceOccurrence(resource, { message: error.message, sample: error.sample }, `line:${error.line}`));
      if (occurrences.length) return result("failed", { ...base, errors: resource.parse.errors, ...occurrenceEnvelope(occurrences) });
      if (!resource.parse.links.length) return result("not_applicable", { ...base, sections: resource.parse.sections.length, links: 0 });
      return result("passed", { ...base, sections: resource.parse.sections.length, links: resource.parse.links.length });
    }
    case "ai_readiness.optional.resources.llms.txt.links.checked.within.the.request.limit": {
      if (resource.presence === "missing") return missing();
      if (!resource.parse || !resource.links) return unable("llms.txt link validation evidence was unavailable", { ...base, readable: resource.readable });
      if (resource.parse.collection.status !== "complete" || resource.parse.errors.length)
        return unable("llms.txt link validation was incomplete because one or more declarations could not be parsed", { ...base, parseErrors: resource.parse.errors });
      if (!resource.links.totalDiscovered) return result("not_applicable", { ...base, totalDiscovered: 0 });
      if (resource.links.truncated) return unable("llms.txt link validation reached the bounded request limit", { ...base, totalDiscovered: resource.links.totalDiscovered, retained: resource.links.retained });
      const unavailableResults = resource.links.results.filter((item) => incompleteDestinationStates.has(item.state) || item.status == null);
      if (unavailableResults.length) return unable("One or more llms.txt link destinations could not be conclusively tested", { ...base, states: unavailableResults.map(compactDestination) });
      const brokenResults = resource.links.results.filter((item) => (item.status || 0) >= 400);
      const occurrences = brokenResults.flatMap((item) => resource.links?.declarations.filter((declaration) => declaration.resolvedUrl === item.requestedUrl).map((declaration) => aiResourceOccurrence(resource, { targetUrl: item.requestedUrl, status: item.status, state: item.state }, declaration.locator)) || []);
      return result(brokenResults.length ? "failed" : "passed", { ...base, linksDiscovered: resource.links.totalDiscovered, checked: resource.links.retained, requests: resource.links.requests, states: resource.links.results.map((item) => ({ url: item.requestedUrl, status: item.status, state: item.state })), ...occurrenceEnvelope(occurrences) });
    }
    case "ai_readiness.optional.resources.selected.page.referenced.in.checked.llms.txt.links": {
      if (resource.presence === "missing") return missing();
      if (!resource.parse || !resource.links) return unable("llms.txt page-reference evidence was unavailable", base);
      if (resource.parse.collection.status !== "complete" || resource.parse.errors.length || resource.links.truncated)
        return unable("llms.txt page-reference evidence was incomplete", { ...base, parseErrors: resource.parse.errors.length, truncated: resource.links.truncated });
      const normalize = (value: string) => { try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return value; } };
      const selectedUrl = normalize(evidence.source.documentUrl);
      const checked = new Set(resource.links.results.map((item) => normalize(item.requestedUrl)));
      const matches = resource.parse.links.filter((link) => link.resolvedUrl && checked.has(normalize(link.resolvedUrl)) && normalize(link.resolvedUrl) === selectedUrl);
      return result(matches.length ? "passed" : "advisory", { ...base, selectedUrl: evidence.source.documentUrl, linksChecked: checked.size, matches: matches.map((match) => ({ url: match.resolvedUrl, locator: match.locator })) }, matches.length ? undefined : "The selected page was not referenced by the checked llms.txt links");
    }
    default:
      throw new Error(`Unexpected optional AI resource check: ${check.id}`);
  }
}

function sourceCoreEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete") return unable("Source HTML collection or parsing did not complete", { collection: evidence.source.collection });
  if (["seo.crawling.http_status", "seo.crawling.html_content", "security.https.selected", "security.headers.hsts", "security.headers.csp", "infrastructure.http.content_type"].includes(check.id)
    && (evidence.http.collection.status !== "complete" || evidence.http.status == null))
    return unable("Required HTTP response evidence was missing or incomplete", { collection: evidence.http.collection, status: evidence.http.status });
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
      return result(title ? "passed" : "failed", { present: titles.length > 0, length: title.length, occurrences: titles.map((item) => occurrence(item)) });
    case "seo.metadata.title.length":
      return title ? result(title.length <= 60 ? "passed" : "advisory", { length: title.length, threshold: 60 }) : unable("Title length cannot be measured because no non-empty title was collected");
    case "seo.metadata.description.present":
      return result(description ? "passed" : "failed", { present: Boolean(description), occurrences: description ? [occurrence(description)] : [] });
    case "seo.metadata.description.not_empty": {
      const value = description ? attr(description, "content") || "" : null;
      return result(value?.trim() ? "passed" : "failed", { present: value != null, length: value?.trim().length || 0, occurrences: description ? [occurrence(description)] : [] });
    }
    case "seo.crawling.http_status":
      if (evidence.http.status == null) return unable("The selected page did not return an HTTP response", { http: evidence.http.collection });
      return result(evidence.http.status >= 200 && evidence.http.status < 400 ? "passed" : "failed", { status: evidence.http.status, finalUrl: evidence.http.finalUrl });
    case "seo.crawling.html_content": {
      const contentType = evidence.http.contentType || "";
      if (!contentType) return unable("The HTTP response did not expose a Content-Type header");
      return result(/(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? "passed" : "failed", { contentType });
    }
    case "seo.content.h1.present": {
      if (h1s.length) return result("passed", { sourceCount: h1s.length, occurrences: h1s.map((item) => occurrence(item)) });
      if (!evidence.rendered) return unable("No H1 was present in source HTML and rendered DOM evidence was unavailable", { sourceCount: 0 });
      if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("No H1 was present in source HTML and rendered DOM collection was incomplete", { sourceCount: 0, desktop: evidence.rendered.desktop.collection, mobile: evidence.rendered.mobile.collection });
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
      return evidence.http.finalUrl ? result(evidence.http.finalUrl.startsWith("https://") ? "passed" : "failed", { finalUrl: evidence.http.finalUrl }) : unable("The final page URL was unavailable");
    case "security.headers.hsts": {
      const values = headerValues(evidence.http.headers, "strict-transport-security");
      return result(values.length ? "passed" : "advisory", { values });
    }
    case "security.headers.csp": {
      const values = headerValues(evidence.http.headers, "content-security-policy");
      return result(values.length ? "passed" : "advisory", { values });
    }
    case "infrastructure.http.content_type":
      return evidence.http.contentType ? result("passed", { contentType: evidence.http.contentType }) : unable("The response Content-Type header was unavailable");
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
      if (evidence.canonical.bodyTruncated || !evidence.canonical.body || !evidence.canonical.finalUrl)
        return unable("Canonical target content was unavailable or incomplete", { canonical: { state: evidence.canonical.state, status: evidence.canonical.status, bodyTruncated: evidence.canonical.bodyTruncated } });
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

function sourceExtendedEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete")
    return unable("Source HTML collection or parsing did not complete", { collection: evidence.source.collection });
  const elements = evidence.source.elements;
  const all = (tag: string) => elements.filter((element) => element.tagName === tag);
  const metas = all("meta");
  const metaAll = (name: string) => metas.filter((element) => [attr(element, "name"), attr(element, "property")].some((value) => value?.toLowerCase() === name.toLowerCase()));
  const metaValues = (name: string) => metaAll(name).map((element) => (attr(element, "content") || "").trim());
  const linksByRel = (rel: string) => all("link").filter((element) => (attr(element, "rel") || "").toLowerCase().split(/\s+/).includes(rel));
  const headers = (name: string) => headerValues(evidence.http.headers, name);
  const withOccurrences = (rows: SourceDomEvidence["elements"]) => occurrenceEnvelope(rows.map((row) => occurrence(row)));
  const detected = (rows: SourceDomEvidence["elements"], failedOutcome: AuditOutcome = "failed") => result(rows.length ? failedOutcome : "passed", withOccurrences(rows));
  const normalizeUrl = (value: string | null) => {
    if (!value) return null;
    try { const url = new URL(value, evidence.source.documentUrl); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return null; }
  };
  const canonicals = linksByRel("canonical");
  const canonicalValues = canonicals.map((element) => attr(element, "href") || "");
  const main = elements.filter((element) => element.tagName === "main" || attr(element, "role")?.toLowerCase() === "main");
  const images = all("img");
  const robotsValues = [
    ...metas.filter((element) => /^(?:robots|googlebot|bingbot)$/i.test(attr(element, "name") || "")).map((element) => attr(element, "content") || ""),
    ...headers("x-robots-tag"),
  ].join(",").toLowerCase();
  const cookieValues = headers("set-cookie");
  const headerPresence = (name: string, optional = false) => {
    const values = headers(name);
    return result(values.length ? "passed" : optional ? "advisory" : "failed", { values });
  };
  const socialPresence = (name: string) => {
    const rows = metaAll(name);
    return result(rows.some((row) => (attr(row, "content") || "").trim()) ? "passed" : "advisory", withOccurrences(rows));
  };
  const urlStateIsUnavailable = (state: DestinationEvidence["state"]) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(state);
  const httpRequired = new Set([
    "seo.crawling.and.indexing.redirect.chain.detected",
    "seo.crawling.and.indexing.redirect.loop.detected",
    "security.security.and.browser.protections.https.connection.succeeds",
    "security.security.and.browser.protections.strict.transport.security.directives.parse.correctly",
    "security.security.and.browser.protections.content.security.policy.is.report.only",
    "security.security.and.browser.protections.content.security.policy.contains.unsafe.inline.allowances",
    "security.security.and.browser.protections.content.security.policy.contains.unsafe.eval.allowances",
    "security.security.and.browser.protections.frame.embedding.protection.declared",
    "security.security.and.browser.protections.x.content.type.options.header.present",
    "security.security.and.browser.protections.x.content.type.options.set.to.nosniff",
    "security.security.and.browser.protections.referrer.policy.declared",
    "security.security.and.browser.protections.referrer.policy.value.recognised",
    "security.security.and.browser.protections.permissions.policy.header.present",
    "security.security.and.browser.protections.observed.cookies.have.secure.attributes",
    "security.security.and.browser.protections.observed.cookies.have.httponly.attributes",
    "security.security.and.browser.protections.observed.cookies.have.samesite.attributes",
    "security.security.and.browser.protections.password.fields.appear.on.an.http.page",
    "infrastructure.server.and.http.information.server.software.header.detected",
    "infrastructure.server.and.http.information.technology.disclosure.headers.detected",
    "infrastructure.server.and.http.information.cdn.or.reverse.proxy.header.indicators.detected",
    "infrastructure.server.and.http.information.cache.hit.or.miss.headers.detected",
    "infrastructure.server.and.http.information.response.character.encoding.declared",
    "infrastructure.server.and.http.information.cache.control.directives.recorded",
    "infrastructure.server.and.http.information.etag.header.detected",
    "infrastructure.server.and.http.information.last.modified.header.detected",
    "infrastructure.server.and.http.information.vary.header.recorded",
    "infrastructure.server.and.http.information.server.timing.metrics.detected",
    "infrastructure.server.and.http.information.response.cookie.attributes.recorded",
    "ai_readiness.content.and.attribution.login.requirement.encountered.by.the.audit.runner",
  ]);
  if (httpRequired.has(check.id) && (evidence.http.collection.status !== "complete" || evidence.http.status == null))
    return unable("Required HTTP response evidence was missing or incomplete", { collection: evidence.http.collection, status: evidence.http.status });

  switch (check.id) {
    case "seo.page.metadata.multiple.page.titles.detected": return detected(all("title").slice(1));
    case "seo.page.metadata.multiple.meta.descriptions.detected": return detected(metaAll("description").slice(1));
    case "seo.page.metadata.meta.description.length.measured": {
      const value = metaValues("description")[0];
      return value == null || value === "" ? unable("Meta description length cannot be measured because no non-empty description was collected") : result(value.length <= 160 ? "passed" : "advisory", { length: value.length, threshold: 160 });
    }
    case "seo.page.metadata.canonical.url.declared": return result(canonicals.length ? "passed" : "failed", withOccurrences(canonicals));
    case "seo.page.metadata.multiple.canonical.urls.detected": return detected(canonicals.slice(1));
    case "seo.page.metadata.canonical.url.format.valid": {
      if (!canonicals.length) return result("not_applicable", { reason: "No canonical declaration exists" });
      const invalid = canonicals.filter((element) => !normalizeUrl(attr(element, "href")));
      return result(invalid.length ? "failed" : "passed", withOccurrences(invalid));
    }
    case "seo.page.metadata.canonical.target.reachable":
      if (!canonicals.length) return result("not_applicable", { reason: "No canonical declaration exists" });
      if (!evidence.canonical) return unable("Canonical target evidence was not collected");
      if (urlStateIsUnavailable(evidence.canonical.state)) return unable("Canonical target could not be confidently reached", { canonical: evidence.canonical });
      return result(["success", "redirect"].includes(evidence.canonical.state) ? "passed" : "failed", { state: evidence.canonical.state, status: evidence.canonical.status, finalUrl: evidence.canonical.finalUrl });
    case "seo.page.metadata.canonical.target.redirects":
      if (!canonicals.length) return result("not_applicable", { reason: "No canonical declaration exists" });
      if (!evidence.canonical) return unable("Canonical target evidence was not collected");
      if (urlStateIsUnavailable(evidence.canonical.state)) return unable("Canonical target redirect evidence was incomplete", { canonical: evidence.canonical });
      return result(evidence.canonical.redirectTrace.length ? "advisory" : "passed", { redirects: evidence.canonical.redirectTrace });
    case "seo.page.metadata.canonical.points.to.a.different.page": {
      if (!canonicals.length) return result("not_applicable", { reason: "No canonical declaration exists" });
      const selected = normalizeUrl(evidence.source.documentUrl);
      const different = canonicalValues.map(normalizeUrl).filter((value) => value && value !== selected);
      return result(different.length ? "advisory" : "passed", { selected, canonical: canonicalValues, different });
    }
    case "seo.page.metadata.html.language.declared": {
      const html = all("html")[0];
      const language = html ? (attr(html, "lang") || "").trim() : "";
      const declaration = html
        ? `<html${language ? ` lang=${JSON.stringify(language)}` : ""}>`
        : null;
      return result(language ? "passed" : "failed", {
        language,
        occurrences: html ? [{ locator: html.locator, html: declaration, source: "html", values: { language } }] : [],
      });
    }
    case "seo.page.metadata.html.language.code.valid": {
      const html = all("html")[0];
      const language = html ? (attr(html, "lang") || "").trim() : "";
      if (!language) return result("not_applicable", { reason: "No HTML language declaration exists" });
      try { new Intl.Locale(language); return result("passed", { language }); } catch { return result("failed", { language }); }
    }
    case "seo.crawling.and.indexing.redirect.chain.detected": return result(evidence.http.redirectTrace.length > 1 ? "advisory" : "passed", { redirects: evidence.http.redirectTrace });
    case "seo.crawling.and.indexing.redirect.loop.detected":
      if (evidence.http.collection.status === "failed" && /redirect.loop/i.test(evidence.http.collection.reason)) return result("failed", { collection: evidence.http.collection, redirects: evidence.http.redirectTrace });
      return evidence.http.collection.status === "complete" ? result("passed", { redirects: evidence.http.redirectTrace }) : unable("HTTP redirect collection was incomplete", { collection: evidence.http.collection });
    case "seo.crawling.and.indexing.conflicting.indexing.directives.detected": {
      const hasIndex = /(?:^|[,;\s])index(?:$|[,;\s])/.test(robotsValues);
      const hasNoindex = /\bnoindex\b/.test(robotsValues);
      return result(hasIndex && hasNoindex ? "failed" : "passed", { directives: robotsValues || null });
    }
    case "seo.crawling.and.indexing.noindex.directive.detected": return result(/\bnoindex\b/.test(robotsValues) ? "failed" : "passed", { directives: robotsValues || null });
    case "seo.crawling.and.indexing.nofollow.directive.detected": return result(/\bnofollow\b/.test(robotsValues) ? "advisory" : "passed", { directives: robotsValues || null });
    case "seo.content.structure.and.headings.skipped.heading.levels.detected": {
      const headings = elements.filter((element) => /^h[1-6]$/.test(element.tagName));
      const skipped = headings.filter((element, index) => index > 0 && Number(element.tagName[1]) > Number(headings[index - 1].tagName[1]) + 1);
      return detected(skipped, "advisory");
    }
    case "seo.content.structure.and.headings.repeated.heading.text.detected": {
      const headings = elements.filter((element) => /^h[1-6]$/.test(element.tagName) && element.text.trim());
      const counts = new Map<string, number>();
      headings.forEach((heading) => counts.set(heading.text.toLowerCase(), (counts.get(heading.text.toLowerCase()) || 0) + 1));
      return detected(headings.filter((heading) => (counts.get(heading.text.toLowerCase()) || 0) > 1), "advisory");
    }
    case "seo.content.structure.and.headings.main.content.landmark.present": return result(main.length ? "passed" : "failed", withOccurrences(main));
    case "seo.content.structure.and.headings.multiple.main.content.landmarks.detected": return detected(main.slice(1));
    case "seo.content.structure.and.headings.main.content.contains.extractable.text":
    case "ai_readiness.content.and.attribution.main.content.includes.machine.readable.text": {
      if (!main.length) return result("not_applicable", { reason: "No main content landmark exists" });
      const characters = main.map((element) => element.text).join(" ").trim().length;
      return result(characters >= 100 ? "passed" : "advisory", { characters, minimumCharacters: 100 });
    }
    case "seo.content.structure.and.headings.main.content.word.count.measured": {
      if (!main.length) return result("not_applicable", { reason: "No main content landmark exists" });
      const words = main.map((element) => element.text).join(" ").trim().split(/\s+/).filter(Boolean).length;
      return result("passed", { words });
    }
    case "seo.content.structure.and.headings.text.present.in.original.html": return result(evidence.source.text.trim().length >= 20 ? "passed" : "advisory", { characters: evidence.source.text.trim().length });
    case "seo.content.structure.and.headings.lists.use.semantic.list.elements": {
      const listItems = all("li");
      if (!listItems.length) return result("not_applicable", { listItems: 0 });
      const semanticLists = [...all("ul"), ...all("ol"), ...all("menu")];
      const orphaned = listItems.filter((item) => !semanticLists.some((list) => list.html.includes(item.html)));
      return result(orphaned.length ? "failed" : "passed", withOccurrences(orphaned));
    }
    case "seo.content.structure.and.headings.data.tables.contain.header.cells": {
      const tables = all("table");
      if (!tables.length) return result("not_applicable", { tables: 0 });
      const withoutHeaders = tables.filter((table) => !/<th\b/i.test(table.html));
      return result(withoutHeaders.length ? "failed" : "passed", withOccurrences(withoutHeaders));
    }
    case "accessibility.images.and.media.empty.alt.attributes.identified": return detected(images.filter((image) => attr(image, "alt") === ""), "advisory");
    case "accessibility.images.and.media.alt.text.repeats.image.filenames": {
      const matches = images.filter((image) => { const alt = (attr(image, "alt") || "").trim().toLowerCase(); const src = (attr(image, "src") || "").split(/[?#]/)[0].split("/").pop()?.replace(/\.[a-z0-9]+$/i, "").toLowerCase() || ""; return Boolean(alt && src && alt.replace(/[-_]+/g, " ") === src.replace(/[-_]+/g, " ")); });
      return detected(matches, "advisory");
    }
    case "accessibility.images.and.media.images.marked.decorative.remain.focusable": {
      const anchors = all("a");
      return detected(images.filter((image) => attr(image, "alt") === "" && (attr(image, "tabindex") !== null || anchors.some((anchor) => anchor.html.includes(image.html)))));
    }
    case "accessibility.images.and.media.image.resources.fail.to.load": {
      const declarations = evidence.resources.declarations.filter((item) => item.declarationType === "img");
      if (!declarations.length) return result("not_applicable", { images: 0 });
      if (evidence.resources.truncated) return unable("Image resource collection was truncated", { totalDiscovered: evidence.resources.totalDiscovered, retained: evidence.resources.retained });
      const rows = evidence.resources.results.filter((row) => row.declarations.some((item) => item.declarationType === "img"));
      if (rows.length < new Set(declarations.map((item) => item.resolvedUrl).filter(Boolean)).size) return unable("One or more declared image resources were not collected");
      const unavailable = rows.filter((row) => urlStateIsUnavailable(row.state));
      if (unavailable.length) return unable("One or more image resources could not be confidently tested", { resources: unavailable });
      const failed = rows.filter((row) => !["success", "redirect"].includes(row.state));
      return result(failed.length ? "failed" : "passed", occurrenceEnvelope(failed.map((row) => ({ url: row.requestedUrl, source: "network", values: { state: row.state, status: row.status } }))));
    }
    case "accessibility.images.and.media.image.width.and.height.attributes.present": {
      if (!images.length) return result("not_applicable", { images: 0 });
      const missing = images.filter((image) => !attr(image, "width") || !attr(image, "height"));
      return result(missing.length ? "advisory" : "passed", withOccurrences(missing));
    }
    case "accessibility.images.and.media.responsive.srcset.declarations.detected":
      if (!images.length) return result("not_applicable", { images: 0 });
      return result(images.some((image) => attr(image, "srcset")) || all("source").some((source) => attr(source, "srcset")) ? "passed" : "advisory", { images: images.length, responsiveDeclarations: images.filter((image) => attr(image, "srcset")).length + all("source").filter((source) => attr(source, "srcset")).length });
    case "accessibility.images.and.media.invalid.srcset.descriptors.detected": {
      const candidates = [...images, ...all("source")].filter((element) => attr(element, "srcset"));
      if (!candidates.length) return result("not_applicable", { declarations: 0 });
      const invalid = candidates.filter((element) => (attr(element, "srcset") || "").split(",").some((part) => { const bits = part.trim().split(/\s+/); return bits.length > 2 || (bits[1] && !/^\d+(?:\.\d+)?[wx]$/.test(bits[1])); }));
      return result(invalid.length ? "failed" : "passed", withOccurrences(invalid));
    }
    case "accessibility.images.and.media.image.formats.recorded": {
      if (!images.length) return result("not_applicable", { images: 0 });
      const formats = images.map((image) => ({ url: attr(image, "src"), format: (attr(image, "src") || "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "unknown" }));
      return result("passed", { formats });
    }
    case "accessibility.images.and.media.videos.contain.caption.track.declarations": {
      const videos = all("video");
      if (!videos.length) return result("not_applicable", { videos: 0 });
      const missing = videos.filter((video) => !/<track\b[^>]*kind=["']captions["']/i.test(video.html));
      return result(missing.length ? "failed" : "passed", withOccurrences(missing));
    }
    case "accessibility.images.and.media.autoplaying.media.detected": return detected([...all("video"), ...all("audio")].filter((element) => attr(element, "autoplay") !== null), "advisory");
    case "accessibility.images.and.media.iframes.have.accessible.titles": {
      const frames = all("iframe");
      if (!frames.length) return result("not_applicable", { iframes: 0 });
      const missing = frames.filter((frame) => !(attr(frame, "title") || "").trim());
      return result(missing.length ? "failed" : "passed", withOccurrences(missing));
    }
    case "security.security.and.browser.protections.https.connection.succeeds":
      if (evidence.http.collection.status !== "complete" || evidence.http.status == null) return unable("HTTPS response evidence was incomplete", { collection: evidence.http.collection });
      return result(evidence.http.finalUrl?.startsWith("https://") && evidence.http.status < 500 ? "passed" : "failed", { finalUrl: evidence.http.finalUrl, status: evidence.http.status });
    case "security.security.and.browser.protections.active.mixed.content.requests.detected": {
      if (!evidence.rendered) return unable("Rendered network evidence was unavailable");
      if ([evidence.rendered.desktop.collection.status, evidence.rendered.mobile.collection.status].some((status) => status !== "complete")) return unable("Rendered network evidence was incomplete");
      const insecureResponses = [...evidence.rendered.desktop.networkResources, ...evidence.rendered.mobile.networkResources].filter((resource) => resource.url.startsWith("http://")).map((resource) => ({ url: resource.url, resourceType: resource.resourceType, source: "network" } as AuditOccurrence));
      const insecureFailures = [evidence.rendered.desktop, evidence.rendered.mobile].flatMap((viewport) => viewport.occurrences.failedRequests || []).filter((item) => item.url?.startsWith("http://"));
      const insecure = [...insecureResponses, ...insecureFailures];
      return result(insecure.length ? "failed" : "passed", occurrenceEnvelope(insecure));
    }
    case "security.security.and.browser.protections.http.image.and.media.references.detected": return detected(elements.filter((element) => ["img", "source", "video", "audio"].includes(element.tagName) && [attr(element, "src"), attr(element, "poster")].some((value) => value?.startsWith("http://"))));
    case "security.security.and.browser.protections.strict.transport.security.directives.parse.correctly": {
      const values = headers("strict-transport-security");
      if (!values.length) return result("not_applicable", { reason: "No HSTS header exists" });
      const invalid = values.filter((value) => !/(?:^|;)\s*max-age=\d+/i.test(value));
      return result(invalid.length ? "failed" : "passed", { values, invalid });
    }
    case "security.security.and.browser.protections.content.security.policy.is.report.only": return result(headers("content-security-policy-report-only").length ? "advisory" : "passed", { reportOnly: headers("content-security-policy-report-only") });
    case "security.security.and.browser.protections.content.security.policy.contains.unsafe.inline.allowances": return result(headers("content-security-policy").some((value) => /'unsafe-inline'/i.test(value)) ? "advisory" : headers("content-security-policy").length ? "passed" : "not_applicable", { values: headers("content-security-policy") });
    case "security.security.and.browser.protections.content.security.policy.contains.unsafe.eval.allowances": return result(headers("content-security-policy").some((value) => /'unsafe-eval'/i.test(value)) ? "advisory" : headers("content-security-policy").length ? "passed" : "not_applicable", { values: headers("content-security-policy") });
    case "security.security.and.browser.protections.frame.embedding.protection.declared": return result(headers("x-frame-options").length || headers("content-security-policy").some((value) => /(?:^|;)\s*frame-ancestors\b/i.test(value)) ? "passed" : "advisory", { xFrameOptions: headers("x-frame-options"), csp: headers("content-security-policy") });
    case "security.security.and.browser.protections.x.content.type.options.header.present": return headerPresence("x-content-type-options");
    case "security.security.and.browser.protections.x.content.type.options.set.to.nosniff": {
      const values = headers("x-content-type-options");
      return values.length ? result(values.every((value) => value.trim().toLowerCase() === "nosniff") ? "passed" : "failed", { values }) : result("not_applicable", { reason: "No X-Content-Type-Options header exists" });
    }
    case "security.security.and.browser.protections.referrer.policy.declared": return headerPresence("referrer-policy", true);
    case "security.security.and.browser.protections.referrer.policy.value.recognised": {
      const values = headers("referrer-policy");
      if (!values.length) return result("not_applicable", { reason: "No Referrer-Policy header exists" });
      const allowed = new Set(["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"]);
      const invalid = values.flatMap((value) => value.split(",").map((part) => part.trim().toLowerCase()).filter((part) => !allowed.has(part)));
      return result(invalid.length ? "failed" : "passed", { values, invalid });
    }
    case "security.security.and.browser.protections.permissions.policy.header.present": return headerPresence("permissions-policy", true);
    case "security.security.and.browser.protections.observed.cookies.have.secure.attributes":
    case "security.security.and.browser.protections.observed.cookies.have.httponly.attributes":
    case "security.security.and.browser.protections.observed.cookies.have.samesite.attributes": {
      if (!cookieValues.length) return result("not_applicable", { cookies: 0 });
      const token = check.id.includes("secure.attributes") ? /(?:^|;)\s*secure(?:;|$)/i : check.id.includes("httponly") ? /(?:^|;)\s*httponly(?:;|$)/i : /(?:^|;)\s*samesite=(?:lax|strict|none)(?:;|$)/i;
      const missing = cookieValues.filter((cookie) => !token.test(cookie));
      return result(missing.length ? "failed" : "passed", { cookies: cookieValues.length, missing: missing.length });
    }
    case "security.security.and.browser.protections.insecure.form.submission.destinations.detected": return detected(all("form").filter((form) => (attr(form, "action") || "").startsWith("http://")));
    case "security.security.and.browser.protections.password.fields.appear.on.an.http.page": return result(evidence.http.finalUrl?.startsWith("http://") && all("input").some((input) => attr(input, "type")?.toLowerCase() === "password") ? "failed" : "passed", { finalUrl: evidence.http.finalUrl, passwordFields: all("input").filter((input) => attr(input, "type")?.toLowerCase() === "password").length });
    case "infrastructure.server.and.http.information.server.software.header.detected": return result(headers("server").length ? "advisory" : "passed", { values: headers("server") });
    case "infrastructure.server.and.http.information.technology.disclosure.headers.detected": {
      const names = ["x-powered-by", "x-aspnet-version", "x-generator"];
      const disclosed = Object.fromEntries(names.map((name) => [name, headers(name)]).filter(([, values]) => values.length));
      return result(Object.keys(disclosed).length ? "advisory" : "passed", { disclosed });
    }
    case "infrastructure.server.and.http.information.cdn.or.reverse.proxy.header.indicators.detected": {
      const names = ["cf-ray", "x-vercel-id", "x-cache", "via", "server-timing"];
      const found = Object.fromEntries(names.map((name) => [name, headers(name)]).filter(([, values]) => values.length));
      return result(Object.keys(found).length ? "passed" : "not_applicable", { headers: found });
    }
    case "infrastructure.server.and.http.information.cache.hit.or.miss.headers.detected": {
      const names = ["x-cache", "cf-cache-status", "x-vercel-cache", "age"];
      const found = Object.fromEntries(names.map((name) => [name, headers(name)]).filter(([, values]) => values.length));
      return result(Object.keys(found).length ? "passed" : "not_applicable", { headers: found });
    }
    case "infrastructure.server.and.http.information.response.character.encoding.declared": {
      const contentType = evidence.http.contentType;
      if (!contentType) return unable("Content-Type evidence was unavailable");
      return result(/charset\s*=\s*[^;\s]+/i.test(contentType) || metaAll("charset").length > 0 || metas.some((meta) => attr(meta, "charset")) ? "passed" : "advisory", { contentType });
    }
    case "infrastructure.server.and.http.information.cache.control.directives.recorded": return headerPresence("cache-control", true);
    case "infrastructure.server.and.http.information.etag.header.detected": return headerPresence("etag", true);
    case "infrastructure.server.and.http.information.last.modified.header.detected": return headerPresence("last-modified", true);
    case "infrastructure.server.and.http.information.vary.header.recorded": return headerPresence("vary", true);
    case "infrastructure.server.and.http.information.server.timing.metrics.detected": return headerPresence("server-timing", true);
    case "infrastructure.server.and.http.information.response.cookie.attributes.recorded": return cookieValues.length ? result("passed", { cookies: cookieValues }) : result("not_applicable", { cookies: 0 });
    case "seo.social.sharing.and.site.identity.open.graph.title.present": return socialPresence("og:title");
    case "seo.social.sharing.and.site.identity.open.graph.description.present": return socialPresence("og:description");
    case "seo.social.sharing.and.site.identity.open.graph.url.present": return socialPresence("og:url");
    case "seo.social.sharing.and.site.identity.open.graph.type.present": return socialPresence("og:type");
    case "seo.social.sharing.and.site.identity.open.graph.image.declared": return socialPresence("og:image");
    case "seo.social.sharing.and.site.identity.open.graph.image.dimensions.measured": {
      if (!metaValues("og:image").some(Boolean)) return result("not_applicable", { reason: "No Open Graph image is declared" });
      const width = metaValues("og:image:width")[0]; const height = metaValues("og:image:height")[0];
      return result(width && height && Number(width) > 0 && Number(height) > 0 ? "passed" : "advisory", { width: width || null, height: height || null });
    }
    case "seo.social.sharing.and.site.identity.open.graph.url.agrees.with.the.canonical.url": {
      const og = normalizeUrl(metaValues("og:url")[0] || null); const canonical = normalizeUrl(canonicalValues[0] || null);
      if (!og || !canonical) return result("not_applicable", { reason: "Both Open Graph URL and canonical URL are required", og, canonical });
      return result(og === canonical ? "passed" : "advisory", { og, canonical });
    }
    case "seo.social.sharing.and.site.identity.x.twitter.card.type.declared": return socialPresence("twitter:card");
    case "seo.social.sharing.and.site.identity.x.twitter.title.or.open.graph.fallback.available": return result(metaValues("twitter:title").some(Boolean) || metaValues("og:title").some(Boolean) ? "passed" : "advisory", { twitter: metaValues("twitter:title"), openGraph: metaValues("og:title") });
    case "seo.social.sharing.and.site.identity.x.twitter.description.or.open.graph.fallback.available": return result(metaValues("twitter:description").some(Boolean) || metaValues("og:description").some(Boolean) ? "passed" : "advisory", { twitter: metaValues("twitter:description"), openGraph: metaValues("og:description") });
    case "seo.social.sharing.and.site.identity.x.twitter.image.or.open.graph.fallback.available": return result(metaValues("twitter:image").some(Boolean) || metaValues("og:image").some(Boolean) ? "passed" : "advisory", { twitter: metaValues("twitter:image"), openGraph: metaValues("og:image") });
    case "seo.social.sharing.and.site.identity.conflicting.duplicate.social.metadata.detected": {
      const names = [...new Set(metas.map((meta) => (attr(meta, "property") || attr(meta, "name") || "").toLowerCase()).filter((name) => name.startsWith("og:") || name.startsWith("twitter:")))];
      const conflicts = names.filter((name) => new Set(metaValues(name).filter(Boolean)).size > 1);
      return result(conflicts.length ? "failed" : "passed", { conflicts });
    }
    case "seo.social.sharing.and.site.identity.favicon.declared": return result(linksByRel("icon").length || linksByRel("shortcut").length ? "passed" : "advisory", { declarations: [...linksByRel("icon"), ...linksByRel("shortcut")].map((item) => attr(item, "href")) });
    case "seo.social.sharing.and.site.identity.apple.touch.icon.declared": return result(linksByRel("apple-touch-icon").length ? "passed" : "advisory", { declarations: linksByRel("apple-touch-icon").map((item) => attr(item, "href")) });
    case "seo.social.sharing.and.site.identity.web.app.manifest.linked": return result(linksByRel("manifest").length ? "passed" : "advisory", { declarations: linksByRel("manifest").map((item) => attr(item, "href")) });
    case "ai_readiness.crawler.permissions.ai.search.and.training.crawler.permissions.differ": {
      if (!evidence.robots || evidence.robots.parseError || !["success", "redirect"].includes(evidence.robots.destination.state)) return unable("Complete robots.txt decisions were unavailable");
      const search = [evidence.robots.decisions["OAI-SearchBot"], evidence.robots.decisions["Claude-SearchBot"]].filter(Boolean).map((item) => item.allowed);
      const training = [evidence.robots.decisions.GPTBot, evidence.robots.decisions.ClaudeBot].filter(Boolean).map((item) => item.allowed);
      if (!search.length || !training.length) return unable("AI search or training crawler decisions were incomplete");
      return result(search.some((value) => !training.includes(value)) ? "passed" : "not_applicable", { search, training });
    }
    case "ai_readiness.crawler.permissions.ai.crawler.rules.inherited.from.wildcard.directives.identified": {
      if (!evidence.robots || evidence.robots.destination.bodyTruncated || !evidence.robots.destination.body) return unable("Complete robots.txt text was unavailable");
      const text = evidence.robots.destination.body;
      const hasWildcard = /^\s*user-agent\s*:\s*\*\s*$/im.test(text);
      const hasExplicitAi = /^\s*user-agent\s*:\s*(?:gptbot|oai-searchbot|claudebot|claude-searchbot|chatgpt-user|claude-user)\s*$/im.test(text);
      return result(hasWildcard && !hasExplicitAi ? "passed" : "not_applicable", { hasWildcard, hasExplicitAi });
    }
    case "ai_readiness.crawler.permissions.nosnippet.restrictions.detected": return result(/\bnosnippet\b/i.test(robotsValues) ? "advisory" : "passed", { directives: robotsValues || null });
    case "ai_readiness.crawler.permissions.max.snippet.restrictions.detected": return result(/\bmax-snippet\s*:/i.test(robotsValues) ? "advisory" : "passed", { directives: robotsValues || null });
    case "ai_readiness.crawler.permissions.data.nosnippet.sections.detected": return detected(elements.filter((element) => attr(element, "data-nosnippet") !== null), "advisory");
    case "ai_readiness.content.and.attribution.login.requirement.encountered.by.the.audit.runner": return result([401, 403].includes(evidence.http.status || 0) || all("input").some((input) => attr(input, "type")?.toLowerCase() === "password") ? "advisory" : "passed", { status: evidence.http.status, passwordFields: all("input").filter((input) => attr(input, "type")?.toLowerCase() === "password").length });
    case "ai_readiness.content.and.attribution.bot.challenge.encountered.by.the.audit.runner": return result(/captcha|cf-chl-|challenge-platform|verify you are human/i.test(evidence.source.text) ? "advisory" : "passed", { detected: /captcha|cf-chl-|challenge-platform|verify you are human/i.test(evidence.source.text) });
    case "ai_readiness.content.and.attribution.main.content.organised.under.semantic.headings": {
      if (!main.length) return result("not_applicable", { reason: "No main content landmark exists" });
      const headings = main.reduce((count, element) => count + (element.html.match(/<h[1-6]\b/gi)?.length || 0), 0);
      return result(headings ? "passed" : "advisory", { headings });
    }
    case "ai_readiness.content.and.attribution.lists.available.in.machine.readable.html": return result(["ul", "ol", "dl"].some((tag) => all(tag).length) ? "passed" : "not_applicable", { lists: all("ul").length + all("ol").length + all("dl").length });
    case "ai_readiness.content.and.attribution.tables.available.in.machine.readable.html": return result(all("table").length ? "passed" : "not_applicable", { tables: all("table").length });
    case "ai_readiness.content.and.attribution.external.source.links.present.in.the.main.content": {
      if (!main.length) return result("not_applicable", { reason: "No main content landmark exists" });
      const external = evidence.source.links.filter((link) => link.internal === false && main.some((element) => element.html.includes(link.originalUrl)));
      return result(external.length ? "passed" : "advisory", { links: external });
    }
    case "ai_readiness.content.and.attribution.machine.readable.organisation.identity.present": return result(evidence.source.structuredData.flatMap((block) => block.entities).some((entity) => entity.types.some((type) => /^(?:organization|corporation|localbusiness)$/i.test(type))) ? "passed" : "advisory", { types: evidence.source.structuredData.flatMap((block) => block.entities).flatMap((entity) => entity.types) });
    case "ai_readiness.content.and.attribution.machine.readable.author.identity.present": return result(evidence.source.structuredData.flatMap((block) => block.entities).some((entity) => entity.types.some((type) => /^(?:person|organization)$/i.test(type)) && ("name" in entity.value || "url" in entity.value)) ? "passed" : "advisory", { entities: evidence.source.structuredData.flatMap((block) => block.entities).length });
    case "ai_readiness.content.and.attribution.entity.sameas.references.use.valid.url.formats": {
      const values: string[] = [];
      const visit = (value: unknown) => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== "object") return; for (const [key, nested] of Object.entries(value as Record<string, unknown>)) { if (key === "sameAs") (Array.isArray(nested) ? nested : [nested]).forEach((item) => { if (typeof item === "string") values.push(item); }); visit(nested); } };
      evidence.source.structuredData.forEach((block) => visit(block.parsed));
      if (!values.length) return result("not_applicable", { values: 0 });
      const invalid = values.filter((value) => !normalizeUrl(value));
      return result(invalid.length ? "failed" : "passed", { values, invalid });
    }
    case "ai_readiness.optional.resources.linked.markdown.alternative.for.the.selected.page.detected": return result(evidence.resources.declarations.some((item) => item.declarationType === "markdown-alternative") ? "passed" : "advisory", { declarations: evidence.resources.declarations.filter((item) => item.declarationType === "markdown-alternative") });
    default: return unable("This check has no completed evidence evaluator", { evaluator: "source_extended", checkId: check.id });
  }
}

function linkInventoryEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete") return unable("Link declarations could not be trusted because source collection was incomplete", { collection: evidence.source.collection });
  const discovered = evidence.links.declarations;
  const checked = evidence.links.results;
  const byUrl = new Map(checked.map((item) => [item.requestedUrl, item]));
  const occurrencesFor = (items: typeof discovered) => occurrenceEnvelope(items.map((item) => ({ locator: item.locator, url: item.resolvedUrl || item.originalUrl, source: item.source, values: { originalUrl: item.originalUrl } } as AuditOccurrence)));
  const checkedOccurrences = (states: string[]) => checked.filter((item) => states.includes(item.state)).map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, status: item.status, finalUrl: item.finalUrl, error: item.error, redirects: item.redirectTrace } } as AuditOccurrence));
  const completePass = (failures: AuditOccurrence[], failedOutcome: AuditOutcome = "failed", requireConclusiveNetwork = false) => failures.length
    ? result(failedOutcome, occurrenceEnvelope(failures))
    : evidence.links.truncated
      ? unable("Link sampling limit was reached; the retained sample contained no issue", { totalDiscovered: evidence.links.totalDiscovered, retained: evidence.links.retained, truncated: true })
      : requireConclusiveNetwork && checked.some((item) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(item.state))
        ? unable("One or more checked links did not produce conclusive destination evidence", { inconclusive: checked.filter((item) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(item.state)) })
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
    case "seo.links.and.navigation.javascript.link.destinations.detected": {
      const matches = discovered.filter((item) => /^javascript:/i.test(item.originalUrl.trim()));
      return completePass(occurrencesFor(matches).occurrences);
    }
    case "seo.links.and.navigation.internal.links.identified":
      return result(discovered.some((item) => item.internal) ? "passed" : "not_applicable", { count: discovered.filter((item) => item.internal).length });
    case "seo.links.and.navigation.external.links.identified":
      return result(discovered.some((item) => item.internal === false) ? "passed" : "not_applicable", { count: discovered.filter((item) => item.internal === false).length });
    case "seo.links.and.navigation.checked.links.returning.http.404.detected": return completePass(checkedOccurrences(["not_found"]), "failed", true);
    case "seo.links.and.navigation.checked.links.returning.http.410.detected": return completePass(checkedOccurrences(["gone"]), "failed", true);
    case "seo.links.and.navigation.checked.links.returning.server.errors.detected": return completePass(checkedOccurrences(["server_error"]), "failed", true);
    case "seo.links.and.navigation.checked.links.failing.dns.resolution.detected": return completePass(checkedOccurrences(["dns_failure"]), "failed", true);
    case "seo.links.and.navigation.checked.links.failing.https.connections.detected": return completePass(checkedOccurrences(["tls_failure"]), "failed", true);
    case "seo.links.and.navigation.checked.links.timing.out.detected": return completePass(checkedOccurrences(["timeout"]), "failed", true);
    case "seo.links.and.navigation.checked.links.blocked.by.access.restrictions.detected": return completePass(checkedOccurrences(["unauthorized", "forbidden", "bot_challenge"]), "failed", true);
    case "seo.links.and.navigation.checked.links.encountering.rate.limits.detected": return completePass(checkedOccurrences(["rate_limited"]), "failed", true);
    case "seo.links.and.navigation.checked.links.containing.redirect.loops.detected": return completePass(checkedOccurrences(["redirect_loop"]), "failed", true);
    case "seo.links.and.navigation.checked.links.exceeding.the.redirect.limit.detected": return completePass(checkedOccurrences(["redirect_limit_exceeded"]), "failed", true);
    case "seo.links.and.navigation.checked.links.redirecting.to.broken.destinations.detected":
      return completePass(checked.filter((item) => item.redirectTrace.length && ["not_found", "gone", "server_error"].includes(item.state)).map((item) => ({ url: item.requestedUrl, source: "network", values: { finalUrl: item.finalUrl, state: item.state } })), "failed", true);
    case "seo.links.and.navigation.redirecting.internal.links.detected":
    case "seo.links.and.navigation.redirecting.external.links.detected": {
      const internal = check.id === "seo.links.and.navigation.redirecting.internal.links.detected";
      const urls = new Set(discovered.filter((item) => item.internal === internal).map((item) => item.resolvedUrl));
      const redirected = checked.filter((item) => urls.has(item.requestedUrl) && item.redirectTrace.length).map((item) => ({ url: item.requestedUrl, source: "network", values: { finalUrl: item.finalUrl, redirects: item.redirectTrace } } as AuditOccurrence));
      return completePass(redirected, "advisory");
    }
    case "seo.links.and.navigation.checked.and.unchecked.link.totals.recorded":
      return evidence.links.truncated
        ? unable("Link sampling limit was reached before every destination could be checked", { discovered: evidence.links.totalDiscovered, checked: checked.length, unchecked: Math.max(0, evidence.links.totalDiscovered - checked.length), truncated: true })
        : result("passed", { discovered: evidence.links.totalDiscovered, checked: checked.length, unchecked: Math.max(0, evidence.links.totalDiscovered - checked.length), truncated: false });
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
    case "seo.links.and.navigation.sponsored.link.attributes.detected": {
      const rows = evidence.source.elements.filter((item) => item.tagName === "a" && (attr(item, "rel") || "").toLowerCase().split(/\s+/).includes("sponsored"));
      return result(rows.length ? "passed" : "not_applicable", occurrenceEnvelope(rows.map((item) => occurrence(item))));
    }
    case "seo.links.and.navigation.user.generated.content.link.attributes.detected": {
      const rows = evidence.source.elements.filter((item) => item.tagName === "a" && (attr(item, "rel") || "").toLowerCase().split(/\s+/).includes("ugc"));
      return result(rows.length ? "passed" : "not_applicable", occurrenceEnvelope(rows.map((item) => occurrence(item))));
    }
    case "seo.links.and.navigation.navigation.landmarks.have.distinguishable.accessible.names": {
      const rows = evidence.source.elements.filter((item) => item.tagName === "nav" || attr(item, "role")?.toLowerCase() === "navigation");
      if (!rows.length) return result("not_applicable", { landmarks: 0 });
      if (rows.length === 1) return result("passed", { landmarks: 1, names: [(attr(rows[0], "aria-label") || attr(rows[0], "aria-labelledby") || "").trim()] });
      const names = rows.map((item) => (attr(item, "aria-label") || attr(item, "aria-labelledby") || "").trim());
      const invalid = rows.filter((_, index) => !names[index] || names.indexOf(names[index]) !== index);
      return result(invalid.length ? "failed" : "passed", { landmarks: rows.length, names, ...occurrenceEnvelope(invalid.map((item) => occurrence(item))) });
    }
    default:
      return unable("This link check has an explicit route but still needs a dedicated evaluator", { discovered: discovered.length, checked: checked.length, deduplicated: byUrl.size });
  }
}

function resourceInventoryEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete") return unable("Resource declarations could not be trusted because source collection was incomplete", { collection: evidence.source.collection });
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
  const failures = rows.filter((item) => !["success", "redirect"].includes(item.state));
  const untestable = failures.filter((item) => ["dns_failure", "tls_failure", "timeout", "rate_limited", "bot_challenge", "unable_to_test"].includes(item.state));
  if (untestable.length) return unable("One or more declared resources could not be confidently tested", occurrenceEnvelope(untestable.map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, error: item.error } }))));
  if (evidence.resources.truncated) return unable("Resource sampling limit was reached", { totalDiscovered: evidence.resources.totalDiscovered, retained: evidence.resources.retained, declarations: declarations.length });
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
  return result(failures.length ? "failed" : "passed", { checked: rows.length, ...occurrenceEnvelope(failures.map((item) => ({ url: item.requestedUrl, source: "network", values: { state: item.state, status: item.status } }))) });
}

function structuredDataEvaluator(check: AuditCheck, evidence: AuditEvidenceBundle) {
  if (evidence.source.collection.status !== "complete") return unable("Structured-data source collection was incomplete", { collection: evidence.source.collection });
  const blocks = evidence.source.structuredData;
  const entities = blocks.flatMap((block) => block.entities);
  const valuesFor = (keys: string[]) => {
    const values: unknown[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (keys.includes(key)) values.push(nested);
        visit(nested);
      }
    };
    blocks.forEach((block) => visit(block.parsed));
    return values.flatMap((value) => Array.isArray(value) ? value : [value]);
  };
  const typed = (types: RegExp) => entities.filter((entity) => entity.types.some((type) => types.test(type)));
  const propertyPresent = (rows: typeof entities, property: string) => rows.filter((entity) => {
    const value = entity.value[property];
    return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim().length > 0;
  });
  const validUrl = (value: unknown) => {
    if (typeof value !== "string") return false;
    try { const url = new URL(value, evidence.source.documentUrl); return ["http:", "https:"].includes(url.protocol); } catch { return false; }
  };
  const normalizeUrl = (value: string) => { try { const url = new URL(value, evidence.source.documentUrl); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return value; } };
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
    case "seo.structured.data.structured.data.context.declared": {
      if (!blocks.length) return result("not_applicable", { blocks: 0 });
      const missing = blocks.filter((block) => !block.parsed || typeof block.parsed !== "object" || !("@context" in (Array.isArray(block.parsed) ? (block.parsed[0] || {}) : block.parsed as Record<string, unknown>)));
      return result(missing.length ? "failed" : "passed", { blocks: blocks.length, missing: missing.map((block) => block.index) });
    }
    case "seo.structured.data.structured.data.url.identifiers.use.valid.formats": {
      const values = entities.map((entity) => entity.id).filter((value): value is string => Boolean(value));
      if (!values.length) return result("not_applicable", { values: 0 });
      const invalid = values.filter((value) => !value.startsWith("#") && !validUrl(value));
      return result(invalid.length ? "failed" : "passed", { values, invalid });
    }
    case "seo.structured.data.structured.data.url.properties.use.valid.formats": {
      const values = valuesFor(["url", "sameAs", "contentUrl", "embedUrl", "image", "logo", "thumbnailUrl"]);
      if (!values.length) return result("not_applicable", { values: 0 });
      const invalid = values.filter((value) => typeof value === "string" && !validUrl(value));
      return result(invalid.length ? "failed" : "passed", { values: values.length, invalid });
    }
    case "seo.structured.data.local.entity.references.resolve.within.the.document": {
      const references = valuesFor(["@id"]).filter((value): value is string => typeof value === "string" && value.startsWith("#"));
      if (!references.length) return result("not_applicable", { references: 0 });
      const ids = new Set(entities.map((entity) => entity.id).filter(Boolean));
      const unresolved = references.filter((reference) => !ids.has(reference));
      return result(unresolved.length ? "failed" : "passed", { references, unresolved });
    }
    case "seo.structured.data.duplicate.entity.identifiers.contain.conflicting.values": {
      const grouped = new Map<string, string[]>();
      for (const entity of entities) if (entity.id) grouped.set(entity.id, [...(grouped.get(entity.id) || []), JSON.stringify(entity.value)]);
      const conflicts = [...grouped.entries()].filter(([, values]) => new Set(values).size > 1).map(([id]) => id);
      return result(!entities.some((entity) => entity.id) ? "not_applicable" : conflicts.length ? "failed" : "passed", { conflicts });
    }
    case "seo.structured.data.structured.data.dates.use.valid.formats": {
      const values = valuesFor(["datePublished", "dateModified", "dateCreated", "uploadDate", "startDate", "endDate"]);
      if (!values.length) return result("not_applicable", { values: 0 });
      const invalid = values.filter((value) => typeof value !== "string" || !Number.isFinite(Date.parse(value)));
      return result(invalid.length ? "failed" : "passed", { values, invalid });
    }
    case "seo.structured.data.structured.data.page.url.matches.the.selected.url": {
      const values = valuesFor(["url", "mainEntityOfPage"]).filter((value): value is string => typeof value === "string");
      if (!values.length) return result("not_applicable", { values: 0 });
      const selected = normalizeUrl(evidence.source.documentUrl);
      const matches = values.filter((value) => normalizeUrl(value) === selected);
      return result(matches.length ? "passed" : "advisory", { selected, values, matches });
    }
    case "seo.structured.data.organisation.name.declared": {
      const rows = typed(/^(?:Organization|Corporation|LocalBusiness)$/i);
      if (!rows.length) return result("not_applicable", { entities: 0 });
      const missing = rows.filter((entity) => !propertyPresent([entity], "name").length);
      return result(missing.length ? "failed" : "passed", { entities: rows.length, missing: missing.map((entity) => entity.pointer) });
    }
    case "seo.structured.data.organisation.website.declared": {
      const rows = typed(/^(?:Organization|Corporation|LocalBusiness)$/i);
      if (!rows.length) return result("not_applicable", { entities: 0 });
      const invalid = rows.filter((entity) => !validUrl(entity.value.url));
      return result(invalid.length ? "advisory" : "passed", { entities: rows.length, invalid: invalid.map((entity) => entity.pointer) });
    }
    case "seo.structured.data.article.headline.declared":
    case "seo.structured.data.article.author.declared":
    case "seo.structured.data.article.publication.date.declared":
    case "seo.structured.data.article.modification.date.declared": {
      const rows = typed(/Article|NewsArticle|BlogPosting/i);
      if (!rows.length) return result("not_applicable", { entities: 0 });
      const property = check.id.includes("headline") ? "headline" : check.id.includes("author") ? "author" : check.id.includes("publication") ? "datePublished" : "dateModified";
      const missing = rows.filter((entity) => !propertyPresent([entity], property).length);
      return result(missing.length ? "failed" : "passed", { property, entities: rows.length, missing: missing.map((entity) => entity.pointer) });
    }
    case "seo.structured.data.breadcrumb.items.have.names.and.positions":
    case "seo.structured.data.breadcrumb.positions.form.a.consistent.sequence": {
      const rows = typed(/^BreadcrumbList$/i);
      if (!rows.length) return result("not_applicable", { entities: 0 });
      const items = rows.flatMap((entity) => Array.isArray(entity.value.itemListElement) ? entity.value.itemListElement : [] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
      if (!items.length) return result("failed", { items: 0 });
      if (check.id.includes("names.and.positions")) {
        const invalid = items.filter((item) => !String(item.name || (item.item as Record<string, unknown> | undefined)?.name || "").trim() || !Number.isFinite(Number(item.position)));
        return result(invalid.length ? "failed" : "passed", { items: items.length, invalid: invalid.length });
      }
      const positions = items.map((item) => Number(item.position));
      const valid = positions.every((position, index) => Number.isInteger(position) && position === index + 1);
      return result(valid ? "passed" : "failed", { positions });
    }
    case "seo.structured.data.declared.product.price.formats.valid": {
      const prices = valuesFor(["price", "lowPrice", "highPrice"]);
      if (!prices.length) return result("not_applicable", { prices: 0 });
      const invalid = prices.filter((price) => !Number.isFinite(Number(price)) || Number(price) < 0);
      return result(invalid.length ? "failed" : "passed", { prices, invalid });
    }
    case "seo.structured.data.declared.product.currency.codes.valid": {
      const currencies = valuesFor(["priceCurrency"]).filter((value): value is string => typeof value === "string");
      if (!currencies.length) return result("not_applicable", { currencies: 0 });
      const invalid = currencies.filter((value) => !/^[A-Z]{3}$/.test(value));
      return result(invalid.length ? "failed" : "passed", { currencies, invalid });
    }
    case "ai_readiness.content.and.attribution.author.attribution.declared.in.structured.data": return result(valuesFor(["author"]).length ? "passed" : blocks.length ? "advisory" : "not_applicable", { values: valuesFor(["author"]).length });
    case "ai_readiness.content.and.attribution.publisher.attribution.declared.in.structured.data": return result(valuesFor(["publisher"]).length ? "passed" : blocks.length ? "advisory" : "not_applicable", { values: valuesFor(["publisher"]).length });
    case "ai_readiness.content.and.attribution.publication.date.declared.in.structured.data": return result(valuesFor(["datePublished"]).length ? "passed" : blocks.length ? "advisory" : "not_applicable", { values: valuesFor(["datePublished"]) });
    case "ai_readiness.content.and.attribution.modification.date.declared.in.structured.data": return result(valuesFor(["dateModified"]).length ? "passed" : blocks.length ? "advisory" : "not_applicable", { values: valuesFor(["dateModified"]) });
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
  const desktopRaw = evidence.rendered.desktop.metrics[config.field];
  const mobileRaw = evidence.rendered.mobile.metrics[config.field];
  if (typeof desktopRaw !== "number" || typeof mobileRaw !== "number" || !Number.isFinite(desktopRaw) || !Number.isFinite(mobileRaw)) return unable(`Required browser metric ${config.field} was missing`);
  const desktop = desktopRaw;
  const mobile = mobileRaw;
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
  const stylesheets = evidence.resources.declarations.filter((item) => item.declarationType === "stylesheet");
  const failedStylesheets = evidence.resources.results.filter((item) => item.declarations.some((declaration) => declaration.declarationType === "stylesheet") && !["success", "redirect"].includes(item.state));
  if (failedStylesheets.length) return unable("One or more stylesheets could not be inspected for font-display", { stylesheets: failedStylesheets });
  if (!evidence.fontFaces.length) return stylesheets.length ? unable("Stylesheets were collected but no reliable font-face parse result was available", { stylesheets: stylesheets.length }) : result("not_applicable", { rules: 0 });
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
    "accessibility.accessibility.aria.attributes.permitted.for.their.roles": "aria-allowed-attr",
    "accessibility.accessibility.required.aria.parent.roles.present": "aria-required-parent",
    "accessibility.accessibility.required.aria.child.roles.present": "aria-required-children",
    "accessibility.accessibility.aria.references.point.to.existing.elements": "aria-valid-attr-value",
    "accessibility.accessibility.duplicate.ids.used.by.accessibility.references.detected": "duplicate-id-aria",
    "accessibility.accessibility.focusable.elements.inside.aria.hidden.content.detected": "aria-hidden-focus",
    "accessibility.accessibility.nested.interactive.controls.detected": "nested-interactive",
    "accessibility.accessibility.positive.tabindex.values.detected": "tabindex",
    "accessibility.accessibility.scrollable.regions.keyboard.focusable": "scrollable-region-focusable",
    "accessibility.accessibility.form.inputs.have.accessible.labels": "label",
    "accessibility.accessibility.select.controls.have.accessible.labels": "select-name",
    "accessibility.accessibility.textareas.have.accessible.labels": "label",
    "accessibility.accessibility.form.labels.reference.existing.controls": "label",
    "accessibility.accessibility.multiple.labels.for.the.same.control.detected": "form-field-multiple-labels",
    "accessibility.accessibility.table.headers.associated.with.data.cells": "td-headers-attr",
    "accessibility.accessibility.table.header.cells.contain.text": "empty-table-header",
    "accessibility.accessibility.definition.lists.have.valid.structure": "definition-list",
    "accessibility.accessibility.lists.contain.valid.list.items": "list",
    "accessibility.accessibility.meta.refresh.redirects.detected": "meta-refresh",
    "accessibility.accessibility.svg.elements.requiring.accessible.names.have.names": "svg-img-alt",
    "accessibility.accessibility.text.contrast.measured.where.calculable": "color-contrast",
  };
  const axeId = axeRuleByCheck[check.id];
  if (axeId) {
    if (!evidence.rendered.desktop.axe || !evidence.rendered.mobile.axe) return unable("axe-core did not complete for both viewports", {
      desktop: Boolean(evidence.rendered.desktop.axe),
      mobile: Boolean(evidence.rendered.mobile.axe),
      errors: {
        desktop: evidence.rendered.desktop.axeError,
        mobile: evidence.rendered.mobile.axeError,
      },
    });
    const reports = [evidence.rendered.desktop.axe, evidence.rendered.mobile.axe];
    const violations = reports.flatMap((report) => report?.violations.filter((violation) => violation.id === axeId) || []);
    const incomplete = reports.flatMap((report) => report?.incomplete.filter((entry) => entry.id === axeId) || []);
    const passes = reports.reduce((total, report) => total + (report?.passes.find((entry) => entry.id === axeId)?.nodes || 0), 0);
    const occurrences = violations.flatMap((violation) => violation.nodes);
    if (occurrences.length) return result("failed", { rule: axeId, axeVersion: reports[0]?.version || reports[1]?.version || null, ...occurrenceEnvelope(occurrences) });
    if (incomplete.length) return unable(`axe-core could not conclusively evaluate ${axeId}`, { rule: axeId, ...occurrenceEnvelope(incomplete.flatMap((entry) => entry.nodes)) });
    return result(passes > 0 ? "passed" : "not_applicable", { rule: axeId, axeVersion: reports[0]?.version || reports[1]?.version || null, passedNodes: passes });
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
      if (values.some((item) => typeof item.value !== "number" || !Number.isFinite(item.value))) return unable("Rendered text length was not available");
      const largestDifference = Math.max(...values.map((item) => Math.abs(Number(item.value) - sourceLength)));
      return result(largestDifference > 100 ? "advisory" : "passed", { sourceLength, rendered: values, largestDifference });
    }
    case "accessibility.images.and.media.image.display.dimensions.recorded": {
      const images = occurrences("images");
      return images.length ? result("passed", occurrenceEnvelope(images)) : result("not_applicable", { images: 0 });
    }
    case "accessibility.images.and.media.image.intrinsic.dimensions.recorded": {
      const images = occurrences("images");
      if (!images.length) return result("not_applicable", { images: 0 });
      if (images.some((item) => typeof item.values?.naturalWidth !== "number" || typeof item.values?.naturalHeight !== "number")) return unable("Intrinsic image dimensions were incomplete");
      return result("passed", occurrenceEnvelope(images));
    }
    case "accessibility.images.and.media.oversized.images.relative.to.display.dimensions.detected": {
      const oversized = occurrences("images").filter((item) => item.values?.oversized === true);
      return result(oversized.length ? "advisory" : "passed", occurrenceEnvelope(oversized));
    }
    case "accessibility.images.and.media.image.aspect.ratio.distortion.detected": {
      const images = occurrences("images");
      if (!images.length) return result("not_applicable", { images: 0 });
      const distorted = images.filter((item) => item.values?.distorted === true);
      return result(distorted.length ? "failed" : "passed", occurrenceEnvelope(distorted));
    }
    case "accessibility.images.and.media.image.transfer.sizes.measured": {
      const rows = viewports.flatMap(([viewport, row]) => row.networkResources.filter((item) => /image/i.test(item.resourceType)).map((item) => ({ viewport, ...item })));
      if (!rows.length) return result("not_applicable", { images: 0 });
      if (rows.some((row) => !Number.isFinite(row.transferSize))) return unable("Image transfer-size evidence was incomplete");
      return result("passed", { images: rows.length, totalBytes: rows.reduce((total, row) => total + row.transferSize, 0), resources: rows });
    }
    case "accessibility.images.and.media.below.the.fold.image.loading.attributes.inspected": {
      const images = occurrences("images");
      if (!images.length) return result("not_applicable", { images: 0 });
      const eager = images.filter((item) => item.values?.belowFoldWithoutLazy === true);
      return result(eager.length ? "advisory" : "passed", occurrenceEnvelope(eager));
    }
    case "accessibility.images.and.media.largest.contentful.paint.image.uses.lazy.loading": {
      const values = metric("lcpImageLazy");
      const elements = metric("lcpElement");
      const imageViewports = elements.filter((item) => typeof item.value === "string" && /^img(?:[#.\s]|$)/i.test(item.value));
      if (!imageViewports.length) return result("not_applicable", { reason: "The LCP element was not an image", elements });
      if (values.some((item) => typeof item.value !== "boolean")) return unable("LCP image loading evidence was unavailable");
      return result(values.some((item) => imageViewports.some((image) => image.viewport === item.viewport) && item.value === true) ? "failed" : "passed", { viewports: values, elements });
    }
    case "accessibility.accessibility.touch.target.size.and.spacing.checked": {
      const small = occurrences("smallTouchTargets");
      return result(small.length ? "advisory" : "passed", occurrenceEnvelope(small));
    }
    case "accessibility.accessibility.viewport.settings.restrict.zoom":
      if (metric("viewportRestrictsZoom").some((item) => typeof item.value !== "boolean")) return unable("Viewport zoom evidence was unavailable");
      return result(metric("viewportRestrictsZoom").some((item) => item.value === true) ? "failed" : "passed", { viewports: metric("viewportRestrictsZoom") });
    case "accessibility.mobile.and.responsive.layout.multiple.viewport.declarations.detected": {
      const values = metric("viewportMetaCount");
      if (values.some((item) => typeof item.value !== "number")) return unable("Viewport declaration evidence was unavailable");
      return result(values.some((item) => Number(item.value) > 1) ? "advisory" : "passed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.viewport.width.configured.for.device.width": {
      const values = metric("viewportDeviceWidth");
      if (values.some((item) => typeof item.value !== "boolean")) return unable("Viewport-width evidence was unavailable");
      return result(values.every((item) => item.value === true) ? "passed" : "failed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.horizontal.page.overflow.detected.at.tested.widths": {
      const values = metric("horizontalOverflow");
      if (values.some((item) => typeof item.value !== "boolean")) return unable("Horizontal overflow evidence was unavailable");
      return result(values.some((item) => item.value === true) ? "failed" : "passed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.elements.extend.beyond.tested.viewports": {
      const overflowing = occurrences("overflow");
      return result(overflowing.length ? "failed" : "passed", occurrenceEnvelope(overflowing));
    }
    case "accessibility.mobile.and.responsive.layout.images.exceed.their.containing.elements": {
      const rows = occurrences("images").filter((item) => item.values?.overflowing === true);
      return result(rows.length ? "failed" : "passed", occurrenceEnvelope(rows));
    }
    case "accessibility.mobile.and.responsive.layout.tables.overflow.their.containing.elements": {
      const rows = occurrences("overflow").filter((item) => /^<table\b/i.test(item.html || ""));
      return result(rows.length ? "failed" : "passed", occurrenceEnvelope(rows));
    }
    case "accessibility.mobile.and.responsive.layout.fixed.elements.geometrically.overlap.main.content.at.tested.widths": {
      const values = metric("fixedContentOverlaps");
      if (values.some((item) => typeof item.value !== "number")) return unable("Fixed-element overlap evidence was unavailable");
      return result(values.some((item) => Number(item.value) > 0) ? "failed" : "passed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.text.sizes.measured.at.tested.mobile.widths": {
      const values = metric("smallTextElements");
      if (values.some((item) => typeof item.value !== "number")) return unable("Mobile text-size evidence was unavailable");
      return result(values.some((item) => Number(item.value) > 0) ? "advisory" : "passed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.desktop.and.mobile.content.differences.detected": {
      const values = metric("renderedTextLength");
      if (values.some((item) => typeof item.value !== "number")) return unable("Rendered text-length evidence was unavailable");
      const difference = Math.abs(Number(values[0].value) - Number(values[1].value));
      return result(difference > 100 ? "advisory" : "passed", { viewports: values, difference });
    }
    case "accessibility.mobile.and.responsive.layout.main.heading.visible.at.tested.widths": {
      const values = metric("visibleMainHeading");
      if (values.some((item) => typeof item.value !== "boolean")) return unable("Main-heading visibility evidence was unavailable");
      return result(values.every((item) => item.value === true) ? "passed" : "failed", { viewports: values });
    }
    case "accessibility.mobile.and.responsive.layout.primary.navigation.controls.have.accessible.names": {
      const values = metric("unnamedPrimaryNavigation");
      if (values.some((item) => typeof item.value !== "number")) return unable("Primary-navigation name evidence was unavailable");
      return result(values.some((item) => Number(item.value) > 0) ? "failed" : "passed", { viewports: values });
    }
    case "security.security.and.browser.protections.browser.reported.security.policy.violations.detected": {
      const values = metric("securityPolicyViolations");
      if (values.some((item) => typeof item.value !== "number")) return unable("Browser security-policy evidence was unavailable");
      return result(values.some((item) => Number(item.value) > 0) ? "failed" : "passed", { viewports: values });
    }
    case "ai_readiness.content.and.attribution.main.content.extractable.after.javascript.rendering": {
      const values = metric("mainTextLength");
      if (values.some((item) => typeof item.value !== "number")) return unable("Rendered main-content evidence was unavailable");
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
    case "infrastructure.dns.and.domain.configuration.selected.hostname.resolves.successfully": {
      const selected = new URL(evidence.source.documentUrl).hostname;
      const rows = evidence.dns.filter((query) => query.queriedHostname === selected && ["A", "AAAA", "CNAME"].includes(query.recordType));
      if (!rows.length) return unable("The selected hostname was not included in the DNS collection", { selected });
      if (rows.some((row) => row.error)) return unable("Selected-hostname DNS evidence was incomplete", { queries: rows });
      return result(records(rows).length ? "passed" : "failed", { selected, records: records(rows) });
    }
    case "infrastructure.dns.and.domain.configuration.ipv4.addresses.recorded": {
      const rows = byType("A");
      if (!complete(rows)) return unable("IPv4 evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "not_applicable", { records: found });
    }
    case "infrastructure.dns.and.domain.configuration.ipv6.addresses.recorded": {
      const rows = byType("AAAA");
      if (!complete(rows)) return unable("IPv6 evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "not_applicable", { records: found });
    }
    case "infrastructure.dns.and.domain.configuration.returned.cname.records.recorded": {
      const rows = byType("CNAME");
      if (!complete(rows)) return unable("CNAME evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "not_applicable", { records: found });
    }
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
    case "infrastructure.dns.and.domain.configuration.apex.domain.resolution.checked": {
      const apex = evidence.dns.find((query) => query.recordType === "SOA")?.queriedHostname;
      if (!apex) return unable("The apex hostname could not be identified from DNS evidence");
      const rows = evidence.dns.filter((query) => query.queriedHostname === apex && ["A", "AAAA", "CNAME"].includes(query.recordType));
      if (!rows.length || rows.some((row) => row.error)) return unable("Apex resolution evidence was incomplete", { queries: rows });
      return result("passed", { apex, records: records(rows) });
    }
    case "infrastructure.dns.and.domain.configuration.www.hostname.resolution.checked": {
      const rows = evidence.dns.filter((query) => query.queriedHostname.startsWith("www.") && ["A", "AAAA", "CNAME"].includes(query.recordType));
      if (!rows.length || rows.some((row) => row.error)) return unable("www hostname resolution evidence was incomplete", { queries: rows });
      return result(records(rows).length ? "passed" : "advisory", { records: records(rows) });
    }
    case "infrastructure.dns.and.domain.configuration.mail.exchange.records.detected": {
      const rows = byType("MX");
      if (!complete(rows)) return unable("Mail-exchange evidence was incomplete", { queries: rows });
      const found = records(rows);
      return result(found.length ? "passed" : "not_applicable", { records: found });
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
    if (evidence.source.collection.status !== "complete") return unable("Source metadata collection was incomplete", { collection: evidence.source.collection });
    const metas = evidence.source.elements.filter((element) => element.tagName === "meta" && /^(?:robots|googlebot|bingbot)$/i.test(attr(element, "name") || ""));
    return result(metas.length ? "passed" : "not_applicable", { ...occurrenceEnvelope(metas.map((element) => occurrence(element, { content: attr(element, "content") }))) });
  }
  if (check.id === "seo.crawling.and.indexing.x.robots.tag.directives.detected") {
    if (evidence.http.collection.status !== "complete" || evidence.http.status == null) return unable("HTTP header collection was incomplete", { collection: evidence.http.collection });
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
  if (!evidence.sitemaps.length) return unable("Sitemap discovery and collection did not produce evidence");
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
      return result(reachable.every((sitemap) => !sitemap.error) ? "passed" : "failed", { sitemaps: reachable });
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
  source_extended: sourceExtendedEvaluator,
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
  alternate_origin: alternateOriginEvaluator,
  nxdomain_control: nxdomainControlEvaluator,
  ai_resources: aiResourceEvaluator,
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
