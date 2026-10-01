import fs from 'node:fs';
import path from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
const { checks } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../docs/audit-registry.json'), 'utf8'));
const rows = checks.map((x) => ({ id:x.id,title:x.title,description:x.description,primary_category:x.primaryCategory,subcategory:x.subcategory,tags:x.tags,source_reference:x.sourceReference,scope:x.scope,applicability:x.applicability,execution_method:x.executionMethod,measurements:x.measurements,timeout_class:x.timeoutClass,thresholds:x.thresholds,severity:x.severity,recommendation:x.recommendation,weight:x.weight,informational:x.informational,logic_version:x.logicVersion,configuration_version:x.configurationVersion,lifecycle:x.lifecycle }));
for (let i=0;i<rows.length;i+=100) {
  const response=await fetch(`${url}/rest/v1/audit_check_definitions?on_conflict=id`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',prefer:'resolution=merge-duplicates'},body:JSON.stringify(rows.slice(i,i+100))});
  if(!response.ok) throw new Error(`Registry seed failed: ${response.status} ${await response.text()}`);
}
console.log(`Seeded ${rows.length} audit checks.`);
