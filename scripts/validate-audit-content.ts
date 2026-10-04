import { AUDIT_REGISTRY } from "../src/shared/audit-registry.generated";
import { USER_FACING_AUDIT_CONTENT } from "../src/shared/audit-user-facing-content.generated";
import { USER_FACING_AUDIT_GROUPS } from "../src/shared/audit-user-facing-registry.generated";

const failures: string[] = [];
const fail = (condition: boolean, message: string) => { if (condition) failures.push(message); };
const contentById = new Map(USER_FACING_AUDIT_CONTENT.map((item) => [item.id, item]));
const knownPlaceholders = new Set([
  "count", "url", "status", "value", "threshold", "mobileValue", "desktopValue",
  "checkedCount", "passedCount", "failedCount", "advisoryCount", "notApplicableCount", "unableCount", "unableReason",
]);
const validSeverities = new Set(["Critical", "Security", "Warning", "Advisory", "Advisory / contextual"]);

fail(USER_FACING_AUDIT_GROUPS.length !== 121, `Expected 121 groups; found ${USER_FACING_AUDIT_GROUPS.length}`);
fail(USER_FACING_AUDIT_CONTENT.length !== 121, `Expected 121 content definitions; found ${USER_FACING_AUDIT_CONTENT.length}`);
const mappedCheckIds = USER_FACING_AUDIT_GROUPS.flatMap((group) => group.technicalChecks.map((mapping) => mapping.checkId));
fail(mappedCheckIds.length !== 306, `Expected 306 mappings; found ${mappedCheckIds.length}`);
fail(new Set(mappedCheckIds).size !== 306, "A technical check is mapped more than once");
fail(AUDIT_REGISTRY.some((check) => !mappedCheckIds.includes(check.id)), "At least one registered technical check is not mapped");

for (const group of USER_FACING_AUDIT_GROUPS) {
  const content = contentById.get(group.id);
  if (!content) {
    failures.push(`${group.id}: content is missing`);
    continue;
  }
  for (const [field, value] of Object.entries({
    focus: content.focus,
    passedMessage: content.passedMessage,
    failedMessage: content.failedMessage,
    advisoryMessage: content.advisoryMessage,
    notApplicableMessage: content.notApplicableMessage,
    unableToTestMessage: content.unableToTestMessage,
    recommendation: content.recommendation,
    referenceLabel: content.referenceLabel,
  })) fail(!value.trim(), `${group.id}: ${field} is blank`);
  fail(content.focus.trim().toLocaleLowerCase() === group.name.trim().toLocaleLowerCase(), `${group.id}: focus merely repeats the title`);
  fail(/^review\b|review this issue/i.test(content.recommendation.trim()), `${group.id}: recommendation is generic review text`);
  fail(!validSeverities.has(group.severity), `${group.id}: invalid severity ${group.severity}`);
  try {
    const url = new URL(content.referenceUrl || "");
    fail(!["http:", "https:"].includes(url.protocol), `${group.id}: reference URL must be HTTP(S)`);
  } catch {
    failures.push(`${group.id}: reference URL is invalid`);
  }
  fail(content.referenceUrl !== group.authoritativeReference, `${group.id}: reference diverges from the approved Stage 3 source`);
  fail(!content.recommendation.trim() && group.outcomePolicy.includes("Failed"), `${group.id}: an applicable Failed state has no recommendation`);
  fail(content.occurrencePresentation.initialLimit !== 10, `${group.id}: initial occurrence limit is not 10`);
  const templates = [content.passedMessage, content.failedMessage, content.advisoryMessage, content.notApplicableMessage, content.unableToTestMessage];
  for (const template of templates) {
    for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      fail(!knownPlaceholders.has(match[1]), `${group.id}: unsupported placeholder {${match[1]}}`);
    }
  }
  fail(JSON.stringify(content).toLowerCase().includes("browserlab"), `${group.id}: raw BrowserLab terminology leaked into presentation content`);
}

for (const item of USER_FACING_AUDIT_CONTENT) fail(!USER_FACING_AUDIT_GROUPS.some((group) => group.id === item.id), `${item.id}: orphan content definition`);

const summary = {
  groups: USER_FACING_AUDIT_CONTENT.length,
  passContent: USER_FACING_AUDIT_CONTENT.filter((item) => item.passedMessage.trim()).length,
  failContent: USER_FACING_AUDIT_CONTENT.filter((item) => item.failedMessage.trim()).length,
  advisoryContent: USER_FACING_AUDIT_CONTENT.filter((item) => item.advisoryMessage.trim()).length,
  notApplicableContent: USER_FACING_AUDIT_CONTENT.filter((item) => item.notApplicableMessage.trim()).length,
  unableToTestContent: USER_FACING_AUDIT_CONTENT.filter((item) => item.unableToTestMessage.trim()).length,
  recommendations: USER_FACING_AUDIT_CONTENT.filter((item) => item.recommendation.trim()).length,
  exampleFixes: USER_FACING_AUDIT_CONTENT.filter((item) => item.exampleFix?.trim()).length,
  references: USER_FACING_AUDIT_CONTENT.filter((item) => item.referenceUrl).length,
  mappedTechnicalChecks: new Set(mappedCheckIds).size,
  failures: failures.length,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
