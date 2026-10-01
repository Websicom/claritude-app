const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dfaxmxschvzmlozxjaxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_zNc8TQjoFQ-OI2nKbiNOPA_5ukCoCY6';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const WORKER_URL = (process.env.WORKER_URL || 'https://claritude-app.morning-sea-c704.workers.dev').replace(/\/$/, '');
const DELIVERY_ADDRESS = process.env.DELIVERY_ADDRESS || 'delivered@resend.dev';

if (!SUPABASE_SECRET_KEY) throw new Error('SUPABASE_SECRET_KEY is required');

const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const password = `Cl4ritude-${crypto.randomUUID()}!`;
const authDeliveryAddress = `delivered+claritude-${stamp}@resend.dev`;
const createdUsers = [];
const createdAccounts = [];
const checks = {};
let registryRestored = true;
let emailTestUserId = null;

async function request(url, init = {}, expected = [200]) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!expected.includes(response.status)) throw new Error(`${init.method || 'GET'} ${url}: ${response.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`);
  return { response, body };
}

function adminHeaders(extra = {}) {
  return { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'content-type': 'application/json', ...extra };
}

function userHeaders(token, extra = {}) {
  return { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

async function createUser(label) {
  const email = `claritude-stage1-${label}-${stamp}@example.com`;
  const { body: user } = await request(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Stage 1 ${label}` } }),
  }, [200, 201]);
  createdUsers.push(user.id);
  const { body: session } = await request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return { id: user.id, email, token: session.access_token };
}

async function worker(path, token, init = {}, expected = [200]) {
  return (await request(`${WORKER_URL}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } }, expected)).body;
}

async function onboard(user, label, url) {
  const data = await worker('/api/onboarding', user.token, {
    method: 'POST', body: JSON.stringify({ accountName: `Stage 1 ${label}`, workspaceName: 'Acceptance', propertyName: `${label} property`, url }),
  });
  createdAccounts.push(data.accountId);
  return data;
}

async function poll(fn, predicate, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
}

async function rest(path, token, init = {}, expected = [200, 201, 204]) {
  return request(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: userHeaders(token, init.headers || {}) }, expected);
}

async function adminRest(path, init = {}, expected = [200, 201, 204]) {
  return request(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: adminHeaders(init.headers || {}) }, expected);
}

async function runAudit(user, propertyId) {
  const run = await worker('/api/audits', user.token, { method: 'POST', body: JSON.stringify({ propertyId }) }, [202]);
  const runs = await poll(
    () => worker(`/api/properties/${propertyId}/audits`, user.token),
    (items) => ['completed', 'partial', 'failed'].includes(items.find((item) => item.id === run.id)?.status),
    `audit ${run.id}`,
  );
  return runs.find((item) => item.id === run.id);
}

try {
  const userA = await createUser('a');
  const userB = await createUser('b');
  const userC = await createUser('c');
  const a = await onboard(userA, 'Tenant A', WORKER_URL);
  const b = await onboard(userB, 'Tenant B', 'https://example.com');
  const c = await onboard(userC, 'Uptime', 'https://httpbin.org/status/503');

  const [bootstrapA, bootstrapB] = await Promise.all([
    worker('/api/bootstrap', userA.token), worker('/api/bootstrap', userB.token),
  ]);
  checks.onboardingAndPro = bootstrapA.accounts[0]?.accounts?.entitlement === 'pro_early_access';
  checks.separateTenants = bootstrapA.accounts[0]?.accounts?.id !== bootstrapB.accounts[0]?.accounts?.id;
  const forbiddenProperty = await rest(`properties?id=eq.${a.propertyId}&select=id`, userB.token);
  const crossTenantAudit = await request(`${WORKER_URL}/api/audits`, {
    method: 'POST', headers: { authorization: `Bearer ${userB.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: a.propertyId }),
  }, [404]);
  checks.tenantIsolation = forbiddenProperty.body.length === 0 && crossTenantAudit.response.status === 404;

  const primary = bootstrapA.properties.find((property) => property.id === a.propertyId);
  await request(`${WORKER_URL}/collect`, {
    method: 'POST', headers: { origin: WORKER_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'pageview', property: primary.tracking_id, path: '/stage-1-acceptance', source: 'acceptance', device: 'desktop', at: new Date().toISOString() }),
  }, [202]);
  const analytics = await poll(() => worker(`/api/properties/${a.propertyId}/analytics?days=1`, userA.token), (value) => value.pageviews >= 1, 'analytics ingestion');
  checks.analyticsIngestion = analytics.pageviews >= 1 && analytics.pages.includes('/stage-1-acceptance');

  const verificationProperty = await worker('/api/properties', userA.token, {
    method: 'POST', body: JSON.stringify({ workspaceId: a.workspaceId, name: 'Verification property', url: 'https://httpbingo.org/response-headers' }),
  }, [201]);
  const verificationUrl = `https://httpbingo.org/response-headers?x-claritude-verification=${encodeURIComponent(verificationProperty.tracking_id)}`;
  await rest(`properties?id=eq.${verificationProperty.id}`, userA.token, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ url: verificationUrl }) });
  const verification = await worker(`/api/properties/${verificationProperty.id}/verify`, userA.token, { method: 'POST', body: '{}' });
  checks.propertyVerification = verification.verified === true && ['header', 'tracking_script'].includes(verification.method);

  const disabledCheck = 'seo.metadata.title.present';
  await adminRest(`audit_check_definitions?id=eq.${disabledCheck}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lifecycle: 'disabled', disabled_reason: 'Stage 1 acceptance test' }),
  });
  registryRestored = false;
  const disabledRun = await runAudit(userA, a.propertyId);
  await adminRest(`audit_check_definitions?id=eq.${disabledCheck}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lifecycle: 'active', disabled_reason: null }),
  });
  registryRestored = true;
  const enabledRun = await runAudit(userA, a.propertyId);
  checks.auditQueue = ['completed', 'partial'].includes(enabledRun.status) && enabledRun.audit_results.length > 0;
  checks.registryToggle = !disabledRun.registry_snapshot.some((item) => item.id === disabledCheck)
    && enabledRun.registry_snapshot.some((item) => item.id === disabledCheck);
  checks.snapshotVersions = enabledRun.audit_results.every((result) => result.logic_version && result.configuration_version >= 1 && result.title_snapshot);

  const bootstrapC = await worker('/api/bootstrap', userC.token);
  const outageProperty = bootstrapC.properties.find((property) => property.id === c.propertyId);
  const { body: outageMonitors } = await adminRest(`uptime_monitors?property_id=eq.${c.propertyId}&select=id,consecutive_failures`);
  if (!outageProperty || outageMonitors.length !== 1) throw new Error('Onboarding did not create the uptime property and monitor');
  const monitorId = outageMonitors[0].id;
  await rest('alert_recipients', userC.token, {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ property_id: c.propertyId, email: DELIVERY_ADDRESS }),
  });
  await worker(`/api/monitors/${monitorId}/check`, userC.token, { method: 'POST', body: '{}' }, [202]);
  await poll(
    () => adminRest(`uptime_monitors?id=eq.${monitorId}&select=consecutive_failures`).then((result) => result.body[0]),
    (monitor) => monitor?.consecutive_failures >= 1,
    'first uptime failure',
  );
  await worker(`/api/monitors/${monitorId}/check`, userC.token, { method: 'POST', body: '{}' }, [202]);
  const downState = await poll(() => worker('/api/bootstrap', userC.token), (data) => data.incidents.some((incident) => incident.property_id === c.propertyId && !incident.resolved_at), 'incident opening');
  await rest(`properties?id=eq.${c.propertyId}`, userC.token, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ url: 'https://httpbin.org/status/200' }),
  });
  await worker(`/api/monitors/${monitorId}/check`, userC.token, { method: 'POST', body: '{}' }, [202]);
  const recoveredState = await poll(() => worker('/api/bootstrap', userC.token), (data) => data.incidents.some((incident) => incident.property_id === c.propertyId && incident.resolved_at), 'incident recovery');
  const incident = recoveredState.incidents.find((item) => item.property_id === c.propertyId);
  const { body: deliveries } = await adminRest(`notification_deliveries?dedupe_key=like.${incident.id}%25&select=kind,status,provider_id,error`);
  checks.uptimeIncidentRecovery = downState.incidents.some((item) => item.id === incident.id) && Boolean(incident.resolved_at);
  checks.alertDelivery = deliveries.length === 2 && deliveries.every((delivery) => delivery.status === 'sent');

  const { body: signup } = await request(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: authDeliveryAddress, password: `Mail-${password}`, data: { full_name: 'Claritude Email Test' } }),
  }, [200]);
  emailTestUserId = signup.user?.id || signup.id || null;
  checks.registrationEmailAccepted = Boolean(emailTestUserId);
  if (emailTestUserId) {
    await request(`${SUPABASE_URL}/auth/v1/admin/users/${emailTestUserId}`, {
      method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ email_confirm: true }),
    });
    await request(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${WORKER_URL}/reset-password`)}`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: authDeliveryAddress }),
    });
    checks.passwordResetAccepted = true;
  }

  if (Object.values(checks).some((value) => value !== true)) throw new Error(`Acceptance assertion failed: ${JSON.stringify({ checks, verification, signup })}`);
  console.log(JSON.stringify({ ok: true, worker: WORKER_URL, checks, audit: { status: enabledRun.status, score: enabledRun.score, coverage: enabledRun.coverage, results: enabledRun.audit_results.length }, deliveries }, null, 2));
} finally {
  if (!registryRestored) {
    await adminRest('audit_check_definitions?id=eq.seo.metadata.title.present', {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lifecycle: 'active', disabled_reason: null }),
    }).catch(() => {});
  }
  for (const accountId of createdAccounts) {
    await adminRest(`accounts?id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (emailTestUserId) createdUsers.push(emailTestUserId);
  for (const userId of createdUsers) {
    await request(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders() }, [200, 204]).catch(() => {});
  }
}
