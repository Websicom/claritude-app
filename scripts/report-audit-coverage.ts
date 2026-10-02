import { auditCheckHasExecutableLogic } from "../src/worker/index";
import { AUDIT_REGISTRY } from "../src/shared/audit-registry.generated";

const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
const rows = active.map((check) => ({
  id: check.id,
  title: check.title,
  detailedCategory: check.subcategory,
  scoreCategory: check.primaryCategory,
  scope: check.scope,
  collectionMethod: check.executionMethod,
  enabled: true,
  executable: auditCheckHasExecutableLogic(check.id),
  capabilityGap: auditCheckHasExecutableLogic(check.id)
    ? ""
    : check.executionMethod === "rendered_browser" || check.executionMethod === "lab"
      ? "authorised rendered-browser worker not configured"
      : check.executionMethod === "dns"
        ? "DNS evidence collector not implemented"
        : "wider crawl/resource evidence or evaluator required",
  logicVersion: check.logicVersion,
  configurationVersion: check.configurationVersion,
}));

if (process.argv.includes("--csv")) {
  const keys = Object.keys(rows[0]) as (keyof typeof rows[number])[];
  console.log(keys.join(","));
  for (const row of rows)
    console.log(keys.map((key) => `"${String(row[key]).replaceAll('"', '""')}"`).join(","));
} else {
  console.log(JSON.stringify({
    catalogueSize: rows.length,
    implementedChecks: rows.filter((row) => row.executable).length,
    capabilityGaps: rows.filter((row) => !row.executable).length,
    byMethod: Object.fromEntries([...new Set(rows.map((row) => row.collectionMethod))].map((method) => [method, {
      catalogue: rows.filter((row) => row.collectionMethod === method).length,
      implemented: rows.filter((row) => row.collectionMethod === method && row.executable).length,
    }])),
    checks: rows,
  }, null, 2));
}
