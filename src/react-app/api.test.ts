import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api";

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
});
