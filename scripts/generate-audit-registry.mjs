import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'docs', 'audit-checklist-source.md');
const text = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
let section = '';
const checks = [];
const categoryFor = (heading) => {
  if (heading.startsWith('Performance')) return 'performance';
  if (heading.startsWith('Accessibility') || heading.startsWith('Mobile') || heading.startsWith('Images')) return 'accessibility';
  if (heading.startsWith('Security')) return 'security';
  if (heading.startsWith('Server') || heading.startsWith('DNS')) return 'infrastructure';
  if (heading.startsWith('AI Readiness')) return 'ai_readiness';
  return 'seo';
};
const slug = (value) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const special = new Map([
  ['Page title present','seo.metadata.title.present'],['Page title not empty','seo.metadata.title.not_empty'],['Page title length measured','seo.metadata.title.length'],
  ['Meta description present','seo.metadata.description.present'],['Meta description not empty','seo.metadata.description.not_empty'],['Page HTTP status recorded','seo.crawling.http_status'],
  ['Page returns HTML content','seo.crawling.html_content'],['H1 heading present','seo.content.h1.present'],['Multiple H1 headings detected','seo.content.h1.multiple'],
  ['Page has a non-empty document title','accessibility.document.title'],['Viewport meta tag present','accessibility.mobile.viewport'],['Selected page uses HTTPS','security.https.selected'],
  ['Strict-Transport-Security header present','security.headers.hsts'],['Content-Security-Policy header present','security.headers.csp'],['Response content type recorded','infrastructure.http.content_type'],
  ['Main content extractable without JavaScript','ai.content.source_extractable'],
]);
const allOutcomes = ['passed','failed','advisory','not_applicable','unable_to_test'];
const groupFor = (title) => {
  const groups = [
    ['Page title', /^Page title|document title/i],
    ['Meta description', /^Meta description/i],
    ['Image sizing and dimensions', /image (?:display dimensions|intrinsic dimensions|aspect ratio|oversized)/i],
    ['Form control labels', /form control labels|form inputs have associated labels/i],
    ['Content Security Policy', /content-security-policy|security policy violations/i],
    ['Cookie security', /cookies? have|cookie attributes/i],
    ['Viewport configuration', /viewport/i],
    ['Crawler permissions', /robots access|crawler permissions|allowed by .*robots/i],
    ['Open Graph metadata', /open graph/i],
    ['X Card metadata', /twitter |x card/i],
    ['llms.txt', /llms\.txt/i],
    ['llms-full.txt', /llms\.full\.txt|llms-full\.txt/i],
    ['Markdown alternatives', /markdown alternative/i],
  ];
  return groups.find(([, pattern]) => pattern.test(title))?.[0] || null;
};
const requirementFor = (method) => method === 'rendered_browser' || method === 'lab'
  ? 'rendered'
  : method === 'dns'
    ? 'dns'
    : method === 'network'
      ? 'http_network'
      : 'source';
const evidenceSchemaFor = (title, method) => {
  if (/structured data|json-ld|schema\.org/i.test(title)) return 'audit.structured-data.v2';
  if (/links?|destinations?/i.test(title)) return 'audit.link-inventory.v2';
  if (/favicon|apple touch|manifest|markdown alternative|caption track/i.test(title)) return 'audit.resource-inventory.v2';
  if (/compression/i.test(title)) return 'audit.text-compression.v2';
  if (/cache directives/i.test(title)) return 'audit.resource-cache.v2';
  if (/font-display/i.test(title)) return 'audit.font-face.v2';
  if (method === 'rendered_browser' || method === 'lab') return 'audit.rendered.v2';
  if (method === 'dns') return 'audit.dns.v2';
  if (method === 'network') return 'audit.network.v2';
  return 'audit.source-dom.v2';
};
for (const line of text.split(/\r?\n/)) {
  const h = line.match(/^###\s+(.+)/); if (h) { section = h[1].trim(); continue; }
  const item = line.match(/^-\s+(.+)/); if (!item) continue;
  const title = item[1].trim(); const category = categoryFor(section); const subcategory = slug(section.replace(/^AI Readiness:\s*/,'').replace(/^SEO:\s*/,''));
  const executionMethod = /render|contrast|layout|paint|blocking|console|javascript|viewport|touch target|display dimensions|overlap/i.test(title) ? 'rendered_browser' : /first contentful|largest contentful|cumulative layout|total blocking|unused|main-thread/i.test(title) ? 'lab' : /dns|nameserver|soa|spf|dmarc|caa/i.test(title) ? 'dns' : /reachable|redirect|http|header|cookie|resource|link|sitemap|robots/i.test(title) ? 'network' : 'source_html';
  checks.push({ id: special.get(title) || `${category}.${subcategory}.${slug(title)}`, title, description: title, primaryCategory: category, subcategory, tags: [], sourceReference: `${section} > ${title}`, scope: /DNS|hostname|domain|robots|sitemap/i.test(title) ? 'property' : 'page', applicability: 'Evaluate when the referenced element or resource is present; otherwise return not_applicable.', executionMethod, evidenceRequirement: requirementFor(executionMethod), evidenceSchema: evidenceSchemaFor(title, executionMethod), allowedOutcomes: allOutcomes, groupId: groupFor(title), focus: '', passedMessage: null, failedMessage: null, advisoryMessage: null, notApplicableMessage: null, unableToTestMessage: null, exampleFix: null, referenceUrl: null, measurements: [], timeoutClass: executionMethod === 'rendered_browser' || executionMethod === 'lab' ? 'expensive' : executionMethod === 'network' ? 'bounded_network' : 'fast', thresholds: {}, severity: /detected|fail|invalid|broken|missing|empty|noindex|insecure|restrict/i.test(title) ? 'medium' : 'informational', recommendation: `Review: ${title}.`, weight: /recorded|identified|detected|measured|declared/i.test(title) ? 0 : 1, informational: /recorded|identified|measured|detected/i.test(title), logicVersion: '2.0.0', configurationVersion: 2, lifecycle: 'active', replacementCheckId: null, implementationStatus: special.has(title) ? 'implemented' : 'mapped', verificationStatus: special.has(title) ? 'unit_pending' : 'not_verified' });
}
const header = `// Generated from docs/audit-checklist-source.md. Do not hand edit.\nimport type { AuditOutcome } from './audit-evidence';\nexport type AuditCheck = { id:string; title:string; description:string; primaryCategory:string; subcategory:string; tags:string[]; sourceReference:string; scope:string; applicability:string; executionMethod:string; evidenceRequirement:'source'|'rendered'|'source_and_rendered'|'http_network'|'dns'|'robots'|'sitemap'|'css'|'accessibility'; evidenceSchema:string; allowedOutcomes:AuditOutcome[]; groupId:string|null; focus:string; passedMessage:string|null; failedMessage:string|null; advisoryMessage:string|null; notApplicableMessage:string|null; unableToTestMessage:string|null; exampleFix:string|null; referenceUrl:string|null; measurements:string[]; timeoutClass:string; thresholds:Record<string,number>; severity:string; recommendation:string; weight:number; informational:boolean; logicVersion:string; configurationVersion:number; lifecycle:'draft'|'active'|'disabled'|'deprecated'|'retired'; replacementCheckId:string|null; implementationStatus:string; verificationStatus:string };\nexport const AUDIT_REGISTRY: AuditCheck[] = `;
fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'shared', 'audit-registry.generated.ts'), header + JSON.stringify(checks, null, 2) + ';\n');
const cols = ['sourceReference','id','primaryCategory','subcategory','executionMethod','implementationStatus','verificationStatus'];
const csv = [cols.join(','), ...checks.map(c => cols.map(k => `"${String(c[k]).replaceAll('"','""')}"`).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(root, 'docs', 'audit-check-map.csv'), csv);
fs.writeFileSync(path.join(root, 'docs', 'audit-registry.json'), JSON.stringify({ schemaVersion: 1, sourceVersion: '2026-10-01', sourceCount: checks.length, checks }, null, 2) + '\n');
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pgArray = (values) => values.length ? `array[${values.map(sql).join(',')}]::text[]` : `array[]::text[]`;
const outcomeArray = (values) => `array[${values.map(sql).join(',')}]::public.check_outcome[]`;
const nullable = (value) => value == null ? 'null' : sql(value);
const seedRows = checks.map(c => `(${[c.id,c.title,c.description,c.primaryCategory,c.subcategory,c.sourceReference,c.scope,c.applicability,c.executionMethod,c.timeoutClass,c.severity,c.recommendation,c.logicVersion].map(sql).join(',')},${pgArray(c.tags)},${pgArray(c.measurements)},${sql(JSON.stringify(c.thresholds))}::jsonb,${c.weight},${c.informational},${c.configurationVersion},${sql(c.lifecycle)}::public.check_lifecycle,${nullable(c.focus)},${nullable(c.passedMessage)},${nullable(c.failedMessage)},${nullable(c.advisoryMessage)},${nullable(c.notApplicableMessage)},${nullable(c.unableToTestMessage)},${nullable(c.exampleFix)},${nullable(c.referenceUrl)},${sql(c.evidenceSchema)},${sql(c.evidenceRequirement)},${outcomeArray(c.allowedOutcomes)},${nullable(c.groupId)})`).join(',\n');
fs.mkdirSync(path.join(root, 'supabase', 'seed'), { recursive: true });
fs.writeFileSync(path.join(root, 'supabase', 'seed', '010_audit_registry.sql'), `-- Generated from the authoritative checklist.\ninsert into public.audit_check_definitions(id,title,description,primary_category,subcategory,source_reference,scope,applicability,execution_method,timeout_class,severity,recommendation,logic_version,tags,measurements,thresholds,weight,informational,configuration_version,lifecycle,focus,passed_message,failed_message,advisory_message,not_applicable_message,unable_to_test_message,example_fix,reference_url,evidence_schema,evidence_requirement,allowed_outcomes,group_id) values\n${seedRows}\non conflict(id) do update set title=excluded.title,description=excluded.description,primary_category=excluded.primary_category,subcategory=excluded.subcategory,source_reference=excluded.source_reference,scope=excluded.scope,applicability=excluded.applicability,execution_method=excluded.execution_method,timeout_class=excluded.timeout_class,severity=excluded.severity,recommendation=excluded.recommendation,logic_version=excluded.logic_version,tags=excluded.tags,measurements=excluded.measurements,thresholds=excluded.thresholds,weight=excluded.weight,informational=excluded.informational,configuration_version=excluded.configuration_version,lifecycle=excluded.lifecycle,focus=excluded.focus,passed_message=excluded.passed_message,failed_message=excluded.failed_message,advisory_message=excluded.advisory_message,not_applicable_message=excluded.not_applicable_message,unable_to_test_message=excluded.unable_to_test_message,example_fix=excluded.example_fix,reference_url=excluded.reference_url,evidence_schema=excluded.evidence_schema,evidence_requirement=excluded.evidence_requirement,allowed_outcomes=excluded.allowed_outcomes,group_id=excluded.group_id,changed_at=now();\n`);

const sourceCoreIds = new Set([
  ...special.values(),
  'seo.page.metadata.canonical.target.contains.a.noindex.directive',
  'accessibility.accessibility.image.buttons.have.accessible.names',
  'accessibility.images.and.media.images.contain.alt.attributes',
  'seo.content.structure.and.headings.empty.h1.headings.detected',
  'seo.content.structure.and.headings.empty.h2.to.h6.headings.detected',
]);
const resourceIds = new Set([
  'accessibility.images.and.media.caption.track.resources.reachable',
  'seo.structured.data.checked.structured.data.image.urls.reachable',
  'seo.social.sharing.and.site.identity.open.graph.image.reachable',
  'seo.social.sharing.and.site.identity.declared.favicon.reachable',
  'seo.social.sharing.and.site.identity.declared.apple.touch.icon.reachable',
  'seo.social.sharing.and.site.identity.linked.web.app.manifest.reachable',
  'seo.social.sharing.and.site.identity.web.app.manifest.contains.valid.json',
  'ai_readiness.optional.resources.declared.markdown.alternative.reachable',
  'ai_readiness.optional.resources.declared.markdown.alternative.contains.readable.content',
]);
const keyFor = (check) => {
  if (sourceCoreIds.has(check.id)) return 'source_core';
  if (check.id === 'performance.performance.text.compression.detected') return 'text_compression';
  if (check.id === 'performance.performance.static.resource.cache.directives.inspected') return 'static_resource_cache';
  if (check.id === 'performance.performance.font.display.declarations.inspected') return 'font_display';
  if (resourceIds.has(check.id)) return 'resource_inventory';
  if (check.id.startsWith('seo.links.and.navigation.')) return 'link_inventory';
  if (/structured data|json-ld|schema\.org/i.test(check.title)) return 'structured_data';
  if (check.primaryCategory === 'performance') return 'performance_metric';
  if (check.executionMethod === 'rendered_browser' || check.executionMethod === 'lab') return 'rendered_evidence';
  if (check.executionMethod === 'dns') return 'dns_evidence';
  if (/robots/i.test(check.title)) return 'robots_evidence';
  if (/sitemap/i.test(check.title)) return 'sitemap_evidence';
  return 'unsupported';
};
const evaluatorRows = checks.map((check) => `  ${JSON.stringify(check.id)}: ${JSON.stringify(keyFor(check))},`).join('\n');
fs.writeFileSync(path.join(root, 'src', 'shared', 'audit-evaluator-map.generated.ts'), `// Generated from the authoritative checklist. Do not hand edit.\nimport type { AuditCheck } from './audit-registry.generated';\nexport type AuditCheckId = AuditCheck['id'];\nexport type AuditEvaluatorKey = 'source_core'|'link_inventory'|'resource_inventory'|'structured_data'|'performance_metric'|'text_compression'|'static_resource_cache'|'font_display'|'rendered_evidence'|'dns_evidence'|'robots_evidence'|'sitemap_evidence'|'unsupported';\nexport const AUDIT_EVALUATOR_KEYS: Record<AuditCheckId, AuditEvaluatorKey> = {\n${evaluatorRows}\n};\n`);
console.log(`Generated ${checks.length} mapped audit checks.`);
