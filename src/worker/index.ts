import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { AUDIT_REGISTRY } from '../shared/audit-registry.generated';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  APP_ORIGIN: string;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;
};
type Variables = { db: SupabaseClient; userId: string };
type Job = { type: 'audit' | 'uptime'; id: string };
type CheckOutcome = 'pass' | 'warning' | 'fail' | 'informational' | 'not_applicable' | 'unable_to_test';
type AuditResult = { check_id: string; outcome: CheckOutcome; evidence: Record<string, unknown>; duration_ms: number };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', secureHeaders());
app.use('/collect', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 }));

function admin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

app.get('/health', (c) => c.json({ ok: true, service: 'claritude', time: new Date().toISOString() }));
app.get('/api/config', (c) => c.json({ supabaseUrl: c.env.SUPABASE_URL, supabaseKey: c.env.SUPABASE_PUBLISHABLE_KEY, appOrigin: c.env.APP_ORIGIN }));

app.get('/tracker.js', (c) => {
  c.header('content-type', 'application/javascript; charset=utf-8');
  c.header('cache-control', 'public, max-age=3600');
  return c.body(TRACKER_SOURCE);
});

app.post('/collect', async (c) => {
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > 32_768) return c.json({ error: 'payload_too_large' }, 413);
  let input: any;
  try { input = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const events = Array.isArray(input) ? input.slice(0, 20) : [input];
  const trackingId = String(events[0]?.property || '').slice(0, 80);
  if (!/^cl_[a-zA-Z0-9_-]{12,64}$/.test(trackingId)) return c.json({ error: 'invalid_property' }, 400);
  const db = admin(c.env);
  const { data: property } = await db.from('properties').select('id,canonical_host,tracking_enabled').eq('tracking_id', trackingId).maybeSingle();
  if (!property?.tracking_enabled) return c.json({ error: 'unknown_property' }, 404);
  const origin = c.req.header('origin');
  if (origin && new URL(origin).hostname !== property.canonical_host) return c.json({ error: 'origin_mismatch' }, 403);
  const now = new Date().toISOString();
  const rows = events.map((e: any) => sanitizeEvent(e, property.id, now)).filter(Boolean);
  if (!rows.length) return c.json({ error: 'no_valid_events' }, 400);
  const { error } = await db.from('analytics_events').insert(rows);
  if (error) return c.json({ error: 'ingestion_failed' }, 503);
  await db.from('properties').update({ tracking_last_received_at: now }).eq('id', property.id);
  return c.body(null, 202);
});

app.use('/api/*', async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'authentication_required' }, 401);
  const db = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'invalid_session' }, 401);
  c.set('db', db); c.set('userId', data.user.id);
  await next();
});

app.get('/api/bootstrap', async (c) => {
  const db = c.get('db');
  const [profile, accounts, workspaces, properties, incidents, notifications] = await Promise.all([
    db.from('profiles').select('*').maybeSingle(),
    db.from('account_memberships').select('role,accounts(*)'),
    db.from('workspace_memberships').select('role,workspaces(*)'),
    db.from('properties').select('*,uptime_monitors(*),audit_runs(id,status,score,coverage,created_at)').order('created_at'),
    db.from('incidents').select('*').order('opened_at', { ascending: false }).limit(50),
    db.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  const firstError = [profile, accounts, workspaces, properties, incidents, notifications].find((x) => x.error)?.error;
  if (firstError) return c.json({ error: firstError.message }, 500);
  return c.json({ profile: profile.data, accounts: accounts.data, workspaces: workspaces.data, properties: properties.data, incidents: incidents.data, notifications: notifications.data });
});

app.post('/api/onboarding', async (c) => {
  const body = await c.req.json<{ accountName: string; workspaceName: string; propertyName?: string; url?: string }>();
  if (!body.accountName?.trim() || !body.workspaceName?.trim()) return c.json({ error: 'account_and_workspace_required' }, 400);
  const { data, error } = await c.get('db').rpc('complete_onboarding', {
    p_account_name: body.accountName.trim().slice(0, 100), p_workspace_name: body.workspaceName.trim().slice(0, 100),
    p_property_name: body.propertyName?.trim().slice(0, 100) || null, p_url: body.url || null,
  });
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post('/api/properties', async (c) => {
  const b = await c.req.json<{ workspaceId: string; name: string; url: string }>();
  const target = validPublicUrl(b.url);
  if (!target) return c.json({ error: 'public_http_url_required' }, 400);
  const trackingId = `cl_${crypto.randomUUID().replaceAll('-', '')}`;
  const { data, error } = await c.get('db').from('properties').insert({ workspace_id: b.workspaceId, name: b.name?.trim().slice(0, 100), url: target.href, canonical_host: target.hostname, tracking_id: trackingId }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.post('/api/properties/:id/verify', async (c) => {
  const db = c.get('db');
  const { data: property, error } = await db.from('properties').select('id,url,tracking_id').eq('id', c.req.param('id')).single();
  if (error || !property) return c.json({ error: 'property_not_found' }, 404);
  try {
    const res = await safeFetch(property.url, { method: 'GET', headers: { 'user-agent': 'Claritude-Verification/1.0' } });
    const html = (await limitedText(res, 1_000_000)).toLowerCase();
    const verified = html.includes(property.tracking_id.toLowerCase()) || res.headers.get('x-claritude-verification') === property.tracking_id;
    await db.from('properties').update({ verification_status: verified ? 'verified' : 'pending', verified_at: verified ? new Date().toISOString() : null }).eq('id', property.id);
    return c.json({ verified, method: html.includes(property.tracking_id.toLowerCase()) ? 'tracking_script' : 'header' });
  } catch (e) { return c.json({ verified: false, error: errorMessage(e) }, 422); }
});

app.post('/api/audits', async (c) => {
  const b = await c.req.json<{ propertyId: string; pageUrl?: string }>();
  const db = c.get('db');
  const { data: property } = await db.from('properties').select('id,url').eq('id', b.propertyId).single();
  if (!property) return c.json({ error: 'property_not_found' }, 404);
  const target = validPublicUrl(b.pageUrl || property.url);
  if (!target || target.hostname !== new URL(property.url).hostname) return c.json({ error: 'page_must_belong_to_property' }, 400);
  const snapshot = AUDIT_REGISTRY.filter((x) => x.lifecycle === 'active').map(({ id, logicVersion, configurationVersion, title, weight }) => ({ id, logicVersion, configurationVersion, title, weight }));
  const { data: run, error } = await db.from('audit_runs').insert({ property_id: property.id, page_url: target.href, status: 'queued', registry_snapshot: snapshot, scoring_version: '1.0.0' }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await c.env.JOBS.send({ type: 'audit', id: run.id });
  return c.json(run, 202);
});

app.get('/api/properties/:id/audits', async (c) => {
  const { data, error } = await c.get('db').from('audit_runs').select('*,audit_results(*)').eq('property_id', c.req.param('id')).order('created_at', { ascending: false }).limit(20);
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post('/api/monitors/:id/check', async (c) => {
  const { data, error } = await c.get('db').from('uptime_monitors').select('id').eq('id', c.req.param('id')).single();
  if (error || !data) return c.json({ error: 'monitor_not_found' }, 404);
  await c.env.JOBS.send({ type: 'uptime', id: data.id });
  return c.json({ status: 'queued' }, 202);
});

app.patch('/api/monitors/:id', async (c) => {
  const allowed = (({ enabled, interval_minutes, timeout_ms, expected_status_min, expected_status_max, failure_threshold }: any) => ({ enabled, interval_minutes, timeout_ms, expected_status_min, expected_status_max, failure_threshold }))(await c.req.json());
  const { data, error } = await c.get('db').from('uptime_monitors').update(allowed).eq('id', c.req.param('id')).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.get('/api/properties/:id/analytics', async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') || 30)));
  const { data, error } = await c.get('db').rpc('analytics_summary', { p_property_id: c.req.param('id'), p_from: new Date(Date.now() - days * 864e5).toISOString(), p_to: new Date().toISOString() });
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.get('/api/properties/:id/report', async (c) => {
  const db = c.get('db'); const id = c.req.param('id');
  const [property, incidents, audits, analytics] = await Promise.all([
    db.from('properties').select('*').eq('id', id).single(), db.from('incidents').select('*').eq('property_id', id).order('opened_at', { ascending: false }).limit(20),
    db.from('audit_runs').select('*').eq('property_id', id).order('created_at', { ascending: false }).limit(5), db.rpc('analytics_summary', { p_property_id: id, p_from: new Date(Date.now() - 30 * 864e5).toISOString(), p_to: new Date().toISOString() }),
  ]);
  if (property.error) return c.json({ error: 'property_not_found' }, 404);
  return c.json({ generatedAt: new Date().toISOString(), period: 'Last 30 days', property: property.data, incidents: incidents.data, audits: audits.data, analytics: analytics.data, limitations: ['Visitor totals are aggregate estimates; no persistent visitor identifiers are used.'] });
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

async function runAudit(env: Env, id: string) {
  const db = admin(env); const started = Date.now();
  const { data: run } = await db.from('audit_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', id).select().single();
  if (!run) return;
  try {
    const res = await safeFetch(run.page_url, { headers: { 'user-agent': 'Claritude-Audit/1.0 (+https://claritude.io)' } });
    const html = await limitedText(res, 2_000_000); const results = evaluateSourceChecks(run.registry_snapshot, res, html);
    await db.from('audit_results').insert(results.map((r) => ({ ...r, audit_run_id: id, logic_version: registry(r.check_id)?.logicVersion || '1.0.0', configuration_version: registry(r.check_id)?.configurationVersion || 1, title_snapshot: registry(r.check_id)?.title || r.check_id })));
    const scored = results.filter((r) => ['pass', 'warning', 'fail'].includes(r.outcome));
    const score = scored.length ? Math.round(scored.reduce((n, r) => n + (r.outcome === 'pass' ? 1 : r.outcome === 'warning' ? .5 : 0), 0) / scored.length * 100) : null;
    await db.from('audit_runs').update({ status: results.some((r) => r.outcome === 'unable_to_test') ? 'partial' : 'completed', score, coverage: Math.round(scored.length / results.length * 100), completed_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq('id', id);
  } catch (e) { await db.from('audit_runs').update({ status: 'failed', error: errorMessage(e), completed_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq('id', id); }
}

function evaluateSourceChecks(snapshot: any[], res: Response, html: string): AuditResult[] {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1];
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const checks: Record<string, () => [CheckOutcome, Record<string, unknown>]> = {
    'seo.metadata.title.present': () => [title ? 'pass' : 'fail', { title: title || null }],
    'seo.metadata.title.not_empty': () => [title ? 'pass' : 'fail', { length: title?.length || 0 }],
    'seo.metadata.title.length': () => [!title ? 'not_applicable' : title.length <= 60 ? 'pass' : 'warning', { length: title?.length || 0, threshold: 60 }],
    'seo.metadata.description.present': () => [desc !== undefined ? 'pass' : 'fail', { present: desc !== undefined }],
    'seo.metadata.description.not_empty': () => [desc ? 'pass' : desc === undefined ? 'not_applicable' : 'fail', { length: desc?.length || 0 }],
    'seo.crawling.http_status': () => [res.ok ? 'pass' : res.status >= 500 ? 'fail' : 'warning', { status: res.status }],
    'seo.crawling.html_content': () => [(res.headers.get('content-type') || '').includes('text/html') ? 'pass' : 'fail', { contentType: res.headers.get('content-type') }],
    'seo.content.h1.present': () => [h1s.length ? 'pass' : 'fail', { count: h1s.length }],
    'seo.content.h1.multiple': () => [h1s.length <= 1 ? 'pass' : 'warning', { count: h1s.length }],
    'accessibility.document.title': () => [title ? 'pass' : 'fail', { title: title || null }],
    'accessibility.mobile.viewport': () => [/<meta[^>]+name=["']viewport["']/i.test(html) ? 'pass' : 'fail', {}],
    'security.https.selected': () => [res.url.startsWith('https://') ? 'pass' : 'fail', { finalUrl: res.url }],
    'security.headers.hsts': () => [res.headers.has('strict-transport-security') ? 'pass' : 'warning', { value: res.headers.get('strict-transport-security') }],
    'security.headers.csp': () => [res.headers.has('content-security-policy') ? 'pass' : 'warning', { value: res.headers.get('content-security-policy') }],
    'infrastructure.http.content_type': () => ['informational', { value: res.headers.get('content-type') }],
    'ai.content.source_extractable': () => [/<main\b/i.test(html) && stripText(html).length > 100 ? 'pass' : 'warning', { textLength: stripText(html).length }],
  };
  return snapshot.map((s) => {
    const t = performance.now(); const fn = checks[s.id];
    const [outcome, evidence] = fn ? fn() : ['unable_to_test' as CheckOutcome, { reason: methodReason(registry(s.id)?.executionMethod) }];
    return { check_id: s.id, outcome, evidence, duration_ms: Math.max(0, Math.round(performance.now() - t)) };
  });
}

async function runUptime(env: Env, id: string) {
  const db = admin(env); const { data: monitor } = await db.from('uptime_monitors').select('*,properties(*)').eq('id', id).single();
  if (!monitor?.enabled) return;
  const started = Date.now(); let status: number | null = null, ok = false, failure: string | null = null;
  try { const r = await safeFetch(monitor.properties.url, { method: 'GET', headers: { 'user-agent': 'Claritude-Uptime/1.0' }, signal: AbortSignal.timeout(monitor.timeout_ms) }); status = r.status; ok = status >= monitor.expected_status_min && status <= monitor.expected_status_max; } catch (e) { failure = errorMessage(e); }
  const checkedAt = new Date().toISOString(); await db.from('uptime_checks').insert({ monitor_id: id, checked_at: checkedAt, success: ok, status_code: status, response_ms: Date.now() - started, error_code: failure });
  const failures = ok ? 0 : (monitor.consecutive_failures || 0) + 1;
  await db.from('uptime_monitors').update({ last_checked_at: checkedAt, last_status: ok ? 'online' : 'offline', last_response_ms: Date.now() - started, consecutive_failures: failures, next_check_at: new Date(Date.now() + monitor.interval_minutes * 60_000).toISOString() }).eq('id', id);
  const { data: open } = await db.from('incidents').select('*').eq('monitor_id', id).is('resolved_at', null).maybeSingle();
  if (!ok && failures >= monitor.failure_threshold && !open) {
    const { data: incident } = await db.from('incidents').insert({ property_id: monitor.property_id, monitor_id: id, opened_at: checkedAt, cause: failure || `HTTP ${status}` }).select().single();
    if (incident) await sendAlert(env, db, incident, 'down');
  } else if (ok && open) {
    await db.from('incidents').update({ resolved_at: checkedAt }).eq('id', open.id); await sendAlert(env, db, { ...open, resolved_at: checkedAt }, 'recovered');
  }
}

async function sendAlert(env: Env, db: SupabaseClient, incident: any, kind: 'down' | 'recovered') {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return;
  const { data: recipients } = await db.from('alert_recipients').select('email').eq('property_id', incident.property_id).eq('enabled', true);
  for (const r of recipients || []) {
    const key = `${incident.id}:${kind}:${r.email}`; const { data: claimed } = await db.rpc('claim_notification', { p_key: key, p_kind: `uptime_${kind}`, p_recipient: r.email, p_payload: incident }); if (!claimed) continue;
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ from: env.RESEND_FROM, to: [r.email], subject: kind === 'down' ? 'Claritude downtime alert' : 'Claritude recovery notice', html: `<h1>${kind === 'down' ? 'Website unavailable' : 'Website recovered'}</h1><p>${kind === 'down' ? 'Claritude opened an incident after the configured failure threshold.' : 'Claritude confirmed a successful response and closed the incident.'}</p>` }) });
    await db.from('notification_deliveries').update({ status: response.ok ? 'sent' : 'failed', provider_id: response.headers.get('x-message-id'), error: response.ok ? null : await response.text() }).eq('dedupe_key', key);
  }
}

async function scheduled(env: Env, cron: string) {
  const db = admin(env);
  if (cron === '*/5 * * * *') { const { data } = await db.from('uptime_monitors').select('id').eq('enabled', true).lte('next_check_at', new Date().toISOString()).limit(100); await Promise.all((data || []).map((m) => env.JOBS.send({ type: 'uptime', id: m.id }))); }
  else await db.rpc('aggregate_analytics_day', { p_day: new Date(Date.now() - 864e5).toISOString().slice(0, 10) });
}

function sanitizeEvent(e: any, propertyId: string, receivedAt: string) {
  const kinds = ['pageview', 'click', 'outbound', 'scroll', 'active_time', 'form_success', 'web_vital']; if (!kinds.includes(e?.type)) return null;
  const path = cleanPath(e.path); if (!path) return null;
  return { property_id: propertyId, event_type: e.type, path, referrer_host: cleanHost(e.referrer), source: String(e.source || '').slice(0, 80) || null, device: ['desktop', 'mobile', 'tablet'].includes(e.device) ? e.device : null, country_code: /^[A-Z]{2}$/.test(e.country || '') ? e.country : null, name: String(e.name || '').slice(0, 80) || null, value: Number.isFinite(e.value) ? Math.max(0, Math.min(600000, Number(e.value))) : null, metadata: safeMetadata(e.meta), occurred_at: validDate(e.at) || receivedAt, received_at: receivedAt };
}
function cleanPath(v: unknown) { try { const u = new URL(String(v), 'https://invalid.local'); return (u.pathname || '/').slice(0, 500); } catch { return null; } }
function cleanHost(v: unknown) { try { return v ? new URL(String(v)).hostname.slice(0, 255) : null; } catch { return null; } }
function safeMetadata(v: any) { const out: Record<string, string | number | boolean> = {}; if (v && typeof v === 'object') for (const [k, x] of Object.entries(v).slice(0, 12)) if (/^[a-zA-Z0-9_-]{1,40}$/.test(k) && ['string','number','boolean'].includes(typeof x)) out[k] = typeof x === 'string' ? x.slice(0, 200) : x as any; return out; }
function validDate(v: unknown) { const d = new Date(String(v)); return Number.isFinite(d.valueOf()) && Math.abs(Date.now() - d.valueOf()) < 864e5 ? d.toISOString() : null; }
function validPublicUrl(value: string) { try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || isPrivateHost(u.hostname)) return null; return u; } catch { return null; } }
function isPrivateHost(h: string) { const x = h.toLowerCase().replace(/\.$/, ''); return x === 'localhost' || x.endsWith('.local') || x.endsWith('.internal') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x) || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:'); }
async function safeFetch(value: string, init: RequestInit = {}) { let url = validPublicUrl(value); if (!url) throw new Error('Target must be a public HTTP or HTTPS URL'); for (let i = 0; i < 5; i++) { const response = await fetch(url, { ...init, redirect: 'manual', signal: init.signal || AbortSignal.timeout(15000) }); if (![301,302,303,307,308].includes(response.status)) return response; const next = validPublicUrl(new URL(response.headers.get('location') || '', url).href); if (!next) throw new Error('Redirect target is not permitted'); url = next; } throw new Error('Redirect limit exceeded'); }
async function limitedText(res: Response, max: number) { const length = Number(res.headers.get('content-length') || 0); if (length > max) throw new Error('Response exceeded size limit'); const text = await res.text(); if (text.length > max) throw new Error('Response exceeded size limit'); return text; }
function stripText(html: string) { return html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function registry(id: string) { return AUDIT_REGISTRY.find((x) => x.id === id); }
function methodReason(method?: string) { return method === 'rendered_browser' || method === 'lab' ? `${method} execution requires Cloudflare Browser Rendering, which is not configured in Stage 1 preview` : 'This catalogue entry is mapped but its execution module is not yet implemented'; }
function errorMessage(e: unknown) { return e instanceof Error ? e.message.slice(0, 500) : 'unknown_error'; }

const TRACKER_SOURCE = `(()=>{const s=document.currentScript,p=s&&s.dataset.property,endpoint=new URL('/collect',s.src).href;if(!p||window.__claritude)return;window.__claritude=1;let q=[],timer;const send=()=>{if(!q.length)return;const body=JSON.stringify(q.splice(0,20));if(navigator.sendBeacon&&document.visibilityState==='hidden')navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'}));else fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{})};const emit=(type,data={})=>{q.push({type,property:p,path:location.pathname,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',...data});clearTimeout(timer);timer=setTimeout(send,800)};emit('pageview');let last=location.href;new MutationObserver(()=>{if(location.href!==last){last=location.href;emit('pageview')}}).observe(document,{subtree:true,childList:true});addEventListener('popstate',()=>emit('pageview'));addEventListener('click',e=>{const a=e.target.closest('[data-claritude-event],a[href]');if(!a)return;const name=a.dataset.claritudeEvent;if(name)emit('click',{name});if(a.href&&new URL(a.href,location.href).host!==location.host)emit('outbound',{name:new URL(a.href).host})},{passive:true});[25,50,75,100].forEach(n=>{});let marks=new Set;addEventListener('scroll',()=>{const n=Math.round((scrollY+innerHeight)/document.documentElement.scrollHeight*100);[25,50,75,100].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);emit('scroll',{value:x})}})},{passive:true});let active=0,tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus())active+=5;if(active&&active%30===0)emit('active_time',{value:active})},5000);addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')send()});addEventListener('pagehide',()=>{clearInterval(tick);if(active)emit('active_time',{value:active});send()});window.claritude={event:(name,meta)=>emit('click',{name,meta}),formSuccess:(name,meta)=>emit('form_success',{name,meta})};if('PerformanceObserver'in window)try{new PerformanceObserver(l=>l.getEntries().forEach(e=>emit('web_vital',{name:e.name==='largest-contentful-paint'?'LCP':e.name,value:e.startTime||e.duration}))).observe({type:'largest-contentful-paint',buffered:true})}catch{}})();`;

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<Job>, env: Env) => { for (const message of batch.messages) { try { message.body.type === 'audit' ? await runAudit(env, message.body.id) : await runUptime(env, message.body.id); message.ack(); } catch { message.retry(); } } },
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(env, event.cron)),
};
