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

const LIMITS = {
  propertiesPerAccount: 25,
  auditsPerPropertyPerDay: 20,
  analyticsEventsPerPropertyPerDay: 50_000,
} as const;

const ACTIVE_AUDIT_CHECKS = AUDIT_REGISTRY.filter(
  (check) => check.lifecycle === "active",
);
const IMPLEMENTED_AUDIT_CHECKS = ACTIVE_AUDIT_CHECKS.filter(
  (check) => check.implementationStatus === "implemented",
);
const IMPLEMENTED_AUDIT_IDS = new Set(
  IMPLEMENTED_AUDIT_CHECKS.map((check) => check.id),
);

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
  if (origin) {
    try {
      if (!sameSiteHost(new URL(origin).hostname, property.canonical_host))
        return c.json({ error: "origin_mismatch" }, 403);
    } catch {
      return c.json({ error: "invalid_origin" }, 400);
    }
  }
  const now = new Date().toISOString();
  const dayStart = `${now.slice(0, 10)}T00:00:00.000Z`;
  const { count: receivedToday } = await db
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property.id)
    .gte("received_at", dayStart);
  if ((receivedToday || 0) + events.length > LIMITS.analyticsEventsPerPropertyPerDay)
    return c.json({ error: "analytics_daily_limit_reached" }, 429);
  const requestCountry = String(
    (c.req.raw as Request & { cf?: { country?: string } }).cf?.country || "",
  ).toUpperCase();
  const userAgent = c.req.header("user-agent") || "";
  const { data: definitions } = await db
    .from("event_definitions")
    .select("name,event_type")
    .eq("property_id", property.id)
    .eq("enabled", true);
  const configuredEvents = new Set(
    (definitions || []).map((definition) => `${definition.event_type}:${definition.name}`),
  );
  const rows = events
    .map((e: any) =>
      sanitizeEvent(e, property.id, now, requestCountry, userAgent),
    )
    .filter((row: any) => {
      if (!row) return false;
      if (!["click", "form_success"].includes(row.event_type) || !row.name) return true;
      return configuredEvents.has(`${row.event_type}:${row.name}`);
    });
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
  const [
    profile,
    accounts,
    workspaces,
    properties,
    incidents,
    notifications,
    activity,
    propertyMemberships,
  ] =
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
      db
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("property_memberships").select("property_id,user_id,role,created_at"),
    ]);
  const firstError = [
    profile,
    accounts,
    workspaces,
    properties,
    incidents,
    notifications,
    activity,
    propertyMemberships,
  ].find((x) => x.error)?.error;
  if (firstError) return c.json({ error: firstError.message }, 500);
  const knownWorkspaceIds = new Set(
    (workspaces.data || []).map((membership: any) => membership.workspaces?.id),
  );
  const sharedWorkspaceIds = [
    ...new Set(
      (properties.data || [])
        .map((property: any) => property.workspace_id)
        .filter((id: string) => id && !knownWorkspaceIds.has(id)),
    ),
  ];
  const sharedWorkspaces = sharedWorkspaceIds.length
    ? await db.from("workspaces").select("*").in("id", sharedWorkspaceIds)
    : { data: [], error: null };
  if (sharedWorkspaces.error)
    return c.json({ error: sharedWorkspaces.error.message }, 500);
  return c.json({
    profile: profile.data,
    accounts: accounts.data,
    workspaces: [
      ...(workspaces.data || []),
      ...(sharedWorkspaces.data || []).map((workspace: any) => ({ role: "viewer", workspaces: workspace })),
    ],
    properties: normalizePropertyRelations(properties.data || []),
    incidents: incidents.data,
    notifications: notifications.data,
    activity: activity.data,
    propertyMemberships: propertyMemberships.data,
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
  const db = c.get("db");
  const { data: membership } = await db
    .from("workspace_memberships")
    .select("role,workspaces(account_id)")
    .eq("workspace_id", b.workspaceId)
    .eq("user_id", c.get("userId"))
    .in("role", ["owner", "member"])
    .maybeSingle();
  const accountId = (membership?.workspaces as any)?.account_id;
  if (!accountId) return c.json({ error: "workspace_access_denied" }, 403);
  const service = admin(c.env);
  const { data: accountWorkspaces } = await service
    .from("workspaces")
    .select("id")
    .eq("account_id", accountId);
  const { count: propertyCount } = await service
    .from("properties")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", (accountWorkspaces || []).map((workspace) => workspace.id));
  if ((propertyCount || 0) >= LIMITS.propertiesPerAccount)
    return c.json({ error: "property_limit_reached" }, 409);
  const trackingId = `cl_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data, error } = await db
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
  await recordActivity(c.env, c.get("userId"), "property.created", data.id, {
    workspaceId: b.workspaceId,
  });
  return c.json(data, 201);
});

app.patch("/api/properties/:id", async (c) => {
  const body = await c.req.json<{ name?: string; settings?: Record<string, unknown> }>();
  const name = body.name?.trim().slice(0, 100);
  if (!name) return c.json({ error: "property_name_required" }, 400);
  const db = c.get("db");
  let settings: Record<string, unknown> | null = null;
  if (body.settings) {
    const { data: current } = await db
      .from("properties")
      .select("settings")
      .eq("id", c.req.param("id"))
      .single();
    if (!current) return c.json({ error: "property_not_found" }, 404);
    const incoming = sanitizePropertySettings(body.settings);
    settings = {
      ...(current.settings || {}),
      ...incoming,
      ...(incoming.report_branding
        ? {
            report_branding: {
              ...((current.settings as any)?.report_branding || {}),
              ...(incoming.report_branding as object),
            },
          }
        : {}),
    };
  }
  const { data, error } = await c
    .get("db")
    .from("properties")
    .update({
      name,
      ...(settings ? { settings } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "property.settings_updated", data.id);
  return c.json(data);
});

app.patch("/api/profile", async (c) => {
  const body = await c.req.json<{
    full_name?: string;
    timezone?: string;
    notification_preferences?: Record<string, boolean>;
    alerts_snoozed_until?: string | null;
  }>();
  const snoozedUntil = body.alerts_snoozed_until
    ? validDateRange(body.alerts_snoozed_until, 31 * 864e5)
    : null;
  const update = {
    ...(body.full_name !== undefined
      ? { full_name: body.full_name.trim().slice(0, 100) || null }
      : {}),
    ...(body.timezone !== undefined
      ? { timezone: body.timezone.trim().slice(0, 80) || "Europe/London" }
      : {}),
    ...(body.notification_preferences
      ? { notification_preferences: sanitizeNotificationPreferences(body.notification_preferences) }
      : {}),
    ...(body.alerts_snoozed_until !== undefined
      ? { alerts_snoozed_until: snoozedUntil }
      : {}),
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

app.post("/api/workspaces", async (c) => {
  const body = await c.req.json<{ accountId: string; name: string }>();
  const { data, error } = await c.get("db").rpc("create_workspace", {
    p_account_id: body.accountId,
    p_name: body.name,
  });
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.get("/api/users", async (c) => {
  const db = c.get("db");
  const { data: memberships, error } = await db
    .from("account_memberships")
    .select("account_id,role")
    .in("role", ["owner", "member"]);
  if (error) return c.json({ error: error.message }, 400);
  const accountIds = (memberships || []).map((membership) => membership.account_id);
  if (!accountIds.length) return c.json([]);
  const service = admin(c.env);
  const { data: workspaces } = await service
    .from("workspaces")
    .select("id,account_id,name")
    .in("account_id", accountIds);
  const workspaceIds = (workspaces || []).map((workspace) => workspace.id);
  const { data: workspaceMembers } = workspaceIds.length
    ? await service
        .from("workspace_memberships")
        .select("workspace_id,user_id,role,created_at")
        .in("workspace_id", workspaceIds)
    : { data: [] as any[] };
  const { data: properties } = workspaceIds.length
    ? await service.from("properties").select("id,workspace_id,name").in("workspace_id", workspaceIds)
    : { data: [] as any[] };
  const propertyIds = (properties || []).map((property) => property.id);
  const { data: propertyMembers } = propertyIds.length
    ? await service
        .from("property_memberships")
        .select("property_id,user_id,role,created_at")
        .in("property_id", propertyIds)
    : { data: [] as any[] };
  const userIds = [
    ...new Set([
      ...(workspaceMembers || []).map((member) => member.user_id),
      ...(propertyMembers || []).map((member) => member.user_id),
    ]),
  ];
  const users = await authUsersById(service, userIds);
  return c.json({
    workspaces,
    properties,
    workspaceMemberships: workspaceMembers,
    propertyMemberships: propertyMembers,
    users,
  });
});

app.post("/api/workspaces/:id/members", async (c) => {
  const db = c.get("db");
  const workspaceId = c.req.param("id");
  if (!(await canManageWorkspace(db, c.get("userId"), workspaceId)))
    return c.json({ error: "workspace_manage_access_required" }, 403);
  const body = await c.req.json<{ email: string; role?: "member" | "viewer" }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "valid_email_required" }, 400);
  const service = admin(c.env);
  const invited = await findOrInviteUser(service, email, c.env.APP_ORIGIN);
  const { data, error } = await service
    .from("workspace_memberships")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: invited.id,
        role: body.role === "viewer" ? "viewer" : "member",
      },
      { onConflict: "workspace_id,user_id" },
    )
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "workspace.member_invited", undefined, {
    workspaceId,
    invitedUserId: invited.id,
  });
  return c.json({ ...data, email, invitationSent: invited.invitationSent }, 201);
});

app.get("/api/properties/:id/viewers", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const { data, error } = await db
    .from("property_memberships")
    .select("property_id,user_id,role,created_at")
    .eq("property_id", propertyId);
  if (error) return c.json({ error: error.message }, 400);
  const users = await authUsersById(admin(c.env), (data || []).map((member) => member.user_id));
  return c.json(
    (data || []).map((member) => ({
      ...member,
      email: users.find((user) => user.id === member.user_id)?.email || "",
      name: users.find((user) => user.id === member.user_id)?.name || "",
    })),
  );
});

app.post("/api/properties/:id/viewers", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const { data: property } = await db
    .from("properties")
    .select("id,workspace_id")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  const body = await c.req.json<{ email: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "valid_email_required" }, 400);
  const service = admin(c.env);
  const invited = await findOrInviteUser(service, email, c.env.APP_ORIGIN);
  const { data, error } = await service
    .from("property_memberships")
    .upsert(
      {
        property_id: propertyId,
        user_id: invited.id,
        role: "viewer",
        invited_by: c.get("userId"),
      },
      { onConflict: "property_id,user_id" },
    )
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "property.viewer_invited", propertyId, {
    invitedUserId: invited.id,
  });
  return c.json({ ...data, email, invitationSent: invited.invitationSent }, 201);
});

app.patch("/api/workspaces/:id", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name?.trim().slice(0, 100);
  if (!name) return c.json({ error: "workspace_name_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("workspaces")
    .update({ name })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "workspace.updated", undefined, {
    workspaceId: data.id,
  });
  return c.json(data);
});

app.post("/api/properties/:id/verify", async (c) => {
  const db = c.get("db");
  const { data: property, error } = await db
    .from("properties")
    .select("id,url,tracking_id,workspace_id")
    .eq("id", c.req.param("id"))
    .single();
  if (error || !property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  try {
    const res = await safeFetch(property.url, {
      method: "GET",
      headers: { "user-agent": "Claritude-Verification/1.0" },
    });
    const html = (await limitedText(res, 1_000_000)).toLowerCase();
    const verified =
      html.includes(property.tracking_id.toLowerCase()) ||
      res.headers.get("x-claritude-verification") === property.tracking_id;
    const { error: updateError } = await db
      .from("properties")
      .update({
        verification_status: verified ? "verified" : "pending",
        verified_at: verified ? new Date().toISOString() : null,
      })
      .eq("id", property.id);
    if (updateError) return c.json({ error: updateError.message }, 400);
    return c.json({
      verified,
      method: verified
        ? html.includes(property.tracking_id.toLowerCase())
          ? "tracking_script"
          : "header"
        : null,
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
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count: runsToday } = await db
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property.id)
    .gte("created_at", dayStart);
  if ((runsToday || 0) >= LIMITS.auditsPerPropertyPerDay)
    return c.json({ error: "audit_daily_limit_reached" }, 429);
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
    IMPLEMENTED_AUDIT_IDS,
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
      created_by: c.get("userId"),
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await c.env.JOBS.send({ type: "audit", id: run.id });
  await recordActivity(c.env, c.get("userId"), "audit.queued", property.id, {
    auditRunId: run.id,
    pageUrl: target.href,
  });
  return c.json(run, 202);
});

app.get("/api/properties/:id/audit-pages", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("property_audit_pages")
    .select("*")
    .eq("property_id", c.req.param("id"))
    .order("created_at");
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/properties/:id/audit-pages", async (c) => {
  const body = await c.req.json<{ name: string; path: string }>();
  const name = body.name?.trim().slice(0, 100);
  const path = cleanPath(body.path);
  if (!name || !path) return c.json({ error: "valid_audit_page_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("property_audit_pages")
    .upsert(
      {
        property_id: c.req.param("id"),
        name,
        path,
        created_by: c.get("userId"),
      },
      { onConflict: "property_id,path" },
    )
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "audit.page_saved", c.req.param("id"), {
    path,
  });
  return c.json(data, 201);
});

app.get("/api/properties/:id/audits", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const { data, error } = await c
    .get("db")
    .from("audit_runs")
    .select("*,audit_results(*)")
    .eq("property_id", c.req.param("id"))
    .gte("created_at", window.from)
    .lte("created_at", window.to)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return c.json({ error: error.message }, 400);
  const definitions = new Map(AUDIT_REGISTRY.map((check) => [check.id, check]));
  return c.json(
    (data || []).map((run: any) => {
      const auditResults = (run.audit_results || []).map((result: any) => {
        const definition = definitions.get(result.check_id);
        return {
          ...result,
          title: definition?.title || result.title_snapshot,
          category: definition
            ? categoryLabel(definition.primaryCategory)
            : "General",
          subcategory: definition?.subcategory || "General",
          severity: definition?.severity || "informational",
          description: definition?.description || result.title_snapshot || "Recorded audit result.",
          recommendation: definition?.recommendation || "Review the evidence.",
          source_reference: definition?.sourceReference || null,
        };
      });
      return {
        ...run,
        audit_results: auditResults,
        catalogue_summary: {
          catalogueSize: ACTIVE_AUDIT_CHECKS.length,
          implementedChecks: IMPLEMENTED_AUDIT_CHECKS.length,
          snapshotChecks: Array.isArray(run.registry_snapshot)
            ? run.registry_snapshot.length
            : 0,
          attemptedChecks: auditResults.length,
          successfullyExecutedChecks: auditResults.filter(
            (result: any) => result.outcome !== "unable_to_test",
          ).length,
          passedChecks: auditResults.filter(
            (result: any) => result.outcome === "pass",
          ).length,
        },
      };
    }),
  );
});

app.get("/api/properties/:id/incidents", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const { data, error } = await c
    .get("db")
    .from("incidents")
    .select("*")
    .eq("property_id", c.req.param("id"))
    .lte("opened_at", window.to)
    .or(`resolved_at.is.null,resolved_at.gte.${window.from}`)
    .order("opened_at", { ascending: false })
    .limit(1000);
  return error ? c.json({ error: error.message }, 400) : c.json(data || []);
});

app.post("/api/monitors/:id/check", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("uptime_monitors")
    .select("id,property_id,properties(workspace_id)")
    .eq("id", c.req.param("id"))
    .single();
  if (error || !data) return c.json({ error: "monitor_not_found" }, 404);
  if (!(await canManageWorkspace(c.get("db"), c.get("userId"), (data.properties as any)?.workspace_id)))
    return c.json({ error: "monitor_manage_access_required" }, 403);
  await runUptime(c.env, data.id);
  const { data: check } = await admin(c.env)
    .from("uptime_checks")
    .select("*")
    .eq("monitor_id", data.id)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await recordActivity(c.env, c.get("userId"), "uptime.checked_manually", data.property_id, {
    checkId: check?.id,
  });
  return c.json({ status: "completed", check });
});

app.get("/api/monitors/:id/checks", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const duration = new Date(window.to).valueOf() - new Date(window.from).valueOf() + 1;
  const previousTo = new Date(new Date(window.from).valueOf() - 1);
  const previousFrom = new Date(previousTo.valueOf() - duration + 1);
  const fields = "id,checked_at,success,status_code,response_ms,error_code,suppressed_by_maintenance";
  const [currentResult, previousResult] = await Promise.all([
    c.get("db")
      .from("uptime_checks")
      .select(fields)
      .eq("monitor_id", c.req.param("id"))
      .gte("checked_at", window.from)
      .lte("checked_at", window.to)
      .order("checked_at", { ascending: true })
      .limit(10000),
    c.get("db")
      .from("uptime_checks")
      .select(fields)
      .eq("monitor_id", c.req.param("id"))
      .gte("checked_at", previousFrom.toISOString())
      .lte("checked_at", previousTo.toISOString())
      .order("checked_at", { ascending: true })
      .limit(10000),
  ]);
  if (currentResult.error) return c.json({ error: currentResult.error.message }, 400);
  if (previousResult.error) return c.json({ error: previousResult.error.message }, 400);
  const checks = currentResult.data || [];
  const previousChecks = previousResult.data || [];
  const summarize = (rows: typeof checks) => {
    const eligible = rows.filter((x) => !x.suppressed_by_maintenance);
    const successful = eligible.filter((x) => x.success);
    const responseValues = successful
      .map((x) => x.response_ms)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    const percentile = (p: number) =>
      responseValues.length
        ? responseValues[Math.min(responseValues.length - 1, Math.floor((responseValues.length - 1) * p))]
        : null;
    return {
      total: eligible.length,
      successful: successful.length,
      suppressed: rows.length - eligible.length,
      availability: eligible.length ? (successful.length / eligible.length) * 100 : null,
      averageResponseMs: responseValues.length
        ? Math.round(responseValues.reduce((a, b) => a + b, 0) / responseValues.length)
        : null,
      medianResponseMs: percentile(0.5),
      p95ResponseMs: percentile(0.95),
    };
  };
  const byDay = new Map<string, { total: number; successful: number; suppressed: number }>();
  for (let cursor = new Date(`${window.from.slice(0, 10)}T00:00:00.000Z`); cursor <= new Date(window.to); cursor = new Date(cursor.valueOf() + 864e5))
    byDay.set(cursor.toISOString().slice(0, 10), { total: 0, successful: 0, suppressed: 0 });
  for (const check of checks) {
    const day = check.checked_at.slice(0, 10);
    const current = byDay.get(day) || { total: 0, successful: 0, suppressed: 0 };
    if (check.suppressed_by_maintenance) current.suppressed += 1;
    else {
      current.total += 1;
      if (check.success) current.successful += 1;
    }
    byDay.set(day, current);
  }
  return c.json({
    checks,
    summary: summarize(checks),
    previous: { checks: previousChecks, summary: summarize(previousChecks) },
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

app.delete("/api/properties/:id/alert-recipients/:recipientId", async (c) => {
  const { error } = await c
    .get("db")
    .from("alert_recipients")
    .delete()
    .eq("property_id", c.req.param("id"))
    .eq("id", c.req.param("recipientId"));
  return error ? c.json({ error: error.message }, 400) : c.json({ deleted: true });
});

app.post("/api/properties/:id/test-alert", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const { data: property } = await db
    .from("properties")
    .select("id,name,workspace_id")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  const { data: recipients } = await db
    .from("alert_recipients")
    .select("email")
    .eq("property_id", propertyId)
    .eq("enabled", true);
  if (!recipients?.length) return c.json({ error: "alert_recipient_required" }, 409);
  if (!c.env.RESEND_API_KEY || !c.env.RESEND_FROM)
    return c.json({ error: "email_delivery_not_configured" }, 503);
  const key = `test:${propertyId}:${crypto.randomUUID()}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: c.env.RESEND_FROM,
      to: recipients.map((recipient) => recipient.email),
      subject: `Claritude test alert · ${property.name}`,
      html: `<h1>Claritude test alert</h1><p>Email delivery is configured for ${escapeHtml(property.name)}.</p>`,
    }),
  });
  if (!response.ok)
    return c.json({ error: `email_delivery_failed:${(await response.text()).slice(0, 240)}` }, 502);
  await recordActivity(c.env, c.get("userId"), "uptime.test_alert_sent", propertyId, {
    recipients: recipients.length,
  });
  return c.json({ delivered: recipients.length });
});

app.get("/api/properties/:id/events", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const from = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data, error }, { data: received, error: receivedError }] = await Promise.all([
    db
    .from("event_definitions")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at"),
    db
      .from("analytics_events")
      .select("name,event_type,occurred_at")
      .eq("property_id", propertyId)
      .gte("occurred_at", from)
      .not("name", "is", null)
      .limit(50000),
  ]);
  if (error || receivedError)
    return c.json({ error: (error || receivedError)?.message }, 400);
  const counts = new Map<string, { count: number; last: string | null }>();
  for (const event of received || []) {
    const key = `${event.event_type}:${event.name}`;
    const current = counts.get(key) || { count: 0, last: null };
    current.count += 1;
    if (!current.last || event.occurred_at > current.last) current.last = event.occurred_at;
    counts.set(key, current);
  }
  return c.json(
    (data || []).map((definition) => {
      const measured = counts.get(`${definition.event_type}:${definition.name}`);
      return {
        ...definition,
        received: measured?.count || 0,
        last_received_at: measured?.last || null,
      };
    }),
  );
});

app.post("/api/properties/:id/events", async (c) => {
  const body = await c.req.json<{
    name: string;
    eventType: string;
    description?: string;
    matchSettings?: Record<string, unknown>;
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
  const matchSettings = sanitizeEventMatchSettings(eventType, body.matchSettings);
  if (!matchSettings) return c.json({ error: "valid_event_match_settings_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("event_definitions")
    .insert({
      property_id: c.req.param("id"),
      name,
      event_type: eventType,
      description: body.description?.trim().slice(0, 240) || null,
      match_settings: matchSettings,
    })
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

app.patch("/api/properties/:id/events/:eventId", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const { data, error } = await c
    .get("db")
    .from("event_definitions")
    .update({ enabled: Boolean(body.enabled) })
    .eq("property_id", c.req.param("id"))
    .eq("id", c.req.param("eventId"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
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

app.post("/api/notifications/read-all", async (c) => {
  const { data, error } = await c
    .get("db")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", c.get("userId"))
    .is("read_at", null)
    .select("id");
  return error ? c.json({ error: error.message }, 400) : c.json({ updated: data?.length || 0 });
});

app.get("/api/account/export", async (c) => {
  const db = c.get("db");
  const [profile, accounts, workspaces, properties, incidents, audits, analytics, reports, schedules, activity] =
    await Promise.all([
      db.from("profiles").select("*").maybeSingle(),
      db.from("account_memberships").select("role,accounts(*)"),
      db.from("workspace_memberships").select("role,workspaces(*)"),
      db.from("properties").select("*,uptime_monitors(*),property_audit_pages(*)"),
      db.from("incidents").select("*"),
      db.from("audit_runs").select("*,audit_results(*)").limit(500),
      db.from("analytics_daily").select("*").limit(100000),
      db.from("saved_reports").select("*").limit(1000),
      db.from("report_schedules").select("*").limit(1000),
      db.from("activity_log").select("*").limit(5000),
    ]);
  const failure = [profile, accounts, workspaces, properties, incidents, audits, analytics, reports, schedules, activity]
    .find((result) => result.error)?.error;
  if (failure) return c.json({ error: failure.message }, 500);
  return c.json({
    exportedAt: new Date().toISOString(),
    profile: profile.data,
    accounts: accounts.data,
    workspaces: workspaces.data,
    properties: properties.data,
    incidents: incidents.data,
    audits: audits.data,
    analyticsDaily: analytics.data,
    savedReports: reports.data,
    reportSchedules: schedules.data,
    activity: activity.data,
  });
});

app.get("/api/properties/:id/analytics", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const filters: AnalyticsFilters = {
    pageSearch: cleanAnalyticsFilter(c.req.query("page_search"), 120),
    pathMode: ["exact", "prefix"].includes(c.req.query("path_mode") || "")
      ? (c.req.query("path_mode") as "exact" | "prefix")
      : undefined,
    pathValue: cleanAnalyticsFilter(c.req.query("path_value"), 500),
    device: cleanAnalyticsFilter(c.req.query("device"), 40),
    source: cleanAnalyticsFilter(c.req.query("source"), 255),
    country: cleanAnalyticsFilter(c.req.query("country"), 20),
    browser: cleanAnalyticsFilter(c.req.query("browser"), 60),
    eventName: cleanAnalyticsFilter(c.req.query("event_name"), 80),
    metric: cleanAnalyticsFilter(c.req.query("metric"), 20),
    sourceType: cleanAnalyticsFilter(c.req.query("source_type"), 40),
    utmSource: cleanAnalyticsFilter(c.req.query("utm_source"), 100),
    utmMedium: cleanAnalyticsFilter(c.req.query("utm_medium"), 100),
    utmCampaign: cleanAnalyticsFilter(c.req.query("utm_campaign"), 100),
  };
  const db = c.get("db");
  const select = "event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at";
  const span = new Date(window.to).valueOf() - new Date(window.from).valueOf() + 1;
  const previousTo = new Date(new Date(window.from).valueOf() - 1).toISOString();
  const previousFrom = new Date(new Date(window.from).valueOf() - span).toISOString();
  const [currentResult, previousResult] = await Promise.all([
    db
      .from("analytics_events")
      .select(select)
      .eq("property_id", c.req.param("id"))
      .gte("occurred_at", window.from)
      .lte("occurred_at", window.to)
      .order("occurred_at", { ascending: true })
      .limit(50000),
    db
      .from("analytics_events")
      .select(select)
      .eq("property_id", c.req.param("id"))
      .gte("occurred_at", previousFrom)
      .lte("occurred_at", previousTo)
      .order("occurred_at", { ascending: true })
      .limit(50000),
  ]);
  if (currentResult.error || previousResult.error)
    return c.json({ error: (currentResult.error || previousResult.error)?.message }, 400);
  const events = currentResult.data || [];
  const previousEvents = previousResult.data || [];
  const filtered = filterAnalyticsEvents(events, filters);
  const filteredPrevious = filterAnalyticsEvents(previousEvents, filters);
  return c.json({
    ...buildAnalyticsSummary(
      filtered,
      window.days,
      window.from,
      window.to,
    ),
    previous: buildAnalyticsSummary(
      filteredPrevious,
      window.days,
      previousFrom,
      previousTo,
    ),
    // Filtering can reduce the returned set below the query ceiling. Preserve
    // whether the underlying property/date result hit that ceiling so the UI
    // never presents a partial result as complete.
    truncated: events.length >= 50000,
    filterOptions: buildAnalyticsFilterOptions(events),
    appliedFilters: filters,
  });
});

app.get("/api/properties/:id/report", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const [property, incidents, audits, analytics] = await Promise.all([
    db.from("properties").select("*").eq("id", id).single(),
    db
      .from("incidents")
      .select("*")
      .eq("property_id", id)
      .gte("opened_at", window.from)
      .lte("opened_at", window.to)
      .order("opened_at", { ascending: false })
      .limit(20),
    db
      .from("audit_runs")
      .select("*")
      .eq("property_id", id)
      .gte("created_at", window.from)
      .lte("created_at", window.to)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("analytics_events")
      .select(
        "event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at",
      )
      .eq("property_id", id)
      .gte("occurred_at", window.from)
      .lte("occurred_at", window.to)
      .order("occurred_at", { ascending: true })
      .limit(50000),
  ]);
  if (property.error) return c.json({ error: "property_not_found" }, 404);
  return c.json({
    generatedAt: new Date().toISOString(),
    period: `${window.from.slice(0, 10)}–${window.to.slice(0, 10)}`,
    periodStart: window.from.slice(0, 10),
    periodEnd: window.to.slice(0, 10),
    property: property.data,
    incidents: incidents.data,
    audits: audits.data,
    analytics: buildAnalyticsSummary(
      analytics.data || [],
      window.days,
      window.from,
      window.to,
    ),
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
    await createPropertyNotification(env, run.property_id, {
      category: "audit_issues",
      title: "Audit completed",
      body: `Audit finished with score ${score ?? "—"} and ${coverage}% coverage.`,
      severity: score != null && score < 80 ? "warning" : "info",
      dedupeKey: `audit:${id}:completed`,
    });
    if (run.created_by)
      await recordActivity(env, run.created_by, "audit.completed", run.property_id, {
        auditRunId: id,
        score,
        coverage,
      });
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
  const now = new Date().toISOString();
  const { data: maintenance } = await db
    .from("maintenance_windows")
    .select("id")
    .eq("monitor_id", id)
    .lte("starts_at", now)
    .gt("ends_at", now)
    .limit(1)
    .maybeSingle();
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
      suppressed_by_maintenance: Boolean(maintenance),
    });
  const failures = maintenance
    ? monitor.consecutive_failures || 0
    : ok
      ? 0
      : (monitor.consecutive_failures || 0) + 1;
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
  if (maintenance) return;
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
  const { data: property } = await db
    .from("properties")
    .select("id,name,workspaces(account_id)")
    .eq("id", incident.property_id)
    .single();
  await createPropertyNotification(env, incident.property_id, {
    category: kind === "down" ? "monitor_incidents" : "recoveries",
    title: kind === "down" ? "Website unavailable" : "Website recovered",
    body: kind === "down"
      ? `${property?.name || "A property"} exceeded its configured failure threshold.`
      : `${property?.name || "A property"} returned a successful response and the incident was closed.`,
    severity: kind === "down" ? "critical" : "info",
    dedupeKey: `${incident.id}:${kind}:in_app`,
  });
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
      .lte("next_check_at", uptimeDueHorizon())
      .limit(100);
    await Promise.all(
      (data || []).map((m) => env.JOBS.send({ type: "uptime", id: m.id })),
    );
  } else {
    await db.rpc("aggregate_analytics_day", {
      p_day: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    });
    await runDueReportSchedules(env, db);
  }
}

export function uptimeDueHorizon(now = Date.now()) {
  // Cron fires on the five-minute boundary, while a completed check records its
  // next due time a few seconds later. A bounded look-ahead prevents every
  // second tick being skipped without treating materially early monitors as due.
  return new Date(now + 60_000).toISOString();
}

async function runDueReportSchedules(env: Env, db: SupabaseClient) {
  const now = new Date();
  const { data: schedules } = await db
    .from("report_schedules")
    .select("*,properties(id,name,canonical_host)")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .limit(100);
  for (const schedule of schedules || []) {
    const nextRun = new Date(
      now.getTime() + (schedule.cadence === "weekly" ? 7 : 30) * 864e5,
    ).toISOString();
    try {
      const from = new Date(now.getTime() - (schedule.cadence === "weekly" ? 7 : 30) * 864e5);
      const [events, incidents, audits] = await Promise.all([
        db
          .from("analytics_events")
          .select("event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at")
          .eq("property_id", schedule.property_id)
          .gte("occurred_at", from.toISOString())
          .order("occurred_at")
          .limit(50000),
        db
          .from("incidents")
          .select("*")
          .eq("property_id", schedule.property_id)
          .gte("opened_at", from.toISOString())
          .order("opened_at", { ascending: false }),
        db
          .from("audit_runs")
          .select("id,status,score,coverage,created_at")
          .eq("property_id", schedule.property_id)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      const days = schedule.cadence === "weekly" ? 7 : 30;
      const snapshot = {
        generatedAt: now.toISOString(),
        periodStart: from.toISOString().slice(0, 10),
        periodEnd: now.toISOString().slice(0, 10),
        property: schedule.properties,
        analytics: buildAnalyticsSummary(events.data || [], days),
        incidents: incidents.data || [],
        audits: audits.data || [],
      };
      const reportName = `${schedule.properties?.name || "Property"} ${schedule.cadence} report`;
      await db.from("saved_reports").insert({
        property_id: schedule.property_id,
        template_id: schedule.template_id,
        name: reportName,
        period_start: snapshot.periodStart,
        period_end: snapshot.periodEnd,
        data_snapshot: snapshot,
        created_by: schedule.created_by,
      });
      let delivered = 0;
      let lastError: string | null = null;
      if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
        lastError = "email_delivery_not_configured";
      } else {
        for (const recipient of schedule.recipients || []) {
          const key = `report:${schedule.id}:${snapshot.periodEnd}:${recipient}`;
          const { data: claimed } = await db.rpc("claim_notification", {
            p_key: key,
            p_kind: "scheduled_report",
            p_recipient: recipient,
            p_payload: { scheduleId: schedule.id, propertyId: schedule.property_id },
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
              to: [recipient],
              subject: `Claritude report · ${schedule.properties?.name || "Property"}`,
              html: renderReportEmail(snapshot),
            }),
          });
          await db
            .from("notification_deliveries")
            .update({
              status: response.ok ? "sent" : "failed",
              provider_id: response.headers.get("x-message-id"),
              error: response.ok ? null : (await response.text()).slice(0, 1000),
              updated_at: new Date().toISOString(),
            })
            .eq("dedupe_key", key);
          if (response.ok) delivered += 1;
          else lastError = "one_or_more_deliveries_failed";
        }
      }
      await db
        .from("report_schedules")
        .update({
          last_run_at: now.toISOString(),
          last_error: lastError,
          last_delivery_count: delivered,
          next_run_at: nextRun,
        })
        .eq("id", schedule.id);
    } catch (error) {
      await db
        .from("report_schedules")
        .update({
          last_run_at: now.toISOString(),
          last_error: errorMessage(error),
          next_run_at: nextRun,
        })
        .eq("id", schedule.id);
    }
  }
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
    "js_error",
    "visible_section",
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

export function buildAnalyticsSummary(
  events: any[],
  days: number,
  from = new Date(Date.now() - days * 864e5).toISOString(),
  to = new Date().toISOString(),
) {
  const pageMap = new Map<string, { pageviews: number; events: number }>();
  const seriesMap = new Map<string, { pageviews: number; events: number; sessions: Set<string> }>();
  const sourceMap = new Map<string, { pageviews: number; events: number }>();
  const countryMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const browserMap = new Map<string, number>();
  const screenMap = new Map<string, number>();
  const campaignMap = new Map<string, number>();
  const eventMap = new Map<string, number>();
  const sessions = new Set<string>();
  const vitals = new Map<string, number[]>();
  const vitalDays = new Map<string, Map<string, number[]>>();
  const views = new Map<string, {
    path: string;
    activeSeconds: number;
    maxScroll: number;
    keyEvents: number;
    jsErrors: number;
    visibleSections: Set<string>;
    vitals: Map<string, number>;
  }>();
  let pageviews = 0;
  let keyEvents = 0;
  let javascriptErrors = 0;
  const bump = (map: Map<string, number>, key: unknown, amount = 1) => {
    const clean = String(key || "Unknown").trim() || "Unknown";
    map.set(clean, (map.get(clean) || 0) + amount);
  };
  const sourceEntry = (name: string) => {
    const current = sourceMap.get(name) || { pageviews: 0, events: 0 };
    sourceMap.set(name, current);
    return current;
  };
  for (const event of events) {
    const path = normalizeAnalyticsPath(event.path);
    const page = pageMap.get(path) || { pageviews: 0, events: 0 };
    const day = String(event.occurred_at).slice(0, 10);
    const point = seriesMap.get(day) || { pageviews: 0, events: 0, sessions: new Set<string>() };
    const viewId = typeof event.metadata?.view_id === "string" ? event.metadata.view_id : "";
    if (event.event_type === "pageview") {
      pageviews += 1;
      page.pageviews += 1;
      point.pageviews += 1;
      const source = analyticsSourceCategory(event);
      sourceEntry(source).pageviews += 1;
      bump(countryMap, event.country_code || "Unknown");
      bump(deviceMap, event.device || "Unknown");
      bump(browserMap, event.metadata?.browser || "Unknown");
      bump(screenMap, analyticsScreenCategory(event.metadata?.screen));
      if (event.metadata?.utm_campaign)
        bump(campaignMap, event.metadata.utm_campaign);
      if (event.metadata?.session) {
        sessions.add(event.metadata.session);
        point.sessions.add(event.metadata.session);
      }
      if (viewId && !views.has(viewId)) {
        views.set(viewId, {
          path,
          activeSeconds: 0,
          maxScroll: 0,
          keyEvents: 0,
          jsErrors: 0,
          visibleSections: new Set<string>(),
          vitals: new Map<string, number>(),
        });
      }
    }
    const keyEvent = ["click", "outbound", "form_success"].includes(event.event_type);
    if (keyEvent) {
      keyEvents += 1;
      page.events += 1;
      point.events += 1;
      bump(eventMap, event.name || event.event_type);
      sourceEntry(analyticsSourceCategory(event)).events += 1;
      if (viewId && views.has(viewId)) views.get(viewId)!.keyEvents += 1;
    }
    if (event.event_type === "active_time" && Number.isFinite(event.value) && viewId && views.has(viewId))
      views.get(viewId)!.activeSeconds += Number(event.value);
    if (event.event_type === "scroll" && Number.isFinite(event.value) && viewId && views.has(viewId))
      views.get(viewId)!.maxScroll = Math.max(views.get(viewId)!.maxScroll, Number(event.value));
    if (event.event_type === "js_error") {
      javascriptErrors += 1;
      if (viewId && views.has(viewId)) views.get(viewId)!.jsErrors += 1;
    }
    if (event.event_type === "visible_section" && event.name && viewId && views.has(viewId))
      views.get(viewId)!.visibleSections.add(String(event.name));
    if (event.event_type === "web_vital" && event.name && Number.isFinite(event.value)) {
      const name = String(event.name).toUpperCase();
      const samples = vitals.get(name) || [];
      samples.push(Number(event.value));
      vitals.set(name, samples);
      const daily = vitalDays.get(name) || new Map<string, number[]>();
      const dailySamples = daily.get(day) || [];
      dailySamples.push(Number(event.value));
      daily.set(day, dailySamples);
      vitalDays.set(name, daily);
      if (viewId && views.has(viewId)) views.get(viewId)!.vitals.set(name, Number(event.value));
    }
    if (event.event_type === "pageview" || keyEvent) pageMap.set(path, page);
    seriesMap.set(day, point);
  }
  const ranked = (map: Map<string, number>) =>
    [...map].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const percentile = (values: number[], fraction: number) => {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
  };
  const vitalRows = [...vitals].map(([name, values]) => ({
    name,
    value: Math.round(Number(percentile(values, 0.75)) * 100) / 100,
    samples: values.length,
    percentile: 75,
  }));
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  const calendarDays: string[] = [];
  for (let cursor = new Date(`${fromDay}T00:00:00.000Z`), index = 0;
    cursor <= new Date(`${toDay}T00:00:00.000Z`) && index < 91;
    cursor = new Date(cursor.valueOf() + 864e5), index += 1)
    calendarDays.push(cursor.toISOString().slice(0, 10));
  const eligibleViews = [...views.values()];
  const engagedViews = eligibleViews.filter(
    (view) => view.activeSeconds >= 10 || view.maxScroll >= 50 || view.keyEvents > 0,
  );
  const activeTimes = eligibleViews.map((view) => view.activeSeconds);
  const scrollDepths = eligibleViews.map((view) => view.maxScroll);
  const engagedPageMap = new Map<string, number>();
  const visibleSectionMap = new Map<string, number>();
  for (const view of engagedViews) bump(engagedPageMap, view.path);
  for (const view of eligibleViews)
    for (const section of view.visibleSections) bump(visibleSectionMap, section);
  const scrollDepth = [25, 50, 75, 90].map((depth) => ({
    depth,
    pageviews: eligibleViews.filter((view) => view.maxScroll >= depth).length,
  }));
  const vitalSeries = Object.fromEntries(
    [...vitalDays].map(([name, values]) => [
      name,
      calendarDays.map((day) => ({
        day,
        value: values.has(day) ? percentile(values.get(day)!, 0.75) : null,
        samples: values.get(day)?.length || 0,
      })),
    ]),
  );
  const goodVitalViews = eligibleViews.filter((view) =>
    view.vitals.has("LCP") &&
    view.vitals.has("INP") &&
    view.vitals.has("CLS"),
  );
  const goodExperiences = goodVitalViews.filter((view) =>
    view.vitals.get("LCP")! <= 2500 &&
    view.vitals.get("INP")! <= 200 &&
    view.vitals.get("CLS")! <= 0.1,
  ).length;
  return {
    from,
    to,
    pageviews,
    events: events.length,
    keyEvents,
    sessions: sessions.size,
    averageDailyVisitors: sessions.size
      ? Math.round(calendarDays.reduce((total, day) => total + (seriesMap.get(day)?.sessions.size || 0), 0) / Math.max(1, calendarDays.length))
      : null,
    dailyVisitorMethod: sessions.size ? "anonymous_sessions" : "unavailable",
    truncated: events.length >= 50000,
    pages: [...pageMap]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.pageviews - a.pageviews),
    series: calendarDays.map((day) => ({
      day,
      pageviews: seriesMap.get(day)?.pageviews || 0,
      events: seriesMap.get(day)?.events || 0,
      dailyVisitors: seriesMap.get(day)?.sessions.size || 0,
    })),
    sources: [...sourceMap]
      .map(([name, value]) => ({ name, ...value }))
      .filter((source) => source.pageviews || source.events)
      .sort((a, b) => b.pageviews - a.pageviews),
    countries: ranked(countryMap),
    devices: ranked(deviceMap),
    browsers: ranked(browserMap),
    screens: ranked(screenMap),
    campaigns: ranked(campaignMap),
    eventBreakdown: ranked(eventMap),
    engagement: {
      eligiblePageviews: eligibleViews.length,
      engagedPageviews: eligibleViews.length ? engagedViews.length : null,
      medianScrollDepth: eligibleViews.length ? percentile(scrollDepths, 0.5) : null,
      pageviewsWithKeyEvents: eligibleViews.length
        ? eligibleViews.filter((view) => view.keyEvents > 0).length
        : null,
      medianActiveSeconds: eligibleViews.length ? percentile(activeTimes, 0.5) : null,
      engagementRate: eligibleViews.length ? (engagedViews.length / eligibleViews.length) * 100 : null,
      javascriptErrors,
      scrollDepth,
      pages: ranked(engagedPageMap).map(({ name, count }) => ({ path: name, engagedViews: count })),
      visibleSections: ranked(visibleSectionMap),
      collectionStatus: eligibleViews.length ? "available" : "historical_view_ids_unavailable",
    },
    vitals: vitalRows,
    performance: {
      vitals: vitalRows,
      series: vitalSeries,
      eligibleGoodExperienceViews: goodVitalViews.length,
      goodExperiencesPercent: goodVitalViews.length
        ? (goodExperiences / goodVitalViews.length) * 100
        : null,
      minimumSamples: 75,
      method: "p75",
    },
  };
}

export type AnalyticsFilters = {
  pageSearch?: string;
  pathMode?: "exact" | "prefix";
  pathValue?: string;
  device?: string;
  source?: string;
  country?: string;
  browser?: string;
  eventName?: string;
  metric?: string;
  sourceType?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export function filterAnalyticsEvents(events: any[], filters: AnalyticsFilters) {
  const search = filters.pageSearch?.trim().toLocaleLowerCase();
  const normalizedPathValue = filters.pathValue
    ? normalizeAnalyticsPath(filters.pathValue).toLocaleLowerCase()
    : "";
  const pathValue = filters.pathMode === "prefix" && normalizedPathValue !== "/"
    ? normalizedPathValue.replace(/\/$/, "")
    : normalizedPathValue;
  const device = filters.device?.trim().toLocaleLowerCase();
  const source = filters.source?.trim().toLocaleLowerCase();
  const country = filters.country?.trim().toLocaleLowerCase();
  const browser = filters.browser?.trim().toLocaleLowerCase();
  const eventName = filters.eventName?.trim().toLocaleLowerCase();
  const metric = filters.metric?.trim().toLocaleUpperCase();
  const sourceType = filters.sourceType?.trim().toLocaleLowerCase();
  const utmSource = filters.utmSource?.trim().toLocaleLowerCase();
  const utmMedium = filters.utmMedium?.trim().toLocaleLowerCase();
  const utmCampaign = filters.utmCampaign?.trim().toLocaleLowerCase();
  return events.filter((event) => {
    const path = normalizeAnalyticsPath(event.path).toLocaleLowerCase();
    if (search && !path.includes(search)) return false;
    if (pathValue && filters.pathMode === "exact" && path !== pathValue) return false;
    if (pathValue && filters.pathMode === "prefix" && !path.startsWith(pathValue)) return false;
    if (device && String(event.device || "Unknown").toLocaleLowerCase() !== device) return false;
    if (source && analyticsSourceCategory(event).toLocaleLowerCase() !== source && analyticsSource(event).toLocaleLowerCase() !== source) return false;
    if (country && String(event.country_code || "Unknown").toLocaleLowerCase() !== country)
      return false;
    if (browser && String(event.metadata?.browser || "Unknown").toLocaleLowerCase() !== browser)
      return false;
    const isKeyEvent = ["click", "outbound", "form_success"].includes(event.event_type);
    if (eventName && isKeyEvent && String(event.name || event.event_type).toLocaleLowerCase() !== eventName)
      return false;
    if (eventName && !isKeyEvent && event.event_type !== "pageview") return false;
    if (metric && event.event_type === "web_vital" && String(event.name || "").toLocaleUpperCase() !== metric)
      return false;
    if (sourceType && analyticsSourceType(event).toLocaleLowerCase() !== sourceType) return false;
    if (utmSource && String(event.metadata?.utm_source || "").toLocaleLowerCase() !== utmSource) return false;
    if (utmMedium && String(event.metadata?.utm_medium || "").toLocaleLowerCase() !== utmMedium) return false;
    if (utmCampaign && String(event.metadata?.utm_campaign || "").toLocaleLowerCase() !== utmCampaign) return false;
    return true;
  });
}

function buildAnalyticsFilterOptions(events: any[]) {
  const unique = (values: string[]) =>
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    paths: unique(
      events
        .filter((event) => event.event_type === "pageview")
        .map((event) => normalizeAnalyticsPath(event.path)),
    ),
    devices: unique(events.map((event) => String(event.device || "Unknown"))),
    sources: unique(events.map(analyticsSourceCategory)),
    countries: unique(events.map((event) => String(event.country_code || "Unknown"))),
    browsers: unique(events.map((event) => String(event.metadata?.browser || "Unknown"))),
    eventNames: unique(events
      .filter((event) => ["click", "outbound", "form_success"].includes(event.event_type))
      .map((event) => String(event.name || event.event_type))),
    metrics: unique(events
      .filter((event) => event.event_type === "web_vital")
      .map((event) => String(event.name || "").toUpperCase())),
    sourceTypes: unique(events.map(analyticsSourceType)),
    utmSources: unique(events.map((event) => String(event.metadata?.utm_source || ""))),
    utmMediums: unique(events.map((event) => String(event.metadata?.utm_medium || ""))),
    utmCampaigns: unique(events.map((event) => String(event.metadata?.utm_campaign || ""))),
  };
}

function analyticsSource(event: any) {
  return String(event.source || event.metadata?.utm_source || event.referrer_host || "Direct / unknown").trim() || "Direct / unknown";
}

function analyticsSourceCategory(event: any) {
  const source = analyticsSource(event).toLocaleLowerCase();
  if (source === "direct" || source === "direct / unknown") return "Direct / unknown";
  if (source.includes("google")) return "Google";
  if (source.includes("linkedin")) return "LinkedIn";
  if (source.includes("instagram")) return "Instagram";
  return "Other referrals";
}

function analyticsSourceType(event: any) {
  const category = analyticsSourceCategory(event);
  if (category === "Direct / unknown") return "Direct";
  if (category === "Google") return "Search";
  if (["LinkedIn", "Instagram"].includes(category)) return "Social";
  return event.metadata?.utm_medium ? String(event.metadata.utm_medium) : "Referral";
}

function analyticsScreenCategory(value: unknown) {
  const screen = String(value || "Unknown").toLocaleLowerCase();
  if (screen === "large") return "Large · 1280px+";
  if (screen === "medium") return "Medium · 768–1279px";
  if (screen === "small") return "Small · under 768px";
  return "Unknown";
}

function cleanAnalyticsFilter(value: string | undefined, maximumLength: number) {
  const clean = value?.trim();
  return clean ? clean.slice(0, maximumLength) : undefined;
}

export function normalizeAnalyticsPath(value: unknown) {
  const raw = String(value || "/").trim() || "/";
  try {
    const pathname = new URL(raw, "https://invalid.local").pathname || "/";
    const collapsed = `/${pathname.split("/").filter(Boolean).join("/")}`;
    return collapsed === "/" ? "/" : `${collapsed}/`;
  } catch {
    return "/";
  }
}

function cleanPath(v: unknown) {
  try {
    const u = new URL(String(v), "https://invalid.local");
    return normalizeAnalyticsPath(u.pathname).slice(0, 500);
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
export function validPublicUrl(value: string) {
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
export function isPrivateHost(h: string) {
  const x = h.toLowerCase().replace(/\.$/, "");
  return (
    x === "localhost" ||
    x.endsWith(".local") ||
    x.endsWith(".internal") ||
    /^(127\.|10\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      x,
    ) ||
    x === "::" ||
    x === "::1" ||
    x.startsWith("::ffff:127.") ||
    x.startsWith("::ffff:10.") ||
    x.startsWith("::ffff:192.168.") ||
    x.startsWith("fc") ||
    x.startsWith("fd") ||
    x.startsWith("fe80:") ||
    x.startsWith("ff")
  );
}
async function assertPublicResolution(hostname: string) {
  if (isPrivateHost(hostname)) throw new Error("Target resolved to a private address");
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) return;
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw new Error("DNS validation failed");
      const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
      return (body.Answer || [])
        .filter((answer) => answer.type === 1 || answer.type === 28)
        .map((answer) => answer.data);
    }),
  );
  const addresses = answers.flat();
  if (!addresses.length) throw new Error("Target hostname did not resolve");
  if (addresses.some(isPrivateHost)) throw new Error("Target resolved to a private address");
}
async function safeFetch(value: string, init: RequestInit = {}) {
  let url = validPublicUrl(value);
  if (!url) throw new Error("Target must be a public HTTP or HTTPS URL");
  for (let i = 0; i < 5; i++) {
    await assertPublicResolution(url.hostname);
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

function sameSiteHost(left: string, right: string) {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return normalize(left) === normalize(right);
}

function validDateRange(value: string, maximumFutureMs: number) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) &&
    date.valueOf() >= Date.now() - 5 * 60_000 &&
    date.valueOf() <= Date.now() + maximumFutureMs
    ? date.toISOString()
    : null;
}

function requestedWindow(c: any, defaultDays = 30, maximumDays = 90) {
  const fromValue = c.req.query("from");
  const toValue = c.req.query("to");
  if (!fromValue && !toValue) {
    const days = Math.min(
      maximumDays,
      Math.max(1, Number(c.req.query("days") || defaultDays)),
    );
    if (!Number.isFinite(days)) return null;
    return {
      days,
      from: new Date(Date.now() - days * 864e5).toISOString(),
      to: new Date().toISOString(),
    };
  }
  if (!fromValue || !toValue) return null;
  const fromDate = new Date(`${fromValue}T00:00:00.000Z`);
  const toDate = new Date(`${toValue}T23:59:59.999Z`);
  const span = toDate.valueOf() - fromDate.valueOf();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromValue) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toValue) ||
    !Number.isFinite(span) ||
    span < 0 ||
    span > maximumDays * 864e5
  )
    return null;
  return {
    days: Math.max(1, Math.ceil((span + 1) / 864e5)),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

function sanitizeNotificationPreferences(input: Record<string, boolean>) {
  const keys = [
    "monitor_incidents",
    "recoveries",
    "tracking_problems",
    "audit_issues",
    "billing_subscription",
    "account_security",
  ];
  return Object.fromEntries(keys.map((key) => [key, input[key] !== false]));
}

function sanitizeEventMatchSettings(eventType: string, input?: Record<string, unknown>) {
  if (eventType === "click") return { method: "data_attribute" };
  if (eventType === "form_success") return { method: "confirmed_callback" };
  if (eventType !== "pageview") return null;
  const mode = input?.mode === "prefix" ? "prefix" : input?.mode === "exact" ? "exact" : null;
  const path = cleanPath(input?.path);
  return mode && path ? { mode, path } : null;
}

function sanitizePropertySettings(input?: Record<string, unknown>) {
  if (!input) return {};
  const output: Record<string, unknown> = {};
  if (typeof input.timezone === "string")
    output.timezone = input.timezone.trim().slice(0, 80);
  if (["GBP", "USD", "EUR"].includes(String(input.reporting_currency)))
    output.reporting_currency = input.reporting_currency;
  if (["disabled"].includes(String(input.analytics_cookies)))
    output.analytics_cookies = input.analytics_cookies;
  if (["anonymous"].includes(String(input.visitor_profiles)))
    output.visitor_profiles = input.visitor_profiles;
  if (["discard_after_geolocation", "discard_immediately"].includes(String(input.ip_address_handling)))
    output.ip_address_handling = input.ip_address_handling;
  if (Array.isArray(input.sensitive_query_parameters))
    output.sensitive_query_parameters = input.sensitive_query_parameters
      .map((item) => String(item).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40))
      .filter(Boolean)
      .slice(0, 30);
  if (input.report_branding && typeof input.report_branding === "object") {
    const branding = input.report_branding as Record<string, unknown>;
    output.report_branding = {
      agency_name: String(branding.agency_name || "").trim().slice(0, 100),
      accent_colour: /^#[0-9a-f]{6}$/i.test(String(branding.accent_colour || ""))
        ? branding.accent_colour
        : "#111111",
      footer_note: String(branding.footer_note || "").trim().slice(0, 240),
    };
  }
  return output;
}

async function canManageWorkspace(
  db: SupabaseClient,
  userId: string,
  workspaceId?: string,
) {
  if (!workspaceId) return false;
  const { data } = await db
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .in("role", ["owner", "member"])
    .maybeSingle();
  return Boolean(data);
}

async function authUsersById(service: SupabaseClient, userIds: string[]) {
  if (!userIds.length) return [];
  const wanted = new Set(userIds);
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users
    .filter((user) => wanted.has(user.id))
    .map((user) => ({
      id: user.id,
      email: user.email || "",
      name: String(user.user_metadata?.full_name || "").slice(0, 100),
      confirmedAt: user.email_confirmed_at || null,
      lastSignInAt: user.last_sign_in_at || null,
    }));
}

async function findOrInviteUser(
  service: SupabaseClient,
  email: string,
  appOrigin: string,
) {
  const { data: listed, error: listError } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  const existing = listed.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) return { id: existing.id, invitationSent: false };
  const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appOrigin.replace(/\/$/, "")}/auth/confirmed`,
  });
  if (error || !data.user) throw error || new Error("Invitation could not be created");
  return { id: data.user.id, invitationSent: true };
}

async function recordActivity(
  env: Env,
  actorId: string,
  action: string,
  propertyId?: string,
  metadata: Record<string, unknown> = {},
) {
  const db = admin(env);
  let accountId: string | undefined;
  if (propertyId) {
    const { data: property } = await db
      .from("properties")
      .select("workspaces(account_id)")
      .eq("id", propertyId)
      .maybeSingle();
    accountId = (property?.workspaces as any)?.account_id;
  } else if (metadata.workspaceId) {
    const { data: workspace } = await db
      .from("workspaces")
      .select("account_id")
      .eq("id", metadata.workspaceId)
      .maybeSingle();
    accountId = workspace?.account_id;
  } else {
    const { data: membership } = await db
      .from("account_memberships")
      .select("account_id")
      .eq("user_id", actorId)
      .limit(1)
      .maybeSingle();
    accountId = membership?.account_id;
  }
  if (!accountId) return;
  await db.from("activity_log").insert({
    account_id: accountId,
    actor_id: actorId,
    action,
    property_id: propertyId || null,
    metadata,
  });
}

async function createPropertyNotification(
  env: Env,
  propertyId: string,
  notification: {
    category: string;
    title: string;
    body: string;
    severity: string;
    dedupeKey: string;
  },
) {
  const db = admin(env);
  const { data: property } = await db
    .from("properties")
    .select("workspaces(account_id)")
    .eq("id", propertyId)
    .maybeSingle();
  const accountId = (property?.workspaces as any)?.account_id;
  if (!accountId) return;
  const { data: members } = await db
    .from("account_memberships")
    .select("user_id")
    .eq("account_id", accountId);
  if (!members?.length) return;
  const { data: profiles } = await db
    .from("profiles")
    .select("id,notification_preferences,alerts_snoozed_until")
    .in("id", members.map((member) => member.user_id));
  const now = Date.now();
  const allowedUsers = new Set(
    (profiles || [])
      .filter(
        (profile) =>
          profile.notification_preferences?.[notification.category] !== false &&
          (!profile.alerts_snoozed_until ||
            new Date(profile.alerts_snoozed_until).valueOf() <= now),
      )
      .map((profile) => profile.id),
  );
  const rows = members.filter((member) => allowedUsers.has(member.user_id)).map((member) => ({
      account_id: accountId,
      user_id: member.user_id,
      property_id: propertyId,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      dedupe_key: `${notification.dedupeKey}:${member.user_id}`,
    }));
  if (!rows.length) return;
  await db.from("notifications").upsert(
    rows,
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderReportEmail(snapshot: any) {
  const analytics = snapshot.analytics || {};
  const latestAudit = snapshot.audits?.[0];
  return `<h1>${escapeHtml(snapshot.property?.name || "Claritude report")}</h1>
    <p>${escapeHtml(snapshot.periodStart)} to ${escapeHtml(snapshot.periodEnd)}</p>
    <ul>
      <li>Pageviews: ${escapeHtml(analytics.pageviews || 0)}</li>
      <li>Key events: ${escapeHtml(analytics.keyEvents || 0)}</li>
      <li>Incidents: ${escapeHtml(snapshot.incidents?.length || 0)}</li>
      <li>Latest audit: ${escapeHtml(latestAudit?.score ?? "Not run")} (${escapeHtml(latestAudit?.coverage ?? 0)}% coverage)</li>
    </ul>
    <p>Open Claritude for evidence, filters and the full report.</p>`;
}

const TRACKER_SOURCE = `(()=>{
  const s=document.currentScript,p=s&&s.dataset.property,endpoint=s&&new URL('/collect',s.src).href;
  if(!p||!endpoint||window.__claritude)return;window.__claritude=1;
  let q=[],timer,lastUrl=location.href,active=0,reportedActive=0,cls=0,lcp=0,inp=0,view=crypto.randomUUID(),vitalsSent=false,errorCount=0;
  const marks=new Set,visibleSections=new Set;
  const params=new URLSearchParams(location.search);
  const session=sessionStorage.getItem('_claritude_session')||crypto.randomUUID();
  sessionStorage.setItem('_claritude_session',session);
  const browser=/Edg\//.test(navigator.userAgent)?'Edge':/Firefox\//.test(navigator.userAgent)?'Firefox':/Chrome\//.test(navigator.userAgent)?'Chrome':/Safari\//.test(navigator.userAgent)?'Safari':'Other';
  const common=()=>({session,view_id:view,browser,screen:innerWidth<768?'small':innerWidth<1280?'medium':'large',language:navigator.language||'',utm_source:params.get('utm_source')||'',utm_medium:params.get('utm_medium')||'',utm_campaign:params.get('utm_campaign')||'',utm_content:params.get('utm_content')||'',utm_term:params.get('utm_term')||''});
  const send=()=>{if(!q.length)return;const body=JSON.stringify(q.splice(0,20));if(navigator.sendBeacon&&document.visibilityState==='hidden')navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'}));else fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{})};
  const emit=(type,data={})=>{q.push({type,property:p,path:location.pathname,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',meta:common(),...data});clearTimeout(timer);timer=setTimeout(send,500)};
  addEventListener('click',e=>{const a=e.target.closest('[data-claritude-event],a[href]');if(!a)return;const name=a.dataset.claritudeEvent;if(name)emit('click',{name});if(a.href&&new URL(a.href,location.href).host!==location.host)emit('outbound',{name:new URL(a.href).host})},{passive:true});
  addEventListener('scroll',()=>{const height=Math.max(document.documentElement.scrollHeight,1),n=Math.round((scrollY+innerHeight)/height*100);[25,50,75,90].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);emit('scroll',{value:x})}})},{passive:true});
  const reportActive=()=>{const delta=active-reportedActive;if(delta>0){reportedActive=active;emit('active_time',{value:delta})}};
  const tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus())active+=5;if(active-reportedActive>=30)reportActive()},5000);
  const flushVitals=()=>{if(vitalsSent)return;vitalsSent=true;if(lcp)emit('web_vital',{name:'LCP',value:lcp});if(cls)emit('web_vital',{name:'CLS',value:cls});if(inp)emit('web_vital',{name:'INP',value:inp})};
  const sectionObserver='IntersectionObserver'in window?new IntersectionObserver(entries=>entries.forEach(entry=>{const name=entry.target.dataset.claritudeSection;if(entry.isIntersecting&&name&&!visibleSections.has(name)){visibleSections.add(name);emit('visible_section',{name})}}),{threshold:.5}):null;
  const observeSections=()=>sectionObserver&&document.querySelectorAll('[data-claritude-section]').forEach(node=>sectionObserver.observe(node));
  const page=()=>{emit('pageview',{source:params.get('utm_source')||''});observeSections()};page();
  const navigation=()=>{if(location.href!==lastUrl){reportActive();flushVitals();send();lastUrl=location.href;view=crypto.randomUUID();active=0;reportedActive=0;cls=0;lcp=0;inp=0;vitalsSent=false;errorCount=0;marks.clear();visibleSections.clear();page()}};
  new MutationObserver(()=>{navigation();observeSections()}).observe(document,{subtree:true,childList:true});
  ['pushState','replaceState'].forEach(k=>{const original=history[k];history[k]=function(...args){const result=original.apply(this,args);queueMicrotask(navigation);return result}});
  addEventListener('popstate',navigation);
  const reportError=(name,source)=>{if(errorCount>=5)return;errorCount+=1;let resource_origin='';try{resource_origin=source?new URL(source,location.href).origin:''}catch{}emit('js_error',{name,meta:{...common(),resource_origin}})};
  addEventListener('error',event=>reportError('script-error',event.filename||''),true);
  addEventListener('unhandledrejection',()=>reportError('promise-rejection',''));
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){flushVitals();send()}});
  addEventListener('pagehide',()=>{clearInterval(tick);reportActive();flushVitals();send()});
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
