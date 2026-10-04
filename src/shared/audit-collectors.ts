import robotsParser from "robots-parser";
import {
  classifyDestination,
  headerMultimap,
  type DestinationEvidence,
  type LinkDeclaration,
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function boundedBody(response: Response, maxBytes: number) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = Number(response.headers.get("content-length") || 0) > maxBytes;
  try {
    while (retained < maxBytes) {
      const { done, value } = await reader.read();
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
      const next = await reader.read();
      if (!next.done) truncated = true;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
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
  options: { includeBody?: boolean; probeChallenge?: boolean; bodyBytes?: number; validatedHosts?: Set<string> } = {},
): Promise<DestinationEvidence> {
  try {
    const trace = await fetchTrace(url, {
      headers: { "user-agent": "Claritude-Audit/2.0 (+https://claritude.io)" },
      signal: AbortSignal.timeout(8_000),
    }, options.validatedHosts);
    const captured = options.includeBody || options.probeChallenge
      ? await boundedBody(trace.response, options.bodyBytes || DEFAULT_COLLECTOR_LIMITS.bodyBytes)
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
    const reason = errorMessage(error);
    return {
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
    };
  }
}

export async function collectLinkInventory(
  links: LinkDeclaration[],
  fetchTrace: BoundedFetchTrace,
  limits: CollectorLimits = DEFAULT_COLLECTOR_LIMITS,
  validatedHosts = new Set<string>(),
  onBatch?: () => Promise<void>,
): Promise<InventoryCollection<DestinationEvidence, LinkDeclaration>> {
  const candidates = [...new Set(links.map((link) => link.resolvedUrl).filter((url): url is string => Boolean(url)))];
  const selected = candidates.slice(0, limits.links);
  const results: DestinationEvidence[] = [];
  for (let index = 0; index < selected.length; index += 5) {
    results.push(...await Promise.all(selected.slice(index, index + 5).map((url) => inspectDestination(url, fetchTrace, { probeChallenge: true, bodyBytes: 16_384, validatedHosts }))));
    await onBatch?.();
  }
  return {
    declarations: links,
    results,
    totalDiscovered: candidates.length,
    retained: results.length,
    truncated: candidates.length > results.length,
    requests: results.length + results.reduce((total, result) => total + result.redirectTrace.length, 0),
  };
}

const bodyResourceKinds = new Set(["manifest", "markdown-alternative", "caption", "stylesheet"]);

export async function collectResourceInventory(
  declarations: ResourceDeclaration[],
  fetchTrace: BoundedFetchTrace,
  limits: CollectorLimits = DEFAULT_COLLECTOR_LIMITS,
  validatedHosts = new Set<string>(),
  onBatch?: () => Promise<void>,
): Promise<InventoryCollection<ResourceEvidence, ResourceDeclaration>> {
  const grouped = new Map<string, ResourceDeclaration[]>();
  for (const declaration of declarations) {
    if (!declaration.resolvedUrl) continue;
    grouped.set(declaration.resolvedUrl, [...(grouped.get(declaration.resolvedUrl) || []), declaration]);
  }
  const entries = [...grouped.entries()];
  const selected = entries.slice(0, limits.resources);
  const results: ResourceEvidence[] = [];
  for (let index = 0; index < selected.length; index += 5) {
    results.push(...await Promise.all(selected.slice(index, index + 5).map(async ([url, declarations]) => ({
      ...await inspectDestination(url, fetchTrace, { includeBody: declarations.some((item) => bodyResourceKinds.has(item.declarationType)), bodyBytes: limits.bodyBytes, validatedHosts }),
      declarations,
    }))));
    await onBatch?.();
  }
  return {
    declarations,
    results,
    totalDiscovered: entries.length,
    retained: results.length,
    truncated: entries.length > results.length,
    requests: results.length + results.reduce((total, result) => total + result.redirectTrace.length, 0),
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
