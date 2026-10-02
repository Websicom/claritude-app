import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import WEB_VITALS_SOURCE from "../../node_modules/web-vitals/dist/web-vitals.iife.js?raw";
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
type AuditResourceEvidence = {
  url: string;
  status: number | null;
  finalUrl: string | null;
  body: string;
  contentType: string | null;
  error: string | null;
};
type AuditNetworkEvidence = {
  redirects: { url: string; status: number; location: string }[];
  canonical: AuditResourceEvidence | null;
  robots: AuditResourceEvidence;
  sitemaps: AuditResourceEvidence[];
  llms: AuditResourceEvidence;
  llmsFull: AuditResourceEvidence;
  dnsRecords: { query: string; type: string; ttl: number; data: string }[];
  dnsErrors: string[];
  dnsAuthenticated: boolean | null;
};

const LIMITS = {
  propertiesPerAccount: 25,
  auditsPerPropertyPerDay: 20,
  analyticsEventsPerPropertyPerDay: 50_000,
} as const;

export function editableWorkspaceRole(value: unknown): "member" | "viewer" | null {
  return value === "member" || value === "viewer" ? value : null;
}

export function workspaceDeletionError(workspaceCount: number, propertyCount: number) {
  if (workspaceCount <= 1) return "account_requires_one_workspace";
  if (propertyCount > 0) return "workspace_must_be_empty_before_deletion";
  return null;
}

const ACTIVE_AUDIT_CHECKS = AUDIT_REGISTRY.filter(
  (check) => check.lifecycle === "active",
);
const ACTIVE_AUDIT_IDS = new Set(ACTIVE_AUDIT_CHECKS.map((check) => check.id));
const EXPLICIT_SOURCE_CHECK_IDS = new Set([
  "seo.metadata.title.present",
  "seo.metadata.title.not_empty",
  "seo.metadata.title.length",
  "seo.metadata.description.present",
  "seo.metadata.description.not_empty",
  "seo.crawling.http_status",
  "seo.crawling.html_content",
  "seo.content.h1.present",
  "seo.content.h1.multiple",
  "accessibility.document.title",
  "accessibility.mobile.viewport",
  "security.https.selected",
  "security.headers.hsts",
  "security.headers.csp",
  "infrastructure.http.content_type",
  "ai.content.source_extractable",
]);
const CONTEXT_AUDIT_CHECK_IDS = new Set([
  "seo.page.metadata.canonical.target.reachable",
  "seo.page.metadata.canonical.target.redirects",
  "seo.crawling.and.indexing.redirect.chain.detected",
  "seo.crawling.and.indexing.redirect.loop.detected",
  "seo.crawling.and.indexing.robots.txt.file.reachable",
  "seo.crawling.and.indexing.robots.txt.contains.readable.text",
  "seo.crawling.and.indexing.robots.txt.parsing.errors.detected",
  "seo.crawling.and.indexing.selected.page.allowed.by.googlebot.robots.rules",
  "seo.crawling.and.indexing.selected.page.allowed.by.bingbot.robots.rules",
  "seo.crawling.and.indexing.sitemap.url.declared.in.robots.txt",
  "seo.crawling.and.indexing.conventional.sitemap.locations.checked",
  "seo.crawling.and.indexing.referenced.xml.sitemap.reachable",
  "seo.crawling.and.indexing.referenced.sitemap.xml.valid",
  "seo.crawling.and.indexing.selected.page.found.in.checked.sitemap.files",
  "seo.crawling.and.indexing.sitemap.lastmod.date.formats.valid",
  "infrastructure.dns.and.domain.configuration.returned.dns.record.ttls.recorded",
  "infrastructure.dns.and.domain.configuration.domain.nameservers.recorded",
  "infrastructure.dns.and.domain.configuration.domain.soa.record.recorded",
  "infrastructure.dns.and.domain.configuration.dns.resolver.errors.detected",
  "infrastructure.dns.and.domain.configuration.dnssec.validation.status.reported.by.the.resolver",
  "infrastructure.dns.and.domain.configuration.spf.record.detected",
  "infrastructure.dns.and.domain.configuration.multiple.spf.records.detected",
  "infrastructure.dns.and.domain.configuration.dmarc.record.detected",
  "infrastructure.dns.and.domain.configuration.dmarc.policy.recorded",
  "infrastructure.dns.and.domain.configuration.caa.certificate.authority.restrictions.detected",
  "infrastructure.dns.and.domain.configuration.selected.hostname.resolves.successfully",
  "infrastructure.dns.and.domain.configuration.ipv4.addresses.recorded",
  "infrastructure.dns.and.domain.configuration.ipv6.addresses.recorded",
  "infrastructure.dns.and.domain.configuration.returned.cname.records.recorded",
  "infrastructure.dns.and.domain.configuration.non.existent.hostname.response.detected",
  "infrastructure.dns.and.domain.configuration.apex.domain.resolution.checked",
  "infrastructure.dns.and.domain.configuration.www.hostname.resolution.checked",
  "infrastructure.dns.and.domain.configuration.mail.exchange.records.detected",
  "ai_readiness.crawler.permissions.selected.page.allowed.by.oai.searchbot.robots.rules",
  "ai_readiness.crawler.permissions.selected.page.allowed.by.gptbot.robots.rules",
  "ai_readiness.crawler.permissions.selected.page.allowed.by.claude.searchbot.robots.rules",
  "ai_readiness.crawler.permissions.selected.page.allowed.by.claudebot.robots.rules",
  "ai_readiness.crawler.permissions.explicit.chatgpt.user.robots.rules.detected",
  "ai_readiness.crawler.permissions.explicit.claude.user.robots.rules.detected",
  "ai_readiness.crawler.permissions.googlebot.robots.access.for.the.selected.page.checked",
  "ai_readiness.crawler.permissions.ai.search.and.training.crawler.permissions.differ",
  "ai_readiness.crawler.permissions.ai.crawler.rules.inherited.from.wildcard.directives.identified",
  "ai_readiness.optional.resources.llms.txt.file.reachable",
  "ai_readiness.optional.resources.llms.txt.returned.as.readable.text",
  "ai_readiness.optional.resources.llms.txt.title.detected",
  "ai_readiness.optional.resources.llms.txt.summary.detected",
  "ai_readiness.optional.resources.llms.txt.markdown.links.parse.correctly",
  "ai_readiness.optional.resources.llms.txt.links.checked.within.the.request.limit",
  "ai_readiness.optional.resources.selected.page.referenced.in.checked.llms.txt.links",
  "ai_readiness.optional.resources.llms.full.txt.file.reachable",
  "ai_readiness.optional.resources.llms.full.txt.returned.as.readable.text",
]);
const IMPLEMENTED_AUDIT_CHECKS = ACTIVE_AUDIT_CHECKS.filter(
  (check) => auditCheckHasExecutableLogic(check.id),
);

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const TRACKER_VERSION = "2.1.1";
const SUPPORTED_TRACKER_VERSIONS = new Set(["2.0.0", "2.1.0", TRACKER_VERSION]);
app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
app.use("*", async (c, next) => {
  await next();
  const publicScript = ["/c.js", "/tracker.js", "/vendor/web-vitals.js"].includes(c.req.path);
  c.header("cross-origin-resource-policy", publicScript ? "cross-origin" : "same-origin");
});
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
  c.header("cache-control", "public, max-age=60, must-revalidate");
  c.header("cross-origin-resource-policy", "cross-origin");
  c.header("access-control-allow-origin", "*");
  c.header("x-claritude-tracker-version", TRACKER_VERSION);
  return c.body(TRACKER_SOURCE);
};
app.get("/tracker.js", serveTracker);
app.get("/c.js", serveTracker);
app.get("/vendor/web-vitals.js", (c) => {
  c.header("content-type", "application/javascript; charset=utf-8");
  c.header("cache-control", "public, max-age=31536000, immutable");
  c.header("cross-origin-resource-policy", "cross-origin");
  c.header("access-control-allow-origin", "*");
  return c.body(WEB_VITALS_SOURCE);
});

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
  // A batch can be retried by sendBeacon/fetch or by the browser. Insert each
  // observation independently so a duplicate event_id never rejects otherwise
  // valid observations in the same delivery.
  const insertResults = await Promise.all(
    rows.map((row: any) => db.from("analytics_events").insert(row)),
  );
  const insertionFailure = insertResults.find(
    (result) => result.error && result.error.code !== "23505",
  )?.error;
  if (insertionFailure) return c.json({ error: "ingestion_failed" }, 503);
  await db
    .from("properties")
    .update({
      tracking_last_received_at: now,
      verification_status: "verified",
      verified_at: now,
    })
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
    accountId: string;
    workspaceId: string;
    name: string;
    url: string;
  }>();
  const name = b.name?.trim().slice(0, 100);
  if (!name) return c.json({ error: "property_name_required" }, 400);
  const target = validPublicUrl(b.url);
  if (!target) return c.json({ error: "public_http_url_required" }, 400);
  const canonicalHost = canonicalPropertyHost(target.hostname);
  const db = c.get("db");
  const { data: membership, error: membershipError } = await db
    .from("workspace_memberships")
    .select("role,workspaces(account_id)")
    .eq("workspace_id", b.workspaceId)
    .eq("user_id", c.get("userId"))
    .in("role", ["owner", "member"])
    .maybeSingle();
  const accountId = (membership?.workspaces as any)?.account_id;
  if (
    membershipError ||
    !accountId ||
    !b.accountId ||
    accountId !== b.accountId
  ) {
    if (membershipError)
      console.error("property_create_membership_lookup_failed", membershipError);
    return c.json({ error: "workspace_access_denied" }, 403);
  }
  const service = admin(c.env);
  const { data: accountWorkspaces, error: accountWorkspacesError } = await service
    .from("workspaces")
    .select("id")
    .eq("account_id", accountId);
  if (accountWorkspacesError) {
    console.error("property_create_account_scope_failed", accountWorkspacesError);
    return c.json({ error: "property_create_failed" }, 500);
  }
  const workspaceIds = (accountWorkspaces || []).map((workspace) => workspace.id);
  const { data: accountProperties, error: accountPropertiesError } = await service
    .from("properties")
    .select("id,workspace_id,canonical_host")
    .in("workspace_id", workspaceIds);
  if (accountPropertiesError) {
    console.error("property_create_limit_lookup_failed", accountPropertiesError);
    return c.json({ error: "property_create_failed" }, 500);
  }
  if ((accountProperties || []).length >= LIMITS.propertiesPerAccount)
    return c.json({ error: "property_limit_reached" }, 409);
  const duplicate = (accountProperties || []).find(
    (property) =>
      property.workspace_id === b.workspaceId &&
      canonicalPropertyHost(property.canonical_host) === canonicalHost,
  );
  if (duplicate) return c.json({ error: "property_already_exists" }, 409);
  const trackingId = `cl_${crypto.randomUUID().replaceAll("-", "")}`;
  // INSERT ... RETURNING also evaluates the SELECT policy before the new row is
  // visible to its relationship-based predicate. Keep both operations under RLS,
  // but commit the insert before reading the new property back.
  const { error } = await db
    .from("properties")
    .insert({
      workspace_id: b.workspaceId,
      name,
      url: target.href,
      canonical_host: canonicalHost,
      tracking_id: trackingId,
    });
  if (error) {
    console.error("property_create_insert_failed", {
      code: error.code,
      workspaceId: b.workspaceId,
      userId: c.get("userId"),
    });
    return c.json({ error: "property_create_failed" }, 400);
  }
  const { data, error: readError } = await db
    .from("properties")
    .select("*")
    .eq("tracking_id", trackingId)
    .single();
  if (readError || !data) {
    console.error("property_create_read_failed", {
      code: readError?.code,
      workspaceId: b.workspaceId,
      userId: c.get("userId"),
    });
    return c.json({ error: "property_created_but_reload_required" }, 500);
  }
  const { error: monitorError } = await service
    .from("uptime_monitors")
    .upsert(
      { property_id: data.id },
      { onConflict: "property_id", ignoreDuplicates: true },
    );
  if (monitorError)
    return c.json({ error: `property_created_monitor_failed: ${monitorError.message}` }, 500);
  const { error: auditPageError } = await service
    .from("property_audit_pages")
    .insert({
      property_id: data.id,
      name: "Homepage",
      path: "/",
      created_by: c.get("userId"),
    });
  if (auditPageError)
    return c.json({ error: `property_created_audit_page_failed: ${auditPageError.message}` }, 500);
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
  const { data: existingMembership } = await service
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", invited.id)
    .maybeSingle();
  if (existingMembership?.role === "owner")
    return c.json({ error: "workspace_owner_role_is_protected" }, 409);
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

app.patch("/api/workspaces/:id/members/:userId", async (c) => {
  const db = c.get("db");
  const workspaceId = c.req.param("id");
  if (!(await isWorkspaceOwner(db, c.get("userId"), workspaceId)))
    return c.json({ error: "workspace_owner_access_required" }, 403);
  const body = await c.req.json<{ role?: "member" | "viewer" }>();
  const role = editableWorkspaceRole(body.role);
  if (!role) return c.json({ error: "valid_workspace_role_required" }, 400);
  const service = admin(c.env);
  const { data: existing } = await service
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", c.req.param("userId"))
    .maybeSingle();
  if (!existing) return c.json({ error: "workspace_member_not_found" }, 404);
  if (existing.role === "owner")
    return c.json({ error: "workspace_owner_role_is_protected" }, 409);
  const { data, error } = await service
    .from("workspace_memberships")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", c.req.param("userId"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "workspace.member_updated", undefined, {
    workspaceId,
    targetUserId: c.req.param("userId"),
    role,
  });
  return c.json(data);
});

app.delete("/api/workspaces/:id/members/:userId", async (c) => {
  const db = c.get("db");
  const workspaceId = c.req.param("id");
  if (!(await isWorkspaceOwner(db, c.get("userId"), workspaceId)))
    return c.json({ error: "workspace_owner_access_required" }, 403);
  const service = admin(c.env);
  const { data: existing } = await service
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", c.req.param("userId"))
    .maybeSingle();
  if (!existing) return c.json({ error: "workspace_member_not_found" }, 404);
  if (existing.role === "owner")
    return c.json({ error: "workspace_owner_role_is_protected" }, 409);
  const { error } = await service
    .from("workspace_memberships")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "workspace.member_removed", undefined, {
    workspaceId,
    targetUserId: c.req.param("userId"),
  });
  return c.json({ deleted: true });
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

app.delete("/api/properties/:id/viewers/:userId", async (c) => {
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
  const { error, count } = await admin(c.env)
    .from("property_memberships")
    .delete({ count: "exact" })
    .eq("property_id", propertyId)
    .eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 400);
  if (!count) return c.json({ error: "property_viewer_not_found" }, 404);
  await recordActivity(c.env, c.get("userId"), "property.viewer_removed", propertyId, {
    targetUserId: c.req.param("userId"),
  });
  return c.json({ deleted: true });
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

app.delete("/api/workspaces/:id", async (c) => {
  const db = c.get("db");
  const workspaceId = c.req.param("id");
  const context = await workspaceOwnerContext(db, c.get("userId"), workspaceId);
  if (!context) return c.json({ error: "workspace_owner_access_required" }, 403);
  const service = admin(c.env);
  const [{ count: workspaceCount }, { count: propertyCount }] = await Promise.all([
    service
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("account_id", context.accountId),
    service
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  const deletionError = workspaceDeletionError(workspaceCount || 0, propertyCount || 0);
  if (deletionError) return c.json({ error: deletionError }, 409);
  await recordActivity(c.env, c.get("userId"), "workspace.deleted", undefined, {
    workspaceId,
    workspaceName: context.name,
  });
  const { error } = await service.from("workspaces").delete().eq("id", workspaceId);
  return error ? c.json({ error: error.message }, 400) : c.json({ deleted: true });
});

app.delete("/api/properties/:id", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const { data: property } = await db
    .from("properties")
    .select("id,name,workspace_id")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await isWorkspaceOwner(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "workspace_owner_access_required" }, 403);
  await recordActivity(c.env, c.get("userId"), "property.deleted", property.id, {
    workspaceId: property.workspace_id,
    propertyName: property.name,
  });
  const { error } = await admin(c.env).from("properties").delete().eq("id", propertyId);
  return error ? c.json({ error: error.message }, 400) : c.json({ deleted: true });
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
  const b = await c.req.json<{
    propertyId: string;
    pageId: string;
    checkIds?: string[];
  }>();
  const db = c.get("db");
  const { data: property } = await db
    .from("properties")
    .select("id,url")
    .eq("id", b.propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  const { data: auditPage } = await db
    .from("property_audit_pages")
    .select("id,property_id,name,path")
    .eq("id", b.pageId)
    .eq("property_id", property.id)
    .single();
  if (!auditPage) return c.json({ error: "audit_page_not_found" }, 404);
  const target = validPublicUrl(new URL(auditPage.path, property.url).href);
  if (!target || !sameSiteHost(target.hostname, new URL(property.url).hostname))
    return c.json({ error: "page_must_belong_to_property" }, 400);
  const { data: activeRun } = await db
    .from("audit_runs")
    .select("id,status,heartbeat_at,created_at")
    .eq("property_id", property.id)
    .eq("audit_page_id", auditPage.id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRun) {
    const lastHeartbeat = Date.parse(activeRun.heartbeat_at || activeRun.created_at);
    const isStalled = Number.isFinite(lastHeartbeat) && Date.now() - lastHeartbeat > 2 * 60_000;
    if (!isStalled)
      return c.json({ error: "audit_already_active", run: activeRun }, 409);
    await db
      .from("audit_runs")
      .update({
        status: "failed",
        execution_stage: "failed",
        error: "Audit worker stopped reporting progress. A replacement run may now be queued.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", activeRun.id)
      .in("status", ["queued", "running"]);
  }
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count: runsToday } = await db
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property.id)
    .in("status", ["queued", "running", "completed", "partial"])
    .gte("created_at", dayStart);
  if ((runsToday || 0) >= LIMITS.auditsPerPropertyPerDay)
    return c.json({ error: "audit_daily_limit_reached" }, 429);
  const { data: registryRows, error: registryError } = await db
    .from("audit_check_definitions")
    .select("id,title,weight,logic_version,configuration_version,primary_category,subcategory,severity,description,recommendation,source_reference")
    .eq("lifecycle", "active")
    .order("id");
  if (registryError)
    return c.json({ error: "audit_registry_unavailable" }, 503);
  let snapshot = buildRegistrySnapshot(
    registryRows || [],
    ACTIVE_AUDIT_IDS,
  );
  if (Array.isArray(b.checkIds) && b.checkIds.length) {
    const requested = new Set(b.checkIds.slice(0, 100));
    snapshot = snapshot.filter((check) => requested.has(check.id));
  }
  if (!snapshot.length) return c.json({ error: "audit_registry_empty" }, 503);
  const { data: run, error } = await db
    .from("audit_runs")
    .insert({
      property_id: property.id,
      audit_page_id: auditPage.id,
      page_url: target.href,
      status: "queued",
      registry_snapshot: snapshot,
      scoring_version: "1.0.0",
      execution_stage: "queued",
      progress_completed: 0,
      progress_total: snapshot.length,
      heartbeat_at: new Date().toISOString(),
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
  const db = c.get("db");
  const { data: property } = await db
    .from("properties")
    .select("id,url,canonical_host")
    .eq("id", c.req.param("id"))
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  const supplied = String(body.path || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(supplied || "/", property.url);
  } catch {
    return c.json({ error: "valid_audit_page_required" }, 400);
  }
  if (!sameSiteHost(parsed.hostname, property.canonical_host))
    return c.json({ error: "page_must_belong_to_property" }, 400);
  if (parsed.search || parsed.hash)
    return c.json({ error: "audit_page_query_and_fragment_not_allowed" }, 400);
  const path = cleanPath(parsed.pathname);
  if (!name || !path) return c.json({ error: "valid_audit_page_required" }, 400);
  const { data: duplicate } = await db
    .from("property_audit_pages")
    .select("id,name,path")
    .eq("property_id", property.id)
    .eq("path", path)
    .maybeSingle();
  if (duplicate) return c.json({ error: "audit_page_already_exists", page: duplicate }, 409);
  const { data, error } = await db
    .from("property_audit_pages")
    .insert({
      property_id: c.req.param("id"),
      name,
      path,
      created_by: c.get("userId"),
    })
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
  const db = c.get("db");
  const pageId = c.req.query("pageId");
  if (pageId) {
    const { data: page } = await db
      .from("property_audit_pages")
      .select("id")
      .eq("id", pageId)
      .eq("property_id", c.req.param("id"))
      .maybeSingle();
    if (!page) return c.json({ error: "audit_page_not_found" }, 404);
  }
  let query = db
    .from("audit_runs")
    .select("*,audit_results(*)")
    .eq("property_id", c.req.param("id"))
    .gte("created_at", window.from)
    .lte("created_at", window.to)
    .order("created_at", { ascending: false });
  if (pageId) query = query.eq("audit_page_id", pageId);
  const { data, error } = await query.limit(50);
  if (error) return c.json({ error: error.message }, 400);
  const definitions = new Map(AUDIT_REGISTRY.map((check) => [check.id, check]));
  return c.json(
    (data || []).map((run: any) => {
      const snapshotDefinitions = new Map((Array.isArray(run.registry_snapshot) ? run.registry_snapshot : []).map((check: any) => [check.id, check]));
      const auditResults = (run.audit_results || []).map((result: any) => {
        const definition = definitions.get(result.check_id);
        const snapshotDefinition: any = snapshotDefinitions.get(result.check_id);
        const primaryCategory = snapshotDefinition?.primaryCategory || definition?.primaryCategory;
        return {
          ...result,
          title: snapshotDefinition?.title || definition?.title || result.title_snapshot,
          category: primaryCategory
            ? categoryLabel(primaryCategory)
            : "General",
          subcategory: snapshotDefinition?.subcategory || definition?.subcategory || "General",
          severity: snapshotDefinition?.severity || definition?.severity || "informational",
          description: snapshotDefinition?.description || definition?.description || result.title_snapshot || "Recorded audit result.",
          recommendation: snapshotDefinition?.recommendation || definition?.recommendation || "Review the evidence.",
          source_reference: snapshotDefinition?.sourceReference || definition?.sourceReference || null,
          weight: Number(snapshotDefinition?.weight ?? definition?.weight ?? 1),
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

app.patch("/api/audit-results/:id/review", async (c) => {
  const body = await c.req.json<{ status: "not_reviewed" | "reviewed" | "fixed" | "accepted" }>();
  if (!["not_reviewed", "reviewed", "fixed", "accepted"].includes(body.status))
    return c.json({ error: "invalid_review_status" }, 400);
  const db = c.get("db");
  const { data: result } = await db
    .from("audit_results")
    .select("id,audit_runs(property_id)")
    .eq("id", c.req.param("id"))
    .single();
  if (!result) return c.json({ error: "audit_result_not_found" }, 404);
  const propertyId = (result.audit_runs as any)?.property_id;
  if (!propertyId) return c.json({ error: "audit_result_not_found" }, 404);
  const { data, error } = await admin(c.env)
    .from("audit_results")
    .update({
      review_status: body.status,
      reviewed_at: body.status === "not_reviewed" ? null : new Date().toISOString(),
      reviewed_by: body.status === "not_reviewed" ? null : c.get("userId"),
    })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "audit.result_reviewed", propertyId, {
    auditResultId: result.id,
    status: body.status,
  });
  return c.json(data);
});

app.get("/api/properties/:id/audit-coverage", async (c) => {
  const runId = c.req.query("runId");
  let run: any = null;
  if (runId) {
    const response = await c.get("db")
      .from("audit_runs")
      .select("id,status,registry_snapshot,audit_results(check_id,outcome,evidence,duration_ms)")
      .eq("id", runId)
      .eq("property_id", c.req.param("id"))
      .single();
    if (response.error || !response.data) return c.json({ error: "audit_run_not_found" }, 404);
    run = response.data;
  }
  const selected = new Set((run?.registry_snapshot || []).map((check: any) => check.id));
  const resultById = new Map((run?.audit_results || []).map((result: any) => [result.check_id, result]));
  const checks = ACTIVE_AUDIT_CHECKS.map((check) => {
    const result: any = resultById.get(check.id);
    const executable = auditCheckHasExecutableLogic(check.id);
    return {
      id: check.id,
      title: check.title,
      detailedCategory: check.subcategory,
      scoreCategory: categoryLabel(check.primaryCategory),
      scope: check.scope,
      collectionMethod: check.executionMethod,
      enabled: true,
      executable,
      selectedInRun: run ? selected.has(check.id) : null,
      outcome: result?.outcome || null,
      executionDurationMs: result?.duration_ms ?? null,
      reason: result?.outcome === "unable_to_test"
        ? result?.evidence?.reason || methodReason(check.executionMethod)
        : executable
          ? null
          : methodReason(check.executionMethod),
      logicVersion: check.logicVersion,
      configurationVersion: check.configurationVersion,
      sourceReference: check.sourceReference,
    };
  });
  return c.json({
    catalogueSize: checks.length,
    implementedChecks: checks.filter((check) => check.executable).length,
    successfullyExecutedChecks: checks.filter((check) => check.outcome && check.outcome !== "unable_to_test").length,
    runId: run?.id || null,
    runStatus: run?.status || null,
    checks,
  });
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
      window.timeZone,
    ),
    previous: buildAnalyticsSummary(
      filteredPrevious,
      window.days,
      previousFrom,
      previousTo,
      window.timeZone,
    ),
    // Filtering can reduce the returned set below the query ceiling. Preserve
    // whether the underlying property/date result hit that ceiling so the UI
    // never presents a partial result as complete.
    truncated: events.length >= 50000,
    filterOptions: buildAnalyticsFilterOptions(events),
    appliedFilters: filters,
  });
});

app.get("/api/properties/:id/analytics/pages", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const page = Math.max(1, Math.floor(Number(c.req.query("page") || 1)));
  const pageSize = [20, 100, 200].includes(Number(c.req.query("page_size")))
    ? Number(c.req.query("page_size"))
    : 20;
  const pathMode = ["exact", "prefix"].includes(c.req.query("path_mode") || "")
    ? c.req.query("path_mode")
    : null;
  const pathValue = cleanAnalyticsFilter(c.req.query("path_value"), 500);
  const normalizedPath = pathValue ? normalizeAnalyticsPath(pathValue) : null;
  const { data, error } = await c.get("db").rpc("analytics_pages_page", {
    p_property_id: c.req.param("id"),
    p_from: window.from,
    p_to: window.to,
    p_offset: (page - 1) * pageSize,
    p_limit: pageSize,
    p_page_search: cleanAnalyticsFilter(c.req.query("page_search"), 120) || null,
    p_path_mode: pathMode,
    p_path_value: normalizedPath,
    p_device: cleanAnalyticsFilter(c.req.query("device"), 40) || null,
    p_source: cleanAnalyticsFilter(c.req.query("source"), 255) || null,
    p_country: cleanAnalyticsFilter(c.req.query("country"), 20) || null,
  });
  if (error) return c.json({ error: error.message }, 400);
  const rows = (data || []).map((row: any) => ({
    path: row.path,
    pageviews: Number(row.pageviews || 0),
    events: Number(row.events || 0),
  }));
  const total = Number((data || [])[0]?.total_rows || 0);
  return c.json({ rows, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) });
});

app.get("/api/properties/:id/tracking-diagnostics", async (c) => {
  const { data, error } = await c.get("db")
    .from("analytics_events")
    .select("event_type,metadata,received_at")
    .eq("property_id", c.req.param("id"))
    .order("received_at", { ascending: false })
    .limit(1000);
  if (error) return c.json({ error: error.message }, 400);
  const rows = data || [];
  const counts: Record<string, number> = {};
  rows.forEach((row: any) => { counts[row.event_type] = (counts[row.event_type] || 0) + 1; });
  const latestVersion = rows.find((row: any) => row.metadata?.tracker_version)?.metadata?.tracker_version || null;
  return c.json({
    currentTrackerVersion: TRACKER_VERSION,
    receivedTrackerVersion: latestVersion,
    updateRequired: Boolean(latestVersion && latestVersion !== TRACKER_VERSION),
    lastReceivedAt: rows[0]?.received_at || null,
    sampleSize: rows.length,
    signals: {
      pageviews: counts.pageview || 0,
      scrollMilestones: counts.scroll || 0,
      activeTime: counts.active_time || 0,
      visibleSections: counts.visible_section || 0,
      javascriptErrors: counts.js_error || 0,
      webVitals: counts.web_vital || 0,
    },
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
      window.timeZone,
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
    .update({
      status: "running",
      execution_stage: "fetching_page",
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["queued", "running"])
    .select()
    .maybeSingle();
  if (!run) return;
  try {
    const fetchStarted = Date.now();
    const trace = await safeFetchTrace(run.page_url, {
      headers: { "user-agent": "Claritude-Audit/1.0 (+https://claritude.io)" },
    });
    const res = trace.response;
    const responseMs = Date.now() - fetchStarted;
    const snapshot = run.registry_snapshot as AuditRegistrySnapshot[];
    const html = await limitedText(res, 2_000_000);
    await db
      .from("audit_runs")
      .update({
        execution_stage: "evaluating_checks",
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", id);
    const networkEvidencePromise = collectAuditNetworkEvidence(
      run.page_url,
      res,
      html,
      trace.redirects,
    );
    const staticResults = evaluateSourceChecks(snapshot, res, html, responseMs)
      .filter((result) => !CONTEXT_AUDIT_CHECK_IDS.has(result.check_id));
    const snapshotById = new Map(snapshot.map((check) => [check.id, check]));
    await db
      .from("audit_runs")
      .update({
        execution_stage: "persisting_results",
        progress_completed: 0,
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", id);
    const decorate = (r: AuditResult) => {
        const check = snapshotById.get(r.check_id);
        return {
          ...r,
          audit_run_id: id,
          logic_version: check?.logicVersion || "unknown",
          configuration_version: check?.configurationVersion || 1,
          title_snapshot: check?.title || r.check_id,
        };
      };
    let persisted = 0;
    const persist = async (results: AuditResult[]) => {
      for (const batch of chunkAuditResults(results.map(decorate), 24)) {
      const { error: resultError } = await db.from("audit_results").upsert(
        batch,
        { onConflict: "audit_run_id,check_id" },
      );
      if (resultError) throw resultError;
      persisted += batch.length;
      await db
        .from("audit_runs")
        .update({
          progress_completed: persisted,
          heartbeat_at: new Date().toISOString(),
        })
        .eq("id", id);
      }
    };
    await persist(staticResults);
    await db
      .from("audit_runs")
      .update({
        execution_stage: "collecting_network_evidence",
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", id);
    const networkEvidence = await networkEvidencePromise;
    const contextResults = evaluateSourceChecks(
      snapshot,
      res,
      html,
      responseMs,
      networkEvidence,
    ).filter((result) => CONTEXT_AUDIT_CHECK_IDS.has(result.check_id));
    await db
      .from("audit_runs")
      .update({
        execution_stage: "persisting_results",
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", id);
    await persist(contextResults);
    const results = [...staticResults, ...contextResults];
    const { score, coverage } = scoreAuditResults(snapshot, results);
    await db
      .from("audit_runs")
      .update({
        status: results.some((r) => r.outcome === "unable_to_test")
          ? "partial"
          : "completed",
        score,
        coverage,
        execution_stage: "completed",
        progress_completed: results.length,
        progress_total: snapshot.length,
        heartbeat_at: new Date().toISOString(),
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
        execution_stage: "failed",
        heartbeat_at: new Date().toISOString(),
        error: errorMessage(e),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      })
      .eq("id", id);
  }
}

export function chunkAuditResults<T>(values: T[], size = 24) {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += safeSize)
    chunks.push(values.slice(index, index + safeSize));
  return chunks;
}

export function evaluateSourceChecks(
  snapshot: any[],
  res: Response,
  html: string,
  responseMs = 0,
  networkEvidence?: AuditNetworkEvidence,
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
    const contextResult = networkEvidence
      ? evaluateNetworkEvidenceCheck(s.id, res, html, analysis, networkEvidence)
      : null;
    const generic = fn || contextResult
      ? null
      : evaluateStaticCheck(s.id, res, html, analysis, responseMs);
    const [outcome, evidence] = fn
      ? fn()
      : contextResult
        ? contextResult
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

async function collectAuditNetworkEvidence(
  pageUrl: string,
  response: Response,
  html: string,
  redirects: { url: string; status: number; location: string }[],
): Promise<AuditNetworkEvidence> {
  const finalUrl = new URL(response.url || pageUrl);
  const origin = finalUrl.origin;
  const canonicalHref =
    html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)/i)?.[1] ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical/i)?.[1] ||
    null;
  const resource = async (value: string, max = 512_000): Promise<AuditResourceEvidence> => {
    try {
      const result = await safeFetchTrace(value, {
        headers: { "user-agent": "Claritude-Audit/1.0 (+https://claritude.io)" },
        signal: AbortSignal.timeout(12_000),
      });
      return {
        url: value,
        status: result.response.status,
        finalUrl: result.response.url,
        body: await limitedText(result.response, max),
        contentType: result.response.headers.get("content-type"),
        error: null,
      };
    } catch (error) {
      return {
        url: value,
        status: null,
        finalUrl: null,
        body: "",
        contentType: null,
        error: errorMessage(error),
      };
    }
  };
  const [robots, llms, llmsFull, canonical] = await Promise.all([
    resource(`${origin}/robots.txt`),
    resource(`${origin}/llms.txt`),
    resource(`${origin}/llms-full.txt`),
    canonicalHref ? resource(new URL(canonicalHref, finalUrl).href) : Promise.resolve(null),
  ]);
  const declaredSitemaps = [...robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)]
    .map((match) => match[1]);
  const sitemapUrls = [...new Set([
    ...declaredSitemaps,
    `${origin}/sitemap.xml`,
  ])].slice(0, 4);
  const sitemaps = await Promise.all(sitemapUrls.map((url) => resource(url, 1_000_000)));
  const dnsRecords: AuditNetworkEvidence["dnsRecords"] = [];
  const dnsErrors: string[] = [];
  let dnsAuthenticated: boolean | null = null;
  const apex = canonicalPropertyHost(finalUrl.hostname);
  const dnsQueries = [
    [apex, "A"], [apex, "AAAA"], [apex, "CNAME"], [apex, "MX"],
    [apex, "TXT"], [apex, "CAA"], [apex, "NS"], [apex, "SOA"],
    [`www.${apex}`, "A"], [`www.${apex}`, "AAAA"],
    [`claritude-nxdomain-probe.${apex}`, "A"],
    [`_dmarc.${apex}`, "TXT"],
  ] as const;
  const dnsAnswers = await Promise.all(dnsQueries.map(async ([query, type]) => {
    try {
      const dns = await queryDns(query, type);
      return { query, type, dns, error: null };
    } catch (error) {
      return { query, type, dns: null, error: errorMessage(error) };
    }
  }));
  for (const answer of dnsAnswers) {
    if (answer.error) {
      dnsErrors.push(`${answer.query} ${answer.type}: ${answer.error}`);
      continue;
    }
    dnsRecords.push(...(answer.dns?.records || []));
    if (answer.query === apex && answer.type === "A") {
      dnsAuthenticated = answer.dns?.authenticated ?? null;
    }
  }
  return {
    redirects,
    canonical,
    robots,
    sitemaps,
    llms,
    llmsFull,
    dnsRecords,
    dnsErrors,
    dnsAuthenticated,
  };
}

async function queryDns(query: string, type: string) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(query)}&type=${type}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error(`resolver returned HTTP ${response.status}`);
  const body = await response.json() as {
    Status?: number;
    AD?: boolean;
    Answer?: { TTL?: number; data?: string }[];
  };
  if (body.Status && body.Status !== 3) throw new Error(`resolver status ${body.Status}`);
  return {
    authenticated: Boolean(body.AD),
    records: (body.Answer || []).map((answer) => ({
      query,
      type,
      ttl: Number(answer.TTL || 0),
      data: String(answer.data || ""),
    })),
  };
}

function robotsDecision(text: string, userAgent: string, pathname: string) {
  const groups: { agents: string[]; rules: { directive: "allow" | "disallow"; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { directive: "allow" | "disallow"; path: string }[] };
  const flush = () => {
    if (group.agents.length) groups.push(group);
    group = { agents: [], rules: [] };
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (group.rules.length) flush();
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group.agents.length) {
      group.rules.push({ directive: key, path: value });
    }
  }
  flush();
  const agent = userAgent.toLowerCase();
  const exact = groups.filter((candidate) => candidate.agents.some((value) => value !== "*" && agent.includes(value)));
  const wildcard = groups.filter((candidate) => candidate.agents.includes("*"));
  const selected = exact.length ? exact : wildcard;
  const matching = selected.flatMap((candidate) => candidate.rules).filter((rule) =>
    rule.path && pathname.startsWith(rule.path.replace(/\$$/, "")),
  ).sort((left, right) => right.path.length - left.path.length || (left.directive === "allow" ? -1 : 1));
  return {
    allowed: matching[0]?.directive !== "disallow",
    matchedRule: matching[0] || null,
    inheritedFromWildcard: !exact.length && wildcard.length > 0,
    explicitGroup: exact.length > 0,
  };
}

function evaluateNetworkEvidenceCheck(
  id: string,
  response: Response,
  html: string,
  analysis: ReturnType<typeof analyseHtml>,
  evidence: AuditNetworkEvidence,
): [CheckOutcome, Record<string, unknown>] | null {
  if (!CONTEXT_AUDIT_CHECK_IDS.has(id)) return null;
  const ok = (resource: AuditResourceEvidence | null) =>
    Boolean(resource?.status && resource.status >= 200 && resource.status < 400 && !resource.error);
  const urlsInSitemaps = evidence.sitemaps.flatMap((resource) =>
    [...resource.body.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => match[1].trim()),
  );
  const selected = normalizeComparableUrl(response.url || analysis.url.href);
  const sitemapLastmods = evidence.sitemaps.flatMap((resource) =>
    [...resource.body.matchAll(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/gi)].map((match) => match[1].trim()),
  );
  const markdownLinks = [...evidence.llms.body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim());
  const records = (type: string, query?: string) => evidence.dnsRecords.filter((record) =>
    record.type === type && (!query || record.query === query),
  );
  const apex = canonicalPropertyHost(analysis.url.hostname);
  if (id.endsWith("canonical.target.reachable")) return [!evidence.canonical ? "not_applicable" : ok(evidence.canonical) ? "pass" : "fail", { target: evidence.canonical?.url || null, status: evidence.canonical?.status || null, error: evidence.canonical?.error || null }];
  if (id.endsWith("canonical.target.redirects")) return [!evidence.canonical ? "not_applicable" : evidence.canonical.finalUrl && normalizeComparableUrl(evidence.canonical.finalUrl) !== normalizeComparableUrl(evidence.canonical.url) ? "warning" : "pass", { target: evidence.canonical?.url || null, finalUrl: evidence.canonical?.finalUrl || null }];
  if (id.endsWith("redirect.chain.detected")) return [evidence.redirects.length > 1 ? "warning" : "pass", { redirects: evidence.redirects }];
  if (id.endsWith("redirect.loop.detected")) { const visited = evidence.redirects.map((item) => normalizeComparableUrl(item.url)); return [new Set(visited).size === visited.length ? "pass" : "fail", { redirects: evidence.redirects }]; }
  if (id.endsWith("robots.txt.file.reachable")) return [ok(evidence.robots) ? "pass" : "warning", { status: evidence.robots.status, error: evidence.robots.error }];
  if (id.endsWith("robots.txt.contains.readable.text")) return [!ok(evidence.robots) ? "not_applicable" : evidence.robots.body.trim() ? "pass" : "warning", { characters: evidence.robots.body.trim().length }];
  if (id.endsWith("robots.txt.parsing.errors.detected")) { const malformed = evidence.robots.body.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && !/^[a-z-]+\s*:/i.test(line)); return [!ok(evidence.robots) ? "not_applicable" : malformed.length ? "warning" : "pass", { malformedLines: malformed.slice(0, 10) }]; }
  const robotsAgent = id.includes("bingbot") ? "Bingbot" : id.includes("oai.searchbot") ? "OAI-SearchBot" : id.includes("gptbot") ? "GPTBot" : id.includes("claude.searchbot") ? "Claude-SearchBot" : id.includes("claudebot") ? "ClaudeBot" : id.includes("googlebot") ? "Googlebot" : null;
  if (robotsAgent && id.includes("allowed.by") || robotsAgent && id.includes("robots.access")) { const decision = robotsDecision(evidence.robots.body, robotsAgent!, analysis.url.pathname); return [!ok(evidence.robots) ? "not_applicable" : decision.allowed ? "pass" : "warning", { userAgent: robotsAgent, path: analysis.url.pathname, ...decision }]; }
  if (id.includes("explicit.chatgpt.user.robots.rules")) { const detected = /^\s*user-agent\s*:\s*chatgpt-user\s*$/im.test(evidence.robots.body); return [!ok(evidence.robots) ? "not_applicable" : "informational", { detected }]; }
  if (id.includes("explicit.claude.user.robots.rules")) { const detected = /^\s*user-agent\s*:\s*claude-user\s*$/im.test(evidence.robots.body); return [!ok(evidence.robots) ? "not_applicable" : "informational", { detected }]; }
  if (id.includes("ai.search.and.training.crawler.permissions.differ")) { const search = robotsDecision(evidence.robots.body, "OAI-SearchBot", analysis.url.pathname); const training = robotsDecision(evidence.robots.body, "GPTBot", analysis.url.pathname); return [!ok(evidence.robots) ? "not_applicable" : "informational", { differ: search.allowed !== training.allowed, searchAllowed: search.allowed, trainingAllowed: training.allowed }]; }
  if (id.includes("ai.crawler.rules.inherited.from.wildcard")) { const agents = ["OAI-SearchBot", "GPTBot", "Claude-SearchBot", "ClaudeBot"]; return [!ok(evidence.robots) ? "not_applicable" : "informational", { inherited: agents.filter((agent) => robotsDecision(evidence.robots.body, agent, analysis.url.pathname).inheritedFromWildcard) }]; }
  if (id.endsWith("sitemap.url.declared.in.robots.txt")) { const declared = [...evidence.robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]); return [!ok(evidence.robots) ? "not_applicable" : declared.length ? "pass" : "warning", { declared }]; }
  if (id.endsWith("conventional.sitemap.locations.checked")) return ["informational", { checked: evidence.sitemaps.map((item) => ({ url: item.url, status: item.status, error: item.error })) }];
  if (id.endsWith("referenced.xml.sitemap.reachable")) return [evidence.sitemaps.length ? evidence.sitemaps.some(ok) ? "pass" : "warning" : "not_applicable", { checked: evidence.sitemaps.map((item) => ({ url: item.url, status: item.status })) }];
  if (id.endsWith("referenced.sitemap.xml.valid")) { const reachable = evidence.sitemaps.filter(ok); return [!reachable.length ? "not_applicable" : reachable.every((item) => /<(?:urlset|sitemapindex)\b/i.test(item.body)) ? "pass" : "warning", { checked: reachable.map((item) => item.url) }]; }
  if (id.endsWith("selected.page.found.in.checked.sitemap.files")) return [!evidence.sitemaps.some(ok) ? "not_applicable" : urlsInSitemaps.some((url) => normalizeComparableUrl(url) === selected) ? "pass" : "warning", { selected: response.url, sitemapUrlsChecked: urlsInSitemaps.length }];
  if (id.endsWith("sitemap.lastmod.date.formats.valid")) return [!sitemapLastmods.length ? "not_applicable" : sitemapLastmods.every((value) => Number.isFinite(Date.parse(value))) ? "pass" : "warning", { values: sitemapLastmods.slice(0, 20) }];
  if (id.endsWith("returned.dns.record.ttls.recorded")) return [evidence.dnsRecords.length ? "informational" : "unable_to_test", { records: evidence.dnsRecords.map(({ type, ttl }) => ({ type, ttl })), errors: evidence.dnsErrors }];
  if (id.endsWith("selected.hostname.resolves.successfully")) return [records("A").length || records("AAAA").length ? "pass" : "fail", { a: records("A"), aaaa: records("AAAA") }];
  if (id.endsWith("ipv4.addresses.recorded")) return ["informational", { records: records("A", apex) }];
  if (id.endsWith("ipv6.addresses.recorded")) return ["informational", { records: records("AAAA", apex) }];
  if (id.endsWith("returned.cname.records.recorded")) return ["informational", { records: records("CNAME", apex) }];
  if (id.endsWith("non.existent.hostname.response.detected")) { const probe = records("A", `claritude-nxdomain-probe.${apex}`); return [probe.length ? "warning" : "pass", { records: probe }]; }
  if (id.endsWith("apex.domain.resolution.checked")) return [records("A", apex).length || records("AAAA", apex).length ? "pass" : "fail", { a: records("A", apex), aaaa: records("AAAA", apex) }];
  if (id.endsWith("www.hostname.resolution.checked")) return [records("A", `www.${apex}`).length || records("AAAA", `www.${apex}`).length ? "pass" : "warning", { a: records("A", `www.${apex}`), aaaa: records("AAAA", `www.${apex}`) }];
  if (id.endsWith("mail.exchange.records.detected")) return [records("MX", apex).length ? "informational" : "not_applicable", { records: records("MX", apex) }];
  if (id.endsWith("domain.nameservers.recorded")) return [records("NS", apex).length ? "informational" : "warning", { records: records("NS", apex) }];
  if (id.endsWith("domain.soa.record.recorded")) return [records("SOA", apex).length ? "informational" : "warning", { records: records("SOA", apex) }];
  if (id.endsWith("dns.resolver.errors.detected")) return [evidence.dnsErrors.length ? "warning" : "pass", { errors: evidence.dnsErrors }];
  if (id.endsWith("dnssec.validation.status.reported.by.the.resolver")) return ["informational", { authenticatedData: evidence.dnsAuthenticated }];
  const spf = records("TXT", apex).filter((record) => /v=spf1/i.test(record.data));
  if (id.endsWith("spf.record.detected")) return [spf.length ? "pass" : "warning", { records: spf }];
  if (id.endsWith("multiple.spf.records.detected")) return [spf.length <= 1 ? "pass" : "warning", { count: spf.length }];
  const dmarc = records("TXT", `_dmarc.${apex}`).filter((record) => /v=dmarc1/i.test(record.data));
  if (id.endsWith("dmarc.record.detected")) return [dmarc.length ? "pass" : "warning", { records: dmarc }];
  if (id.endsWith("dmarc.policy.recorded")) return [!dmarc.length ? "not_applicable" : dmarc.some((record) => /\bp\s*=\s*(none|quarantine|reject)/i.test(record.data)) ? "pass" : "warning", { records: dmarc }];
  if (id.endsWith("caa.certificate.authority.restrictions.detected")) return ["informational", { records: records("CAA", apex) }];
  if (id.endsWith("llms.txt.file.reachable")) return [ok(evidence.llms) ? "pass" : "not_applicable", { status: evidence.llms.status, error: evidence.llms.error }];
  if (id.endsWith("llms.txt.returned.as.readable.text")) return [!ok(evidence.llms) ? "not_applicable" : evidence.llms.body.trim() ? "pass" : "warning", { characters: evidence.llms.body.trim().length, contentType: evidence.llms.contentType }];
  if (id.endsWith("llms.txt.title.detected")) return [!ok(evidence.llms) ? "not_applicable" : /^#\s+\S+/m.test(evidence.llms.body) ? "pass" : "warning", { title: evidence.llms.body.match(/^#\s+(.+)$/m)?.[1] || null }];
  if (id.endsWith("llms.txt.summary.detected")) return [!ok(evidence.llms) ? "not_applicable" : evidence.llms.body.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("#") && !/^[-*]\s|^\[/.test(line.trim())) ? "pass" : "warning", {}];
  if (id.endsWith("llms.txt.markdown.links.parse.correctly")) { const invalid = markdownLinks.filter((link) => { try { new URL(link, analysis.url); return false; } catch { return true; } }); return [!ok(evidence.llms) ? "not_applicable" : invalid.length ? "warning" : "pass", { links: markdownLinks.length, invalid }]; }
  if (id.endsWith("llms.txt.links.checked.within.the.request.limit")) return [!ok(evidence.llms) ? "not_applicable" : "informational", { discovered: markdownLinks.length, requestLimit: 20 }];
  if (id.endsWith("selected.page.referenced.in.checked.llms.txt.links")) return [!ok(evidence.llms) ? "not_applicable" : markdownLinks.some((link) => normalizeComparableUrl(new URL(link, analysis.url).href) === selected) ? "pass" : "informational", { selected: response.url, links: markdownLinks.length }];
  if (id.endsWith("llms.full.txt.file.reachable")) return [ok(evidence.llmsFull) ? "pass" : "not_applicable", { status: evidence.llmsFull.status, error: evidence.llmsFull.error }];
  if (id.endsWith("llms.full.txt.returned.as.readable.text")) return [!ok(evidence.llmsFull) ? "not_applicable" : evidence.llmsFull.body.trim() ? "pass" : "warning", { characters: evidence.llmsFull.body.trim().length, contentType: evidence.llmsFull.contentType }];
  return null;
}

function normalizeComparableUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${canonicalPropertyHost(url.hostname)}${url.pathname.replace(/\/+$/, "") || "/"}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function auditCheckHasExecutableLogic(id: string) {
  if (EXPLICIT_SOURCE_CHECK_IDS.has(id) || CONTEXT_AUDIT_CHECK_IDS.has(id)) return true;
  const definition = registry(id);
  if (!definition || !["source_html", "network"].includes(definition.executionMethod)) return false;
  const html = "<!doctype html><html lang=\"en\"><head><title>Probe</title></head><body><main>Probe content for evaluator capability detection.</main></body></html>";
  const values = new Map<string, string>([["content-type", "text/html; charset=utf-8"]]);
  const response = {
    status: 200,
    ok: true,
    url: "https://audit-capability.invalid/",
    headers: {
      get: (name: string) => values.get(name.toLowerCase()) || null,
      has: (name: string) => values.has(name.toLowerCase()),
    },
  } as unknown as Response;
  return evaluateStaticCheck(
    id,
    response,
    html,
    analyseHtml(html, "https://audit-capability.invalid/"),
    1,
  ) !== null;
}

function evaluateStaticCheck(
  id: string,
  res: Response,
  html: string,
  a: ReturnType<typeof analyseHtml>,
  responseMs: number,
): [CheckOutcome, Record<string, unknown>] | null {
  const count = (pattern: RegExp) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return [...html.matchAll(new RegExp(pattern.source, flags))].length;
  };
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
  if (!["source_html", "network"].includes(method || "")) return null;

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
  if (id.includes("conflicting.indexing.directives")) { const directives = `${meta("robots") || ""} ${res.headers.get("x-robots-tag") || ""}`; const conflicting = (/\bindex\b/i.test(directives) && /\bnoindex\b/i.test(directives)) || (/\bfollow\b/i.test(directives) && /\bnofollow\b/i.test(directives)); return result(!conflicting, { directives }, "warning"); }
  if (id.includes("empty.h1")) return result(!/<h1\b[^>]*>\s*<\/h1>/i.test(html), {}, "warning");
  if (id.includes("empty.h2.to.h6")) return result(!/<h[2-6]\b[^>]*>\s*<\/h[2-6]>/i.test(html), {}, "warning");
  if (id.includes("skipped.heading.levels")) { const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1])); const skipped = levels.some((level, index) => index > 0 && level > levels[index - 1] + 1); return result(!skipped, { levels }, "warning"); }
  if (id.includes("repeated.heading.text")) { const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((match) => stripText(match[1]).toLowerCase()).filter(Boolean); const repeated = [...new Set(headings.filter((value, index) => headings.indexOf(value) !== index))]; return result(!repeated.length, { repeated }, "warning"); }
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
  if (id.includes("navigation.landmarks.have.distinguishable.accessible.names")) { const landmarks = [...html.matchAll(/<(?:nav|[^>]+role=["']navigation["'])\b[^>]*>/gi)].map((match) => match[0]); const names = landmarks.map((tag) => a.attr(tag, "aria-label") || a.attr(tag, "aria-labelledby") || "").filter(Boolean); return [landmarks.length < 2 ? "not_applicable" : names.length === landmarks.length && new Set(names).size === names.length ? "pass" : "warning", { landmarks: landmarks.length, names }]; }

  if (id.includes("images.contain.alt")) return result(a.images.every((x) => x.alt !== null), { total: a.images.length, missing: a.images.filter((x) => x.alt === null).length });
  if (id.includes("empty.alt.attributes")) return ["informational", { count: a.images.filter((x) => x.alt === "").length }];
  if (id.includes("alt.text.repeats.image.filenames")) { const found = a.images.filter((x) => x.alt && x.src && x.src.split('/').pop()?.split('.')[0].toLowerCase() === x.alt.toLowerCase()); return result(!found.length, { count: found.length }, "warning"); }
  if (id.includes("image.width.and.height.attributes")) return result(a.images.every((x) => x.width && x.height), { total: a.images.length, complete: a.images.filter((x) => x.width && x.height).length }, "warning");
  if (id.includes("images.marked.decorative.remain.focusable")) { const found = count(/<(?:a|button)\b[^>]*>[\s\S]{0,500}?<img\b[^>]*alt=["']{2}[^>]*>/gi); return result(!found, { count: found }, "warning"); }
  if (id.includes("image.intrinsic.dimensions.recorded")) return ["informational", { images: a.images.map((image) => ({ src: image.src, width: image.width, height: image.height })).slice(0, 50) }];
  if (id.includes("responsive.srcset.declarations")) return ["informational", { count: a.images.filter((x) => x.srcset).length }];
  if (id.includes("invalid.srcset.descriptors")) { const invalid = a.images.filter((image) => image.srcset && image.srcset.split(",").some((candidate) => { const descriptor = candidate.trim().split(/\s+/)[1]; return descriptor && !/^\d+(?:\.\d+)?[wx]$/.test(descriptor); })); return result(!invalid.length, { count: invalid.length }, "warning"); }
  if (id.includes("image.formats.recorded")) return ["informational", { formats: [...new Set(a.images.map((x) => x.src?.split('.').pop()?.split('?')[0]).filter(Boolean))] }];
  if (id.includes("videos.contain.caption")) { const videos = count(/<video\b/gi), captions = count(/<track[^>]+kind=["']captions/i); return [!videos ? "not_applicable" : captions >= videos ? "pass" : "warning", { videos, captions }]; }
  if (id.includes("autoplaying.media")) { const found = count(/<(?:video|audio)[^>]+autoplay/gi); return result(!found, { count: found }, "warning"); }
  if (id.includes("iframes.have.accessible.titles")) { const frames = a.tags('iframe'); return result(frames.every((x) => !!a.attr(x, 'title')), { total: frames.length }, "warning"); }

  if (id.includes("buttons.have.accessible.names")) { const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]; const bad = buttons.filter((x) => !stripText(x[2]) && !/aria-label=["'][^"']+/i.test(x[1])); return result(!bad.length, { total: buttons.length, unnamed: bad.length }); }
  if (id.includes("form.inputs.have.accessible.labels") || id.includes("select.controls.have.accessible.labels") || id.includes("textareas.have.accessible.labels")) { const tag = id.includes('select') ? 'select' : id.includes('textarea') ? 'textarea' : 'input'; const controls = a.tags(tag).filter((x) => !/type=["'](?:hidden|submit|button)["']/i.test(x)); const bad = controls.filter((x) => { const ident = a.attr(x,'id'); return !a.attr(x,'aria-label') && !a.attr(x,'aria-labelledby') && !(ident && new RegExp(`<label[^>]+for=["']${ident}["']`,'i').test(html)); }); return result(!bad.length, { total: controls.length, unlabeled: bad.length }); }
  if (id.includes("form.labels.reference.existing.controls")) { const references = [...html.matchAll(/<label[^>]+for=["']([^"']+)["']/gi)].map((match) => match[1]); const missing = references.filter((value) => !a.ids.includes(value)); return result(!missing.length, { references: references.length, missing }, "warning"); }
  if (id.includes("multiple.labels.for.the.same.control")) { const references = [...html.matchAll(/<label[^>]+for=["']([^"']+)["']/gi)].map((match) => match[1]); const repeated = [...new Set(references.filter((value, index) => references.indexOf(value) !== index))]; return result(!repeated.length, { repeated }, "warning"); }
  if (id.includes("aria.references.point.to.existing.elements")) { const references = [...html.matchAll(/\baria-(?:labelledby|describedby|controls|owns|activedescendant)=["']([^"']+)["']/gi)].flatMap((match) => match[1].trim().split(/\s+/)); const missing = references.filter((value) => !a.ids.includes(value)); return result(!missing.length, { references: references.length, missing: [...new Set(missing)] }, "warning"); }
  if (id.includes("nested.interactive.controls")) { const nested = count(/<(?:a|button)\b[^>]*>[\s\S]{0,2000}?<(?:a|button|input|select|textarea)\b/gi); return result(!nested, { count: nested }, "warning"); }
  if (id.includes("definition.lists.have.valid.structure")) { const lists = [...html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)]; const invalid = lists.filter((match) => /<(?!\/?(?:dt|dd)\b)[a-z][^>]*>/i.test(match[1].replace(/<(?:dt|dd)\b[^>]*>[\s\S]*?<\/(?:dt|dd)>/gi, ""))); return result(!invalid.length, { lists: lists.length, invalid: invalid.length }, "warning"); }
  if (id.includes("lists.contain.valid.list.items")) { const lists = [...html.matchAll(/<(?:ul|ol)\b[^>]*>([\s\S]*?)<\/(?:ul|ol)>/gi)]; const invalid = lists.filter((match) => /<(?!\/?li\b)[a-z][^>]*>/i.test(match[1].replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, ""))); return result(!invalid.length, { lists: lists.length, invalid: invalid.length }, "warning"); }
  if (id.includes("svg.elements.requiring.accessible.names.have.names")) { const svgs = [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi)]; const unnamed = svgs.filter((match) => !/aria-label=["'][^"']+|aria-labelledby=["'][^"']+/i.test(match[1]) && !/<title\b[^>]*>\s*[^<]+/i.test(match[2])); return result(!unnamed.length, { total: svgs.length, unnamed: unnamed.length }, "warning"); }
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
  if (id.includes("total.resource.request.count.measured")) return ["informational", { resources: count(/<(?:script|img|iframe|source)\b[^>]+(?:src|srcset)=|<link\b[^>]+href=/gi) }];

  if (id.includes("strict.transport.security.directives")) return result(/^max-age=\d+/i.test(res.headers.get('strict-transport-security') || ''), { value: res.headers.get('strict-transport-security') }, "warning");
  if (id.includes("content.security.policy.is.report.only")) return ["informational", { reportOnly: res.headers.has('content-security-policy-report-only') }];
  if (id.includes("unsafe.inline")) { const value = res.headers.get('content-security-policy') || ''; return [!value ? "not_applicable" : value.includes("'unsafe-inline'") ? "warning" : "pass", { value }]; }
  if (id.includes("unsafe.eval")) { const value = res.headers.get('content-security-policy') || ''; return [!value ? "not_applicable" : value.includes("'unsafe-eval'") ? "warning" : "pass", { value }]; }
  if (id.includes("frame.embedding.protection")) return result(res.headers.has('x-frame-options') || /frame-ancestors/i.test(res.headers.get('content-security-policy') || ''), {}, "warning");
  if (id.includes("x.content.type.options.header.present")) return result(res.headers.has('x-content-type-options'), {});
  if (id.includes("x.content.type.options.set.to.nosniff")) return result((res.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', { value: res.headers.get('x-content-type-options') });
  if (id.includes("referrer.policy.declared")) return result(res.headers.has('referrer-policy') || !!meta('referrer'), {});
  if (id.includes("referrer.policy.value.recognised")) { const value = (res.headers.get('referrer-policy') || meta('referrer') || '').trim().toLowerCase(); const valid = new Set(['no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url']); return [!value ? "not_applicable" : valid.has(value) ? "pass" : "warning", { value }]; }
  if (id.includes("permissions.policy.header.present")) return result(res.headers.has('permissions-policy'), {}, "warning");
  if (id.includes("insecure.form.submission")) { const found = count(/<form[^>]+action=["']http:\/\//gi); return result(!found, { count: found }); }
  if (id.includes("active.mixed.content.requests")) { const found = count(/<(?:script|link|iframe|img|audio|video|source)\b[^>]+(?:src|href)=["']http:\/\//gi); return result(!found, { count: found }, "warning"); }
  if (id.includes("password.fields.appear.on.an.http.page")) { const fields = count(/<input\b[^>]+type=["']password["']/gi); return [!fields ? "not_applicable" : a.url.protocol === "https:" ? "pass" : "fail", { fields, protocol: a.url.protocol }]; }

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
  if (id.includes("structured.data.url.identifiers.use.valid.formats") || id.includes("structured.data.url.properties.use.valid.formats")) { const values = [...a.jsonLd.join('\n').matchAll(/["'](?:@id|url)["']\s*:\s*["']([^"']+)/gi)].map((match) => match[1]); const invalid = values.filter((value) => { try { new URL(value, a.url); return false; } catch { return true; } }); return result(!invalid.length, { values: values.length, invalid }, "warning"); }
  if (id.includes("structured.data.dates.use.valid.formats")) { const values = [...a.jsonLd.join('\n').matchAll(/["'](?:datePublished|dateModified|startDate|endDate)["']\s*:\s*["']([^"']+)/gi)].map((match) => match[1]); const invalid = values.filter((value) => !Number.isFinite(Date.parse(value))); return result(!invalid.length, { values, invalid }, "warning"); }
  if (id.includes("structured.data.page.url.matches.the.selected.url")) { const values = [...a.jsonLd.join('\n').matchAll(/["']url["']\s*:\s*["']([^"']+)/gi)].map((match) => match[1]); return [!values.length ? "not_applicable" : values.some((value) => normalizeComparableUrl(new URL(value, a.url).href) === normalizeComparableUrl(a.url.href)) ? "pass" : "warning", { selected: a.url.href, values }]; }
  if (id.includes("organisation.website.declared")) return [!/Organization["']/i.test(a.jsonLd.join('\n')) ? "not_applicable" : /["']url["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("breadcrumb.items.have.names.and.positions")) { const data = a.jsonLd.join('\n'); return [!/BreadcrumbList["']/i.test(data) ? "not_applicable" : /["']name["']\s*:/i.test(data) && /["']position["']\s*:/i.test(data) ? "pass" : "warning", {}]; }
  if (id.includes("breadcrumb.positions.form.a.consistent.sequence")) { const positions = [...a.jsonLd.join('\n').matchAll(/["']position["']\s*:\s*(\d+)/gi)].map((match) => Number(match[1])); return [!positions.length ? "not_applicable" : positions.every((value, index) => value === index + 1) ? "pass" : "warning", { positions }]; }
  if (id.includes("declared.product.price.formats.valid")) { const values = [...a.jsonLd.join('\n').matchAll(/["']price["']\s*:\s*["']?([^,"'}\s]+)/gi)].map((match) => match[1]); return [!values.length ? "not_applicable" : values.every((value) => /^\d+(?:\.\d+)?$/.test(value)) ? "pass" : "warning", { values }]; }
  if (id.includes("declared.product.currency.codes.valid")) { const values = [...a.jsonLd.join('\n').matchAll(/["']priceCurrency["']\s*:\s*["']([^"']+)/gi)].map((match) => match[1]); return [!values.length ? "not_applicable" : values.every((value) => /^[A-Z]{3}$/.test(value)) ? "pass" : "warning", { values }]; }
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
  if (id.includes("open.graph.url.agrees.with.the.canonical.url")) { const og = meta('og:url'), canonical = linkRel('canonical'); return [!og || !canonical ? "not_applicable" : normalizeComparableUrl(new URL(og, a.url).href) === normalizeComparableUrl(new URL(canonical, a.url).href) ? "pass" : "warning", { openGraphUrl: og, canonical }]; }
  if (id.includes("conflicting.duplicate.social.metadata")) { const values = [...html.matchAll(/<meta[^>]+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]+content=["']([^"']*)/gi)].map((match) => `${match[1].toLowerCase()}=${match[2]}`); const keys = values.map((value) => value.split('=')[0]); const conflicts = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]; return result(!conflicts.length, { conflicts }, "warning"); }

  if (id.includes("main.content.organised.under.semantic.headings")) return result(count(/<h[1-6]\b/gi) > 0, { headings: count(/<h[1-6]\b/gi) }, "warning");
  if (id.includes("tables.available.in.machine")) return ["informational", { tables: count(/<table\b/gi) }];
  if (id.includes("external.source.links.present")) { const external = a.links.filter((x) => { try { return new URL(x.href || '', a.url).hostname !== a.url.hostname; } catch { return false; } }); return ["informational", { count: external.length }]; }
  if (id.includes("machine.readable.organisation.identity")) return result(/Organization["']/i.test(a.jsonLd.join('\n')), {}, "warning");
  if (id.includes("machine.readable.author.identity")) return result(/["']author["']\s*:/i.test(a.jsonLd.join('\n')), {}, "warning");
  if (id.includes("publisher.attribution")) return [!a.jsonLd.length ? "not_applicable" : /["']publisher["']\s*:/i.test(a.jsonLd.join('\n')) ? "pass" : "warning", {}];
  if (id.includes("entity.sameas.references.use.valid.url.formats")) { const values = [...a.jsonLd.join('\n').matchAll(/["']sameAs["']\s*:\s*(?:\[([^\]]*)\]|["']([^"']+))/gi)].flatMap((match) => [...`${match[1] || match[2] || ''}`.matchAll(/["']([^"']+)["']/g)].map((item) => item[1])); const invalid = values.filter((value) => { try { new URL(value); return false; } catch { return true; } }); return result(!invalid.length, { values: values.length, invalid }, "warning"); }
  if (id.includes("nosnippet.restrictions")) return result(!/\bnosnippet\b/i.test(`${meta('robots') || ''} ${res.headers.get('x-robots-tag') || ''}`), {}, "warning");
  if (id.includes("max.snippet.restrictions")) return ["informational", { value: `${meta('robots') || ''} ${res.headers.get('x-robots-tag') || ''}`.match(/max-snippet\s*:\s*-?\d+/i)?.[0] || null }];
  if (id.includes("data.nosnippet.sections")) return ["informational", { count: count(/\bdata-nosnippet\b/gi) }];
  if (id.includes("login.requirement.encountered")) { const detected = res.status === 401 || res.status === 403 || /<input\b[^>]+type=["']password["']/i.test(html); return result(!detected, { status: res.status, passwordField: /<input\b[^>]+type=["']password["']/i.test(html) }, "warning"); }
  if (id.includes("bot.challenge.encountered")) { const detected = /captcha|cf-chl-|challenge-platform|verify you are human/i.test(html); return result(!detected, { detected }, "warning"); }
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
  timeZone = "UTC",
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
  const dailySessions = new Map<string, Set<string>>();
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
    const day = dateKeyInTimeZone(event.occurred_at, timeZone);
    const bucket = days === 1
      ? new Date(Math.floor(new Date(event.occurred_at).valueOf() / 3600000) * 3600000).toISOString()
      : day;
    const point = seriesMap.get(bucket) || { pageviews: 0, events: 0, sessions: new Set<string>() };
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
        const daySessions = dailySessions.get(day) || new Set<string>();
        daySessions.add(event.metadata.session);
        dailySessions.set(day, daySessions);
      }
      if (viewId && SUPPORTED_TRACKER_VERSIONS.has(event.metadata?.tracker_version) && !views.has(viewId)) {
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
    if (event.event_type === "web_vital" && event.name && Number.isFinite(event.value) && SUPPORTED_TRACKER_VERSIONS.has(event.metadata?.tracker_version)) {
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
    seriesMap.set(bucket, point);
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
  const fromDay = dateKeyInTimeZone(from, timeZone);
  const toDay = dateKeyInTimeZone(to, timeZone);
  const calendarDays: string[] = [];
  for (let cursor = new Date(`${fromDay}T00:00:00.000Z`), index = 0;
    cursor <= new Date(`${toDay}T00:00:00.000Z`) && index < 91;
    cursor = new Date(cursor.valueOf() + 864e5), index += 1)
    calendarDays.push(cursor.toISOString().slice(0, 10));
  const seriesBuckets = days === 1
    ? (() => {
        const buckets: string[] = [];
        const end = new Date(to).valueOf();
        for (let cursor = Math.floor(new Date(from).valueOf() / 3600000) * 3600000; cursor <= end && buckets.length < 25; cursor += 3600000)
          buckets.push(new Date(cursor).toISOString());
        return buckets;
      })()
    : calendarDays;
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
    timeZone,
    pageviews,
    events: events.length,
    keyEvents,
    sessions: sessions.size,
    averageDailyVisitors: sessions.size
      ? Math.round(calendarDays.reduce((total, day) => total + (dailySessions.get(day)?.size || 0), 0) / Math.max(1, calendarDays.length) * 10) / 10
      : null,
    dailyVisitorMethod: sessions.size ? "anonymous_sessions" : "unavailable",
    truncated: events.length >= 50000,
    pages: [...pageMap]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.pageviews - a.pageviews),
    series: seriesBuckets.map((day) => ({
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
      minimumSamples: 1,
      method: "p75",
      collectionStatus: vitalRows.length ? "available" : "versioned_web_vitals_unavailable",
      trackerVersion: TRACKER_VERSION,
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

export function cleanPath(v: unknown) {
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
    for (const [k, x] of Object.entries(v).slice(0, 20))
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
export function canonicalPropertyHost(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
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
  return (await safeFetchTrace(value, init)).response;
}
async function safeFetchTrace(value: string, init: RequestInit = {}) {
  let url = validPublicUrl(value);
  if (!url) throw new Error("Target must be a public HTTP or HTTPS URL");
  const redirects: { url: string; status: number; location: string }[] = [];
  for (let i = 0; i < 5; i++) {
    await assertPublicResolution(url.hostname);
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: init.signal || AbortSignal.timeout(15000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      return { response, redirects };
    const location = response.headers.get("location") || "";
    redirects.push({ url: url.href, status: response.status, location });
    const next = validPublicUrl(
      new URL(location, url).href,
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
  const headlineLabels: Record<string, string> = {
    seo: "SEO",
    performance: "Performance",
    accessibility: "Accessibility",
    security: "Security",
    infrastructure: "Infrastructure",
    ai_readiness: "AI Readiness",
  };
  if (headlineLabels[value]) return headlineLabels[value];
  return value
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
function methodReason(method?: string) {
  if (method === "rendered_browser" || method === "lab")
    return `${method} execution requires an authorised rendered-browser worker, which is not configured`;
  if (method === "dns")
    return "DNS evidence collection is not yet implemented by the audit worker";
  if (method === "network")
    return "This network check requires a wider crawl or resource request that the selected-page collector did not perform";
  return "No reliable automated evaluator is implemented for this catalogue entry";
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
  const requestedTimeZone = String(c.req.query("time_zone") || "UTC").slice(0, 80);
  const timeZone = validTimeZone(requestedTimeZone) ? requestedTimeZone : "UTC";
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
      timeZone,
    };
  }
  if (!fromValue || !toValue) return null;
  const fromDate = zonedDateBoundary(fromValue, timeZone, false);
  const toDate = zonedDateBoundary(toValue, timeZone, true);
  const span = toDate.valueOf() - fromDate.valueOf();
  const calendarDayCount = Math.round(
    (Date.parse(`${toValue}T00:00:00.000Z`) - Date.parse(`${fromValue}T00:00:00.000Z`)) / 864e5,
  ) + 1;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromValue) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toValue) ||
    !Number.isFinite(span) ||
    span < 0 ||
    calendarDayCount < 1 ||
    calendarDayCount > maximumDays
  )
    return null;
  return {
    days: calendarDayCount,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    timeZone,
  };
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedDateBoundary(value: string, timeZone: string, end: boolean) {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + (end ? 1 : 0), 0, 0, 0, 0));
  let instant = target.valueOf();
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value || 0);
    const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant += target.valueOf() - represented;
  }
  return new Date(instant - (end ? 1 : 0));
}

function dateKeyInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

async function workspaceOwnerContext(
  db: SupabaseClient,
  userId: string,
  workspaceId?: string,
) {
  if (!workspaceId) return null;
  const { data } = await db
    .from("workspace_memberships")
    .select("role,workspaces(id,name,account_id)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  const workspace = data?.workspaces as unknown as
    | { id: string; name: string; account_id: string }
    | null;
  return workspace
    ? { id: workspace.id, name: workspace.name, accountId: workspace.account_id }
    : null;
}

async function isWorkspaceOwner(
  db: SupabaseClient,
  userId: string,
  workspaceId?: string,
) {
  return Boolean(await workspaceOwnerContext(db, userId, workspaceId));
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
  const s=document.currentScript,p=s&&s.dataset.property,endpoint=s&&new URL('/collect',s.src).href,base=s&&new URL('/',s.src).href;
  if(!p||!endpoint||window.__claritude)return;window.__claritude=1;
  const uuid=()=>{try{return crypto.randomUUID()}catch{const b=new Uint8Array(16);try{crypto.getRandomValues(b)}catch{for(let i=0;i<b.length;i++)b[i]=Math.floor(Math.random()*256)}b[6]=b[6]&15|64;b[8]=b[8]&63|128;return Array.prototype.map.call(b,(x,i)=>(i===4||i===6||i===8||i===10?'-':'')+x.toString(16).padStart(2,'0')).join('')}};
  let q=[],timer,retryTimer,retryDelay=1000,sending=false,lastUrl=location.href,view=uuid(),generation=0,active=0,reportedActive=0,lastActivity=Date.now(),errorCount=0,vitalsReady=null;
  const marks=new Set,visibleSections=new Set,observedSections=new WeakSet;
  const session=sessionStorage.getItem('_claritude_session')||uuid();
  sessionStorage.setItem('_claritude_session',session);
  const browser=/Edg\//.test(navigator.userAgent)?'Edge':/OPR\//.test(navigator.userAgent)?'Opera':/SamsungBrowser\//.test(navigator.userAgent)?'Samsung Internet':/Firefox\//.test(navigator.userAgent)?'Firefox':/Chrome\//.test(navigator.userAgent)?'Chrome':/Safari\//.test(navigator.userAgent)?'Safari':/MSIE|Trident/.test(navigator.userAgent)?'Internet Explorer':'Other';
  const common=()=>{const params=new URLSearchParams(location.search);return{session,view_id:view,browser,screen:innerWidth<768?'small':innerWidth<1280?'medium':'large',language:navigator.language||'',tracker_version:'${TRACKER_VERSION}',utm_source:params.get('utm_source')||'',utm_medium:params.get('utm_medium')||'',utm_campaign:params.get('utm_campaign')||'',utm_content:params.get('utm_content')||'',utm_term:params.get('utm_term')||''}};
  const retry=()=>{if(retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=0;send()},retryDelay);retryDelay=Math.min(retryDelay*2,30000)};
  const send=async()=>{if(sending||!q.length)return;sending=true;const batch=q.splice(0,20),body=JSON.stringify(batch);try{if(navigator.sendBeacon&&document.visibilityState==='hidden'){if(!navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'})))throw new Error('beacon-rejected')}else{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true});if(!response.ok)throw new Error('collect-'+response.status)}retryDelay=1000}catch{q=batch.concat(q).slice(0,200);retry()}finally{sending=false;if(q.length&&!retryTimer){clearTimeout(timer);timer=setTimeout(send,500)}}};
  const emit=(type,data={})=>{const supplied=data.meta&&typeof data.meta==='object'?data.meta:{};q.push(Object.assign({},data,{type,property:p,path:location.pathname,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',meta:Object.assign({},common(),supplied,{event_id:uuid()})}));if(q.length>200)q=q.slice(-200);clearTimeout(timer);timer=setTimeout(send,500)};
  addEventListener('click',e=>{lastActivity=Date.now();const a=e.target.closest('[data-claritude-event],a[href]');if(!a)return;const name=a.dataset.claritudeEvent;if(name)emit('click',{name});if(a.href&&new URL(a.href,location.href).host!==location.host)emit('outbound',{name:new URL(a.href).host})},{passive:true});
  ['keydown','pointerdown','touchstart'].forEach(name=>addEventListener(name,()=>{lastActivity=Date.now()},{passive:true}));
  const checkScroll=()=>{const root=document.documentElement,height=Math.max(root.scrollHeight,document.body&&document.body.scrollHeight||0,1),n=Math.min(100,Math.round((scrollY+innerHeight)/height*100));[25,50,75,90].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);emit('scroll',{value:x})}})};
  addEventListener('scroll',checkScroll,{passive:true});addEventListener('resize',checkScroll,{passive:true});
  const reportActive=()=>{const delta=active-reportedActive;if(delta>0){reportedActive=active;emit('active_time',{value:delta})}};
  const tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus()&&Date.now()-lastActivity<30000)active+=1;if(active-reportedActive>=5)reportActive()},1000);
  const sectionObserver='IntersectionObserver'in window?new IntersectionObserver(entries=>entries.forEach(entry=>{const name=entry.target.dataset.claritudeSection;if(entry.isIntersecting&&name&&!visibleSections.has(name)){visibleSections.add(name);emit('visible_section',{name})}}),{threshold:.5}):null;
  const observeSections=()=>{if(!sectionObserver)return;document.querySelectorAll('[data-claritude-section]').forEach(node=>{if(!observedSections.has(node)){observedSections.add(node);sectionObserver.observe(node)}})};
  const initVitals=()=>{if(!window.webVitals)return;const own=generation,record=metric=>{if(own===generation&&metric&&Number.isFinite(metric.value))emit('web_vital',{name:metric.name,value:metric.value,meta:{metric_id:metric.id,navigation_type:metric.navigationType}})};try{webVitals.onLCP(record)}catch{}try{webVitals.onINP(record)}catch{}try{webVitals.onCLS(record)}catch{}};
  const loadVitals=()=>vitalsReady||(vitalsReady=new Promise(resolve=>{if(window.webVitals){resolve();return}const script=document.createElement('script');script.src=new URL('/vendor/web-vitals.js',base).href;script.async=true;script.crossOrigin='anonymous';script.onload=resolve;script.onerror=resolve;document.head.appendChild(script)}));
  const page=()=>{const params=new URLSearchParams(location.search);emit('pageview',{source:params.get('utm_source')||''});observeSections();requestAnimationFrame(checkScroll);loadVitals().then(initVitals)};page();
  const navigation=(forcedPath)=>{if(!forcedPath&&location.href===lastUrl)return;reportActive();send();lastUrl=location.href;view=uuid();generation+=1;active=0;reportedActive=0;lastActivity=Date.now();errorCount=0;marks.clear();visibleSections.clear();page()};
  new MutationObserver(()=>{navigation();observeSections();checkScroll()}).observe(document,{subtree:true,childList:true});
  ['pushState','replaceState'].forEach(k=>{const original=history[k];history[k]=function(){const result=original.apply(this,arguments);Promise.resolve().then(()=>navigation());return result}});
  addEventListener('popstate',()=>navigation());
  const reportError=(name,source)=>{if(errorCount>=5)return;errorCount+=1;let resource_origin='';try{resource_origin=source?new URL(source,location.href).origin:''}catch{}emit('js_error',{name,meta:{resource_origin}})};
  addEventListener('error',event=>reportError('script-error',event.filename||''),true);
  addEventListener('unhandledrejection',()=>reportError('promise-rejection',''));
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){reportActive();send()}else lastActivity=Date.now()});
  addEventListener('pagehide',()=>{clearInterval(tick);reportActive();send()});
  window.claritude={version:'${TRACKER_VERSION}',event:(name,meta)=>emit('click',{name,meta}),formSuccess:(name,meta)=>emit('form_success',{name,meta}),pageview:details=>navigation(details&&details.path),flush:send};
})();`;

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<Job>, env: Env) => {
    await Promise.all(batch.messages.map(async (message) => {
      try {
        message.body.type === "audit"
          ? await runAudit(env, message.body.id)
          : await runUptime(env, message.body.id);
        message.ack();
      } catch (error) {
        console.error("queue job failed", message.body.type, message.body.id, errorMessage(error));
        message.retry();
      }
    }));
  },
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(scheduled(env, event.cron)),
};
