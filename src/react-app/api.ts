import type { Session } from "@supabase/supabase-js";

const inFlightReads = new Map<string, Promise<unknown>>();
const analyticsReadCache = new Map<string, { expiresAt: number; value: unknown }>();
const RETRYABLE_READ_STATUSES = new Set([502, 503, 504]);
const ANALYTICS_CACHE_MS = 30_000;

function readKey(session: Session, path: string) {
  return `${session.user.id}:${path}`;
}

function isCacheableAnalyticsRead(path: string) {
  return /^\/api\/properties\/[^/]+\/analytics(?:\?|\/pages\?)/.test(path);
}

function retryDelay(attempt: number) {
  return 100 * 3 ** attempt;
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function apiErrorMessage(payload: unknown, fallback = "Request failed") {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.error === "string" && candidate.error.trim())
    return candidate.error;
  if (typeof candidate.message === "string" && candidate.message.trim())
    return candidate.message;
  return fallback;
}

export async function apiRequest<T>(
  session: Session,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET") return request<T>(session, path, init, false);

  const key = readKey(session, path);
  const cached = analyticsReadCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) analyticsReadCache.delete(key);

  const existing = inFlightReads.get(key);
  if (existing) return existing as Promise<T>;

  const pending = request<T>(session, path, init, true)
    .then((value) => {
      if (isCacheableAnalyticsRead(path))
        analyticsReadCache.set(key, {
          expiresAt: Date.now() + ANALYTICS_CACHE_MS,
          value,
        });
      return value;
    })
    .finally(() => inFlightReads.delete(key));
  inFlightReads.set(key, pending);
  return pending;
}

async function request<T>(
  session: Session,
  path: string,
  init: RequestInit | undefined,
  retryTransientFailure: boolean,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
        ...init?.headers,
      },
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok) return payload as T;
    if (
      retryTransientFailure &&
      attempt < 2 &&
      RETRYABLE_READ_STATUSES.has(response.status) &&
      !init?.signal?.aborted
    ) {
      await wait(retryDelay(attempt));
      continue;
    }
    throw new Error(
      apiErrorMessage(payload, response.statusText || `Request failed (${response.status})`),
    );
  }
}
