import { describe, expect, it } from "vitest";
import { USER_FACING_AUDIT_GROUPS } from "./audit-user-facing-registry.generated";
import {
  buildUserFacingGroupSnapshot,
  deriveUserFacingAuditResults,
  deriveUserFacingOutcome,
  generatedGroupRows,
  resolveAuditAvailability,
  scoreUserFacingAuditResults,
  type UserFacingAuditGroupSnapshot,
} from "./audit-user-facing";

const strictPolicy = "Passed / Failed / Not applicable / Unable to test" as const;
const optionalPolicy = "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant" as const;
const contextualPolicy = "Contextual: report policy/state; do not Fail without declared intent" as const;

function snapshot(overrides: Partial<UserFacingAuditGroupSnapshot> = {}): UserFacingAuditGroupSnapshot {
  return {
    id: "audit-group.seo.example",
    name: "Example group",
    category: "SEO",
    subcategory: "Page Metadata",
    presentationRole: "Scored check",
    outcomePolicy: strictPolicy,
    severity: "Warning",
    weight: 1,
    authoritativeReference: "https://example.com/reference",
    configurationVersion: 1,
    sortOrder: 1,
    technicalChecks: [
      { checkId: "one", action: "Merge into user-facing group", sortOrder: 1 },
      { checkId: "two", action: "Merge into user-facing group", sortOrder: 2 },
    ],
    ...overrides,
  };
}

describe("Stage 3 user-facing audit catalogue", () => {
  it("maps all 306 technical checks exactly once into 121 stable groups", () => {
    const ids = USER_FACING_AUDIT_GROUPS.map((group) => group.id);
    const technicalIds = USER_FACING_AUDIT_GROUPS.flatMap((group) => group.technicalChecks.map((mapping) => mapping.checkId));
    expect(USER_FACING_AUDIT_GROUPS).toHaveLength(121);
    expect(new Set(ids).size).toBe(121);
    expect(technicalIds).toHaveLength(306);
    expect(new Set(technicalIds).size).toBe(306);
    expect(USER_FACING_AUDIT_GROUPS.filter((group) => group.technicalChecks.length === 1)).toHaveLength(54);
  });

  it("uses only the approved Stage 3 categories", () => {
    expect([...new Set(USER_FACING_AUDIT_GROUPS.map((group) => group.category))].sort()).toEqual([
      "AI & Crawler Readiness",
      "Accessibility",
      "Performance",
      "SEO",
      "Security",
      "Technical",
    ]);
  });

  it("omits disabled checks from execution and removes groups with no enabled subchecks", () => {
    const { groups, mappings } = generatedGroupRows(USER_FACING_AUDIT_GROUPS.slice(0, 2));
    const firstGroupCheckIds = new Set(mappings.filter((mapping) => mapping.group_id === groups[0].id).map((mapping) => mapping.check_id));
    const enabledIds = new Set(mappings.map((mapping) => mapping.check_id).filter((id) => !firstGroupCheckIds.has(id)));
    const effective = buildUserFacingGroupSnapshot(groups, mappings, enabledIds);
    expect(effective.some((group) => group.id === groups[0].id)).toBe(false);
    expect(effective.every((group) => group.technicalChecks.every((mapping) => enabledIds.has(mapping.checkId)))).toBe(true);
  });

  it("omits lifecycle-disabled groups even when their technical checks are active", () => {
    const { groups, mappings } = generatedGroupRows(USER_FACING_AUDIT_GROUPS.slice(0, 1));
    groups[0] = { ...groups[0], lifecycle: "disabled" };
    expect(buildUserFacingGroupSnapshot(groups, mappings, new Set(mappings.map((mapping) => mapping.check_id)))).toEqual([]);
  });

  it("applies account availability after package availability and the catalogue default", () => {
    const packageOverrides = [{ target_kind: "technical_check" as const, target_id: "one", enabled: false }];
    const accountOverrides = [{ target_kind: "technical_check" as const, target_id: "one", enabled: true }];
    expect(resolveAuditAvailability("technical_check", "one", true, packageOverrides, [])).toBe(false);
    expect(resolveAuditAvailability("technical_check", "one", true, packageOverrides, accountOverrides)).toBe(true);
    expect(resolveAuditAvailability("user_facing_group", "missing", false, packageOverrides, accountOverrides)).toBe(false);
  });

  it("uses explicit strict, optional and contextual outcome policies", () => {
    expect(deriveUserFacingOutcome(strictPolicy, ["passed", "failed"])).toBe("failed");
    expect(deriveUserFacingOutcome(strictPolicy, ["passed", "unable_to_test"])).toBe("unable_to_test");
    expect(deriveUserFacingOutcome(strictPolicy, ["passed", "not_applicable"])).toBe("passed");
    expect(deriveUserFacingOutcome(optionalPolicy, ["passed", "failed"])).toBe("advisory");
    expect(deriveUserFacingOutcome(optionalPolicy, ["not_applicable", "not_applicable"])).toBe("not_applicable");
    expect(deriveUserFacingOutcome(contextualPolicy, ["passed", "failed"])).toBe("advisory");
    expect(deriveUserFacingOutcome(contextualPolicy, ["passed", "unable_to_test"])).toBe("unable_to_test");
    expect(USER_FACING_AUDIT_GROUPS.filter((group) => group.presentationRole === "Contextual / policy-dependent")).toHaveLength(2);
  });

  it("keeps mixed diagnostic subchecks inside their approved user-facing groups", () => {
    const diagnosticGroups = USER_FACING_AUDIT_GROUPS.filter((group) => group.presentationRole === "Mixed: checks + diagnostics");
    const diagnosticSubchecks = diagnosticGroups.flatMap((group) => group.technicalChecks);
    expect(diagnosticGroups).toHaveLength(2);
    expect(diagnosticSubchecks).toHaveLength(16);
    expect(diagnosticGroups.map((group) => group.name)).toEqual(["DNS configuration", "HTTP caching metadata"]);
  });

  it("does not manufacture a pass when an enabled result is missing", () => {
    const [group] = deriveUserFacingAuditResults([snapshot()], [{
      check_id: "one",
      title: "One",
      outcome: "passed",
      evidence: {},
    }]);
    expect(group.outcome).toBe("unable_to_test");
    expect(group.subfindings.find((finding) => finding.check_id === "two")?.outcome).toBe("unable_to_test");
  });

  it("aggregates every affected occurrence without leaking unrelated BrowserLab evidence", () => {
    const [group] = deriveUserFacingAuditResults([snapshot()], [
      {
        id: 1,
        check_id: "one",
        title: "One",
        outcome: "failed",
        evidence: {
          occurrences: [{ selector: "h1:empty" }, { selector: "h1:nth-of-type(2)" }],
          browserLab: { raw: "must-not-leak" },
        },
      },
      { id: 2, check_id: "two", title: "Two", outcome: "passed", evidence: {} },
    ]);
    expect(group.occurrences).toHaveLength(2);
    expect(group.subfindings).toHaveLength(2);
    expect(JSON.stringify(group)).not.toContain("must-not-leak");
  });

  it("keeps zero-weight advisory groups out of scoring", () => {
    const strict = deriveUserFacingAuditResults([snapshot()], [
      { check_id: "one", outcome: "passed" },
      { check_id: "two", outcome: "passed" },
    ])[0];
    const advisory = deriveUserFacingAuditResults([snapshot({
      id: "audit-group.ai.optional",
      outcomePolicy: optionalPolicy,
      presentationRole: "Advisory / optional",
      weight: 0,
    })], [
      { check_id: "one", outcome: "failed" },
      { check_id: "two", outcome: "passed" },
    ])[0];
    expect(advisory.outcome).toBe("advisory");
    expect(scoreUserFacingAuditResults([strict, advisory])).toBe(100);
  });

  it("retains critical and security severity from the approved group definition", () => {
    const severities = new Set(USER_FACING_AUDIT_GROUPS.map((group) => group.severity));
    expect(severities.has("Critical")).toBe(true);
    expect(severities.has("Security")).toBe(true);
  });
});
