export type AuditTechnicalResult = {
  check_id: string;
  outcome: string;
  evidence?: Record<string, any> | null;
};

export type AuditTechnicalTone = "neutral" | "positive" | "issue";

export type AuditTechnicalItem = {
  key: string;
  label: string;
  value: string;
  detail?: string;
  tone?: AuditTechnicalTone;
};

export type AuditTechnicalSectionId =
  | "delivery"
  | "content"
  | "assets"
  | "infrastructure"
  | "security";

export type AuditTechnicalSection = {
  id: AuditTechnicalSectionId;
  title: string;
  items: AuditTechnicalItem[];
};

export type AuditTechnicalProfile = {
  available: true;
  runId: string;
  pageUrl: string;
  completedAt: string;
  sections: AuditTechnicalSection[];
};

export type AuditTechnicalUnavailable = { available: false };

const IDS = {
  httpStatus: "seo.crawling.http_status",
  redirects: "seo.crawling.and.indexing.redirect.chain.detected",
  responseTime: "performance.performance.document.response.time.measured",
  transferSize: "performance.performance.total.transferred.page.size.measured",
  requests: "performance.performance.total.resource.request.count.measured",
  thirdParty: "performance.performance.third.party.request.count.measured",
  compression: "performance.performance.text.compression.detected",
  staticCache: "performance.performance.static.resource.cache.directives.inspected",
  cacheIndicators: "infrastructure.server.and.http.information.cache.hit.or.miss.headers.detected",
  cacheControl: "infrastructure.server.and.http.information.cache.control.directives.recorded",
  cdn: "infrastructure.server.and.http.information.cdn.or.reverse.proxy.header.indicators.detected",
  canonical: "seo.page.metadata.canonical.points.to.a.different.page",
  noindex: "seo.crawling.and.indexing.noindex.directive.detected",
  robotsReachable: "seo.crawling.and.indexing.robots.txt.file.reachable",
  robotsAllowed: "seo.crawling.and.indexing.selected.page.allowed.by.googlebot.robots.rules",
  sitemapReachable: "seo.crawling.and.indexing.referenced.xml.sitemap.reachable",
  sitemapPage: "seo.crawling.and.indexing.selected.page.found.in.checked.sitemap.files",
  language: "seo.page.metadata.html.language.declared",
  structuredTypes: "seo.structured.data.schema.org.types.identified",
  internalLinks: "seo.links.and.navigation.internal.links.identified",
  externalLinks: "seo.links.and.navigation.external.links.identified",
  linkTotals: "seo.links.and.navigation.checked.and.unchecked.link.totals.recorded",
  imageFormats: "accessibility.images.and.media.image.formats.recorded",
  lazyImages: "accessibility.images.and.media.below.the.fold.image.loading.attributes.inspected",
  imageBytes: "performance.performance.image.transfer.size.measured",
  scriptBytes: "performance.performance.javascript.transfer.size.measured",
  cssBytes: "performance.performance.css.transfer.size.measured",
  fontBytes: "performance.performance.font.transfer.size.measured",
  renderBlocking: "performance.performance.render.blocking.resources.detected",
  preloads: "performance.performance.resource.preload.declarations.inspected",
  unusedPreloads: "performance.performance.preloaded.resources.unused.during.the.test.detected",
  nameservers: "infrastructure.dns.and.domain.configuration.domain.nameservers.recorded",
  ipv4: "infrastructure.dns.and.domain.configuration.ipv4.addresses.recorded",
  ipv6: "infrastructure.dns.and.domain.configuration.ipv6.addresses.recorded",
  cname: "infrastructure.dns.and.domain.configuration.returned.cname.records.recorded",
  dnssec: "infrastructure.dns.and.domain.configuration.dnssec.validation.status.reported.by.the.resolver",
  dnsTtls: "infrastructure.dns.and.domain.configuration.returned.dns.record.ttls.recorded",
  apexWww: "infrastructure.dns.and.domain.configuration.apex.and.www.http.redirect.behaviour.compared",
  mail: "infrastructure.dns.and.domain.configuration.mail.exchange.records.detected",
  spf: "infrastructure.dns.and.domain.configuration.spf.record.detected",
  dmarc: "infrastructure.dns.and.domain.configuration.dmarc.record.detected",
  caa: "infrastructure.dns.and.domain.configuration.caa.certificate.authority.restrictions.detected",
  https: "security.https.selected",
  tls: "security.security.and.browser.protections.https.connection.succeeds",
  hsts: "security.headers.hsts",
  csp: "security.headers.csp",
  framing: "security.security.and.browser.protections.frame.embedding.protection.declared",
  contentTypeOptions: "security.security.and.browser.protections.x.content.type.options.header.present",
  referrerPolicy: "security.security.and.browser.protections.referrer.policy.declared",
  permissionsPolicy: "security.security.and.browser.protections.permissions.policy.header.present",
  mixedContent: "security.security.and.browser.protections.active.mixed.content.requests.detected",
  cookieSecure: "security.security.and.browser.protections.observed.cookies.have.secure.attributes",
  cookieHttpOnly: "security.security.and.browser.protections.observed.cookies.have.httponly.attributes",
  cookieSameSite: "security.security.and.browser.protections.observed.cookies.have.samesite.attributes",
} as const;

const BROKEN_LINK_IDS = [
  "seo.links.and.navigation.checked.links.returning.http.404.detected",
  "seo.links.and.navigation.checked.links.returning.http.410.detected",
  "seo.links.and.navigation.checked.links.returning.server.errors.detected",
  "seo.links.and.navigation.checked.links.failing.dns.resolution.detected",
  "seo.links.and.navigation.checked.links.failing.https.connections.detected",
  "seo.links.and.navigation.checked.links.timing.out.detected",
  "seo.links.and.navigation.checked.links.containing.redirect.loops.detected",
  "seo.links.and.navigation.checked.links.exceeding.the.redirect.limit.detected",
  "seo.links.and.navigation.checked.links.redirecting.to.broken.destinations.detected",
] as const;

export const AUDIT_TECHNICAL_CHECK_IDS = [...new Set([...Object.values(IDS), ...BROKEN_LINK_IDS])];

const asNumber = (value: unknown) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const compactText = (value: unknown, maximum = 160) => {
  const text = String(value ?? "").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
};

const formatNumber = (value: number) => new Intl.NumberFormat("en-GB").format(value);

const formatImageFormat = (value: unknown) => {
  const normalized = compactText(value || "unknown", 24).toLowerCase();
  const labels: Record<string, string> = {
    avif: "Avif",
    bmp: "Bmp",
    gif: "Gif",
    ico: "Ico",
    jpeg: "Jpg",
    jpg: "Jpg",
    png: "Png",
    svg: "Svg",
    tiff: "Tiff",
    webp: "WebP",
  };
  return labels[normalized] || `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
};

export function formatAuditTechnicalBytes(value: unknown) {
  const bytes = asNumber(value);
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function buildAuditTechnicalSections(results: AuditTechnicalResult[]): AuditTechnicalSection[] {
  const resultById = new Map(results.map((result) => [result.check_id, result]));
  const usable = (id: string) => {
    const row = resultById.get(id);
    return row && row.outcome !== "unable_to_test" ? row : null;
  };
  const evidence = (id: string) => usable(id)?.evidence || null;
  const resultTone = (id: string): AuditTechnicalTone => {
    const outcome = usable(id)?.outcome;
    return outcome === "failed" || outcome === "advisory" ? "issue" : outcome === "passed" ? "positive" : "neutral";
  };
  const sections: AuditTechnicalSection[] = [
    { id: "delivery", title: "Delivery", items: [] },
    { id: "content", title: "Content & Discovery", items: [] },
    { id: "assets", title: "Assets", items: [] },
    { id: "infrastructure", title: "Infrastructure", items: [] },
    { id: "security", title: "Security", items: [] },
  ];
  const section = (id: AuditTechnicalSectionId) => sections.find((entry) => entry.id === id)!;
  const add = (sectionId: AuditTechnicalSectionId, key: string, label: string, value: unknown, detail?: string, tone: AuditTechnicalTone = "neutral") => {
    if (value == null || value === "") return;
    section(sectionId).items.push({ key, label, value: String(value), ...(detail ? { detail } : {}), ...(tone !== "neutral" ? { tone } : {}) });
  };
  const metric = (id: string, formatter: (value: number) => string) => {
    const row = evidence(id);
    if (!row) return null;
    const desktop = asNumber(row.desktop?.value);
    const mobile = asNumber(row.mobile?.value);
    if (desktop == null && mobile == null) return null;
    if (desktop != null && mobile != null && desktop === mobile) return formatter(desktop);
    return [desktop == null ? null : `${formatter(desktop)} desktop`, mobile == null ? null : `${formatter(mobile)} mobile`].filter(Boolean).join(" · ");
  };
  const countMetric = (id: string) => metric(id, (value) => formatNumber(Math.round(value)));
  const byteMetric = (id: string) => metric(id, (value) => formatAuditTechnicalBytes(value) || `${value} B`);
  const records = (id: string) => {
    const rows = evidence(id)?.records;
    return Array.isArray(rows) ? rows : [];
  };
  const recordValues = (id: string) => [...new Set(records(id).map((record: any) => compactText(record?.value)).filter(Boolean))];

  const http = evidence(IDS.httpStatus);
  add("delivery", "http-status", "HTTP status", asNumber(http?.status) == null ? null : String(http!.status), undefined, resultTone(IDS.httpStatus));
  add("delivery", "final-url", "Final URL", compactText(http?.finalUrl, 260));
  const redirectTrace = evidence(IDS.redirects)?.redirects;
  if (Array.isArray(redirectTrace)) add("delivery", "redirects", "Redirect count", formatNumber(redirectTrace.length), undefined, redirectTrace.length === 0 ? "positive" : "issue");
  add("delivery", "response-time", "Document response time", metric(IDS.responseTime, (value) => `${Math.round(value)} ms`));
  add("delivery", "transfer-size", "Transferred page size", byteMetric(IDS.transferSize));
  add("delivery", "requests", "Resource requests", countMetric(IDS.requests));
  add("delivery", "third-party", "Third-party requests", countMetric(IDS.thirdParty));
  const compression = evidence(IDS.compression);
  const compressionChecked = asNumber(compression?.checked);
  const compressionMisses = asNumber(compression?.totalDiscovered) ?? (Array.isArray(compression?.occurrences) ? compression.occurrences.length : null);
  if (compressionChecked != null && compressionMisses != null) {
    const compressed = Math.max(0, compressionChecked - compressionMisses);
    add("delivery", "compression", "Text compression", `${formatNumber(compressed)} of ${formatNumber(compressionChecked)} checked resources`, compressionMisses ? `${formatNumber(compressionMisses)} resource${compressionMisses === 1 ? "" : "s"} lacked a recognised compression encoding.` : "All checked text resources used a recognised compression encoding.", compressionMisses === 0 ? "positive" : "issue");
  }
  const cache = evidence(IDS.staticCache);
  const cacheChecked = asNumber(cache?.checked);
  const cacheMisses = asNumber(cache?.totalDiscovered) ?? (Array.isArray(cache?.occurrences) ? cache.occurrences.length : null);
  if (cacheChecked != null && cacheMisses != null) {
    const configured = Math.max(0, cacheChecked - cacheMisses);
    add("delivery", "static-cache", "Static resource caching", `${formatNumber(configured)} of ${formatNumber(cacheChecked)} checked resources`, cacheMisses ? `${formatNumber(cacheMisses)} resource${cacheMisses === 1 ? "" : "s"} had no max-age, s-maxage, immutable or Expires evidence.` : "Caching directives were detected for every checked static resource.", cacheMisses === 0 ? "positive" : "issue");
  }
  const cacheHeaders = evidence(IDS.cacheIndicators)?.headers;
  if (cacheHeaders && typeof cacheHeaders === "object") {
    const values = Object.entries(cacheHeaders).flatMap(([name, entries]) => Array.isArray(entries) ? entries.map((entry) => `${name}: ${entry}`) : []);
    add("delivery", "cache-indicators", "Cache indicators", compactText(values.join(" · ")));
  }
  const cacheControl = evidence(IDS.cacheControl)?.values;
  if (Array.isArray(cacheControl) && cacheControl.length) add("delivery", "cache-control", "Response cache control", compactText(cacheControl.join(" · ")));
  const cdnHeaders = evidence(IDS.cdn)?.headers;
  if (cdnHeaders && typeof cdnHeaders === "object" && Object.keys(cdnHeaders).length) {
    const providers = ["cf-ray" in cdnHeaders ? "Cloudflare indicator" : null, "x-vercel-id" in cdnHeaders ? "Vercel indicator" : null].filter(Boolean);
    add("delivery", "cdn", "CDN / reverse proxy", providers.length ? providers.join(" · ") : `Indicators detected (${Object.keys(cdnHeaders).join(", ")})`);
  }

  const canonical = evidence(IDS.canonical)?.canonical;
  if (Array.isArray(canonical) && canonical.length) add("content", "canonical", "Canonical URL", compactText(canonical[0], 260));
  const noindex = usable(IDS.noindex);
  if (noindex) add("content", "indexable", "Selected page indexable", noindex.outcome === "passed" ? "Yes" : "No", undefined, resultTone(IDS.noindex));
  const robots = usable(IDS.robotsReachable);
  if (robots) add("content", "robots-reachable", "Robots.txt reachable", robots.outcome === "passed" ? "Yes" : "No", undefined, resultTone(IDS.robotsReachable));
  const robotsAllowed = usable(IDS.robotsAllowed);
  if (robotsAllowed) add("content", "robots-allowed", "Selected page allowed by robots", robotsAllowed.outcome === "passed" ? "Yes" : "No", "Googlebot rules for the selected audited page.", resultTone(IDS.robotsAllowed));
  const sitemap = usable(IDS.sitemapReachable);
  if (sitemap) add("content", "sitemap-reachable", "Sitemap available", sitemap.outcome === "passed" ? "Yes" : "No", undefined, resultTone(IDS.sitemapReachable));
  const sitemapPage = evidence(IDS.sitemapPage);
  const sitemapUrls = asNumber(sitemapPage?.urlsChecked);
  if (sitemapUrls != null) add("content", "sitemap-urls", "URLs discovered from sitemap", formatNumber(sitemapUrls));
  const sitemapPageResult = usable(IDS.sitemapPage);
  if (sitemapPageResult) add("content", "sitemap-page", "Audited page present in sitemap", sitemapPageResult.outcome === "passed" ? "Yes" : "No", undefined, resultTone(IDS.sitemapPage));
  add("content", "language", "HTML language", compactText(evidence(IDS.language)?.language));
  const types = evidence(IDS.structuredTypes)?.types;
  if (Array.isArray(types) && types.length) add("content", "structured-data", "Structured data types", [...new Set(types.map((value) => compactText(value)).filter(Boolean))].join(", "));
  const internalCount = asNumber(evidence(IDS.internalLinks)?.count);
  if (internalCount != null) add("content", "internal-links", "Internal links", formatNumber(internalCount));
  const externalCount = asNumber(evidence(IDS.externalLinks)?.count);
  if (externalCount != null) add("content", "external-links", "External links", formatNumber(externalCount));
  const checkedLinks = asNumber(evidence(IDS.linkTotals)?.checked);
  if (checkedLinks != null) add("content", "checked-links", "Checked links", formatNumber(checkedLinks));
  if (checkedLinks != null) {
    const brokenUrls = new Set<string>();
    let unlocatedFailures = 0;
    for (const id of BROKEN_LINK_IDS) {
      const row = usable(id);
      if (!row || row.outcome === "passed" || row.outcome === "not_applicable") continue;
      const occurrences = Array.isArray(row.evidence?.occurrences) ? row.evidence!.occurrences : [];
      for (const occurrence of occurrences) occurrence?.url ? brokenUrls.add(String(occurrence.url)) : unlocatedFailures += 1;
    }
    const broken = brokenUrls.size + unlocatedFailures;
    add("content", "broken-links", "Broken checked links", `${formatNumber(broken)} of ${formatNumber(checkedLinks)} checked`, undefined, broken === 0 ? "positive" : "issue");
  }

  const formats = evidence(IDS.imageFormats)?.formats;
  if (Array.isArray(formats)) {
    add("assets", "image-count", "Images", formatNumber(formats.length));
    if (formats.length) {
      const counts = new Map<string, number>();
      for (const image of formats) {
        const format = compactText(image?.format || "unknown", 24).toLowerCase();
        counts.set(format, (counts.get(format) || 0) + 1);
      }
      const ranked = [...counts].sort((left, right) => right[1] - left[1]);
      add("assets", "image-formats", "Image formats", ranked.slice(0, 6).map(([format, count]) => `${formatImageFormat(format)} ${formatNumber(count)}`).join(" · "));
      const modern = ranked.filter(([format]) => ["webp", "avif", "svg"].includes(format)).reduce((total, [, count]) => total + count, 0);
      add("assets", "modern-images", "Modern image formats", `${formatNumber(modern)} of ${formatNumber(formats.length)} · ${Math.round(modern / formats.length * 100)}%`, undefined, modern === formats.length ? "positive" : "neutral");
    }
  }
  const lazy = evidence(IDS.lazyImages);
  const missingLazy = asNumber(lazy?.totalDiscovered) ?? (Array.isArray(lazy?.occurrences) ? lazy.occurrences.length : null);
  if (missingLazy != null) add("assets", "lazy-images", "Missing lazy loading", formatNumber(missingLazy), "Below-fold image observations across desktop and mobile. Eligible-image totals are not retained by the current check.", missingLazy === 0 ? "positive" : "issue");
  add("assets", "image-bytes", "Image transfer size", byteMetric(IDS.imageBytes));
  add("assets", "script-bytes", "JavaScript transfer size", byteMetric(IDS.scriptBytes));
  add("assets", "css-bytes", "CSS transfer size", byteMetric(IDS.cssBytes));
  add("assets", "font-bytes", "Font transfer size", byteMetric(IDS.fontBytes));
  add("assets", "render-blocking", "Render-blocking resources", countMetric(IDS.renderBlocking), undefined, resultTone(IDS.renderBlocking));
  add("assets", "preloads", "Resource preloads", countMetric(IDS.preloads));
  add("assets", "unused-preloads", "Unused preloads", countMetric(IDS.unusedPreloads), undefined, resultTone(IDS.unusedPreloads));

  const nameservers = recordValues(IDS.nameservers).map((value) => value.replace(/\.$/, ""));
  if (nameservers.length) add("infrastructure", "nameservers", "Nameservers", nameservers.join(" · "));
  const ipv4 = recordValues(IDS.ipv4);
  if (ipv4.length) add("infrastructure", "ipv4", "IPv4 addresses", ipv4.join(" · "));
  const ipv6 = recordValues(IDS.ipv6);
  if (ipv6.length) add("infrastructure", "ipv6", "IPv6 addresses", ipv6.join(" · "));
  const cname = recordValues(IDS.cname).map((value) => value.replace(/\.$/, ""));
  if (cname.length) add("infrastructure", "cname", "CNAME", cname.join(" · "));
  const dnssecQueries = evidence(IDS.dnssec)?.queries;
  if (Array.isArray(dnssecQueries)) {
    const reported = dnssecQueries.filter((query) => typeof query?.authenticatedData === "boolean");
    const authenticated = reported.filter((query) => query.authenticatedData).length;
    if (reported.length) add("infrastructure", "dnssec", "DNSSEC resolver status", authenticated === reported.length ? "Validated" : authenticated === 0 ? "Not validated by resolver" : `${authenticated} of ${reported.length} responses validated`, "Based on the resolver authenticated-data flag.", authenticated === reported.length ? "positive" : "issue");
  }
  const ttlRows = records(IDS.dnsTtls).map((record: any) => asNumber(record?.ttl)).filter((value): value is number => value != null);
  if (ttlRows.length) {
    const minimum = Math.min(...ttlRows), maximum = Math.max(...ttlRows);
    add("infrastructure", "dns-ttl", "DNS TTL range", minimum === maximum ? `${formatNumber(minimum)} seconds` : `${formatNumber(minimum)}–${formatNumber(maximum)} seconds`);
  }
  const apexWww = evidence(IDS.apexWww);
  if (apexWww && typeof apexWww.converged === "boolean") add("infrastructure", "apex-www", "Apex / www redirects", apexWww.converged ? "Same final destination" : "Different final destinations", undefined, apexWww.converged ? "positive" : "issue");
  const mail = recordValues(IDS.mail).map((value) => value.replace(/\.$/, ""));
  if (mail.length) add("infrastructure", "mail", "Mail exchange records", mail.join(" · "));
  for (const [id, key, label] of [[IDS.spf, "spf", "SPF"], [IDS.dmarc, "dmarc", "DMARC"], [IDS.caa, "caa", "CAA"]] as const) {
    const row = usable(id);
    if (!row) continue;
    const present = recordValues(id).length > 0;
    add("infrastructure", key, label, present ? "Present" : "Not present", undefined, present ? "positive" : "issue");
  }

  const https = usable(IDS.https);
  if (https) add("security", "https", "HTTPS enabled", https.outcome === "passed" ? "Yes" : "No", undefined, resultTone(IDS.https));
  const tls = usable(IDS.tls);
  if (tls) add("security", "tls", "HTTPS / TLS connection", tls.outcome === "passed" ? "Succeeded" : "Failed", undefined, resultTone(IDS.tls));
  for (const [id, key, label] of [
    [IDS.hsts, "hsts", "HSTS"],
    [IDS.csp, "csp", "Content Security Policy"],
    [IDS.framing, "framing", "Frame / clickjacking protection"],
    [IDS.contentTypeOptions, "content-type-options", "X-Content-Type-Options"],
    [IDS.referrerPolicy, "referrer-policy", "Referrer Policy"],
    [IDS.permissionsPolicy, "permissions-policy", "Permissions Policy"],
  ] as const) {
    const row = usable(id);
    if (!row) continue;
    const present = row.outcome === "passed";
    add("security", key, label, present ? "Present" : "Not present", undefined, present ? "positive" : "issue");
  }
  const mixed = usable(IDS.mixedContent);
  if (mixed) {
    const occurrences = asNumber(mixed.evidence?.totalDiscovered) ?? (Array.isArray(mixed.evidence?.occurrences) ? mixed.evidence!.occurrences.length : 0);
    add("security", "mixed-content", "Mixed content", mixed.outcome === "passed" ? "Clear" : `${formatNumber(occurrences || 1)} observation${occurrences === 1 ? "" : "s"} detected`, undefined, mixed.outcome === "passed" ? "positive" : "issue");
  }
  const cookieRows = [usable(IDS.cookieSecure), usable(IDS.cookieHttpOnly), usable(IDS.cookieSameSite)];
  const observedCookies = cookieRows.map((row) => asNumber(row?.evidence?.cookies)).find((value) => value != null && value > 0);
  if (observedCookies) {
    const attribute = (row: AuditTechnicalResult | null, name: string) => {
      const missing = asNumber(row?.evidence?.missing) || 0;
      return `${name} ${formatNumber(Math.max(0, observedCookies - missing))}/${formatNumber(observedCookies)}`;
    };
    const cookieIssue = cookieRows.some((row) => row?.outcome === "failed" || row?.outcome === "advisory");
    add("security", "cookies", "Observed cookie attributes", [attribute(cookieRows[0], "Secure"), attribute(cookieRows[1], "HttpOnly"), attribute(cookieRows[2], "SameSite")].join(" · "), undefined, cookieIssue ? "issue" : "positive");
  }

  return sections;
}
