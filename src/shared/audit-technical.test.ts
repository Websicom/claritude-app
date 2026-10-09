import { describe, expect, it } from "vitest";
import {
  AUDIT_TECHNICAL_CHECK_IDS,
  buildAuditTechnicalSections,
  formatAuditTechnicalBytes,
  type AuditTechnicalResult,
} from "./audit-technical";
import { AUDIT_REGISTRY } from "./audit-registry.generated";

const row = (check_id: string, outcome: string, evidence: Record<string, any>): AuditTechnicalResult => ({ check_id, outcome, evidence });

describe("audit technical profile", () => {
  it("formats compact byte values", () => {
    expect(formatAuditTechnicalBytes(900)).toBe("900 B");
    expect(formatAuditTechnicalBytes(1536)).toBe("1.5 KB");
    expect(formatAuditTechnicalBytes(1_887_437)).toBe("1.8 MB");
    expect(formatAuditTechnicalBytes(undefined)).toBeNull();
  });

  it("derives all five sections from retained check evidence", () => {
    const sections = buildAuditTechnicalSections([
      row("seo.crawling.http_status", "passed", { status: 200, finalUrl: "https://example.com/" }),
      row("seo.crawling.and.indexing.redirect.chain.detected", "passed", { redirects: [] }),
      row("performance.performance.total.transferred.page.size.measured", "passed", { desktop: { value: 1_887_437 }, mobile: { value: 2_097_152 } }),
      row("performance.performance.text.compression.detected", "advisory", { checked: 10, totalDiscovered: 2, occurrences: [{ url: "a.js" }, { url: "b.css" }] }),
      row("seo.page.metadata.canonical.points.to.a.different.page", "passed", { canonical: ["https://example.com/"] }),
      row("seo.crawling.and.indexing.noindex.directive.detected", "passed", { directives: null }),
      row("seo.crawling.and.indexing.selected.page.allowed.by.googlebot.robots.rules", "passed", { agent: "Googlebot", allowed: true }),
      row("seo.crawling.and.indexing.selected.page.found.in.checked.sitemap.files", "passed", { urlsChecked: 42, matches: [{ loc: "https://example.com/" }] }),
      row("seo.links.and.navigation.checked.and.unchecked.link.totals.recorded", "passed", { checked: 20, discovered: 20 }),
      row("seo.links.and.navigation.checked.links.returning.http.404.detected", "failed", { totalDiscovered: 1, occurrences: [{ url: "https://example.com/missing" }] }),
      row("accessibility.images.and.media.image.formats.recorded", "passed", { formats: [{ format: "webp" }, { format: "avif" }, { format: "jpg" }] }),
      row("accessibility.images.and.media.below.the.fold.image.loading.attributes.inspected", "advisory", { totalDiscovered: 1, occurrences: [{ url: "hero.jpg" }] }),
      row("performance.performance.image.transfer.size.measured", "passed", { desktop: { value: 2048 }, mobile: { value: 4096 } }),
      row("infrastructure.dns.and.domain.configuration.domain.nameservers.recorded", "passed", { records: [{ value: "ada.ns.cloudflare.com.", ttl: 3600 }] }),
      row("infrastructure.dns.and.domain.configuration.dnssec.validation.status.reported.by.the.resolver", "passed", { queries: [{ authenticatedData: true }, { authenticatedData: true }] }),
      row("infrastructure.dns.and.domain.configuration.spf.record.detected", "passed", { records: [{ value: "v=spf1 -all" }] }),
      row("security.https.selected", "passed", { finalUrl: "https://example.com/" }),
      row("security.headers.hsts", "passed", { values: ["max-age=31536000"] }),
      row("security.security.and.browser.protections.active.mixed.content.requests.detected", "passed", { totalDiscovered: 0, occurrences: [] }),
    ]);

    expect(sections.map((section) => section.title)).toEqual(["Delivery", "Content & Discovery", "Assets", "Infrastructure", "Security"]);
    expect(sections.find((section) => section.id === "delivery")?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "http-status", value: "200" }),
      expect.objectContaining({ key: "transfer-size", value: "1.8 MB desktop · 2.0 MB mobile" }),
      expect.objectContaining({ key: "compression", value: "8 of 10 checked resources" }),
    ]));
    expect(sections.find((section) => section.id === "content")?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "indexable", value: "Yes" }),
      expect.objectContaining({ key: "broken-links", value: "1 of 20 checked" }),
    ]));
    expect(sections.find((section) => section.id === "assets")?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "modern-images", value: "2 of 3 · 67%" }),
      expect.objectContaining({ key: "lazy-images", value: "1" }),
    ]));
    expect(sections.find((section) => section.id === "infrastructure")?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "nameservers", value: "ada.ns.cloudflare.com" }),
      expect.objectContaining({ key: "dnssec", value: "Validated" }),
    ]));
    expect(sections.find((section) => section.id === "security")?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "https", value: "Yes" }),
      expect.objectContaining({ key: "mixed-content", value: "Clear" }),
    ]));
  });

  it("omits unavailable evidence and does not expose raw objects", () => {
    const sections = buildAuditTechnicalSections([
      row("seo.crawling.http_status", "unable_to_test", { reason: "timeout", response: { large: true } }),
      row("security.headers.csp", "advisory", { values: [] }),
    ]);

    expect(sections.find((section) => section.id === "delivery")?.items).toEqual([]);
    expect(sections.find((section) => section.id === "security")?.items).toEqual([
      expect.objectContaining({ key: "csp", value: "Not present" }),
    ]);
    expect(JSON.stringify(sections)).not.toContain("timeout");
    expect(new Set(AUDIT_TECHNICAL_CHECK_IDS).size).toBe(AUDIT_TECHNICAL_CHECK_IDS.length);
  });

  it("only requests check IDs present in the current registry", () => {
    const registryIds = new Set(AUDIT_REGISTRY.map((check) => check.id));
    expect(AUDIT_TECHNICAL_CHECK_IDS.filter((id) => !registryIds.has(id))).toEqual([]);
  });
});
