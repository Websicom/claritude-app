import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";
import {
  buildRegistrySnapshot,
  scoreAuditResults,
  type AuditRegistrySnapshot,
} from "../shared/audit-runtime";

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
type Job = { type: "audit" | "uptime"; id: string };
type CheckOutcome =
  | "pass"
  | "warning"
  | "fail"
  | "informational"
  | "not_applicable"
  | "unable_to_test";
type AuditResult = {
  check_id: string;
  outcome: CheckOutcome;
  evidence: Record<string, unknown>;
  duration_ms: number;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", secureHeaders());
app.use(
  "/collect",
  cors({ origin: "*", allowMethods: ["POST", "OPTIONS"], maxAge: 86400 }),
);

function admin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

app.get("/health", (c) =>
  c.json({ ok: true, service: "claritude", time: new Date().toISOString() }),
);
app.get("/api/config", (c) =>
  c.json({
    supabaseUrl: c.env.SUPABASE_URL,
    supabaseKey: c.env.SUPABASE_PUBLISHABLE_KEY,
    appOrigin: c.env.APP_ORIGIN,
  }),
);

const serveTracker = (c: any) => {
  c.header("content-type", "application/javascript; charset=utf-8");
  c.header("cache-control", "public, max-age=3600");
  return c.body(TRACKER_SOURCE);
};
app.get("/tracker.js", serveTracker);
app.get("/c.js", serveTracker);

app.post("/collect", async (c) => {
  const contentLength = Number(c.req.header("content-length") || 0);
  if (contentLength > 32_768)
    return c.json({ error: "payload_too_large" }, 413);
  let input: any;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const events = Array.isArray(input) ? input.slice(0, 20) : [input];
  const trackingId = String(events[0]?.property || "").slice(0, 80);
  if (!/^cl_[a-zA-Z0-9_-]{12,64}$/.test(trackingId))
    return c.json({ error: "invalid_property" }, 400);
  const db = admin(c.env);
  const { data: property } = await db
    .from("properties")
    .select("id,canonical_host,tracking_enabled")
    .eq("tracking_id", trackingId)
    .maybeSingle();
  if (!property?.tracking_enabled)
    return c.json({ error: "unknown_property" }, 404);
  const origin = c.req.header("origin");
  if (origin && new URL(origin).hostname !== property.canonical_host)
    return c.json({ error: "origin_mismatch" }, 403);
  const now = new Date().toISOString();
  const requestCountry = String(
    (c.req.raw as Request & { cf?: { country?: string } }).cf?.country || "",
  ).toUpperCase();
  const userAgent = c.req.header("user-agent") || "";
  const rows = events
    .map((e: any) =>
      sanitizeEvent(e, property.id, now, requestCountry, userAgent),
    )
    .filter(Boolean);
  if (!rows.length) return c.json({ error: "no_valid_events" }, 400);
  const { error } = await db.from("analytics_events").insert(rows);
  if (error) return c.json({ error: "ingestion_failed" }, 503);
  await db
    .from("properties")
    .update({ tracking_last_received_at: now })
    .eq("id", property.id);
  return c.body(null, 202);
});

app.use("/api/*", async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "authentication_required" }, 401);
  const db = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ error: "invalid_session" }, 401);
  c.set("db", db);
  c.set("userId", data.user.id);
  await next();
});

app.get("/api/bootstrap", async (c) => {
  const db = c.get("db");
  const { data: accessibleProperties } = await db.from("properties").select("id");
  if (accessibleProperties?.length) {
    await admin(c.env)
      .from("uptime_monitors")
      .upsert(
        accessibleProperties.map((property) => ({ property_id: property.id })),
        { onConflict: "property_id", ignoreDuplicates: true },
      );
  }
  const [profile, accounts, workspaces, properties, incidents, notifications] =
    await Promise.all([
      db.from("profiles").select("*").maybeSingle(),
      db.from("account_memberships").select("role,accounts(*)"),
      db.from("workspace_memberships").select("role,workspaces(*)"),
      db
        .from("properties")
        .select(
          "*,uptime_monitors(*),audit_runs(id,status,score,coverage,created_at)",
        )
        .order("created_at"),
      db
        .from("incidents")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(50),
      db
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  const firstError = [
    profile,
    accounts,
    workspaces,
    properties,
    incidents,
    notifications,
  ].find((x) => x.error)?.error;
  if (firstError) return c.json({ error: firstError.message }, 500);
  return c.json({
    profile: profile.data,
    accounts: accounts.data,
    workspaces: workspaces.data,
    properties: normalizePropertyRelations(properties.data || []),
    incidents: incidents.data,
    notifications: notifications.data,
  });
});

export function normalizePropertyRelations(properties: any[]) {
  return properties.map((property) => ({
    ...property,
    uptime_monitors: Array.isArray(property.uptime_monitors)
      ? property.uptime_monitors
      : property.uptime_monitors
        ? [property.uptime_monitors]
        : [],
  }));
}

app.post("/api/onboarding", async (c) => {
  const body = await c.req.json<{
    accountName: string;
    workspaceName: string;
    propertyName?: string;
    url?: string;
  }>();
  if (!body.accountName?.trim() || !body.workspaceName?.trim())
    return c.json({ error: "account_and_workspace_required" }, 400);
  const { data, error } = await c.get("db").rpc("complete_onboarding", {
    p_account_name: body.accountName.trim().slice(0, 100),
    p_workspace_name: body.workspaceName.trim().slice(0, 100),
    p_property_name: body.propertyName?.trim().slice(0, 100) || null,
    p_url: body.url || null,
  });
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties", async (c) => {
  const b = await c.req.json<{
    workspaceId: string;
    name: string;
    url: string;
  }>();
  const target = validPublicUrl(b.url);
  if (!target) return c.json({ error: "public_http_url_required" }, 400);
  const trackingId = `cl_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data, error } = await c
    .get("db")
    .from("properties")
    .insert({
      workspace_id: b.workspaceId,
      name: b.name?.trim().slice(0, 100),
      url: target.href,
      canonical_host: target.hostname,
      tracking_id: trackingId,
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  const { error: monitorError } = await admin(c.env)
    .from("uptime_monitors")
    .upsert(
      { property_id: data.id },
      { onConflict: "property_id", ignoreDuplicates: true },
    );
  if (monitorError)
    return c.json({ error: `property_created_monitor_failed: ${monitorError.message}` }, 500);
  return c.json(data, 201);
});

app.patch("/api/properties/:id", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim().slice(0, 100);
  if (!name) return c.json({ error: "property_name_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("properties")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.patch("/api/profile", async (c) => {
  const body = await c.req.json<{ full_name?: string; timezone?: string }>();
  const update = {
    full_name: body.full_name?.trim().slice(0, 100) || null,
    timezone: body.timezone?.trim().slice(0, 80) || "Europe/London",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await c
    .get("db")
    .from("profiles")
    .update(update)
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/verify", async (c) => {
  const db = c.get("db");
  const { data: property, error } = await db
    .from("properties")
    .select("id,url,tracking_id")
    .eq("id", c.req.param("id"))
    .single();
  if (error || !property) return c.json({ error: "property_not_found" }, 404);
  try {
    const res = await safeFetch(property.url, {
      method: "GET",
      headers: { "user-agent": "Claritude-Verification/1.0" },
    });
    const html = (await limitedText(res, 1_000_000)).toLowerCase();
    const verified =
      html.includes(property.tracking_id.toLowerCase()) ||
      res.headers.get("x-claritude-verification") === property.tracking_id;
    await db
      .from("properties")
      .update({
        verification_status: verified ? "verified" : "pending",
        verified_at: verified ? new Date().toISOString() : null,
      })
      .eq("id", property.id);
    return c.json({
      verified,
      method: html.includes(property.tracking_id.toLowerCase())
        ? "tracking_script"
        : "header",
    });
  } catch (e) {
    return c.json({ verified: false, error: errorMessage(e) }, 422);
  }
});

app.post("/api/audits", async (c) => {
  const b = await c.req.json<{ propertyId: string; pageUrl?: string }>();
  const db = c.get("db");
  const { data: property } = await db
    .from("properties")
    .select("id,url")
    .eq("id", b.propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  const target = validPublicUrl(b.pageUrl || property.url);
  if (!target || target.hostname !== new URL(property.url).hostname)
    return c.json({ error: "page_must_belong_to_property" }, 400);
  const { data: registryRows, error: registryError } = await db
    .from("audit_check_definitions")
    .select("id,title,weight,logic_version,configuration_version")
    .eq("lifecycle", "active")
    .order("id");
  if (registryError)
    return c.json({ error: "audit_registry_unavailable" }, 503);
  const snapshot = buildRegistrySnapshot(
    registryRows || [],
    new Set(AUDIT_REGISTRY.map((check) => check.id)),
  );
  if (!snapshot.length) return c.json({ error: "audit_registry_empty" }, 503);
  const { data: run, error } = await db
    .from("audit_runs")
    .insert({
      property_id: property.id,
      page_url: target.href,
      status: "queued",
      registry_snapshot: snapshot,
      scoring_version: "1.0.0",
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await c.env.JOBS.send({ type: "audit", id: run.id });
  return c.json(run, 202);
});

app.get("/api/properties/:id/audits", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("audit_runs")
    .select("*,audit_results(*)")
    .eq("property_id", c.req.param("id"))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return c.json({ error: error.message }, 400);
  const definitions = new Map(AUDIT_REGISTRY.map((check) => [check.id, check]));
  return c.json(
    (data || []).map((run: any) => ({
      ...run,
      audit_results: (run.audit_results || []).map((result: any) => {
        const definition = definitions.get(result.check_id);
        return {
          ...result,
          title: definition?.title || result.title_snapshot,
          category: definition
            ? categoryLabel(definition.primaryCategory)
            : "General",
          subcategory: definition?.subcategory || "General",
          severity: definition?.severity || "informational",
          recommendation: definition?.recommendation || "Review the evidence.",
        };
      }),
    })),
  );
});

app.post("/api/monitors/:id/check", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("uptime_monitors")
    .select("id")
    .eq("id", c.req.param("id"))
    .single();
  if (error || !data) return c.json({ error: "monitor_not_found" }, 404);
  await runUptime(c.env, data.id);
  const { data: check } = await admin(c.env)
    .from("uptime_checks")
    .select("*")
    .eq("monitor_id", data.id)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return c.json({ status: "completed", check });
});

app.get("/api/monitors/:id/checks", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") || 30)));
  const from = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await c
    .get("db")
    .from("uptime_checks")
    .select("id,checked_at,success,status_code,response_ms,error_code")
    .eq("monitor_id", c.req.param("id"))
    .gte("checked_at", from)
    .order("checked_at", { ascending: true })
    .limit(10000);
  if (error) return c.json({ error: error.message }, 400);
  const checks = data || [];
  const successful = checks.filter((x) => x.success);
  const responseValues = successful
    .map((x) => x.response_ms)
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  const percentile = (p: number) =>
    responseValues.length
      ? responseValues[Math.min(responseValues.length - 1, Math.floor((responseValues.length - 1) * p))]
      : null;
  const byDay = new Map<string, { total: number; successful: number }>();
  for (const check of checks) {
    const day = check.checked_at.slice(0, 10);
    const current = byDay.get(day) || { total: 0, successful: 0 };
    current.total += 1;
    if (check.success) current.successful += 1;
    byDay.set(day, current);
  }
  return c.json({
    checks,
    summary: {
      total: checks.length,
      successful: successful.length,
      availability: checks.length ? (successful.length / checks.length) * 100 : null,
      averageResponseMs: responseValues.length
        ? Math.round(responseValues.reduce((a, b) => a + b, 0) / responseValues.length)
        : null,
      medianResponseMs: percentile(0.5),
      p95ResponseMs: percentile(0.95),
    },
    days: [...byDay].map(([day, value]) => ({ day, ...value })),
  });
});

app.patch("/api/monitors/:id", async (c) => {
  const allowed = (({
    enabled,
    interval_minutes,
    timeout_ms,
    expected_status_min,
    expected_status_max,
    failure_threshold,
  }: any) => ({
    enabled,
    interval_minutes,
    timeout_ms,
    expected_status_min,
    expected_status_max,
    failure_threshold,
  }))(await c.req.json());
  const { data, error } = await c
    .get("db")
    .from("uptime_monitors")
    .update(allowed)
    .eq("id", c.req.param("id"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.get("/api/monitors/:id/maintenance", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("maintenance_windows")
    .select("*")
    .eq("monitor_id", c.req.param("id"))
    .order("starts_at", { ascending: false })
    .limit(50);
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/monitors/:id/maintenance", async (c) => {
  const body = await c.req.json<{
    startsAt: string;
    endsAt?: string;
    reason?: string;
  }>();
  const startsAt = new Date(body.startsAt);
  const endsAt = body.endsAt
    ? new Date(body.endsAt)
    : new Date(startsAt.getTime() + 60 * 60_000);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    return c.json({ error: "valid_maintenance_window_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("maintenance_windows")
    .insert({
      monitor_id: c.req.param("id"),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: body.reason?.trim().slice(0, 240) || null,
      created_by: c.get("userId"),
    })
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.get("/api/properties/:id/alert-recipients", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("alert_recipients")
    .select("*")
    .eq("property_id", c.req.param("id"))
    .order("created_at");
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/alert-recipients", async (c) => {
  const body = await c.req.json<{ email: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "valid_email_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("alert_recipients")
    .upsert(
      { property_id: c.req.param("id"), email, enabled: true },
      { onConflict: "property_id,email" },
    )
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.get("/api/properties/:id/events", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("event_definitions")
    .select("*")
    .eq("property_id", c.req.param("id"))
    .order("created_at");
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/events", async (c) => {
  const body = await c.req.json<{
    name: string;
    eventType: string;
    description?: string;
  }>();
  const name = body.name
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 80);
  const eventType = ["click", "pageview", "form_success"].includes(
    body.eventType,
  )
    ? body.eventType
    : "click";
  if (!name) return c.json({ error: "event_name_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("event_definitions")
    .insert({
      property_id: c.req.param("id"),
      name,
      event_type: eventType,
      description: body.description?.trim().slice(0, 240) || null,
    })
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.get("/api/properties/:id/report-schedules", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("report_schedules")
    .select("*")
    .eq("property_id", c.req.param("id"))
    .order("created_at");
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/report-schedules", async (c) => {
  const body = await c.req.json<{
    cadence: "weekly" | "monthly";
    recipients: string[];
  }>();
  const recipients = (body.recipients || [])
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
    .slice(0, 20);
  if (!["weekly", "monthly"].includes(body.cadence) || !recipients.length)
    return c.json({ error: "valid_schedule_required" }, 400);
  const next = new Date(
    Date.now() + (body.cadence === "weekly" ? 7 : 30) * 864e5,
  );
  const { data, error } = await c
    .get("db")
    .from("report_schedules")
    .insert({
      property_id: c.req.param("id"),
      cadence: body.cadence,
      recipients,
      next_run_at: next.toISOString(),
      created_by: c.get("userId"),
    })
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.get("/api/properties/:id/saved-reports", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("saved_reports")
    .select("id,name,period_start,period_end,data_snapshot,created_at")
    .eq("property_id", c.req.param("id"))
    .order("created_at", { ascending: false });
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/saved-reports", async (c) => {
  const body = await c.req.json<{
    name: string;
    periodStart?: string;
    periodEnd?: string;
    dataSnapshot: Record<string, unknown>;
  }>();
  const name = body.name?.trim().slice(0, 120);
  if (!name || !body.dataSnapshot || typeof body.dataSnapshot !== "object")
    return c.json({ error: "valid_report_required" }, 400);
  const periodEnd = body.periodEnd || new Date().toISOString().slice(0, 10);
  const periodStart =
    body.periodStart ||
    new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await c
    .get("db")
    .from("saved_reports")
    .insert({
      property_id: c.req.param("id"),
      name,
      period_start: periodStart,
      period_end: periodEnd,
      data_snapshot: body.dataSnapshot,
      created_by: c.get("userId"),
    })
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.patch("/api/notifications/:id/read", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.get("/api/properties/:id/analytics", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") || 30)));
  const from = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await c
    .get("db")
    .from("analytics_events")
    .select(
      "event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at",
    )
    .eq("property_id", c.req.param("id"))
    .gte("occurred_at", from)
    .order("occurred_at", { ascending: true })
    .limit(50000);
  if (error) return c.json({ error: error.message }, 400);
  return c.json(buildAnalyticsSummary(data || [], days));
});

app.get("/api/properties/:id/report", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const from = new Date(Date.now() - 30 * 864e5).toISOString();
  const [property, incidents, audits, analytics] = await Promise.all([
    db.from("properties").select("*").eq("id", id).single(),
    db
      .from("incidents")
      .select("*")
      .eq("property_id", id)
      .order("opened_at", { ascending: false })
      .limit(20),
    db
      .from("audit_runs")
      .select("*")
      .eq("property_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("analytics_events")
      .select(
        "event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at",
      )
      .eq("property_id", id)
      .gte("occurred_at", from)
      .order("occurred_at", { ascending: true })
      .limit(50000),
  ]);
  if (property.error) return c.json({ error: "property_not_found" }, 404);
  return c.json({
    generatedAt: new Date().toISOString(),
    period: "Last 30 days",
    property: property.data,
    incidents: incidents.data,
    audits: audits.data,
    analytics: buildAnalyticsSummary(analytics.data || [], 30),
    limitations: [
      "Visitor totals are aggregate estimates; no persistent visitor identifiers are used.",
    ],
  });
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

async function runAudit(env: Env, id: string) {
  const db = admin(env);
  const started = Date.now();
  const { data: run } = await db
    .from("audit_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (!run) return;
  try {
    const fetchStarted = Date.now();
    const res = await safeFetch(run.page_url, {
      headers: { "user-agent": "Claritude-Audit/1.0 (+https://claritude.io)" },
    });
    const responseMs = Date.now() - fetchStarted;
    const snapshot = run.registry_snapshot as AuditRegistrySnapshot[];
    const html = await limitedText(res, 2_000_000);
    const results = evaluateSourceChecks(snapshot, res, html, responseMs);
    const snapshotById = new Map(snapshot.map((check) => [check.id, check]));
    await db.from("audit_results").insert(
      results.map((r) => {
        const check = snapshotById.get(r.check_id);
        return {
          ...r,
          audit_run_id: id,
          logic_version: check?.logicVersion || "unknown",
          configuration_version: check?.configurationVersion || 1,
          title_snapshot: check?.title || r.check_id,
        };
      }),
    );
    const { score, coverage } = scoreAuditResults(snapshot, results);
    await db
      .from("audit_runs")
      .update({
        status: results.some((r) => r.outcome === "unable_to_test")
          ? "partial"
          : "completed",
        score,
        coverage,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      })
      .eq("id", id);
  } catch (e) {
    await db
      .from("audit_runs")
      .update({
        status: "failed",
        error: errorMessage(e),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      })
      .eq("id", id);
  }
}

export function evaluateSourceChecks(
  snapshot: any[],
  res: Response,
  html: string,
  responseMs = 0,
): AuditResult[] {
  const title = html
    .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, "")
    .trim();
  const desc =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i,
    )?.[1] ||
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    )?.[1];
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const analysis = analyseHtml(html, res.url);
  const checks: Partial<Record<string, () => [CheckOutcome, Record<string, unknown>]>> =
    {
      "seo.metadata.title.present": () => [
        title ? "pass" : "fail",
        { title: title || null },
      ],
      "seo.metadata.title.not_empty": () => [
        title ? "pass" : "fail",
        { length: title?.length || 0 },
      ],
      "seo.metadata.title.length": () => [
        !title ? "not_applicable" : title.length <= 60 ? "pass" : "warning",
        { length: title?.length || 0, threshold: 60 },
      ],
      "seo.metadata.description.present": () => [
        desc !== undefined ? "pass" : "fail",
        { present: desc !== undefined },
      ],
      "seo.metadata.description.not_empty": () => [
        desc ? "pass" : desc === undefined ? "not_applicable" : "fail",
        { length: desc?.length || 0 },
      ],
      "seo.crawling.http_status": () => [
        res.ok ? "pass" : res.status >= 500 ? "fail" : "warning",
        { status: res.status },
      ],
      "seo.crawling.html_content": () => [
        (res.headers.get("content-type") || "").includes("text/html")
          ? "pass"
          : "fail",
        { contentType: res.headers.get("content-type") },
      ],
      "seo.content.h1.present": () => [
        h1s.length ? "pass" : "fail",
        { count: h1s.length },
      ],
      "seo.content.h1.multiple": () => [
        h1s.length <= 1 ? "pass" : "warning",
        { count: h1s.length },
      ],
      "accessibility.document.title": () => [
        title ? "pass" : "fail",
        { title: title || null },
      ],
      "accessibility.mobile.viewport": () => [
        /<meta[^>]+name=["']viewport["']/i.test(html) ? "pass" : "fail",
        {},
      ],
      "security.https.selected": () => [
        res.url.startsWith("https://") ? "pass" : "fail",
        { finalUrl: res.url },
      ],
      "security.headers.hsts": () => [
        res.headers.has("strict-transport-security") ? "pass" : "warning",
        { value: res.headers.get("strict-transport-security") },
      ],
      "security.headers.csp": () => [
        res.headers.has("content-security-policy") ? "pass" : "warning",
        { value: res.headers.get("content-security-policy") },
      ],
      "infrastructure.http.content_type": () => [
        "informational",
        { value: res.headers.get("content-type") },
      ],
      "ai.content.source_extractable": () => [
        /<main\b/i.test(html) && stripText(html).length > 100
          ? "pass"
          : "warning",
        { textLength: stripText(html).length },
      ],
    };
  return snapshot.map((s) => {
    const t = performance.now();
    const fn = checks[s.id];
    const generic = fn
      ? null
      : evaluateStaticCheck(s.id, res, html, analysis, responseMs);
    const [outcome, evidence] = fn
      ? fn()
      : generic || [
          "unable_to_test" as CheckOutcome,
          { reason: methodReason(registry(s.id)?.executionMethod) },
        ];
    return {
      check_id: s.id,
      outcome,
      evidence,
      duration_ms: Math.max(0, Math.round(performance.now() - t)),
    };
  });
}

function analyseHtml(html: string, baseUrl: string) {
  const tags = (name: string) => [
    ...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi")),
  ].map((match) => match[0]);
  const attr = (tag: string, name: string) =>
    tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ||
    null;
  const links = tags("a").map((tag) => ({
    tag,
    href: attr(tag, "href"),
    name:
      attr(tag, "aria-label") ||
      stripText(html.slice(html.indexOf(tag) + tag.length, html.indexOf("</a>", html.indexOf(tag)))),
  }));
  const images = tags("img").map((tag) => ({
    tag,
    src: attr(tag, "src"),
    alt: attr(tag, "alt"),
    width: attr(tag, "width"),
    height: attr(tag, "height"),
    srcset: attr(tag, "srcset"),
  }));
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]);
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1]);
  return {
    tags,
    attr,
    links,
    images,
    ids,
    duplicateIds: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
    jsonLd,
    text: stripText(html),
    url: new URL(baseUrl),
  };
}

function evaluateStaticCheck(
  id: string,
  res: Response,
  html: string,
  a: ReturnType<typeof analyseHtml>,
  responseMs: number,
): [CheckOutcome, Record<string, unknown>] | null {
  const count = (pattern: RegExp) => [...html.matchAll(pattern)].length;
  const present = (pattern: RegExp) => pattern.test(html);
  const result = (
    ok: boolean,
    evidence: Record<string, unknown> = {},
    bad: CheckOutcome = "fail",
  ): [CheckOutcome, Record<string, unknown>] => [ok ? "pass" : bad, evidence];
  const meta = (key: string) =>
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${key}["']`, "i"))?.[1] ||
    null;
  const linkRel = (rel: string) =>
    html.match(new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]+href=["']([^"']+)`, "i"))?.[1] ||
    html.match(new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${rel}[^"']*["']`, "i"))?.[1] ||
    null;
  const method = registry(id)?.executionMethod;
  if (!['source_html', 'headers', 'http', 'static_analysis'].includes(method || '')) return null;

  if (id.includes("multiple.page.titles")) return result(count(/<title\b[^>]*>/gi) <= 1, { count: count(/<title\b[^>]*>/gi) }, "warning");
  if (id.includes("multiple.meta.descriptions")) return result(count(/<meta[^>]+name=["']description["']/gi) <= 1, { count: count(/<meta[^>]+name=["']description["']/gi) }, "warning");
  if (id.includes("meta.description.length")) { const value = meta("description") || ""; return [!value ? "not_applicable" : value.length <= 160 ? "pass" : "warning", { length: value.length }]; }
  if (id.includes("canonical.url.declared")) return result(!!linkRel("canonical"), { value: linkRel("canonical") });
  if (id.includes("multiple.canonical")) return result(count(/<link[^>]+rel=["'][^"']*canonical/gi) <= 1, { count: count(/<link[^>]+rel=["'][^"']*canonical/gi) }, "warning");
  if (id.includes("canonical.url.format")) { const value = linkRel("canonical"); if (!value) return ["not_applicable", {}]; try { new URL(value, a.url); return ["pass", { value }]; } catch { return ["fail", { value }]; } }
  if (id.includes("canonical.points.to.a.different")) { const value = linkRel("canonical"); return [!value ? "not_applicable" : new URL(value, a.url).href === a.url.href ? "pass" : "informational", { selected: a.url.href, canonical: value }]; }
  if (id.includes("html.language.declared")) return result(/<html[^>]+lang=["'][^"']+/i.test(html), {});
  if (id.includes("html.language.code.valid")) { const lang = html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1]; return [!lang ? "not_applicable" : /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang) ? "pass" : "fail", { lang }]; }
  if (id.includes("meta.robots.directives")) return ["informational", { value: meta("robots") }];
  if (id.includes("x.robots.tag")) return ["informational", { value: res.headers.get("x-robots-tag") }];
  if (id.includes("noindex.directive")) return result(!/\bnoindex\b/i.test(`${meta("robots") || ""} ${res.headers.get("x-robots-tag") || ""}`), {}, "warning");
  if (id.includes("nofollow.directive")) return result(!/\bnofollow\b/i.test(`${meta("robots") || ""} ${res.headers.get("x-robots-tag") || ""}`), {}, "warning");
  if (id.includes("empty.h1")) return result(!/<h1\b[^>]*>\s*<\/h1>/i.test(html), {}, "warning");
  if (id.includes("empty.h2.to.h6")) return result(!/<h[2-6]\b[^>]*>\s*<\/h[2-6]>/i.test(html), {}, "warning");
  if (id.includes("main.content.landmark.present")) return result(present(/<main\b|role=["']main["']/i), {});
  if (id.includes("multiple.main.content")) return result(count(/<main\b|role=["']main["']/gi) <= 1, { count: count(/<main\b|role=["']main["']/gi) }, "warning");
  if (id.includes("main.content.contains.extractable.text") || id.includes("machine.readable.text")) return result(a.text.length >= 100, { textLength: a.text.length }, "warning");
  if (id.includes("word.count.measured")) return ["informational", { words: a.text.split(/\s+/).filter(Boolean).length }];
  if (id.includes("text.present.in.original.html")) return result(a.text.length > 0, { textLength: a.text.length });
  if (id.includes("lists.use.semantic") || id.includes("lists.available.in.machine")) return ["informational", { orderedLists: count(/<ol\b/gi), unorderedLists: count(/<ul\b/gi) }];
  if (id.includes("data.tables.contain.header")) { const tables = count(/<table\b/gi), headers = count(/<th\b/gi); return [!tables ? "not_applicable" : headers ? "pass" : "warning", { tables, headers }]; }

  if (id.includes("links.have.non.empty.destinations")) return result(a.links.every((x) => !!x.href?.trim()), { checked: a.links.length }, "warning");
  if (id.includes("links.have.accessible.names") || id.includes("empty.anchor.text")) return result(a.links.every((x) => !!x.name?.trim()), { checked: a.links.length }, "warning");
  if (id.includes("placeholder.link")) { const found = a.links.filter((x) => !x.href || ["#", "javascript:void(0)"].includes(x.href)); return result(!found.length, { count: found.length }, "warning"); }
  if (id.includes("javascript.link")) { const found = a.links.filter((x) => /^javascript:/i.test(x.href || "")); return result(!found.length, { count: found.length }, "warning"); }
  if (id.includes("internal.links.identified")) { const found = a.links.filter((x) => { try { return new URL(x.href || "", a.url).hostname === a.url.hostname; } catch { return false; } }); return ["informational", { count: found.length }]; }
  if (id.includes("external.links.identified")) { const found = a.links.filter((x) => { try { return new URL(x.href || "", a.url).hostname !== a.url.hostname; } catch { return false; } }); return ["informational", { count: found.length }]; }
  if (id.includes("https.page.links.to.http")) { const found = a.links.filter((x) => /^http:\/\//i.test(x.href || "")); return result(!found.length, { count: found.length }, "warning"); }
  if (id.includes("fragment.links.point")) { const missing = a.links.filter((x) => x.href?.startsWith("#") && !a.ids.includes(x.href.slice(1))); return result(!missing.length, { missing: missing.map((x) => x.href) }, "warning"); }
  if (id.includes("download.links.identified")) return ["informational", { count: a.links.filter((x) => /\bdownload(?:\s|=|>)/i.test(x.tag)).length }];
  if (id.includes("telephone.link.formats")) { const values = a.links.filter((x) => x.href?.startsWith("tel:")); return result(values.every((x) => /^tel:\+?[0-9() .-]+$/i.test(x.href || "")), { count: values.length }, "warning"); }
  if (id.includes("email.link.formats")) { const values = a.links.filter((x) => x.href?.startsWith("mailto:")); return result(values.every((x) => /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(x.href || "")), { count: values.length }, "warning"); }
  if (id.includes("sponsored.link")) return ["informational", { count: a.links.filter((x) => /rel=["'][^"']*sponsored/i.test(x.tag)).length }];
  if (id.includes("user.generated.content")) return ["informational", { count: a.links.filter((x) => /rel=["'][^"']*ugc/i.test(x.tag)).length }];
  if (id.includes("checked.and.unchecked.link.totals")) return ["informational", { total: a.links.length, checked: 0, unchecked: a.links.length }];

  if (id.includes("images.contain.alt")) return result(a.images.every((x) => x.alt !== null), { total: a.images.length, missing: a.images.filter((x) => x.alt === null).length });
  if (id.includes("empty.alt.attributes")) return ["informational", { count: a.images.filter((x) => x.alt === "").length }];
  if (id.includes("alt.text.repeats.image.filenames")) { const found = a.images.filter((x) => x.alt && x.src && x.src.split('/').pop()?.split('.')[0].toLowerCase() === x.alt.toLowerCase()); return result(!found.length, { count: found.length }, "warning"); }
  if (id.includes("image.width.and.height.attributes")) return result(a.images.every((x) => x.width && x.height), { total: a.images.length, complete: a.images.filter((x) => x.width && x.height).length }, "warning");
  if (id.includes("responsive.srcset.declarations")) return ["informational", { count: a.images.filter((x) => x.srcset).length }];
  if (id.includes("image.formats.recorded")) return ["informational", { formats: [...new Set(a.images.map((x) => x.src?.split('.').pop()?.split('?')[0]).filter(Boolean))] }];
  if (id.includes("videos.contain.caption")) { const videos = count(/<video\b/gi), captions = count(/<track[^>]+kind=["']captions/i); return [!videos ? "not_applicable" : captions >= videos ? "pass" : "warning", { videos, captions }]; }
  if (id.includes("autoplaying.media")) { const found = count(/<(?:video|audio)[^>]+autoplay/gi); return result(!found, { count: found }, "warning"); }
  if (id.includes("iframes.have.accessible.titles")) { const frames = a.tags('iframe'); return result(frames.every((x) => !!a.attr(x, 'title')), { total: frames.length }, "warning"); }

  if (id.includes("buttons.have.accessible.names")) { const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]; const bad = buttons.filter((x) => !stripText(x[2]) && !/aria-label=["'][^"']+/i.test(x[1])); return result(!bad.length, { total: buttons.length, unnamed: bad.length }); }
  if (id.includes("form.inputs.have.accessible.labels") || id.includes("select.controls.have.accessible.labels") || id.includes("textareas.have.accessible.labels")) { const tag = id.includes('select') ? 'select' : id.includes('textarea') ? 'textarea' : 'input'; const controls = a.tags(tag).filter((x) => !/type=["'](?:hidden|submit|button)["']/i.test(x)); const bad = controls.filter((x) => { const ident = a.attr(x,'id'); return !a.attr(x,'aria-label') && !a.attr(x,'aria-labelledby') && !(ident && new RegExp(`<label[^>]+for=["']${ident}["']`,'i').test(html)); }); return result(!bad.length, { total: controls.length, unlabeled: bad.length }); }
  if (id.includes("duplicate.ids.used")) return result(!a.duplicateIds.length, { duplicateIds: a.duplicateIds }, "warning");
  if (id.includes("positive.tabindex")) { const found = count(/tabindex=["'][1-9]\d*["']/gi); return result(!found, { count: found }, "warning"); }
  if (id.includes("meta.refresh")) { const found = present(/<meta[^>]+http-equiv=["']refresh["']/i); return result(!found, { detected: found }, "warning"); }
  if (id.includes("viewport.settings.restrict.zoom")) { const value = meta('viewport') || ''; const restricted = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(value); return result(!restricted, { value }, "warning"); }
  if (id.includes("multiple.viewport")) return result(count(/<meta[^>]+name=["']viewport["']/gi) <= 1, { count: count(/<meta[^>]+name=["']viewport["']/gi) }, "warning");
  if (id.includes("viewport.width.configured")) { const value = meta('viewport') || ''; return result(/width\s*=\s*device-width/i.test(value), { value }); }

  if (id.includes("document.response.time")) return ["informational", { responseMs }];
  if (id.includes("text.compression")) return result(/gzip|br|deflate/i.test(res.headers.get('content-encoding') || ''), { value: res.headers.get('content-encoding') }, "warning");
  if (id.includes("static.resource.cache.directives")) return ["informational", { cacheControl: res.headers.get('cache-control') }];
  if (id.includes("resource.preload.declarations")) return ["informational", { count: count(/<link[^>]+rel=["'][^"']*preload/gi) }];
  if (id.includes("font.display.declarations")) return ["informational", { declarations: count(/font-display\s*:/gi) }];

  if (id.includes("strict.transport.security.directives")) return result(/^max-age=\d+/i.test(res.headers.get('strict-transport-security') || ''), { value: res.headers.get('strict-transport-security') }, "warning");
  if (id.includes("content.security.policy.is.report.only")) return ["informational", { reportOnly: res.headers.has('content-security-policy-report-only') }];
  if (id.includes("unsafe.inline")) { const value = res.headers.get('content-security-policy') || ''; return [!value ? "not_applicable" : value.includes("'unsafe-inline'") ? "warning" : "pass", { value }]; }
  if (id.includes("unsafe.eval")) { const value = res.headers.get('content-security-policy') || ''; return [!value ? "not_applicable" : value.includes("'unsafe-eval'") ? "warning" : "pass", { value }]; }
  if (id.includes("frame.embedding.protection")) return result(res.headers.has('x-frame-options') || /frame-ancestors/i.test(res.headers.get('content-security-policy') || ''), {}, "warning");
  if (id.includes("x.content.type.options.header.present")) return result(res.headers.has('x-content-type-options'), {});
  if (id.includes("x.content.type.options.set.to.nosniff")) return result((res.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', { value: res.headers.get('x-content-type-options') });
  if (id.includes("referrer.policy.declared")) return result(res.headers.has('referrer-policy') || !!meta('referrer'), {});
  if (id.includes("permissions.policy.header.present")) return result(res.headers.has('permissions-policy'), {}, "warning");
  if (id.includes("insecure.form.submission")) { const found = count(/<form[^>]+action=["']http:\/\//gi); return result(!found, { count: found }); }

  if (id.includes("server.software.header")) return ["informational", { value: res.headers.get('server') }];
  if (id.includes("technology.disclosure.headers")) return ["informational", { poweredBy: res.headers.get('x-powered-by'), generator: meta('generator') }];
  if (id.includes("cdn.or.reverse.proxy")) return ["informational", { cfRay: res.headers.get('cf-ray'), via: res.headers.get('via') }];
  if (id.includes("cache.hit.or.miss")) return ["informational", { cfCacheStatus: res.headers.get('cf-cache-status'), age: res.headers.get('age') }];
  if (id.includes("character.encoding")) return result(/charset=/i.test(res.headers.get('content-type') || '') || /<meta[^>]+charset=/i.test(html), { contentType: res.headers.get('content-type') }, "warning");
  if (id.includes("cache.control.directives")) return ["informational", { value: res.headers.get('cache-control') }];
  if (id.includes("etag.header")) return ["informational", { value: res.headers.get('etag') }];
  if (id.includes("last.modified.header")) return ["informational", { value: res.headers.get('last-modified') }];
  if (id.includes("vary.header")) return ["informational", { value: res.headers.get('vary') }];
  if (id.includes("server.timing")) return ["informational", { value: res.headers.get('server-timing') }];

  if (id.includes("json.ld.blocks.detected")) return ["informational", { count: a.jsonLd.length }];
  if (id.includes("json.ld.syntax.valid")) { const invalid = a.jsonLd.filter((x) => { try { JSON.parse(x); return false; } catch { return true; } }); return result(!invalid.length, { total: a.jsonLd.length, invalid: invalid.length }); }
  if (id.includes("schema.org.types.identified")) { const types = [...html.matchAll(/["']@type["']\s*:\s*["']([^"']+)/gi)].map((x) => x[1]); return ["informational", { types }]; }
  if (id.includes("structured.data.context.declared")) return result(!a.jsonLd.length || a.jsonLd.every((x) => /["']@context["']\s*:/i.test(x)), { blocks: a.jsonLd.length }, "warning");
  if (id.includes("organisation.name.declared")) return [!a.jsonLd.length ? "not_applicable" : /["']@type["']\s*:\s*["']Organization["'][\s\S]*?["']name["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("article.headline.declared")) return [!/Article["']/i.test(a.jsonLd.join('\n')) ? "not_applicable" : /["']headline["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("article.author.declared") || id.includes("author.attribution")) return [!/Article["']/i.test(a.jsonLd.join('\n')) ? "not_applicable" : /["']author["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("publication.date.declared")) return [!/Article["']/i.test(a.jsonLd.join('\n')) ? "not_applicable" : /["']datePublished["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("modification.date.declared")) return [!/Article["']/i.test(a.jsonLd.join('\n')) ? "not_applicable" : /["']dateModified["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];

  if (id.includes("open.graph.title.present")) return result(!!meta('og:title'), { value: meta('og:title') });
  if (id.includes("open.graph.description.present")) return result(!!meta('og:description'), { value: meta('og:description') });
  if (id.includes("open.graph.url.present")) return result(!!meta('og:url'), { value: meta('og:url') });
  if (id.includes("open.graph.type.present")) return result(!!meta('og:type'), { value: meta('og:type') });
  if (id.includes("open.graph.image.declared")) return result(!!meta('og:image'), { value: meta('og:image') });
  if (id.includes("twitter.card.type.declared")) return result(!!meta('twitter:card'), { value: meta('twitter:card') }, "warning");
  if (id.includes("twitter.title.or.open.graph")) return result(!!(meta('twitter:title') || meta('og:title')), {});
  if (id.includes("twitter.description.or.open.graph")) return result(!!(meta('twitter:description') || meta('og:description')), {});
  if (id.includes("twitter.image.or.open.graph")) return result(!!(meta('twitter:image') || meta('og:image')), {});
  if (id.includes("favicon.declared")) return result(!!linkRel('icon'), { value: linkRel('icon') }, "warning");
  if (id.includes("apple.touch.icon.declared")) return result(!!linkRel('apple-touch-icon'), { value: linkRel('apple-touch-icon') }, "warning");
  if (id.includes("web.app.manifest.linked")) return result(!!linkRel('manifest'), { value: linkRel('manifest') }, "warning");

  if (id.includes("main.content.organised.under.semantic.headings")) return result(count(/<h[1-6]\b/gi) > 0, { headings: count(/<h[1-6]\b/gi) }, "warning");
  if (id.includes("tables.available.in.machine")) return ["informational", { tables: count(/<table\b/gi) }];
  if (id.includes("external.source.links.present")) { const external = a.links.filter((x) => { try { return new URL(x.href || '', a.url).hostname !== a.url.hostname; } catch { return false; } }); return ["informational", { count: external.length }]; }
  if (id.includes("machine.readable.organisation.identity")) return result(/Organization["']/i.test(a.jsonLd.join('\n')), {}, "warning");
  if (id.includes("machine.readable.author.identity")) return result(/["']author["']\s*:/i.test(a.jsonLd.join('\n')), {}, "warning");
  return null;
}

async function runUptime(env: Env, id: string) {
  const db = admin(env);
  const { data: monitor } = await db
    .from("uptime_monitors")
    .select("*,properties(*)")
    .eq("id", id)
    .single();
  if (!monitor?.enabled) return;
  const started = Date.now();
  let status: number | null = null,
    ok = false,
    failure: string | null = null;
  try {
    const r = await safeFetch(monitor.properties.url, {
      method: "GET",
      headers: { "user-agent": "Claritude-Uptime/1.0" },
      signal: AbortSignal.timeout(monitor.timeout_ms),
    });
    status = r.status;
    ok =
      status >= monitor.expected_status_min &&
      status <= monitor.expected_status_max;
  } catch (e) {
    failure = errorMessage(e);
  }
  const checkedAt = new Date().toISOString();
  await db
    .from("uptime_checks")
    .insert({
      monitor_id: id,
      checked_at: checkedAt,
      success: ok,
      status_code: status,
      response_ms: Date.now() - started,
      error_code: failure,
    });
  const failures = ok ? 0 : (monitor.consecutive_failures || 0) + 1;
  await db
    .from("uptime_monitors")
    .update({
      last_checked_at: checkedAt,
      last_status: ok ? "online" : "offline",
      last_response_ms: Date.now() - started,
      consecutive_failures: failures,
      next_check_at: new Date(
        Date.now() + monitor.interval_minutes * 60_000,
      ).toISOString(),
    })
    .eq("id", id);
  const { data: open } = await db
    .from("incidents")
    .select("*")
    .eq("monitor_id", id)
    .is("resolved_at", null)
    .maybeSingle();
  if (!ok && failures >= monitor.failure_threshold && !open) {
    const { data: incident } = await db
      .from("incidents")
      .insert({
        property_id: monitor.property_id,
        monitor_id: id,
        opened_at: checkedAt,
        cause: failure || `HTTP ${status}`,
      })
      .select()
      .single();
    if (incident) await sendAlert(env, db, incident, "down");
  } else if (ok && open) {
    await db
      .from("incidents")
      .update({ resolved_at: checkedAt })
      .eq("id", open.id);
    await sendAlert(env, db, { ...open, resolved_at: checkedAt }, "recovered");
  }
}

async function sendAlert(
  env: Env,
  db: SupabaseClient,
  incident: any,
  kind: "down" | "recovered",
) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return;
  const { data: recipients } = await db
    .from("alert_recipients")
    .select("email")
    .eq("property_id", incident.property_id)
    .eq("enabled", true);
  for (const r of recipients || []) {
    const key = `${incident.id}:${kind}:${r.email}`;
    const { data: claimed } = await db.rpc("claim_notification", {
      p_key: key,
      p_kind: `uptime_${kind}`,
      p_recipient: r.email,
      p_payload: incident,
    });
    if (!claimed) continue;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [r.email],
        subject:
          kind === "down"
            ? "Claritude downtime alert"
            : "Claritude recovery notice",
        html: `<h1>${kind === "down" ? "Website unavailable" : "Website recovered"}</h1><p>${kind === "down" ? "Claritude opened an incident after the configured failure threshold." : "Claritude confirmed a successful response and closed the incident."}</p>`,
      }),
    });
    await db
      .from("notification_deliveries")
      .update({
        status: response.ok ? "sent" : "failed",
        provider_id: response.headers.get("x-message-id"),
        error: response.ok ? null : await response.text(),
      })
      .eq("dedupe_key", key);
  }
}

async function scheduled(env: Env, cron: string) {
  const db = admin(env);
  if (cron === "*/5 * * * *") {
    const { data } = await db
      .from("uptime_monitors")
      .select("id")
      .eq("enabled", true)
      .lte("next_check_at", new Date().toISOString())
      .limit(100);
    await Promise.all(
      (data || []).map((m) => env.JOBS.send({ type: "uptime", id: m.id })),
    );
  } else
    await db.rpc("aggregate_analytics_day", {
      p_day: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    });
}

function sanitizeEvent(
  e: any,
  propertyId: string,
  receivedAt: string,
  requestCountry = "",
  userAgent = "",
) {
  const kinds = [
    "pageview",
    "click",
    "outbound",
    "scroll",
    "active_time",
    "form_success",
    "web_vital",
  ];
  if (!kinds.includes(e?.type)) return null;
  const path = cleanPath(e.path);
  if (!path) return null;
  return {
    property_id: propertyId,
    event_type: e.type,
    path,
    referrer_host: cleanHost(e.referrer),
    source: String(e.source || "").slice(0, 80) || null,
    device: ["desktop", "mobile", "tablet"].includes(e.device)
      ? e.device
      : null,
    country_code: /^[A-Z]{2}$/.test(requestCountry)
      ? requestCountry
      : /^[A-Z]{2}$/.test(e.country || "")
        ? e.country
        : null,
    name: String(e.name || "").slice(0, 80) || null,
    value: Number.isFinite(e.value)
      ? Math.max(0, Math.min(600000, Number(e.value)))
      : null,
    metadata: safeMetadata({
      ...e.meta,
      browser: e.meta?.browser || browserFromUserAgent(userAgent),
    }),
    occurred_at: validDate(e.at) || receivedAt,
    received_at: receivedAt,
  };
}

function browserFromUserAgent(value: string) {
  if (/Edg\//i.test(value)) return "Edge";
  if (/OPR\//i.test(value)) return "Opera";
  if (/Chrome\//i.test(value)) return "Chrome";
  if (/Firefox\//i.test(value)) return "Firefox";
  if (/Safari\//i.test(value)) return "Safari";
  return value ? "Other" : "Unknown";
}

export function buildAnalyticsSummary(events: any[], days: number) {
  const pageMap = new Map<string, { pageviews: number; events: number }>();
  const seriesMap = new Map<string, { pageviews: number; events: number }>();
  const sourceMap = new Map<string, number>();
  const countryMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const browserMap = new Map<string, number>();
  const screenMap = new Map<string, number>();
  const campaignMap = new Map<string, number>();
  const eventMap = new Map<string, number>();
  const sessions = new Set<string>();
  const vitals = new Map<string, number[]>();
  let pageviews = 0;
  let keyEvents = 0;
  let activeSeconds = 0;
  let activeSamples = 0;
  let scroll75 = 0;
  const bump = (map: Map<string, number>, key: unknown, amount = 1) => {
    const clean = String(key || "Unknown").trim() || "Unknown";
    map.set(clean, (map.get(clean) || 0) + amount);
  };
  for (const event of events) {
    const path = event.path || "/";
    const page = pageMap.get(path) || { pageviews: 0, events: 0 };
    const day = String(event.occurred_at).slice(0, 10);
    const point = seriesMap.get(day) || { pageviews: 0, events: 0 };
    page.events += 1;
    point.events += 1;
    if (event.event_type === "pageview") {
      pageviews += 1;
      page.pageviews += 1;
      point.pageviews += 1;
      bump(sourceMap, event.source || event.referrer_host || "Direct");
      bump(countryMap, event.country_code || "Unknown");
      bump(deviceMap, event.device || "Unknown");
      bump(browserMap, event.metadata?.browser || "Unknown");
      bump(screenMap, event.metadata?.screen || event.device || "Unknown");
      if (event.metadata?.utm_campaign)
        bump(campaignMap, event.metadata.utm_campaign);
      if (event.metadata?.session) sessions.add(event.metadata.session);
    }
    if (["click", "outbound", "form_success"].includes(event.event_type))
      keyEvents += 1;
    if (event.event_type === "active_time" && Number.isFinite(event.value)) {
      activeSeconds += Number(event.value);
      activeSamples += 1;
    }
    if (event.event_type === "scroll" && Number(event.value) >= 75) scroll75 += 1;
    if (event.event_type === "web_vital" && event.name && Number.isFinite(event.value)) {
      const samples = vitals.get(event.name) || [];
      samples.push(Number(event.value));
      vitals.set(event.name, samples);
    }
    bump(eventMap, event.name || event.event_type);
    pageMap.set(path, page);
    seriesMap.set(day, point);
  }
  const ranked = (map: Map<string, number>) =>
    [...map].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const vitalRows = [...vitals].map(([name, values]) => ({
    name,
    value: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
    samples: values.length,
  }));
  return {
    from: new Date(Date.now() - days * 864e5).toISOString(),
    to: new Date().toISOString(),
    pageviews,
    events: events.length,
    keyEvents,
    sessions: sessions.size,
    truncated: events.length >= 50000,
    pages: [...pageMap]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.pageviews - a.pageviews),
    series: [...seriesMap]
      .map(([day, value]) => ({ day, ...value }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    sources: ranked(sourceMap),
    countries: ranked(countryMap),
    devices: ranked(deviceMap),
    browsers: ranked(browserMap),
    screens: ranked(screenMap),
    campaigns: ranked(campaignMap),
    eventBreakdown: ranked(eventMap),
    engagement: {
      engagedSessions: sessions.size,
      averageActiveSeconds: activeSamples ? Math.round(activeSeconds / activeSamples) : null,
      scroll75Rate: pageviews ? (scroll75 / pageviews) * 100 : null,
      keyEventRate: pageviews ? (keyEvents / pageviews) * 100 : null,
    },
    vitals: vitalRows,
  };
}
function cleanPath(v: unknown) {
  try {
    const u = new URL(String(v), "https://invalid.local");
    return (u.pathname || "/").slice(0, 500);
  } catch {
    return null;
  }
}
function cleanHost(v: unknown) {
  try {
    return v ? new URL(String(v)).hostname.slice(0, 255) : null;
  } catch {
    return null;
  }
}
function safeMetadata(v: any) {
  const out: Record<string, string | number | boolean> = {};
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v).slice(0, 12))
      if (
        /^[a-zA-Z0-9_-]{1,40}$/.test(k) &&
        ["string", "number", "boolean"].includes(typeof x)
      )
        out[k] = typeof x === "string" ? x.slice(0, 200) : (x as any);
  return out;
}
function validDate(v: unknown) {
  const d = new Date(String(v));
  return Number.isFinite(d.valueOf()) &&
    Math.abs(Date.now() - d.valueOf()) < 864e5
    ? d.toISOString()
    : null;
}
function validPublicUrl(value: string) {
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      isPrivateHost(u.hostname)
    )
      return null;
    return u;
  } catch {
    return null;
  }
}
function isPrivateHost(h: string) {
  const x = h.toLowerCase().replace(/\.$/, "");
  return (
    x === "localhost" ||
    x.endsWith(".local") ||
    x.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      x,
    ) ||
    x === "::1" ||
    x.startsWith("fc") ||
    x.startsWith("fd") ||
    x.startsWith("fe80:")
  );
}
async function safeFetch(value: string, init: RequestInit = {}) {
  let url = validPublicUrl(value);
  if (!url) throw new Error("Target must be a public HTTP or HTTPS URL");
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: init.signal || AbortSignal.timeout(15000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const next = validPublicUrl(
      new URL(response.headers.get("location") || "", url).href,
    );
    if (!next) throw new Error("Redirect target is not permitted");
    url = next;
  }
  throw new Error("Redirect limit exceeded");
}
async function limitedText(res: Response, max: number) {
  const length = Number(res.headers.get("content-length") || 0);
  if (length > max) throw new Error("Response exceeded size limit");
  const text = await res.text();
  if (text.length > max) throw new Error("Response exceeded size limit");
  return text;
}
function stripText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function registry(id: string) {
  return AUDIT_REGISTRY.find((x) => x.id === id);
}
function categoryLabel(value: string) {
  return value
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
function methodReason(method?: string) {
  return method === "rendered_browser" || method === "lab"
    ? `${method} execution requires Cloudflare Browser Rendering, which is not configured in Stage 1 preview`
    : "This catalogue entry is mapped but its execution module is not yet implemented";
}
function errorMessage(e: unknown) {
  return e instanceof Error ? e.message.slice(0, 500) : "unknown_error";
}

const TRACKER_SOURCE = `(()=>{
  const s=document.currentScript,p=s&&s.dataset.property,endpoint=s&&new URL('/collect',s.src).href;
  if(!p||!endpoint||window.__claritude)return;window.__claritude=1;
  let q=[],timer,lastUrl=location.href,active=0,cls=0,lcp=0,inp=0;
  const params=new URLSearchParams(location.search);
  const session=sessionStorage.getItem('_claritude_session')||crypto.randomUUID();
  sessionStorage.setItem('_claritude_session',session);
  const browser=/Edg\//.test(navigator.userAgent)?'Edge':/Firefox\//.test(navigator.userAgent)?'Firefox':/Chrome\//.test(navigator.userAgent)?'Chrome':/Safari\//.test(navigator.userAgent)?'Safari':'Other';
  const common=()=>({session,browser,screen:innerWidth<768?'small':innerWidth<1280?'medium':'large',language:navigator.language||'',utm_source:params.get('utm_source')||'',utm_medium:params.get('utm_medium')||'',utm_campaign:params.get('utm_campaign')||'',utm_content:params.get('utm_content')||'',utm_term:params.get('utm_term')||''});
  const send=()=>{if(!q.length)return;const body=JSON.stringify(q.splice(0,20));if(navigator.sendBeacon&&document.visibilityState==='hidden')navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'}));else fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{})};
  const emit=(type,data={})=>{q.push({type,property:p,path:location.pathname,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',meta:common(),...data});clearTimeout(timer);timer=setTimeout(send,500)};
  const page=()=>emit('pageview',{source:params.get('utm_source')||''});page();
  new MutationObserver(()=>{if(location.href!==lastUrl){lastUrl=location.href;page()}}).observe(document,{subtree:true,childList:true});
  addEventListener('popstate',page);
  addEventListener('click',e=>{const a=e.target.closest('[data-claritude-event],a[href]');if(!a)return;const name=a.dataset.claritudeEvent;if(name)emit('click',{name});if(a.href&&new URL(a.href,location.href).host!==location.host)emit('outbound',{name:new URL(a.href).host})},{passive:true});
  const marks=new Set;addEventListener('scroll',()=>{const height=Math.max(document.documentElement.scrollHeight,1),n=Math.round((scrollY+innerHeight)/height*100);[25,50,75,100].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);emit('scroll',{value:x})}})},{passive:true});
  const tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus())active+=5;if(active&&active%30===0)emit('active_time',{value:active})},5000);
  const flushVitals=()=>{if(lcp)emit('web_vital',{name:'LCP',value:lcp});if(cls)emit('web_vital',{name:'CLS',value:cls});if(inp)emit('web_vital',{name:'INP',value:inp})};
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){flushVitals();send()}});
  addEventListener('pagehide',()=>{clearInterval(tick);if(active)emit('active_time',{value:active});flushVitals();send()});
  window.claritude={event:(name,meta)=>emit('click',{name,meta:{...common(),...meta}}),formSuccess:(name,meta)=>emit('form_success',{name,meta:{...common(),...meta}}),flush:send};
  if('PerformanceObserver'in window){
    try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{lcp=e.startTime||e.duration||0})).observe({type:'largest-contentful-paint',buffered:true})}catch{}
    try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)cls+=e.value||0})).observe({type:'layout-shift',buffered:true})}catch{}
    try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{inp=Math.max(inp,e.duration||0)})).observe({type:'event',buffered:true,durationThreshold:40})}catch{}
    try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(e.name==='first-contentful-paint')emit('web_vital',{name:'FCP',value:e.startTime})})).observe({type:'paint',buffered:true})}catch{}
  }
})();`;

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<Job>, env: Env) => {
    for (const message of batch.messages) {
      try {
        message.body.type === "audit"
          ? await runAudit(env, message.body.id)
          : await runUptime(env, message.body.id);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(scheduled(env, event.cron)),
};
