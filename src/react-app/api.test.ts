import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorMessage, apiRequest } from "./api";

const session = {
  access_token: "test-token",
  user: { id: "test-user" },
} as any;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("apiErrorMessage", () => {
  it("uses a validated API error string", () => {
    expect(apiErrorMessage({ error: "property_access_denied" })).toBe(
      "property_access_denied",
    );
  });

  it("falls back for malformed or empty response bodies", () => {
    expect(apiErrorMessage({ error: { code: "bad" } }, "Request failed (503)")).toBe(
      "Request failed (503)",
    );
    expect(apiErrorMessage(undefined, "Request failed (502)")).toBe(
      "Request failed (502)",
    );
  });

  it("deduplicates and briefly caches identical analytics reads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ pageviews: 12 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const path = "/api/properties/property-1/analytics?days=dedupe-test";
    const [first, second] = await Promise.all([
      apiRequest<any>(session, path),
      apiRequest<any>(session, path),
    ]);
    const cached = await apiRequest<any>(session, path);
    expect(first.pageviews).toBe(12);
    expect(second.pageviews).toBe(12);
    expect(cached.pageviews).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient read failures before surfacing an error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const pending = apiRequest<any>(
      session,
      "/api/properties/property-1/analytics?days=retry-test",
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
