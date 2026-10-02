export type AuditRegistrySnapshot = {
  id: string;
  title: string;
  weight: number;
  logicVersion: string;
  configurationVersion: number;
  primaryCategory?: string;
  subcategory?: string;
  severity?: string;
  description?: string;
  recommendation?: string;
  sourceReference?: string;
};

export type AuditRegistryRow = {
  id: string;
  title: string;
  weight: number | string;
  logic_version: string;
  configuration_version: number;
  primary_category?: string;
  subcategory?: string;
  severity?: string;
  description?: string;
  recommendation?: string;
  source_reference?: string;
};

export type ScoredAuditResult = {
  check_id: string;
  outcome: string;
};

export function buildRegistrySnapshot(rows: AuditRegistryRow[], executableIds: ReadonlySet<string>): AuditRegistrySnapshot[] {
  return rows
    .filter((row) => executableIds.has(row.id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      weight: Number(row.weight),
      logicVersion: row.logic_version,
      configurationVersion: row.configuration_version,
      primaryCategory: row.primary_category,
      subcategory: row.subcategory,
      severity: row.severity,
      description: row.description,
      recommendation: row.recommendation,
      sourceReference: row.source_reference,
    }));
}

export function scoreAuditResults(snapshot: AuditRegistrySnapshot[], results: ScoredAuditResult[]) {
  const weights = new Map(snapshot.map((check) => [check.id, check.weight]));
  const scorable = results.filter((result) => ['pass', 'warning', 'fail'].includes(result.outcome));
  const weighted = scorable.map((result) => ({
    value: result.outcome === 'pass' ? 1 : result.outcome === 'warning' ? 0.5 : 0,
    weight: Math.max(0, weights.get(result.check_id) ?? 1),
  }));
  const totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
  const executed = results.filter((result) => result.outcome !== 'unable_to_test');

  return {
    score: totalWeight > 0
      ? Math.round(weighted.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight * 100)
      : null,
    coverage: snapshot.length ? Math.round(executed.length / snapshot.length * 100) : 0,
  };
}
