import type { Session } from "@supabase/supabase-js";

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
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(
      apiErrorMessage(payload, response.statusText || `Request failed (${response.status})`),
    );
  return payload as T;
}
