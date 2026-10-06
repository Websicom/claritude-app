import type { AuditOutcome } from "./audit-evidence";
import {
  USER_FACING_AUDIT_CONTENT_BY_ID,
  type UserFacingAuditEvidencePresentation,
  type UserFacingAuditOccurrencePresentation,
} from "./audit-user-facing-content.generated";
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
  focus?: string | null;
  passed_message?: string | null;
  failed_message?: string | null;
  advisory_message?: string | null;
  not_applicable_message?: string | null;
  unable_to_test_message?: string | null;
  recommendation?: string | null;
  example_fix?: string | null;
  reference_label?: string | null;
  evidence_presentation?: UserFacingAuditEvidencePresentation | null;
  occurrence_presentation?: UserFacingAuditOccurrencePresentation | null;
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
  focus: string;
  passedMessage: string;
  failedMessage: string;
  advisoryMessage: string;
  notApplicableMessage: string;
  unableToTestMessage: string;
  recommendation: string;
  exampleFix: string | null;
  referenceLabel: string;
  evidencePresentation: UserFacingAuditEvidencePresentation;
  occurrencePresentation: UserFacingAuditOccurrencePresentation;
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
  reference_label: string;
  focus: string;
  result_summary: string;
  recommendation: string;
  example_fix: string | null;
  evidence_presentation: UserFacingAuditEvidencePresentation;
  occurrence_presentation: UserFacingAuditOccurrencePresentation;
  presentation_values: Record<string, string | number>;
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
    groups: definitions.map((group) => {
      const content = USER_FACING_AUDIT_CONTENT_BY_ID.get(group.id);
      if (!content) throw new Error(`Missing Stage 4 content for ${group.id}`);
      return ({
      id: group.id,
      name: group.name,
      category: group.category,
      subcategory: group.subcategory,
      presentation_role: group.presentationRole,
      outcome_policy: group.outcomePolicy,
      failure_severity: group.severity,
      weight: group.weight,
      authoritative_reference: group.authoritativeReference,
      focus: content.focus,
      passed_message: content.passedMessage,
      failed_message: content.failedMessage,
      advisory_message: content.advisoryMessage,
      not_applicable_message: content.notApplicableMessage,
      unable_to_test_message: content.unableToTestMessage,
      recommendation: content.recommendation,
      example_fix: content.exampleFix,
      reference_label: content.referenceLabel,
      evidence_presentation: content.evidencePresentation,
      occurrence_presentation: content.occurrencePresentation,
      lifecycle: group.lifecycle,
      enabled_by_default: group.enabledByDefault,
      configuration_version: Math.max(2, group.configurationVersion),
      sort_order: group.sortOrder,
      });
    }),
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
      const fallback = USER_FACING_AUDIT_CONTENT_BY_ID.get(group.id);
      if (!fallback) throw new Error(`Missing Stage 4 content for ${group.id}`);
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
        focus: group.focus || fallback.focus,
        passedMessage: group.passed_message || fallback.passedMessage,
        failedMessage: group.failed_message || fallback.failedMessage,
        advisoryMessage: group.advisory_message || fallback.advisoryMessage,
        notApplicableMessage: group.not_applicable_message || fallback.notApplicableMessage,
        unableToTestMessage: group.unable_to_test_message || fallback.unableToTestMessage,
        recommendation: group.recommendation || fallback.recommendation,
        exampleFix: group.example_fix ?? fallback.exampleFix,
        referenceLabel: group.reference_label || fallback.referenceLabel,
        evidencePresentation: group.evidence_presentation || fallback.evidencePresentation,
        occurrencePresentation: group.occurrence_presentation || fallback.occurrencePresentation,
        configurationVersion: group.configuration_version,
        sortOrder: group.sort_order,
        technicalChecks,
      }];
    });
}

function scalarEvidence(result: PresentableTechnicalAuditResult, key: string): string | number | null {
  if (!result.evidence || typeof result.evidence !== "object") return null;
  const evidence = result.evidence as Record<string, unknown>;
  const direct = evidence[key];
  if (typeof direct === "string" || typeof direct === "number") return direct;
  for (const nested of Object.values(evidence)) {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const value = (nested as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function formatMetric(value: unknown, unit?: UserFacingAuditEvidencePresentation["unit"]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "not available";
  if (unit === "seconds_from_ms") return `${(value / 1000).toFixed(1)} seconds`;
  if (unit === "milliseconds") return `${Math.round(value)} milliseconds`;
  if (unit === "score") return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return String(value);
}

function presentationValues(
  group: UserFacingAuditGroupSnapshot,
  subfindings: UserFacingAuditResult["subfindings"],
  technicalResults: PresentableTechnicalAuditResult[],
  occurrenceCount: number,
) {
  const byOutcome = (outcome: AuditOutcome) => subfindings.filter((finding) => finding.outcome === outcome).length;
  const metricResult = technicalResults.find((result) => {
    const evidence = result.evidence as Record<string, unknown> | null;
    return evidence && typeof evidence.desktop === "object" && typeof evidence.mobile === "object";
  });
  const metricEvidence = metricResult?.evidence as Record<string, any> | undefined;
  const unableResult = technicalResults.find((result) => result.outcome === "unable_to_test");
  const values: Record<string, string | number> = {
    checkedCount: subfindings.length,
    passedCount: byOutcome("passed"),
    failedCount: byOutcome("failed"),
    advisoryCount: byOutcome("advisory") || byOutcome("failed"),
    notApplicableCount: byOutcome("not_applicable"),
    unableCount: byOutcome("unable_to_test"),
    count: occurrenceCount,
    mobileValue: formatMetric(metricEvidence?.mobile?.value, group.evidencePresentation.unit),
    desktopValue: formatMetric(metricEvidence?.desktop?.value, group.evidencePresentation.unit),
    threshold: group.evidencePresentation.threshold || "the documented target",
    unableReason: String((unableResult && (scalarEvidence(unableResult, "reason") || scalarEvidence(unableResult, "message"))) || "Required evidence was unavailable or incomplete."),
  };
  for (const key of ["url", "status", "value"] as const) {
    const result = technicalResults.find((entry) => scalarEvidence(entry, key) != null);
    const value = result ? scalarEvidence(result, key) : null;
    if (value != null) values[key] = value;
  }
  return values;
}

function renderMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}

function occurrencesFor(result: PresentableTechnicalAuditResult) {
  if (!result.evidence || typeof result.evidence !== "object") return [];
  const occurrences = (result.evidence as Record<string, unknown>).occurrences;
  return Array.isArray(occurrences) ? occurrences : [];
}

function evidenceLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactEvidenceValue(value: unknown, depth = 0): string | null {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact ? (compact.length > 180 ? `${compact.slice(0, 177)}…` : compact) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (depth >= 2 || value == null) return null;
  if (Array.isArray(value)) {
    const rendered = value.slice(0, 4).flatMap((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const viewport = typeof record.viewport === "string" ? record.viewport : null;
        const measured = compactEvidenceValue(record.value, depth + 1);
        if (viewport && measured != null) return [`${evidenceLabel(viewport)}: ${measured}`];
      }
      const summary = compactEvidenceValue(item, depth + 1);
      return summary == null ? [] : [summary];
    });
    if (!rendered.length) return null;
    return `${rendered.join("; ")}${value.length > rendered.length ? `; +${value.length - rendered.length} more` : ""}`;
  }
  if (typeof value === "object") {
    const blocked = new Set(["browserLab", "raw", "html", "source", "occurrences"]);
    const rendered = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.has(key))
      .slice(0, 4)
      .flatMap(([key, item]) => {
        const summary = compactEvidenceValue(item, depth + 1);
        return summary == null ? [] : [`${evidenceLabel(key)}: ${summary}`];
      });
    return rendered.length ? rendered.join("; ") : null;
  }
  return null;
}

function compactEvidenceSummary(result: PresentableTechnicalAuditResult) {
  const evidence = result.evidence && typeof result.evidence === "object"
    ? result.evidence as Record<string, unknown>
    : {};
  const preferredKeys = ["reason", "message", "status", "value", "expected", "actual", "count", "url", "path", "resource", "selector", "element", "viewports", "desktop", "mobile"];
  const keys = [...preferredKeys.filter((key) => Object.hasOwn(evidence, key)), ...Object.keys(evidence).filter((key) => !preferredKeys.includes(key))];
  const values = keys.flatMap((key) => {
    if (["browserLab", "raw", "html", "source", "occurrences"].includes(key)) return [];
    const summary = compactEvidenceValue(evidence[key]);
    return summary == null ? [] : [`${evidenceLabel(key)}: ${summary}`];
  }).slice(0, 3);
  const occurrenceCount = occurrencesFor(result).length;
  if (occurrenceCount) values.push(`${occurrenceCount} affected occurrence${occurrenceCount === 1 ? "" : "s"}`);
  return values.length ? values.join(" · ") : "No additional evidence was recorded.";
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
    const fallback = USER_FACING_AUDIT_CONTENT_BY_ID.get(group.id);
    group = {
      ...group,
      focus: group.focus || fallback?.focus || "",
      passedMessage: group.passedMessage || fallback?.passedMessage || "The expected behaviour was verified.",
      failedMessage: group.failedMessage || fallback?.failedMessage || "The audit found a problem.",
      advisoryMessage: group.advisoryMessage || fallback?.advisoryMessage || "The audit found an opportunity to consider.",
      notApplicableMessage: group.notApplicableMessage || fallback?.notApplicableMessage || "This check did not apply.",
      unableToTestMessage: group.unableToTestMessage || fallback?.unableToTestMessage || "Claritude could not reach a reliable conclusion.",
      recommendation: group.recommendation || fallback?.recommendation || "",
      exampleFix: group.exampleFix ?? fallback?.exampleFix ?? null,
      referenceLabel: group.referenceLabel || fallback?.referenceLabel || "Authoritative reference",
      evidencePresentation: group.evidencePresentation || fallback?.evidencePresentation || { kind: "summary", fields: [] },
      occurrencePresentation: group.occurrencePresentation || fallback?.occurrencePresentation || { enabled: true, initialLimit: 10, fields: [] },
    };
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
    const groupTechnicalResults = group.technicalChecks.flatMap((mapping) => {
      const result = resultByCheckId.get(mapping.checkId);
      return result ? [result] : [];
    });
    const values = presentationValues(group, subfindings, groupTechnicalResults, occurrences.length);
    const message = outcome === "passed" ? group.passedMessage
      : outcome === "failed" ? group.failedMessage
        : outcome === "advisory" ? group.advisoryMessage
          : outcome === "not_applicable" ? group.notApplicableMessage
            : group.unableToTestMessage;
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
      reference_label: group.referenceLabel,
      focus: group.focus,
      result_summary: renderMessage(message, values),
      recommendation: group.recommendation,
      example_fix: group.exampleFix,
      evidence_presentation: group.evidencePresentation,
      occurrence_presentation: group.occurrencePresentation,
      presentation_values: values,
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
