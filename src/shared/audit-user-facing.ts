import type { AuditOutcome } from "./audit-evidence";
import type {
  UserFacingAuditGroupDefinition,
  UserFacingAuditOutcomePolicy,
  UserFacingAuditPresentationRole,
} from "./audit-user-facing-registry.generated";

export type UserFacingAuditGroupRow = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  presentation_role: UserFacingAuditPresentationRole;
  outcome_policy: UserFacingAuditOutcomePolicy;
  failure_severity: string;
  weight: number | string;
  authoritative_reference?: string | null;
  lifecycle: string;
  enabled_by_default: boolean;
  configuration_version: number;
  sort_order: number;
};

export type UserFacingAuditGroupCheckRow = {
  group_id: string;
  check_id: string;
  presentation_action: string;
  lifecycle: string;
  enabled_by_default: boolean;
  sort_order: number;
};

export type AuditAvailabilityOverride = {
  target_kind: "technical_check" | "user_facing_group";
  target_id: string;
  enabled: boolean;
};

export function resolveAuditAvailability(
  kind: AuditAvailabilityOverride["target_kind"],
  id: string,
  enabledByDefault: boolean,
  packageOverrides: AuditAvailabilityOverride[],
  accountOverrides: AuditAvailabilityOverride[],
) {
  const matches = (row: AuditAvailabilityOverride) => row.target_kind === kind && row.target_id === id;
  return accountOverrides.find(matches)?.enabled ?? packageOverrides.find(matches)?.enabled ?? enabledByDefault;
}

export type UserFacingAuditGroupSnapshot = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  presentationRole: UserFacingAuditPresentationRole;
  outcomePolicy: UserFacingAuditOutcomePolicy;
  severity: string;
  weight: number;
  authoritativeReference: string | null;
  configurationVersion: number;
  sortOrder: number;
  technicalChecks: Array<{
    checkId: string;
    action: string;
    sortOrder: number;
  }>;
};

export type PresentableTechnicalAuditResult = {
  id?: string | number;
  check_id: string;
  outcome: AuditOutcome;
  title?: string;
  title_snapshot?: string;
  severity?: string;
  evidence?: unknown;
  review_status?: string;
};

export type UserFacingAuditResult = {
  group_id: string;
  title: string;
  category: string;
  subcategory: string;
  presentation_role: UserFacingAuditPresentationRole;
  outcome_policy: UserFacingAuditOutcomePolicy;
  outcome: AuditOutcome;
  severity: string;
  weight: number;
  source_reference: string | null;
  technical_check_ids: string[];
  result_ids: Array<string | number>;
  evidence_summary: string[];
  subfindings: Array<{
    result_id: string | number | null;
    check_id: string;
    title: string;
    outcome: AuditOutcome;
    evidence_summary: string;
    occurrence_count: number;
    review_status: string;
  }>;
  occurrences: Array<{
    check_id: string;
    check_title: string;
    occurrence: unknown;
  }>;
  review_status: string;
};

export function generatedGroupRows(
  definitions: UserFacingAuditGroupDefinition[],
): { groups: UserFacingAuditGroupRow[]; mappings: UserFacingAuditGroupCheckRow[] } {
  return {
    groups: definitions.map((group) => ({
      id: group.id,
      name: group.name,
      category: group.category,
      subcategory: group.subcategory,
      presentation_role: group.presentationRole,
      outcome_policy: group.outcomePolicy,
      failure_severity: group.severity,
      weight: group.weight,
      authoritative_reference: group.authoritativeReference,
      lifecycle: group.lifecycle,
      enabled_by_default: group.enabledByDefault,
      configuration_version: group.configurationVersion,
      sort_order: group.sortOrder,
    })),
    mappings: definitions.flatMap((group) => group.technicalChecks.map((mapping) => ({
      group_id: group.id,
      check_id: mapping.checkId,
      presentation_action: mapping.action,
      lifecycle: mapping.lifecycle,
      enabled_by_default: mapping.enabledByDefault,
      sort_order: mapping.sortOrder,
    }))),
  };
}

export function buildUserFacingGroupSnapshot(
  groupRows: UserFacingAuditGroupRow[],
  mappingRows: UserFacingAuditGroupCheckRow[],
  enabledTechnicalCheckIds: ReadonlySet<string>,
): UserFacingAuditGroupSnapshot[] {
  const mappingsByGroup = new Map<string, UserFacingAuditGroupCheckRow[]>();
  for (const mapping of mappingRows) {
    if (mapping.lifecycle !== "active" || !mapping.enabled_by_default || !enabledTechnicalCheckIds.has(mapping.check_id)) continue;
    const entries = mappingsByGroup.get(mapping.group_id) || [];
    entries.push(mapping);
    mappingsByGroup.set(mapping.group_id, entries);
  }
  return groupRows
    .filter((group) => group.lifecycle === "active" && group.enabled_by_default)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .flatMap((group) => {
      const technicalChecks = (mappingsByGroup.get(group.id) || [])
        .sort((left, right) => left.sort_order - right.sort_order || left.check_id.localeCompare(right.check_id))
        .map((mapping) => ({ checkId: mapping.check_id, action: mapping.presentation_action, sortOrder: mapping.sort_order }));
      if (!technicalChecks.length) return [];
      return [{
        id: group.id,
        name: group.name,
        category: group.category,
        subcategory: group.subcategory,
        presentationRole: group.presentation_role,
        outcomePolicy: group.outcome_policy,
        severity: group.failure_severity,
        weight: Number(group.weight),
        authoritativeReference: group.authoritative_reference || null,
        configurationVersion: group.configuration_version,
        sortOrder: group.sort_order,
        technicalChecks,
      }];
    });
}

function occurrencesFor(result: PresentableTechnicalAuditResult) {
  if (!result.evidence || typeof result.evidence !== "object") return [];
  const occurrences = (result.evidence as Record<string, unknown>).occurrences;
  return Array.isArray(occurrences) ? occurrences : [];
}

function compactEvidenceSummary(result: PresentableTechnicalAuditResult) {
  const evidence = result.evidence && typeof result.evidence === "object"
    ? result.evidence as Record<string, unknown>
    : {};
  const safeKeys = ["reason", "message", "status", "value", "expected", "actual", "count", "url", "path", "resource", "selector", "element"];
  const values = safeKeys.flatMap((key) => {
    const value = evidence[key];
    if (value == null || value === "" || typeof value === "object") return [];
    return [`${key.replaceAll("_", " ")}: ${String(value)}`];
  }).slice(0, 3);
  const occurrenceCount = occurrencesFor(result).length;
  if (occurrenceCount) values.push(`${occurrenceCount} affected occurrence${occurrenceCount === 1 ? "" : "s"}`);
  return values.length ? values.join(" · ") : result.outcome.replaceAll("_", " ");
}

export function deriveUserFacingOutcome(
  policy: UserFacingAuditOutcomePolicy,
  outcomes: AuditOutcome[],
): AuditOutcome {
  if (!outcomes.length) return "unable_to_test";
  if (policy === "Passed / Failed / Not applicable / Unable to test" && outcomes.includes("failed")) return "failed";
  if (outcomes.includes("unable_to_test")) return "unable_to_test";
  if (outcomes.every((outcome) => outcome === "not_applicable")) return "not_applicable";
  if (policy === "Passed / Failed / Not applicable / Unable to test") {
    if (outcomes.includes("advisory")) return "advisory";
    return outcomes.every((outcome) => outcome === "passed" || outcome === "not_applicable") ? "passed" : "unable_to_test";
  }
  if (outcomes.some((outcome) => outcome === "failed" || outcome === "advisory")) return "advisory";
  return outcomes.every((outcome) => outcome === "passed" || outcome === "not_applicable") ? "passed" : "unable_to_test";
}

export function deriveUserFacingAuditResults(
  snapshot: UserFacingAuditGroupSnapshot[],
  technicalResults: PresentableTechnicalAuditResult[],
): UserFacingAuditResult[] {
  const resultByCheckId = new Map(technicalResults.map((result) => [result.check_id, result]));
  return snapshot.flatMap((group) => {
    if (!group.technicalChecks.length) return [];
    const subfindings = group.technicalChecks.map((mapping) => {
      const result = resultByCheckId.get(mapping.checkId);
      const outcome: AuditOutcome = result?.outcome || "unable_to_test";
      const title = result?.title || result?.title_snapshot || mapping.checkId;
      return {
        result_id: result?.id ?? null,
        check_id: mapping.checkId,
        title,
        outcome,
        evidence_summary: result ? compactEvidenceSummary(result) : "Result was not persisted for this enabled check.",
        occurrence_count: result ? occurrencesFor(result).length : 0,
        review_status: result?.review_status || "not_reviewed",
      };
    });
    const occurrences = group.technicalChecks.flatMap((mapping) => {
      const result = resultByCheckId.get(mapping.checkId);
      if (!result) return [];
      const title = result.title || result.title_snapshot || mapping.checkId;
      return occurrencesFor(result).map((occurrence) => ({
        check_id: mapping.checkId,
        check_title: title,
        occurrence,
      }));
    });
    const outcome = deriveUserFacingOutcome(group.outcomePolicy, subfindings.map((finding) => finding.outcome));
    const resultIds = subfindings.flatMap((finding) => finding.result_id == null ? [] : [finding.result_id]);
    const reviewed = subfindings.length > 0 && subfindings.every((finding) => finding.review_status !== "not_reviewed");
    return [{
      group_id: group.id,
      title: group.name,
      category: group.category,
      subcategory: group.subcategory,
      presentation_role: group.presentationRole,
      outcome_policy: group.outcomePolicy,
      outcome,
      severity: group.severity,
      weight: group.weight,
      source_reference: group.authoritativeReference,
      technical_check_ids: group.technicalChecks.map((mapping) => mapping.checkId),
      result_ids: resultIds,
      evidence_summary: subfindings.map((finding) => `${finding.title}: ${finding.evidence_summary}`),
      subfindings,
      occurrences,
      review_status: reviewed ? "reviewed" : "not_reviewed",
    }];
  });
}

export function scoreUserFacingAuditResults(results: UserFacingAuditResult[]) {
  const scorable = results.filter((result) => result.weight > 0 && ["passed", "advisory", "failed"].includes(result.outcome));
  const totalWeight = scorable.reduce((total, result) => total + result.weight, 0);
  if (!totalWeight) return null;
  const achieved = scorable.reduce((total, result) => total + result.weight * (result.outcome === "passed" ? 1 : result.outcome === "advisory" ? 0.5 : 0), 0);
  return Math.round(achieved / totalWeight * 100);
}
