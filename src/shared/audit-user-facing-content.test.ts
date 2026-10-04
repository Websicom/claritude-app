import { describe, expect, it } from "vitest";
import { USER_FACING_AUDIT_CONTENT, USER_FACING_AUDIT_CONTENT_BY_ID } from "./audit-user-facing-content.generated";
import { USER_FACING_AUDIT_GROUPS } from "./audit-user-facing-registry.generated";
import { buildUserFacingGroupSnapshot, deriveUserFacingAuditResults, generatedGroupRows } from "./audit-user-facing";

describe("Stage 4 user-facing audit content", () => {
  it("provides complete, referenced content for every stable group", () => {
    expect(USER_FACING_AUDIT_CONTENT).toHaveLength(121);
    for (const group of USER_FACING_AUDIT_GROUPS) {
      const content = USER_FACING_AUDIT_CONTENT_BY_ID.get(group.id);
      expect(content, group.id).toBeDefined();
      expect(content?.focus.length, group.id).toBeGreaterThan(80);
      expect(content?.passedMessage, group.id).toBeTruthy();
      expect(content?.failedMessage, group.id).toBeTruthy();
      expect(content?.advisoryMessage, group.id).toBeTruthy();
      expect(content?.notApplicableMessage, group.id).toBeTruthy();
      expect(content?.unableToTestMessage, group.id).toContain("reliable conclusion");
      expect(content?.recommendation, group.id).not.toMatch(/^Review\b/i);
      expect(() => new URL(content?.referenceUrl || "")).not.toThrow();
    }
  });

  it("stores Stage 4 wording in new run snapshots", () => {
    const group = USER_FACING_AUDIT_GROUPS.find((item) => item.name === "H1 headings")!;
    const rows = generatedGroupRows([group]);
    const [snapshot] = buildUserFacingGroupSnapshot(rows.groups, rows.mappings, new Set(rows.mappings.map((row) => row.check_id)));
    expect(snapshot.focus).toContain("Claritude examines H1 headings");
    expect(snapshot.focus.split(".").filter(Boolean)).toHaveLength(2);
    expect(snapshot.recommendation).toContain("H1");
    expect(snapshot.referenceLabel).not.toBe("Learn more");
    expect(snapshot.configurationVersion).toBe(2);
  });

  it("renders metric-specific values without exposing a BrowserLab object", () => {
    const group = USER_FACING_AUDIT_GROUPS.find((item) => item.name === "Largest Contentful Paint")!;
    const rows = generatedGroupRows([group]);
    const [snapshot] = buildUserFacingGroupSnapshot(rows.groups, rows.mappings, new Set(rows.mappings.map((row) => row.check_id)));
    const results = group.technicalChecks.map((mapping, index) => ({
      check_id: mapping.checkId,
      outcome: "passed" as const,
      evidence: index === 0
        ? { desktop: { value: 3400, unit: "ms" }, mobile: { value: 2900, unit: "ms" }, browserLab: { raw: "must-not-leak" } }
        : {},
    }));
    const [result] = deriveUserFacingAuditResults([snapshot], results);
    expect(result.result_summary).toBe("Mobile was 2.9 seconds and desktop was 3.4 seconds. The recommended threshold is 2.5 seconds or less.");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("uses the authored unable-to-test wording and evidence reason", () => {
    const group = USER_FACING_AUDIT_GROUPS.find((item) => item.name === "HTML language")!;
    const rows = generatedGroupRows([group]);
    const [snapshot] = buildUserFacingGroupSnapshot(rows.groups, rows.mappings, new Set(rows.mappings.map((row) => row.check_id)));
    const results = group.technicalChecks.map((mapping) => ({
      check_id: mapping.checkId,
      outcome: "unable_to_test" as const,
      evidence: { reason: "Rendered evidence collection was incomplete." },
    }));
    const [result] = deriveUserFacingAuditResults([snapshot], results);
    expect(result.outcome).toBe("unable_to_test");
    expect(result.result_summary).toContain("Rendered evidence collection was incomplete.");
    expect(result.result_summary).not.toContain("passed");
  });

  it("retains every affected occurrence and leaves initial limiting to presentation", () => {
    const group = USER_FACING_AUDIT_GROUPS.find((item) => item.name === "Form control labels")!;
    const rows = generatedGroupRows([group]);
    const [snapshot] = buildUserFacingGroupSnapshot(rows.groups, rows.mappings, new Set(rows.mappings.map((row) => row.check_id)));
    const results = group.technicalChecks.map((mapping, index) => ({
      check_id: mapping.checkId,
      outcome: (index === 0 ? "failed" : "passed") as "failed" | "passed",
      evidence: index === 0 ? { occurrences: Array.from({ length: 37 }, (_, item) => ({ locator: `#field-${item}` })) } : {},
    }));
    const [result] = deriveUserFacingAuditResults([snapshot], results);
    expect(result.occurrences).toHaveLength(37);
    expect(result.occurrence_presentation.initialLimit).toBe(10);
  });
});
