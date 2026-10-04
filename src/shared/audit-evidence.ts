import { parse, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { XMLParser } from "fast-xml-parser";
import postcss from "postcss";

export type AuditOutcome =
  | "passed"
  | "failed"
  | "advisory"
  | "not_applicable"
  | "unable_to_test";

export type EvidenceSource =
  | "html"
  | "rendered"
  | "network"
  | "http"
  | "dns"
  | "robots"
  | "sitemap"
  | "css"
  | "accessibility";

export type AuditOccurrence = {
  locator?: string;
  html?: string;
  url?: string;
  resourceType?: string;
  source: EvidenceSource;
  viewport?: "mobile" | "desktop";
  values?: Record<string, unknown>;
};

export type CollectionState =
  | { status: "complete" }
  | { status: "failed" | "partial"; reason: string };

export type HeaderValue = { name: string; values: string[] };

export type HttpEvidence = {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  redirectTrace: Array<{ url: string; status: number; location: string | null }>;
  responseMs: number | null;
  headers: HeaderValue[];
  contentType: string | null;
  encodedBytes: number | null;
  decodedBytes: number | null;
  collection: CollectionState;
};

export type ParsedElement = {
  tagName: string;
  attributes: Array<{ name: string; value: string }>;
  locator: string;
  html: string;
  text: string;
  sourceOffset: number | null;
};

export type StructuredDataEntity = {
  block: number;
  pointer: string;
  value: Record<string, unknown>;
  id: string | null;
  types: string[];
};

export type StructuredDataBlock = {
  index: number;
  locator: string;
  raw: string;
  parsed: unknown | null;
  error: string | null;
  entities: StructuredDataEntity[];
};

export type LinkDeclaration = {
  originalUrl: string;
  resolvedUrl: string | null;
  sourceElement: string;
  locator: string;
  internal: boolean | null;
  source: "html" | "rendered";
  accessibleName: string;
};

export type ResourceDeclaration = {
  declaredUrl: string;
  resolvedUrl: string | null;
  declarationType: string;
  locator: string;
  source: "html" | "rendered";
};

export type SourceDomEvidence = {
  collection: CollectionState;
  documentUrl: string;
  elements: ParsedElement[];
  links: LinkDeclaration[];
  resources: ResourceDeclaration[];
  structuredData: StructuredDataBlock[];
  duplicateIds: string[];
  text: string;
};

export type DestinationState =
  | "success"
  | "redirect"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "gone"
  | "rate_limited"
  | "server_error"
  | "dns_failure"
  | "tls_failure"
  | "timeout"
  | "redirect_loop"
  | "redirect_limit_exceeded"
  | "bot_challenge"
  | "unable_to_test";

export type DestinationEvidence = {
  requestedUrl: string;
  finalUrl: string | null;
  state: DestinationState;
  status: number | null;
  redirectTrace: Array<{ url: string; status: number; location: string | null }>;
  contentType: string | null;
  headers: HeaderValue[];
  body: string | null;
  bodyTruncated: boolean;
  error: string | null;
};

export type ResourceEvidence = DestinationEvidence & {
  declarations: ResourceDeclaration[];
};

export type DnsEvidence = {
  queriedHostname: string;
  recordType: string;
  responseCode: number | null;
  authenticatedData: boolean | null;
  records: Array<{ value: string; ttl: number }>;
  error: string | null;
};

export type FontFaceEvidence = {
  stylesheetUrl: string;
  fontFamily: string | null;
  fontSources: string[];
  fontDisplay: string | null;
  rule: string;
};

export type SitemapEvidence = {
  sourceUrl: string | null;
  destinationState: DestinationState | null;
  status: number | null;
  urls: Array<{ loc: string; lastmod: string | null }>;
  error: string | null;
};

type DocumentNode = DefaultTreeAdapterMap["document"];
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

function escapePointer(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function structuredEntities(value: unknown, block: number, pointer = ""): StructuredDataEntity[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => structuredEntities(item, block, `${pointer}/${index}`));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const current = object["@type"] || object["@id"]
    ? [{
        block,
        pointer: pointer || "",
        value: object,
        id: typeof object["@id"] === "string" ? object["@id"] : null,
        types: Array.isArray(object["@type"])
          ? object["@type"].filter((item): item is string => typeof item === "string")
          : typeof object["@type"] === "string" ? [object["@type"]] : [],
      }]
    : [];
  return [
    ...current,
    ...Object.entries(object).flatMap(([key, nested]) =>
      structuredEntities(nested, block, `${pointer}/${escapePointer(key)}`)),
  ];
}

function nodeText(node: Node): string {
  if ("value" in node && node.nodeName === "#text") return String(node.value || "");
  return "childNodes" in node ? node.childNodes.map(nodeText).join("") : "";
}

function isElement(node: Node): node is Element {
  return "tagName" in node && typeof node.tagName === "string";
}

function attribute(element: Element, name: string) {
  return element.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function elementLocator(element: Element, parents: Element[]) {
  const id = attribute(element, "id");
  if (id) return `#${id.replace(/([^a-zA-Z0-9_-])/g, "\\$1")}`;
  const segments = [...parents, element].slice(-6).map((item) => {
    const parent = item.parentNode;
    const siblings = parent && "childNodes" in parent
      ? parent.childNodes.filter((child): child is Element => isElement(child) && child.tagName === item.tagName)
      : [];
    const index = siblings.indexOf(item);
    return `${item.tagName}${siblings.length > 1 ? `:nth-of-type(${index + 1})` : ""}`;
  });
  return segments.join(" > ");
}

function safeResolvedUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function resourceKind(element: Element) {
  const tag = element.tagName;
  const rel = (attribute(element, "rel") || "").toLowerCase().split(/\s+/);
  if (tag === "track") return "caption";
  if (tag === "link" && rel.includes("manifest")) return "manifest";
  if (tag === "link" && rel.includes("apple-touch-icon")) return "apple-touch-icon";
  if (tag === "link" && (rel.includes("icon") || rel.includes("shortcut"))) return "favicon";
  if (tag === "link" && (attribute(element, "type") || "").toLowerCase() === "text/markdown") return "markdown-alternative";
  if (tag === "meta" && ["og:image", "twitter:image"].includes((attribute(element, "property") || attribute(element, "name") || "").toLowerCase())) return "social-image";
  if (["img", "source", "script", "iframe", "video", "audio"].includes(tag)) return tag;
  if (tag === "link" && rel.includes("stylesheet")) return "stylesheet";
  return null;
}

export function parseSourceDom(html: string, documentUrl: string): SourceDomEvidence {
  try {
    const document = parse(html, { sourceCodeLocationInfo: true }) as DocumentNode;
    const elements: ParsedElement[] = [];
    const links: LinkDeclaration[] = [];
    const resources: ResourceDeclaration[] = [];
    const structuredData: StructuredDataBlock[] = [];
    const ids: string[] = [];
    const baseHost = new URL(documentUrl).hostname;
    const visit = (node: Node, parents: Element[]) => {
      if (!isElement(node)) {
        if ("childNodes" in node) node.childNodes.forEach((child) => visit(child, parents));
        return;
      }
      const locator = elementLocator(node, parents);
      const htmlValue = serializeOuter(node);
      const text = nodeText(node).replace(/\s+/g, " ").trim();
      const parsed: ParsedElement = {
        tagName: node.tagName,
        attributes: node.attrs.map(({ name, value }) => ({ name, value })),
        locator,
        html: htmlValue,
        text,
        sourceOffset: node.sourceCodeLocation?.startOffset ?? null,
      };
      elements.push(parsed);
      const id = attribute(node, "id");
      if (id) ids.push(id);
      if (node.tagName === "a" || node.tagName === "area") {
        const originalUrl = attribute(node, "href") || "";
        const resolvedUrl = safeResolvedUrl(originalUrl, documentUrl);
        links.push({
          originalUrl,
          resolvedUrl,
          sourceElement: node.tagName,
          locator,
          internal: resolvedUrl ? new URL(resolvedUrl).hostname === baseHost : null,
          source: "html",
          accessibleName: (attribute(node, "aria-label") || text || attribute(node, "title") || "").trim(),
        });
      }
      const kind = resourceKind(node);
      if (kind) {
        const declaredUrl = attribute(node, node.tagName === "link" ? "href" : node.tagName === "meta" ? "content" : "src") || "";
        if (declaredUrl) resources.push({ declaredUrl, resolvedUrl: safeResolvedUrl(declaredUrl, documentUrl), declarationType: kind, locator, source: "html" });
      }
      if (node.tagName === "script" && (attribute(node, "type") || "").toLowerCase() === "application/ld+json") {
        const raw = nodeText(node).trim();
        const index = structuredData.length;
        try {
          const parsedJson = JSON.parse(raw);
          structuredData.push({ index, locator, raw, parsed: parsedJson, error: null, entities: structuredEntities(parsedJson, index) });
        } catch (error) {
          structuredData.push({ index, locator, raw, parsed: null, error: error instanceof Error ? error.message : String(error), entities: [] });
        }
      }
      node.childNodes.forEach((child) => visit(child, [...parents, node]));
    };
    document.childNodes.forEach((node) => visit(node, []));
    return {
      collection: { status: "complete" },
      documentUrl,
      elements,
      links,
      resources,
      structuredData,
      duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
      text: nodeText(document).replace(/\s+/g, " ").trim(),
    };
  } catch (error) {
    return {
      collection: { status: "failed", reason: error instanceof Error ? error.message : String(error) },
      documentUrl,
      elements: [], links: [], resources: [], structuredData: [], duplicateIds: [], text: "",
    };
  }
}

export function headerMultimap(headers: Headers): HeaderValue[] {
  const values = new Map<string, string[]>();
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    values.set(key, [...(values.get(key) || []), value]);
  });
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) values.set("set-cookie", getSetCookie);
  return [...values.entries()].map(([name, entries]) => ({ name, values: entries }));
}

export function headerValues(headers: HeaderValue[], name: string) {
  return headers.find((header) => header.name === name.toLowerCase())?.values || [];
}

export function classifyDestination(status: number | null, error: string | null, redirects = 0): DestinationState {
  const reason = (error || "").toLowerCase();
  if (reason.includes("redirect_loop")) return "redirect_loop";
  if (reason.includes("redirect_limit")) return "redirect_limit_exceeded";
  if (reason.includes("timeout") || reason.includes("timed out") || reason.includes("aborted")) return "timeout";
  if (reason.includes("certificate") || reason.includes("tls") || reason.includes("ssl")) return "tls_failure";
  if (reason.includes("dns") || reason.includes("enotfound") || reason.includes("name not resolved")) return "dns_failure";
  if (error) return "unable_to_test";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 410) return "gone";
  if (status === 429) return "rate_limited";
  if (status != null && status >= 500) return "server_error";
  if (status != null && status >= 200 && status < 400) return redirects ? "redirect" : "success";
  return "unable_to_test";
}

export function parseSitemapXml(xml: string, sourceUrl: string | null = null): SitemapEvidence {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, isArray: (name) => name === "url" || name === "sitemap" });
    const parsed = parser.parse(xml);
    const nodes = parsed?.urlset?.url || parsed?.sitemapindex?.sitemap || [];
    return {
      sourceUrl,
      destinationState: null,
      status: null,
      urls: nodes.filter((node: unknown) => node && typeof node === "object").map((node: any) => ({ loc: String(node.loc || ""), lastmod: node.lastmod == null ? null : String(node.lastmod) })).filter((node: { loc: string }) => node.loc),
      error: null,
    };
  } catch (error) {
    return { sourceUrl, destinationState: null, status: null, urls: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseFontFaces(css: string, stylesheetUrl: string): FontFaceEvidence[] {
  try {
    const root = postcss.parse(css, { from: stylesheetUrl });
    const rows: FontFaceEvidence[] = [];
    root.walkAtRules("font-face", (rule) => {
      const declarations = new Map<string, string>();
      rule.walkDecls((decl) => { declarations.set(decl.prop.toLowerCase(), decl.value); });
      rows.push({
        stylesheetUrl,
        fontFamily: declarations.get("font-family") || null,
        fontSources: [...(declarations.get("src") || "").matchAll(/url\((?:["']?)(.*?)(?:["']?)\)/g)].map((match) => match[1]),
        fontDisplay: declarations.get("font-display") || null,
        rule: rule.toString(),
      });
    });
    return rows;
  } catch {
    return [];
  }
}

export function occurrenceEnvelope(occurrences: AuditOccurrence[], total = occurrences.length, ceiling = 500) {
  const retained = occurrences.slice(0, ceiling);
  return { occurrences: retained, totalDiscovered: total, retained: retained.length, truncated: total > retained.length };
}
