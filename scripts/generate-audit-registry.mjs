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
for (const line of text.split(/\r?\n/)) {
  const h = line.match(/^###\s+(.+)/); if (h) { section = h[1].trim(); continue; }
  const item = line.match(/^-\s+(.+)/); if (!item) continue;
  const title = item[1].trim(); const category = categoryFor(section); const subcategory = slug(section.replace(/^AI Readiness:\s*/,'').replace(/^SEO:\s*/,''));
  const executionMethod = /render|contrast|layout|paint|blocking|console|javascript|viewport|touch target|display dimensions|overlap/i.test(title) ? 'rendered_browser' : /first contentful|largest contentful|cumulative layout|total blocking|unused|main-thread/i.test(title) ? 'lab' : /dns|nameserver|soa|spf|dmarc|caa/i.test(title) ? 'dns' : /reachable|redirect|http|header|cookie|resource|link|sitemap|robots/i.test(title) ? 'network' : 'source_html';
  checks.push({ id: special.get(title) || `${category}.${subcategory}.${slug(title)}`, title, description: title, primaryCategory: category, subcategory, tags: [], sourceReference: `${section} > ${title}`, scope: /DNS|hostname|domain|robots|sitemap/i.test(title) ? 'property' : 'page', applicability: 'Evaluate when the referenced element or resource is present; otherwise return not_applicable.', executionMethod, measurements: [], timeoutClass: executionMethod === 'rendered_browser' || executionMethod === 'lab' ? 'expensive' : executionMethod === 'network' ? 'bounded_network' : 'fast', thresholds: {}, severity: /detected|fail|invalid|broken|missing|empty|noindex|insecure|restrict/i.test(title) ? 'medium' : 'informational', recommendation: `Review: ${title}.`, weight: /recorded|identified|detected|measured|declared/i.test(title) ? 0 : 1, informational: /recorded|identified|measured|detected/i.test(title), logicVersion: '1.0.0', configurationVersion: 1, lifecycle: 'active', replacementCheckId: null, implementationStatus: special.has(title) ? 'implemented' : 'mapped', verificationStatus: special.has(title) ? 'unit_pending' : 'not_verified' });
}
const header = `// Generated from docs/audit-checklist-source.md. Do not hand edit.\nexport type AuditCheck = { id:string; title:string; description:string; primaryCategory:string; subcategory:string; tags:string[]; sourceReference:string; scope:string; applicability:string; executionMethod:string; measurements:string[]; timeoutClass:string; thresholds:Record<string,number>; severity:string; recommendation:string; weight:number; informational:boolean; logicVersion:string; configurationVersion:number; lifecycle:'draft'|'active'|'disabled'|'deprecated'|'retired'; replacementCheckId:string|null; implementationStatus:string; verificationStatus:string };\nexport const AUDIT_REGISTRY: AuditCheck[] = `;
fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'shared', 'audit-registry.generated.ts'), header + JSON.stringify(checks, null, 2) + ';\n');
const cols = ['sourceReference','id','primaryCategory','subcategory','executionMethod','implementationStatus','verificationStatus'];
const csv = [cols.join(','), ...checks.map(c => cols.map(k => `"${String(c[k]).replaceAll('"','""')}"`).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(root, 'docs', 'audit-check-map.csv'), csv);
fs.writeFileSync(path.join(root, 'docs', 'audit-registry.json'), JSON.stringify({ schemaVersion: 1, sourceVersion: '2026-10-01', sourceCount: checks.length, checks }, null, 2) + '\n');
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pgArray = (values) => values.length ? `array[${values.map(sql).join(',')}]::text[]` : `array[]::text[]`;
const seedRows = checks.map(c => `(${[c.id,c.title,c.description,c.primaryCategory,c.subcategory,c.sourceReference,c.scope,c.applicability,c.executionMethod,c.timeoutClass,c.severity,c.recommendation,c.logicVersion].map(sql).join(',')},${pgArray(c.tags)},${pgArray(c.measurements)},${sql(JSON.stringify(c.thresholds))}::jsonb,${c.weight},${c.informational},${c.configurationVersion},${sql(c.lifecycle)}::public.check_lifecycle)`).join(',\n');
fs.mkdirSync(path.join(root, 'supabase', 'seed'), { recursive: true });
fs.writeFileSync(path.join(root, 'supabase', 'seed', '010_audit_registry.sql'), `-- Generated from the authoritative checklist.\ninsert into public.audit_check_definitions(id,title,description,primary_category,subcategory,source_reference,scope,applicability,execution_method,timeout_class,severity,recommendation,logic_version,tags,measurements,thresholds,weight,informational,configuration_version,lifecycle) values\n${seedRows}\non conflict(id) do update set title=excluded.title,description=excluded.description,primary_category=excluded.primary_category,subcategory=excluded.subcategory,source_reference=excluded.source_reference,scope=excluded.scope,applicability=excluded.applicability,execution_method=excluded.execution_method,timeout_class=excluded.timeout_class,severity=excluded.severity,recommendation=excluded.recommendation,logic_version=excluded.logic_version,tags=excluded.tags,measurements=excluded.measurements,thresholds=excluded.thresholds,weight=excluded.weight,informational=excluded.informational,configuration_version=excluded.configuration_version,lifecycle=excluded.lifecycle,changed_at=now();\n`);
console.log(`Generated ${checks.length} mapped audit checks.`);
