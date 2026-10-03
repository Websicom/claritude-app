import { describe, expect, it } from "vitest";
import {
  estimateIncidentDowntime,
  medianMilliseconds,
  summarizeUptimeChecks,
} from "./uptime";

describe("uptime evidence calculations", () => {
  it("uses the statistical median for odd and even sample counts", () => {
    expect(medianMilliseconds([90, 50, 70])).toBe(70);
    expect(medianMilliseconds([20, 80, 40, 60])).toBe(50);
  });

  it("does not turn failures, timeouts or maintenance into response-time zeroes", () => {
    expect(summarizeUptimeChecks([
      { success: true, response_ms: 120 },
      { success: false, response_ms: null },
      { success: false, response_ms: 0 },
      { success: true, response_ms: 260 },
      { success: false, response_ms: null, suppressed_by_maintenance: true },
    ])).toEqual({
      total: 4,
      successful: 2,
      suppressed: 1,
      availability: 50,
      averageResponseMs: 190,
      medianResponseMs: 190,
      highestResponseMs: 260,
    });
  });

  it("clips incidents to the selected range and merges overlapping downtime", () => {
    expect(estimateIncidentDowntime([
      { opened_at: "2026-09-30T23:55:00Z", resolved_at: "2026-10-01T00:10:00Z" },
      { opened_at: "2026-10-01T00:05:00Z", resolved_at: "2026-10-01T00:15:00Z" },
      { opened_at: "2026-10-01T00:50:00Z" },
    ], "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", "2026-10-01T00:55:00Z")).toEqual({
      milliseconds: 20 * 60_000,
      intervals: 2,
      resolved: 2,
      ongoing: 1,
    });
  });
});
