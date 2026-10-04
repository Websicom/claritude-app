import { performance } from "node:perf_hooks";
import { AUDIT_REGISTRY } from "../src/shared/audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "../src/shared/audit-evaluator-map.generated";
import { collectLinkInventory, collectResourceInventory } from "../src/shared/audit-collectors";
import { evaluateAuditCatalogue, type AuditEvidenceBundle } from "../src/shared/audit-evaluators";
import { headerMultimap, parseSourceDom, type HttpEvidence } from "../src/shared/audit-evidence";

const encoder = new TextEncoder();
const html = `<!doctype html><html><head><title>Benchmark page</title><meta name="description" content="Evidence benchmark"><link rel="icon" href="/favicon.ico"><link rel="manifest" href="/manifest.json"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","url":"https://example.com/"}</script></head><body><main><h1>Benchmark page</h1>${Array.from({ length: 40 }, (_, index) => `<a href="/page-${index}">Page ${index}</a>`).join("")}${Array.from({ length: 20 }, (_, index) => `<img src="/image-${index}.webp"${index % 3 ? ` alt="Image ${index}"` : ""}>`).join("")}</main></body></html>`;

const started = performance.now();
const cpuStarted = process.cpuUsage();
const source = parseSourceDom(html, "https://example.com/");
let requestCount = 0;
const fetchTrace = async (url: string) => {
  requestCount += 1;
  const body = url.endsWith("manifest.json") ? '{"name":"Benchmark"}' : "ok";
  return { response: new Response(body, { status: 200, headers: { "content-type": url.endsWith(".json") ? "application/json" : "text/plain" } }), redirects: [] };
};
const [links, resources] = await Promise.all([
  collectLinkInventory(source.links, fetchTrace),
  collectResourceInventory(source.resources, fetchTrace),
]);
const http: HttpEvidence = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  redirectTrace: [],
  responseMs: 20,
  headers: headerMultimap(new Headers({ "content-type": "text/html; charset=utf-8" })),
  contentType: "text/html; charset=utf-8",
  encodedBytes: encoder.encode(html).byteLength,
  decodedBytes: encoder.encode(html).byteLength,
  collection: { status: "complete" },
};
const evidence: AuditEvidenceBundle = { http, source, rendered: null, links, resources, canonical: null, dns: [], robots: null, sitemaps: [], fontFaces: [], alternateOrigins: null, nxdomainControl: null, aiResources: null };
const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
const implemented = active.filter((check) => AUDIT_EVALUATOR_KEYS[check.id] !== "unsupported");
const results = evaluateAuditCatalogue(implemented.map((check) => check.id), evidence);
const cpu = process.cpuUsage(cpuStarted);
const outcomeCounts = Object.fromEntries(["passed", "failed", "advisory", "not_applicable", "unable_to_test"].map((outcome) => [outcome, results.filter((result) => result.outcome === outcome).length]));
const evidenceBytes = encoder.encode(JSON.stringify({ http, source, links, resources })).byteLength;
const resultBytes = encoder.encode(JSON.stringify(results)).byteLength;

console.log(JSON.stringify({
  fixture: "source + shared link/resource collection; browser, DNS, robots and sitemap deliberately unavailable",
  catalogueChecks: active.length,
  implementedChecks: implemented.length,
  implementationCoverage: active.length ? Math.round(implemented.length / active.length * 100) : 0,
  checksAttemptedInFixture: results.length,
  wallTimeMs: Math.round((performance.now() - started) * 100) / 100,
  cpuUserMs: Math.round(cpu.user / 10) / 100,
  cpuSystemMs: Math.round(cpu.system / 10) / 100,
  browserDurationMs: 0,
  browserSessions: 0,
  httpRequests: requestCount,
  uniqueLinksChecked: links.retained,
  uniqueResourcesChecked: resources.retained,
  approximateEvidenceBytes: evidenceBytes,
  approximateResultBytes: resultBytes,
  occurrencesStored: results.reduce((total, result) => total + (Array.isArray(result.evidence.occurrences) ? result.evidence.occurrences.length : 0), 0),
  truncatedCollections: Number(links.truncated) + Number(resources.truncated),
  outcomeCounts,
}, null, 2));
