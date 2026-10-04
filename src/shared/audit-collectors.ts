import robotsParser from "robots-parser";
import {
  classifyDestination,
  headerMultimap,
  parseLlmsText,
  type DestinationEvidence,
  type LinkDeclaration,
  type LlmsTextParseEvidence,
  type ResourceDeclaration,
  type ResourceEvidence,
  type SourceDomEvidence,
} from "./audit-evidence";

export type FetchTraceResult = {
  response: Response;
  redirects: Array<{ url: string; status: number; location: string }>;
};

export type BoundedFetchTrace = (
  url: string,
  init?: RequestInit,
  validatedHosts?: Set<string>,
) => Promise<FetchTraceResult>;

export type CollectorLimits = {
  links: number;
  resources: number;
  redirects: number;
  bodyBytes: number;
};

export const DEFAULT_COLLECTOR_LIMITS: CollectorLimits = {
  links: 50,
  resources: 40,
  redirects: 5,
  bodyBytes: 512_000,
};

export type InventoryCollection<T, Declaration> = {
  declarations: Declaration[];
  results: T[];
  totalDiscovered: number;
  retained: number;
  truncated: boolean;
  requests: number;
};

export type OptionalAiResourceEvidence = {
  kind: "llms.txt" | "llms-full.txt";
  sourceUrl: string;
  destination: DestinationEvidence;
  presence: "present" | "missing" | "unavailable";
  readable: boolean | null;
  readabilityReason: string | null;
  parse: LlmsTextParseEvidence | null;
  links: InventoryCollection<DestinationEvidence, LinkDeclaration> | null;
};

export type PrecollectedResource = {
  status: number;
  headers: Record<string, string>;
  resourceType: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function boundedBody(response: Response, maxBytes: number, timeoutMs = 8_000) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const deadline = Date.now() + timeoutMs;
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = Number(response.headers.get("content-length") || 0) > maxBytes;
  let failed = false;
  const read = async () => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Response body timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Response body timed out")), remainingMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    while (retained < maxBytes) {
      const { done, value } = await read();
      if (done) break;
      const available = Math.min(value.byteLength, maxBytes - retained);
      if (available) chunks.push(value.slice(0, available));
      retained += available;
      if (available < value.byteLength) {
        truncated = true;
        break;
      }
    }
    if (retained === maxBytes) {
      const next = await read();
      if (!next.done) truncated = true;
    }
  } catch (error) {
    failed = true;
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (truncated && !failed) void reader.cancel().catch(() => undefined);
    else if (!failed) reader.releaseLock();
  }
  const joined = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(joined), truncated };
}

export async function inspectDestination(
  url: string,
  fetchTrace: BoundedFetchTrace,
  options: { includeBody?: boolean; probeChallenge?: boolean; bodyBytes?: number; bodyTimeoutMs?: number; totalTimeoutMs?: number; validatedHosts?: Set<string> } = {},
): Promise<DestinationEvidence> {
  const unavailable = (reason: string): DestinationEvidence => ({
    requestedUrl: url,
    finalUrl: null,
    state: classifyDestination(null, reason),
    status: null,
    redirectTrace: [],
    contentType: null,
    headers: [],
    body: null,
    bodyTruncated: false,
    error: reason,
  });
  const operation = (async (): Promise<DestinationEvidence> => {
    try {
      const trace = await fetchTrace(url, {
        headers: { "user-agent": "Claritude-Audit/2.0 (+https://claritude.io)" },
        signal: AbortSignal.timeout(8_000),
      }, options.validatedHosts);
      if (!options.includeBody && !options.probeChallenge)
        await trace.response.body?.cancel().catch(() => undefined);
      const captured = options.includeBody || options.probeChallenge
        ? await boundedBody(trace.response, options.bodyBytes || DEFAULT_COLLECTOR_LIMITS.bodyBytes, options.bodyTimeoutMs)
        : { text: "", truncated: false };
      const body = options.includeBody ? captured.text : null;
      const text = captured.text;
      const challenge = /captcha|cf-chl-|challenge-platform|verify you are human/i.test(text);
      return {
        requestedUrl: url,
        finalUrl: trace.response.url || url,
        state: challenge ? "bot_challenge" : classifyDestination(trace.response.status, null, trace.redirects.length),
        status: trace.response.status,
        redirectTrace: trace.redirects.map((item) => ({ ...item, location: item.location || null })),
        contentType: trace.response.headers.get("content-type"),
        headers: headerMultimap(trace.response.headers),
        body,
        bodyTruncated: captured.truncated,
        error: null,
      };
    } catch (error) {
      return unavailable(errorMessage(error));
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DestinationEvidence>((resolve) => {
    timer = setTimeout(() => resolve(unavailable("Destination inspection timed out")), options.totalTimeoutMs ?? 20_000);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectLinkInventory(
  links: LinkDeclaration[],
  fetchTrace: BoundedFetchTrace,
  limits: CollectorLimits = DEFAULT_COLLECTOR_LIMITS,
  validatedHosts = new Set<string>(),
  onBatch?: () => Promise<void>,
  precollected = new Map<string, DestinationEvidence>(),
): Promise<InventoryCollection<DestinationEvidence, LinkDeclaration>> {
  const candidates = [...new Set(links.map((link) => link.resolvedUrl).filter((url): url is string => Boolean(url)))];
  const selected = candidates.slice(0, limits.links);
  const results: DestinationEvidence[] = [];
  let requests = 0;
  for (let index = 0; index < selected.length; index += 5) {
    results.push(...await Promise.all(selected.slice(index, index + 5).map(async (url) => {
      const observed = precollected.get(url);
      if (observed) return observed;
      requests += 1;
      const inspected = await inspectDestination(url, fetchTrace, { probeChallenge: true, bodyBytes: 16_384, validatedHosts });
      requests += inspected.redirectTrace.length;
      return inspected;
    })));
    await onBatch?.();
  }
  return {
    declarations: links,
    results,
    totalDiscovered: candidates.length,
    retained: results.length,
    truncated: candidates.length > results.length,
    requests,
  };
}

function readableAiText(destination: DestinationEvidence) {
  if (destination.bodyTruncated) return { readable: null, reason: "Response exceeded the bounded body limit" } as const;
  if (destination.body == null) return { readable: null, reason: destination.error || "Response body was unavailable" } as const;
  const contentType = (destination.contentType || "").split(";", 1)[0].trim().toLowerCase();
  const allowedType = !contentType || ["text/plain", "text/markdown", "text/x-markdown", "application/markdown", "application/x-markdown"].includes(contentType);
  if (!allowedType) return { readable: false, reason: `Response Content-Type ${contentType} is not readable text` } as const;
  if (!destination.body.trim()) return { readable: false, reason: "Response body was empty" } as const;
  if (/[\u0000\uFFFD]/.test(destination.body)) return { readable: false, reason: "Response body contains invalid text bytes" } as const;
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(destination.body)) return { readable: false, reason: "Response body is HTML rather than an AI text resource" } as const;
  return { readable: true, reason: null } as const;
}

export async function collectOptionalAiResource(
  kind: OptionalAiResourceEvidence["kind"],
  sourceUrl: string,
  fetchTrace: BoundedFetchTrace,
  validatedHosts = new Set<string>(),
  precollected = new Map<string, DestinationEvidence>(),
): Promise<OptionalAiResourceEvidence> {
  const destination = await inspectDestination(sourceUrl, fetchTrace, {
    includeBody: true,
    probeChallenge: true,
    bodyBytes: DEFAULT_COLLECTOR_LIMITS.bodyBytes,
    validatedHosts,
  });
  const missing = ["not_found", "gone"].includes(destination.state);
  const present = ["success", "redirect"].includes(destination.state) && destination.status != null && destination.status >= 200 && destination.status < 400;
  if (!present) {
    return {
      kind,
      sourceUrl,
      destination,
      presence: missing ? "missing" : "unavailable",
      readable: null,
      readabilityReason: missing ? "Optional resource was not found" : destination.error || `Destination state: ${destination.state}`,
      parse: null,
      links: null,
    };
  }
  const readability = readableAiText(destination);
  const parsed = kind === "llms.txt" && readability.readable === true
    ? parseLlmsText(destination.body || "", destination.finalUrl || sourceUrl)
    : null;
  const links = parsed
    ? await collectLinkInventory(parsed.links, fetchTrace, DEFAULT_COLLECTOR_LIMITS, validatedHosts, undefined, precollected)
    : null;
  return {
    kind,
    sourceUrl,
    destination,
    presence: "present",
    readable: readability.readable,
    readabilityReason: readability.reason,
    parse: parsed,
    links,
  };
}

const bodyResourceKinds = new Set(["manifest", "markdown-alternative", "caption", "stylesheet"]);

export async function collectResourceInventory(
  declarations: ResourceDeclaration[],
  fetchTrace: BoundedFetchTrace,
  limits: CollectorLimits = DEFAULT_COLLECTOR_LIMITS,
  validatedHosts = new Set<string>(),
  onBatch?: () => Promise<void>,
  precollected = new Map<string, PrecollectedResource>(),
): Promise<InventoryCollection<ResourceEvidence, ResourceDeclaration>> {
  const grouped = new Map<string, ResourceDeclaration[]>();
  for (const declaration of declarations) {
    if (!declaration.resolvedUrl) continue;
    grouped.set(declaration.resolvedUrl, [...(grouped.get(declaration.resolvedUrl) || []), declaration]);
  }
  const entries = [...grouped.entries()];
  const selected = entries.slice(0, limits.resources);
  const results: ResourceEvidence[] = [];
  let requests = 0;
  for (let index = 0; index < selected.length; index += 5) {
    results.push(...await Promise.all(selected.slice(index, index + 5).map(async ([url, declarations]) => {
      const needsBody = declarations.some((item) => bodyResourceKinds.has(item.declarationType));
      const observed = !needsBody ? precollected.get(url) : undefined;
      if (observed) {
        return {
          requestedUrl: url,
          finalUrl: url,
          state: classifyDestination(observed.status, null),
          status: observed.status,
          redirectTrace: [],
          contentType: new Headers(observed.headers).get("content-type"),
          headers: headerMultimap(new Headers(observed.headers)),
          body: null,
          bodyTruncated: false,
          error: null,
          declarations,
        } satisfies ResourceEvidence;
      }
      requests += 1;
      const inspected = await inspectDestination(url, fetchTrace, { includeBody: needsBody, bodyBytes: limits.bodyBytes, validatedHosts });
      requests += inspected.redirectTrace.length;
      return { ...inspected, declarations };
    })));
    await onBatch?.();
  }
  return {
    declarations,
    results,
    totalDiscovered: entries.length,
    retained: results.length,
    truncated: entries.length > results.length,
    requests,
  };
}

export type RobotsEvidence = {
  url: string;
  destination: DestinationEvidence;
  decisions: Record<string, { allowed: boolean; matchedBy: string | null }>;
  sitemaps: string[];
  parseError: string | null;
};

export function parseRobotsEvidence(destination: DestinationEvidence, pageUrl: string, agents: string[]): RobotsEvidence {
  const text = destination.body || "";
  try {
    const parser = robotsParser(destination.requestedUrl, text);
    return {
      url: destination.requestedUrl,
      destination,
      decisions: Object.fromEntries(agents.map((agent) => [agent, {
        allowed: parser.isAllowed(pageUrl, agent) !== false,
        matchedBy: parser.getMatchingLineNumber(pageUrl, agent) == null ? null : String(parser.getMatchingLineNumber(pageUrl, agent)),
      }])),
      sitemaps: parser.getSitemaps(),
      parseError: null,
    };
  } catch (error) {
    return { url: destination.requestedUrl, destination, decisions: {}, sitemaps: [], parseError: errorMessage(error) };
  }
}

export function mergeRenderedDeclarations(source: SourceDomEvidence, renderedLinks: LinkDeclaration[], renderedResources: ResourceDeclaration[]) {
  const linkKeys = new Set(source.links.map((link) => `${link.resolvedUrl || link.originalUrl}|${link.locator}|${link.source}`));
  const resourceKeys = new Set(source.resources.map((resource) => `${resource.resolvedUrl || resource.declaredUrl}|${resource.declarationType}|${resource.locator}|${resource.source}`));
  return {
    links: [...source.links, ...renderedLinks.filter((link) => !linkKeys.has(`${link.resolvedUrl || link.originalUrl}|${link.locator}|${link.source}`))],
    resources: [...source.resources, ...renderedResources.filter((resource) => !resourceKeys.has(`${resource.resolvedUrl || resource.declaredUrl}|${resource.declarationType}|${resource.locator}|${resource.source}`))],
  };
}
