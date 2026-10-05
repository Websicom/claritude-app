import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import puppeteer from "@cloudflare/puppeteer";
import WEB_VITALS_SOURCE from "../../node_modules/web-vitals/dist/web-vitals.iife.js?raw";
import AXE_SOURCE from "../../node_modules/axe-core/axe.min.js?raw";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "../shared/audit-evaluator-map.generated";
import { USER_FACING_AUDIT_GROUPS } from "../shared/audit-user-facing-registry.generated";
import {
  buildUserFacingGroupSnapshot,
  deriveUserFacingAuditResults,
  generatedGroupRows,
  resolveAuditAvailability,
  scoreUserFacingAuditResults,
  type UserFacingAuditGroupSnapshot,
} from "../shared/audit-user-facing";
import {
  buildRegistrySnapshot,
  implementationCoverage,
  scoreAuditResults,
  type AuditRegistrySnapshot,
} from "../shared/audit-runtime";
import { summarizeUptimeChecks } from "../shared/uptime";
import {
  classifyDestination,
  headerMultimap,
  parseFontFaces,
  parseSitemapXml,
  parseSourceDom,
  type AuditOccurrence,
  type DnsEvidence,
  type HttpEvidence,
  type LinkDeclaration,
  type ResourceDeclaration,
  type ResourceEvidence,
} from "../shared/audit-evidence";
import {
  collectLinkInventory,
  collectOptionalAiResource,
  collectResourceInventory,
  inspectDestination,
  mergeRenderedDeclarations,
  parseRobotsEvidence,
} from "../shared/audit-collectors";
import {
  evaluateAuditCatalogue,
  validateAuditEvaluatorRegistry,
  type AuditEvidenceBundle,
  type RenderedViewportEvidence,
  type TypedAuditResult,
} from "../shared/audit-evaluators";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  APP_ORIGIN: string;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;
  BROWSER: Fetcher;
};
type Variables = { db: SupabaseClient; userId: string };
type Job =
  | { type: "audit" | "uptime"; id: string }
  | { type: "audit-persist"; id: string; payload: string };
type AuditResult = TypedAuditResult;

const LIMITS = {
  propertiesPerAccount: 25,
  auditsPerPropertyPerDay: 20,
  analyticsEventsPerPropertyPerDay: 50_000,
} as const;

export type CustomEventPlan = "Free" | "Essentials" | "Scale" | "Pro";

export function customEventPlan(entitlement: unknown): CustomEventPlan {
  const normalized = String(entitlement || "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (normalized === "proearlyaccess" || normalized.startsWith("pro")) return "Pro";
  if (normalized.startsWith("scale")) return "Scale";
  if (normalized.startsWith("essentials")) return "Essentials";
  return "Free";
}

export function customEventAllowance(entitlement: unknown, used: number) {
  const plan = customEventPlan(entitlement);
  const limits: Record<CustomEventPlan, number | null> = {
    Free: 2,
    Essentials: 5,
    Scale: 20,
    Pro: null,
  };
  const limit = limits[plan];
  const safeUsed = Math.max(0, Math.floor(Number(used) || 0));
  return {
    plan,
    used: safeUsed,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - safeUsed),
    unlimited: limit == null,
    canCreate: limit == null || safeUsed < limit,
  };
}

export function validAvatarBytes(contentType: string, bytes: Uint8Array) {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (contentType === "image/png")
    return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (contentType === "image/gif") {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (contentType === "image/webp") {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    return riff === "RIFF" && webp === "WEBP";
  }
  return false;
}

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
validateAuditEvaluatorRegistry();
const IMPLEMENTED_AUDIT_CHECKS = ACTIVE_AUDIT_CHECKS.filter(
  (check) => auditCheckHasExecutableLogic(check.id),
);
const IMPLEMENTED_AUDIT_IDS = new Set(IMPLEMENTED_AUDIT_CHECKS.map((check) => check.id));
const GENERATED_USER_FACING_ROWS = generatedGroupRows(USER_FACING_AUDIT_GROUPS);

type AuditAvailabilityContext = {
  accountId?: string | null;
  entitlement?: string | null;
  requestedCheckIds?: string[];
};

async function configuredAuditSnapshots(env: Env, context: AuditAvailabilityContext = {}) {
  const db = admin(env);
  const [registryResponse, groupResponse, mappingResponse] = await Promise.all([
    db.from("audit_check_definitions")
      .select("id,title,weight,logic_version,configuration_version,primary_category,subcategory,severity,description,recommendation,source_reference,evidence_schema,evidence_requirement,allowed_outcomes,group_id")
      .eq("lifecycle", "active")
      .order("id"),
    db.from("audit_user_facing_groups")
      .select("id,name,category,subcategory,presentation_role,outcome_policy,failure_severity,weight,authoritative_reference,focus,passed_message,failed_message,advisory_message,not_applicable_message,unable_to_test_message,recommendation,example_fix,reference_label,evidence_presentation,occurrence_presentation,lifecycle,enabled_by_default,configuration_version,sort_order")
      .order("sort_order"),
    db.from("audit_user_facing_group_checks")
      .select("group_id,check_id,presentation_action,lifecycle,enabled_by_default,sort_order")
      .order("sort_order"),
  ]);
  if (registryResponse.error) throw new Error(`audit_registry_unavailable: ${registryResponse.error.message}`);
  if (groupResponse.error) throw new Error(`audit_group_registry_unavailable: ${groupResponse.error.message}`);
  if (mappingResponse.error) throw new Error(`audit_group_mapping_unavailable: ${mappingResponse.error.message}`);

  const packageResponse = context.entitlement
    ? await db.from("audit_catalogue_package_availability")
      .select("target_kind,target_id,enabled")
      .eq("entitlement", context.entitlement)
    : { data: [], error: null };
  const accountResponse = context.accountId
    ? await db.from("audit_catalogue_account_availability")
      .select("target_kind,target_id,enabled")
      .eq("account_id", context.accountId)
    : { data: [], error: null };
  if (packageResponse.error) throw new Error(`audit_package_availability_unavailable: ${packageResponse.error.message}`);
  if (accountResponse.error) throw new Error(`audit_account_availability_unavailable: ${accountResponse.error.message}`);
  const packageOverrides = (packageResponse.data || []) as any;
  const accountOverrides = (accountResponse.data || []) as any;
  const available = (kind: "technical_check" | "user_facing_group", id: string, enabledByDefault: boolean) =>
    resolveAuditAvailability(kind, id, enabledByDefault, packageOverrides, accountOverrides);

  let technicalSnapshot = buildRegistrySnapshot(registryResponse.data || [], IMPLEMENTED_AUDIT_IDS);
  technicalSnapshot = technicalSnapshot.filter((check) => available("technical_check", check.id, true));
  const enabledTechnicalIds = new Set(technicalSnapshot.map((check) => check.id));
  let userFacingSnapshot = buildUserFacingGroupSnapshot(
    (groupResponse.data || []).map((group: any) => ({
      ...group,
      enabled_by_default: available("user_facing_group", group.id, Boolean(group.enabled_by_default)),
    })),
    mappingResponse.data || [],
    enabledTechnicalIds,
  );
  const groupEnabledTechnicalIds = new Set(userFacingSnapshot.flatMap((group) => group.technicalChecks.map((mapping) => mapping.checkId)));
  technicalSnapshot = technicalSnapshot.filter((check) => groupEnabledTechnicalIds.has(check.id));

  if (context.requestedCheckIds?.length) {
    const requested = new Set(context.requestedCheckIds.slice(0, 100));
    technicalSnapshot = technicalSnapshot.filter((check) => requested.has(check.id));
    const selectedIds = new Set(technicalSnapshot.map((check) => check.id));
    userFacingSnapshot = userFacingSnapshot.flatMap((group) => {
      const technicalChecks = group.technicalChecks.filter((mapping) => selectedIds.has(mapping.checkId));
      return technicalChecks.length ? [{ ...group, technicalChecks }] : [];
    });
  }
  return { technicalSnapshot, userFacingSnapshot };
}

function fallbackUserFacingSnapshot(technicalSnapshot: AuditRegistrySnapshot[]): UserFacingAuditGroupSnapshot[] {
  return buildUserFacingGroupSnapshot(
    GENERATED_USER_FACING_ROWS.groups,
    GENERATED_USER_FACING_ROWS.mappings,
    new Set(technicalSnapshot.map((check) => check.id)),
  );
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const TRACKER_VERSION = "2.1.5";
const SUPPORTED_TRACKER_VERSIONS = new Set(["2.0.0", "2.1.0", "2.1.1", "2.1.2", "2.1.3", "2.1.4", TRACKER_VERSION]);
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
  c.json({
    ok: true,
    service: "claritude",
    time: new Date().toISOString(),
    audit: {
      architectureVersion: "2.0.0",
      catalogueChecks: ACTIVE_AUDIT_CHECKS.length,
      implementedChecks: IMPLEMENTED_AUDIT_CHECKS.length,
      unsupportedChecks: ACTIVE_AUDIT_CHECKS.length - IMPLEMENTED_AUDIT_CHECKS.length,
      implementationCoverage: implementationCoverage(ACTIVE_AUDIT_CHECKS.length, IMPLEMENTED_AUDIT_CHECKS.length),
      runtimeLimits: {
        cpuMsPerInvocation: 30_000,
        subrequestsPerInvocation: 750,
      },
    },
  }),
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

app.get("/favicons/:trackingId", async (c) => {
  const trackingId = c.req.param("trackingId");
  if (!/^cl_[a-zA-Z0-9_-]{12,64}$/.test(trackingId)) return c.body(null, 404);
  const { data: property } = await admin(c.env)
    .from("properties")
    .select("url")
    .eq("tracking_id", trackingId)
    .maybeSingle();
  if (!property?.url) return c.body(null, 404);

  const candidates = [new URL("/favicon.ico", property.url).href];
  try {
    const page = await safeFetch(property.url, {
      headers: { "user-agent": "Claritude Favicon/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    const html = page.ok ? await limitedText(page, 512_000) : "";
    const declared = html.match(/<link\b[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)/i)?.[1]
      || html.match(/<link\b[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:icon|shortcut icon)/i)?.[1]
      || html.match(/<link\b[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)/i)?.[1];
    if (declared) candidates.unshift(new URL(declared, page.url || property.url).href);
  } catch {
    // The conventional root icon and managed fallback still work when a large
    // or protected homepage cannot be parsed.
  }
  candidates.push(`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(property.url)}&sz=64`);
  for (const candidate of candidates) {
    try {
      const icon = await safeFetch(candidate, {
        headers: { "user-agent": "Claritude Favicon/1.0", accept: "image/*" },
        signal: AbortSignal.timeout(6000),
      });
      const contentType = icon.headers.get("content-type") || "";
      const contentLength = Number(icon.headers.get("content-length") || 0);
      if (!icon.ok || !contentType.startsWith("image/") || contentLength > 1_048_576) continue;
      const bytes = await icon.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 1_048_576) continue;
      return new Response(bytes, {
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        },
      });
    } catch {
      // Try the next favicon source.
    }
  }
  return c.body(null, 404);
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
        .neq("title", "Audit completed")
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
  const { data: monitor, error: monitorError } = await service
    .from("uptime_monitors")
    .upsert(
      { property_id: data.id },
      { onConflict: "property_id", ignoreDuplicates: true },
    )
    .select("id")
    .single();
  if (monitorError || !monitor)
    return c.json({ error: `property_created_monitor_failed: ${monitorError?.message || "monitor_not_returned"}` }, 500);
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
  await c.env.JOBS.send({ type: "uptime", id: monitor.id });
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
  let notificationPreferences: Record<string, unknown> | undefined;
  if (body.notification_preferences) {
    const { data: current } = await c.get("db")
      .from("profiles")
      .select("notification_preferences")
      .single();
    notificationPreferences = {
      ...sanitizeNotificationPreferences(body.notification_preferences),
      ...(current?.notification_preferences && Object.prototype.hasOwnProperty.call(current.notification_preferences, "_avatar_url")
        ? { _avatar_url: current.notification_preferences._avatar_url }
        : {}),
    };
  }
  const update = {
    ...(body.full_name !== undefined
      ? { full_name: body.full_name.trim().slice(0, 100) || null }
      : {}),
    ...(body.timezone !== undefined
      ? { timezone: body.timezone.trim().slice(0, 80) || "Europe/London" }
      : {}),
    ...(notificationPreferences
      ? { notification_preferences: notificationPreferences }
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
    .eq("id", c.get("userId"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.put("/api/profile/avatar", async (c) => {
  const contentType = (c.req.header("content-type") || "").split(";")[0].toLowerCase();
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(contentType)) return c.json({ error: "unsupported_avatar_type" }, 415);
  const contentLength = Number(c.req.header("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024) return c.json({ error: "avatar_too_large" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024)
    return c.json({ error: "avatar_too_large" }, 413);
  if (!validAvatarBytes(contentType, bytes)) return c.json({ error: "invalid_avatar_image" }, 400);
  const path = `${c.get("userId")}/avatar`;
  const service = admin(c.env);
  const { error: bucketError } = await service.storage.getBucket("avatars");
  if (bucketError) {
    const { error: createError } = await service.storage.createBucket("avatars", {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    });
    if (createError && !/already exists|duplicate/i.test(createError.message))
      return c.json({ error: createError.message }, 400);
  }
  const storage = service.storage.from("avatars");
  const { error: uploadError } = await storage.upload(path, bytes, {
    contentType,
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) return c.json({ error: uploadError.message }, 400);
  const publicUrl = `${storage.getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  const { data: current } = await c.get("db")
    .from("profiles")
    .select("notification_preferences")
    .single();
  const { data, error } = await c.get("db")
    .from("profiles")
    .update({
      notification_preferences: {
        ...(current?.notification_preferences || {}),
        _avatar_url: publicUrl,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.get("userId"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.delete("/api/profile/avatar", async (c) => {
  const path = `${c.get("userId")}/avatar`;
  const storage = admin(c.env).storage.from("avatars");
  const { error: removeError } = await storage.remove([path]);
  if (removeError && !/bucket not found|not found/i.test(removeError.message))
    return c.json({ error: removeError.message }, 400);
  const { data: current } = await c.get("db")
    .from("profiles")
    .select("notification_preferences")
    .single();
  const { data, error } = await c.get("db")
    .from("profiles")
    .update({
      notification_preferences: {
        ...(current?.notification_preferences || {}),
        _avatar_url: null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.get("userId"))
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

const AUDIT_HEARTBEAT_DEADLINE_MS = 8 * 60_000;
const AUDIT_RUN_DEADLINE_MS = 10 * 60_000;

export function isFreshAuditRun(run: { heartbeat_at?: string | null; created_at: string }, now = Date.now()) {
  const heartbeatAt = Date.parse(run.heartbeat_at || run.created_at);
  const createdAt = Date.parse(run.created_at);
  return (!Number.isFinite(createdAt) || now - createdAt <= AUDIT_RUN_DEADLINE_MS) &&
    (!Number.isFinite(heartbeatAt) || now - heartbeatAt <= AUDIT_HEARTBEAT_DEADLINE_MS);
}

async function reconcileStaleAuditRuns(env: Env, propertyId: string) {
  const db = admin(env);
  const { data: activeRuns, error } = await db
    .from("audit_runs")
    .select("id,status,heartbeat_at,created_at,progress_completed,progress_total,registry_snapshot,user_facing_snapshot")
    .eq("property_id", propertyId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`audit_run_reconciliation_failed: ${error.message}`);

  const now = Date.now();
  const freshActiveRun = (activeRuns || []).find((candidate) => isFreshAuditRun(candidate, now));
  const staleRuns = (activeRuns || []).filter((candidate) => !isFreshAuditRun(candidate, now));
  for (const candidate of staleRuns) {
    const total = Number(candidate.progress_total || 0);
    const { data: persistedResults, error: resultError } = await db
      .from("audit_results")
      .select("check_id,outcome")
      .eq("audit_run_id", candidate.id)
      .limit(Math.max(total + 1, 1));
    const persisted = persistedResults?.length || 0;
    if (resultError || !total || persisted < total) {
      const { error: failError } = await db
        .from("audit_runs")
        .update({
          status: "failed",
          execution_stage: "failed",
          progress_completed: persisted,
          error: "Audit worker stopped before all check evidence was saved. A replacement run may now be queued.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .in("status", ["queued", "running"]);
      if (failError) throw new Error(`audit_run_reconciliation_failed: ${failError.message}`);
      continue;
    }

    const snapshot = Array.isArray(candidate.registry_snapshot)
      ? candidate.registry_snapshot as AuditRegistrySnapshot[]
      : [];
    const technicalResults = persistedResults || [];
    const { coverage } = scoreAuditResults(snapshot, technicalResults);
    const groupSnapshot = Array.isArray(candidate.user_facing_snapshot) && candidate.user_facing_snapshot.length
      ? candidate.user_facing_snapshot as UserFacingAuditGroupSnapshot[]
      : fallbackUserFacingSnapshot(snapshot);
    const score = scoreUserFacingAuditResults(deriveUserFacingAuditResults(groupSnapshot, technicalResults as any));
    const status = (persistedResults || []).some((result) => result.outcome === "unable_to_test")
      ? "partial"
      : "completed";
    const { error: salvageError } = await db
      .from("audit_runs")
      .update({
        status,
        score,
        coverage,
        execution_stage: "completed",
        progress_completed: total,
        completed_at: candidate.heartbeat_at || new Date().toISOString(),
        error: null,
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "running"]);
    if (salvageError) throw new Error(`audit_run_reconciliation_failed: ${salvageError.message}`);
  }
  return freshActiveRun || null;
}

app.post("/api/audits", async (c) => {
  const b = await c.req.json<{
    propertyId: string;
    pageId: string;
    checkIds?: string[];
  }>();
  const db = c.get("db");
  const { data: property } = await db
    .from("properties")
    .select("id,url,workspaces(account_id,accounts(entitlement))")
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
  const freshActiveRun = await reconcileStaleAuditRuns(c.env, property.id);
  if (freshActiveRun)
    return c.json({ error: "audit_already_active", run: freshActiveRun }, 409);
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count: runsToday } = await db
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property.id)
    .in("status", ["queued", "running", "completed", "partial"])
    .gte("created_at", dayStart);
  if ((runsToday || 0) >= LIMITS.auditsPerPropertyPerDay)
    return c.json({ error: "audit_daily_limit_reached" }, 429);
  let snapshot: AuditRegistrySnapshot[];
  let userFacingSnapshot: UserFacingAuditGroupSnapshot[];
  try {
    const workspace = property.workspaces as any;
    const configured = await configuredAuditSnapshots(c.env, {
      accountId: workspace?.account_id || null,
      entitlement: workspace?.accounts?.entitlement || null,
      requestedCheckIds: b.checkIds,
    });
    snapshot = configured.technicalSnapshot;
    userFacingSnapshot = configured.userFacingSnapshot;
  } catch (error) {
    console.error("audit registry configuration failed", errorMessage(error));
    return c.json({ error: "audit_registry_unavailable" }, 503);
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
      user_facing_snapshot: userFacingSnapshot,
      scoring_version: "2.0.0",
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

app.delete("/api/properties/:id/audit-pages/:pageId", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const pageId = c.req.param("pageId");
  const { data: page, error: pageError } = await db
    .from("property_audit_pages")
    .select("id,name,path,properties(workspace_id)")
    .eq("id", pageId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (pageError) return c.json({ error: pageError.message }, 400);
  if (!page) return c.json({ error: "audit_page_not_found" }, 404);
  if (isProtectedAuditPagePath(page.path)) return c.json({ error: "homepage_audit_page_cannot_be_deleted" }, 400);
  if (!(await canManageWorkspace(db, c.get("userId"), (page.properties as any)?.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  const service = admin(c.env);
  const { error: runError } = await service.from("audit_runs").delete().eq("audit_page_id", pageId);
  if (runError) return c.json({ error: runError.message }, 400);
  const { error } = await db.from("property_audit_pages").delete().eq("id", pageId);
  if (error) return c.json({ error: error.message }, 400);
  await recordActivity(c.env, c.get("userId"), "audit.page_deleted", propertyId, {
    name: page.name,
    path: page.path,
  });
  return c.body(null, 204);
});

app.get("/api/properties/:id/audits", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const db = c.get("db");
  const { data: visibleProperty } = await db
    .from("properties")
    .select("id")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (!visibleProperty) return c.json({ error: "property_not_found" }, 404);
  await reconcileStaleAuditRuns(c.env, visibleProperty.id);
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
  let runs = data || [];
  if (!pageId) {
    const { data: active } = await db
      .from("audit_runs")
      .select("*,audit_results(*)")
      .eq("property_id", c.req.param("id"))
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(5);
    const activeIds = new Set((active || []).map((run: any) => run.id));
    runs = [...(active || []), ...runs.filter((run: any) => !activeIds.has(run.id))];
  }
  const definitions = new Map(AUDIT_REGISTRY.map((check) => [check.id, check]));
  return c.json(
    runs.map((run: any) => {
      const technicalSnapshot = Array.isArray(run.registry_snapshot) ? run.registry_snapshot as AuditRegistrySnapshot[] : [];
      const snapshotDefinitions = new Map(technicalSnapshot.map((check: any) => [check.id, check]));
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
      const groupSnapshot = Array.isArray(run.user_facing_snapshot) && run.user_facing_snapshot.length
        ? run.user_facing_snapshot as UserFacingAuditGroupSnapshot[]
        : fallbackUserFacingSnapshot(technicalSnapshot);
      const userFacingResults = deriveUserFacingAuditResults(groupSnapshot, auditResults);
      const performanceRows = [
        ["LCP", "performance.performance.largest.contentful.paint.measured", "≤ 2.5 s", (value: number) => `${(value / 1000).toFixed(1)} s`],
        ["TBT", "performance.performance.total.blocking.time.measured", "≤ 200 ms", (value: number) => `${Math.round(value)} ms`],
        ["CLS", "performance.performance.cumulative.layout.shift.measured", "≤ 0.1", (value: number) => value.toFixed(2)],
        ["FCP", "performance.performance.first.contentful.paint.measured", "≤ 1.8 s", (value: number) => `${(value / 1000).toFixed(1)} s`],
      ] as const;
      const metricRows = (viewport: "desktop" | "mobile") => performanceRows.flatMap(([label, checkId, target, format]) => {
        const value = auditResults.find((result: any) => result.check_id === checkId)?.evidence?.[viewport]?.value;
        return Number.isFinite(Number(value)) ? [[label, format(Number(value)), target]] : [];
      });
      const desktopMetrics = metricRows("desktop");
      const mobileMetrics = metricRows("mobile");
      return {
        ...run,
        audit_results: auditResults,
        user_facing_results: userFacingResults,
        performance_metrics: desktopMetrics.length || mobileMetrics.length ? {
          desktop: desktopMetrics,
          mobile: mobileMetrics,
          scores: { desktop: null, mobile: null },
          source: "Cloudflare Browser Run",
        } : undefined,
        catalogue_summary: {
          catalogueSize: ACTIVE_AUDIT_CHECKS.length,
          implementedChecks: IMPLEMENTED_AUDIT_CHECKS.length,
          snapshotChecks: Array.isArray(run.registry_snapshot)
            ? run.registry_snapshot.length
            : 0,
          userFacingGroups: userFacingResults.length,
          attemptedChecks: auditResults.length,
          successfullyExecutedChecks: auditResults.filter(
            (result: any) => result.outcome !== "unable_to_test",
          ).length,
          passedChecks: auditResults.filter(
            (result: any) => result.outcome === "passed",
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
  let configuredIds = new Set<string>();
  try {
    const { data: property } = await admin(c.env)
      .from("properties")
      .select("workspaces(account_id,accounts(entitlement))")
      .eq("id", c.req.param("id"))
      .single();
    const workspace = (property as any)?.workspaces;
    configuredIds = new Set((await configuredAuditSnapshots(c.env, {
      accountId: workspace?.account_id || null,
      entitlement: workspace?.accounts?.entitlement || null,
    })).technicalSnapshot.map((check) => check.id));
  } catch (error) {
    console.error("audit coverage configuration failed", errorMessage(error));
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
      enabled: configuredIds.has(check.id),
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
    enabledChecks: checks.filter((check) => check.enabled).length,
    implementationCoverage: implementationCoverage(checks.length, checks.filter((check) => check.executable).length),
    successfullyExecutedChecks: checks.filter((check) => check.outcome && check.outcome !== "unable_to_test").length,
    auditCoverage: run?.registry_snapshot?.length
      ? Math.round(checks.filter((check) => check.selectedInRun && check.outcome && check.outcome !== "unable_to_test").length / run.registry_snapshot.length * 100)
      : null,
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
  const now = new Date();
  const currentLocalDay = localDateKey(now, window.timeZone);
  const dailyStartKey = shiftDateKey(currentLocalDay, -29);
  const dailyFrom = zonedDateBoundary(dailyStartKey, window.timeZone, false).toISOString();
  const dailyTo = zonedDateBoundary(currentLocalDay, window.timeZone, true).toISOString();
  const [currentResult, previousResult, dailyResult, monitorResult] = await Promise.all([
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
    c.get("db")
      .from("uptime_checks")
      .select(fields)
      .eq("monitor_id", c.req.param("id"))
      .gte("checked_at", dailyFrom)
      .lt("checked_at", dailyTo)
      .order("checked_at", { ascending: true })
      .limit(10000),
    c.get("db")
      .from("uptime_monitors")
      .select("id,property_id,interval_minutes,created_at")
      .eq("id", c.req.param("id"))
      .single(),
  ]);
  if (currentResult.error) return c.json({ error: currentResult.error.message }, 400);
  if (previousResult.error) return c.json({ error: previousResult.error.message }, 400);
  if (dailyResult.error) return c.json({ error: dailyResult.error.message }, 400);
  if (monitorResult.error || !monitorResult.data)
    return c.json({ error: "monitor_not_found" }, 404);
  const checks = currentResult.data || [];
  const previousChecks = previousResult.data || [];
  const dailyChecks = dailyResult.data || [];
  const { data: dailyIncidents, error: dailyIncidentError } = await c.get("db")
    .from("incidents")
    .select("id,opened_at,resolved_at,cause")
    .eq("monitor_id", c.req.param("id"))
    .lt("opened_at", dailyTo)
    .or(`resolved_at.is.null,resolved_at.gte.${dailyFrom}`)
    .order("opened_at", { ascending: true });
  if (dailyIncidentError) return c.json({ error: dailyIncidentError.message }, 400);
  const incidentIds = (dailyIncidents || []).map((incident) => incident.id);
  const deliveries = incidentIds.length
    ? await admin(c.env)
        .from("notification_deliveries")
        .select("kind,status,payload,provider_id,error,created_at")
        .in("kind", ["uptime_down", "uptime_recovered"])
        .contains("payload", { property_id: monitorResult.data.property_id })
        .limit(1000)
    : { data: [], error: null };
  const deliveryRows = (deliveries.data || []).filter((delivery: any) =>
    incidentIds.includes(String(delivery.payload?.id || "")),
  );
  const byDay = new Map<string, any>();
  for (let index = 0; index < 30; index += 1)
    byDay.set(shiftDateKey(dailyStartKey, index), { total: 0, successful: 0, suppressed: 0, checks: [], incidents: [] });
  for (const check of dailyChecks) {
    const day = localDateKey(new Date(check.checked_at), window.timeZone);
    const current = byDay.get(day);
    if (!current) continue;
    if (check.suppressed_by_maintenance) current.suppressed += 1;
    else {
      current.total += 1;
      if (check.success) current.successful += 1;
    }
    current.checks.push(check);
    byDay.set(day, current);
  }
  for (const incident of dailyIncidents || []) {
    const startKey = localDateKey(new Date(Math.max(Date.parse(incident.opened_at), Date.parse(dailyFrom))), window.timeZone);
    const incidentEnd = incident.resolved_at ? Date.parse(incident.resolved_at) : Date.now();
    const endKey = localDateKey(new Date(Math.min(incidentEnd, Date.parse(dailyTo) - 1)), window.timeZone);
    for (const [day, value] of byDay) {
      if (day < startKey || day > endKey) continue;
      value.incidents.push({
        ...incident,
        deliveries: deliveryRows.filter((delivery: any) => delivery.payload?.id === incident.id),
      });
    }
  }
  const intervalMinutes = Number(monitorResult.data.interval_minutes || 5);
  const monitorCreated = Date.parse(monitorResult.data.created_at);
  const dailyDays = [...byDay].map(([day, value]) => {
    const dayStart = zonedDateBoundary(day, window.timeZone, false).valueOf();
    const dayEnd = Math.min(zonedDateBoundary(day, window.timeZone, true).valueOf(), Date.now());
    const coveredStart = Math.max(dayStart, monitorCreated);
    const expected = dayEnd > coveredStart ? Math.max(1, Math.floor((dayEnd - coveredStart) / (intervalMinutes * 60_000))) : 0;
    const partial = value.total + value.suppressed > 0 && expected > 0 && value.total + value.suppressed < expected * 0.8;
    const latestObserved = [...value.checks].reverse().find((check: any) => !check.suppressed_by_maintenance);
    return {
      day,
      total: value.total,
      successful: value.successful,
      suppressed: value.suppressed,
      expected,
      partial,
      status: value.incidents.length ? "incident" : value.total ? (partial ? "partial" : "available") : value.suppressed ? "suppressed" : "missing",
      statusCode: latestObserved?.status_code ?? null,
      incidents: value.incidents,
    };
  });
  return c.json({
    checks,
    summary: summarizeUptimeChecks(checks),
    previous: { checks: previousChecks, summary: summarizeUptimeChecks(previousChecks) },
    range: { from: window.from, to: window.to, timeZone: window.timeZone },
    days: dailyDays,
    dailyScope: { from: dailyFrom, to: dailyTo, timeZone: window.timeZone, days: 30 },
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

app.patch("/api/properties/:id/alert-recipients/:recipientId", async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>();
  if (typeof body.enabled !== "boolean")
    return c.json({ error: "enabled_boolean_required" }, 400);
  const { data, error } = await c.get("db")
    .from("alert_recipients")
    .update({ enabled: body.enabled })
    .eq("property_id", c.req.param("id"))
    .eq("id", c.req.param("recipientId"))
    .select()
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
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
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "valid_email_required" }, 400);
  const { data: property } = await db
    .from("properties")
    .select("id,name,url,workspace_id")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  if (!c.env.RESEND_API_KEY || !c.env.RESEND_FROM)
    return c.json({ error: "email_delivery_not_configured" }, 503);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count: recentTests } = await admin(c.env)
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", c.get("userId"))
    .eq("property_id", propertyId)
    .eq("action", "uptime.test_alert_sent")
    .gte("created_at", fiveMinutesAgo);
  if ((recentTests || 0) >= 3)
    return c.json({ error: "test_alert_rate_limit", retryAfterSeconds: 300 }, 429);
  const key = `test:${propertyId}:${c.get("userId")}:${crypto.randomUUID()}`;
  const sampleIncident = {
    id: `test-${crypto.randomUUID()}`,
    property_id: propertyId,
    opened_at: new Date().toISOString(),
    resolved_at: null,
    cause: "HTTP 503 sample incident",
  };
  const { data: claimed } = await admin(c.env).rpc("claim_notification", {
    p_key: key,
    p_kind: "uptime_test",
    p_recipient: email,
    p_payload: { ...sampleIncident, test: true, requested_by: c.get("userId") },
  });
  if (!claimed) return c.json({ error: "test_alert_already_submitted" }, 409);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: c.env.RESEND_FROM,
      to: [email],
      subject: `[TEST] Claritude uptime alert · ${property.name}`,
      html: renderUptimeAlertEmail({
        property,
        incident: sampleIncident,
        kind: "down",
        appOrigin: c.env.APP_ORIGIN,
        test: true,
      }),
    }),
  });
  const providerBody = response.ok ? await response.json().catch(() => ({})) : null;
  const providerId = String((providerBody as any)?.id || response.headers.get("x-message-id") || "") || null;
  await admin(c.env)
    .from("notification_deliveries")
    .update({
      status: response.ok ? "sent" : "failed",
      provider_id: providerId,
      error: response.ok ? null : (await response.text()).slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", key);
  if (!response.ok) return c.json({ error: "email_provider_rejected_request" }, 502);
  await recordActivity(c.env, c.get("userId"), "uptime.test_alert_sent", propertyId, {
    recipient: email,
    providerId,
  });
  return c.json({ submitted: true, delivered: false, providerId });
});

app.get("/api/properties/:id/events", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const from = new Date(Date.now() - 30 * 864e5).toISOString();
  const [definitionsResponse, receivedResponse, propertyResponse] = await Promise.all([
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
    db
      .from("properties")
      .select("id,workspaces(accounts(entitlement))")
      .eq("id", propertyId)
      .single(),
  ]);
  const requestError = definitionsResponse.error || receivedResponse.error || propertyResponse.error;
  if (requestError) return c.json({ error: requestError.message }, 400);
  const definitions = definitionsResponse.data || [];
  const received = receivedResponse.data || [];
  const counts = new Map<string, { count: number; last: string | null }>();
  for (const event of received) {
    const key = `${event.event_type}:${event.name}`;
    const current = counts.get(key) || { count: 0, last: null };
    current.count += 1;
    if (!current.last || event.occurred_at > current.last) current.last = event.occurred_at;
    counts.set(key, current);
  }
  const workspace = (propertyResponse.data as any)?.workspaces;
  const allowance = customEventAllowance(workspace?.accounts?.entitlement, definitions.length);
  return c.json({
    events: definitions.map((definition) => {
      const measured = counts.get(`${definition.event_type}:${definition.name}`);
      return {
        ...definition,
        received: measured?.count || 0,
        last_received_at: measured?.last || null,
      };
    }),
    allowance,
  });
});

app.post("/api/properties/:id/events", async (c) => {
  const db = c.get("db");
  const propertyId = c.req.param("id");
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
  const { data: property } = await db
    .from("properties")
    .select("id,workspace_id,workspaces(accounts(entitlement))")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  const { count } = await db
    .from("event_definitions")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  const workspace = (property as any).workspaces;
  const allowance = customEventAllowance(workspace?.accounts?.entitlement, count || 0);
  if (!allowance.canCreate)
    return c.json({ error: "custom_event_plan_limit_reached", allowance }, 403);
  const { data, error } = await admin(c.env).rpc("create_event_definition_limited", {
    p_property_id: propertyId,
    p_name: name,
    p_event_type: eventType,
    p_description: body.description?.trim().slice(0, 240) || null,
    p_match_settings: matchSettings,
  });
  if (error) {
    if (error.message.includes("custom_event_plan_limit_reached"))
      return c.json({ error: "custom_event_plan_limit_reached", allowance: { ...allowance, canCreate: false, remaining: 0 } }, 403);
    return c.json({ error: error.message }, 400);
  }
  return c.json(data, 201);
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
  const body: { propertyId?: string | null } = await c.req
    .json<{ propertyId?: string | null }>()
    .catch(() => ({}));
  let query = c.get("db")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", c.get("userId"))
    .is("read_at", null);
  if (body.propertyId) query = query.eq("property_id", body.propertyId);
  const { data, error } = await query.select("id");
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
  const span = new Date(window.to).valueOf() - new Date(window.from).valueOf() + 1;
  const previousTo = new Date(new Date(window.from).valueOf() - 1).toISOString();
  const previousFrom = new Date(new Date(window.from).valueOf() - span).toISOString();
  const useRollups = !hasAnalyticsFilters(filters);
  let currentResult: AnalyticsWindowData;
  let previousResult: AnalyticsWindowData;
  try {
    [currentResult, previousResult] = await Promise.all([
      loadAnalyticsWindow(db, c.req.param("id"), window.from, window.to, useRollups),
      loadAnalyticsWindow(db, c.req.param("id"), previousFrom, previousTo, useRollups),
    ]);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "analytics_query_failed" }, 400);
  }
  const events = currentResult.events;
  const previousEvents = previousResult.events;
  const filtered = filterAnalyticsEvents(events, filters);
  const filteredPrevious = filterAnalyticsEvents(previousEvents, filters);
  return c.json({
    ...buildAnalyticsSummary(
      filtered,
      window.days,
      window.from,
      window.to,
      window.timeZone,
      currentResult.rollups,
      currentResult.views,
    ),
    previous: buildAnalyticsSummary(
      filteredPrevious,
      window.days,
      previousFrom,
      previousTo,
      window.timeZone,
      previousResult.rollups,
      previousResult.views,
    ),
    // Filtering can reduce the returned set below the query ceiling. Preserve
    // whether the underlying property/date result hit that ceiling so the UI
    // never presents a partial result as complete.
    truncated: currentResult.truncated,
    filterOptions: buildAnalyticsFilterOptions([
      ...events,
      ...currentResult.rollups.map(analyticsRollupAsEvent),
    ]),
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

app.get("/api/properties/:id/analytics/events/:name/occurrences", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const eventName = cleanAnalyticsFilter(c.req.param("name"), 80);
  if (!eventName) return c.json({ error: "invalid_event_name" }, 400);
  const page = Math.max(1, Math.floor(Number(c.req.query("page") || 1)));
  const pageSize = [20, 50, 100].includes(Number(c.req.query("page_size")))
    ? Number(c.req.query("page_size"))
    : 20;
  const pathMode = ["exact", "prefix"].includes(c.req.query("path_mode") || "")
    ? c.req.query("path_mode")
    : null;
  const pathValue = cleanAnalyticsFilter(c.req.query("path_value"), 500);
  const { data, error } = await c.get("db").rpc("analytics_event_occurrences_page", {
    p_property_id: c.req.param("id"),
    p_event_name: eventName,
    p_from: window.from,
    p_to: window.to,
    p_offset: (page - 1) * pageSize,
    p_limit: pageSize,
    p_path_mode: pathMode,
    p_path_value: pathValue ? normalizeAnalyticsPath(pathValue) : null,
    p_source: cleanAnalyticsFilter(c.req.query("source"), 255) || null,
    p_country: cleanAnalyticsFilter(c.req.query("country"), 20) || null,
    p_device: cleanAnalyticsFilter(c.req.query("device"), 40) || null,
    p_browser: cleanAnalyticsFilter(c.req.query("browser"), 60) || null,
  });
  if (error) return c.json({ error: error.message }, 400);
  const rows = (data || []).map((row: any) => ({
    ...row,
    id: String(row.id),
    active_seconds: Number(row.active_seconds || 0),
    unique_sessions: Number(row.unique_sessions || 0),
    total_rows: Number(row.total_rows || 0),
  }));
  const total = rows[0]?.total_rows || 0;
  return c.json({
    rows,
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    uniqueSessions: rows.length ? rows[0].unique_sessions : null,
    occurrenceRetentionDays: 120,
  });
});

app.get("/api/properties/:id/analytics/events/:name/occurrences/:occurrenceId", async (c) => {
  const eventName = cleanAnalyticsFilter(c.req.param("name"), 80);
  const occurrenceId = c.req.param("occurrenceId");
  if (!eventName || !/^\d+$/.test(occurrenceId)) return c.json({ error: "invalid_occurrence" }, 400);
  const db = c.get("db");
  const fields = "id,event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at,received_at";
  const occurrenceResult = await db
    .from("analytics_events")
    .select(fields)
    .eq("property_id", c.req.param("id"))
    .eq("id", occurrenceId)
    .eq("name", eventName)
    .in("event_type", ["click", "outbound", "form_success"])
    .maybeSingle();
  if (occurrenceResult.error) return c.json({ error: occurrenceResult.error.message }, 400);
  if (!occurrenceResult.data) return c.json({ error: "occurrence_not_found" }, 404);
  const occurrence: any = occurrenceResult.data;
  const viewId = cleanAnalyticsFilter(occurrence.metadata?.view_id, 200);
  const sessionId = cleanAnalyticsFilter(occurrence.metadata?.session, 200);
  const occurredAt = Date.parse(occurrence.occurred_at);
  const contextFrom = new Date(occurredAt - 24 * 60 * 60_000).toISOString();
  const contextTo = new Date(occurredAt + 24 * 60 * 60_000).toISOString();
  const viewPromise = viewId
    ? db.from("analytics_events").select(fields)
        .eq("property_id", c.req.param("id"))
        .eq("metadata->>view_id", viewId)
        .gte("occurred_at", contextFrom)
        .lte("occurred_at", contextTo)
        .order("occurred_at", { ascending: true })
        .limit(200)
    : Promise.resolve({ data: [], error: null });
  const sessionPromise = sessionId
    ? db.from("analytics_events").select(fields)
        .eq("property_id", c.req.param("id"))
        .eq("metadata->>session", sessionId)
        .gte("occurred_at", contextFrom)
        .lte("occurred_at", contextTo)
        .order("occurred_at", { ascending: true })
        .limit(200)
    : Promise.resolve({ data: [], error: null });
  const [viewResult, sessionResult] = await Promise.all([viewPromise, sessionPromise]);
  const contextError = viewResult.error || sessionResult.error;
  if (contextError) return c.json({ error: contextError.message }, 400);
  return c.json(buildAnalyticsOccurrenceContext(occurrence, viewResult.data || [], sessionResult.data || []));
});

app.get("/api/properties/:id/analytics/events/:name", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const eventName = cleanAnalyticsFilter(c.req.param("name"), 80);
  if (!eventName) return c.json({ error: "invalid_event_name" }, 400);
  const filters: AnalyticsFilters = {
    pathMode: ["exact", "prefix"].includes(c.req.query("path_mode") || "")
      ? (c.req.query("path_mode") as "exact" | "prefix")
      : undefined,
    pathValue: cleanAnalyticsFilter(c.req.query("path_value"), 500),
    device: cleanAnalyticsFilter(c.req.query("device"), 40),
    source: cleanAnalyticsFilter(c.req.query("source"), 255),
    country: cleanAnalyticsFilter(c.req.query("country"), 20),
    browser: cleanAnalyticsFilter(c.req.query("browser"), 60),
    eventName,
  };
  try {
    const { data, error } = await c.get("db").rpc("analytics_event_summary_rows", {
      p_property_id: c.req.param("id"),
      p_event_name: eventName,
      p_from: window.from,
      p_to: window.to,
      p_path_mode: filters.pathMode || null,
      p_path_value: filters.pathValue ? normalizeAnalyticsPath(filters.pathValue) : null,
      p_source: filters.source || null,
      p_country: filters.country || null,
      p_device: filters.device || null,
      p_browser: filters.browser || null,
    });
    if (error) throw new Error(error.message);
    const observations = (data || []).map((row: any) => ({
      event_type: row.event_type,
      path: row.path,
      source: row.source,
      device: row.device,
      country_code: row.country_code,
      name: row.name,
      metadata: { browser: row.browser },
      occurred_at: row.occurred_at,
      _lastOccurredAt: row.last_occurred_at,
      _aggregateCount: Number(row.event_count || 0),
      _isRollup: Boolean(row.rolled_up),
    }));
    return c.json({
      ...buildAnalyticsEventDetailSummary(observations, eventName, window.timeZone),
      from: window.from,
      to: window.to,
      timeZone: window.timeZone,
      truncated: false,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "event_detail_query_failed" }, 400);
  }
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
    loadAnalyticsWindow(db, id, window.from, window.to, true),
  ]);
  if (property.error) return c.json({ error: "property_not_found" }, 404);
  return c.json({
    generatedAt: new Date().toISOString(),
    period: `${window.from.slice(0, 10)} – ${window.to.slice(0, 10)}`,
    periodStart: window.from.slice(0, 10),
    periodEnd: window.to.slice(0, 10),
    property: property.data,
    incidents: incidents.data,
    audits: audits.data,
    analytics: buildAnalyticsSummary(
      analytics.events,
      window.days,
      window.from,
      window.to,
      window.timeZone,
      analytics.rollups,
      analytics.views,
    ),
    limitations: [
      "Visitor totals are aggregate estimates; no persistent visitor identifiers are used.",
    ],
  });
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

type BrowserLabResult = {
  collection: { status: "complete" | "partial" | "failed"; reason?: string };
  durationMs: number;
  score: number;
  fcp: number;
  lcp: number;
  cls: number;
  tbt: number;
  documentResponseMs: number;
  bytes: number;
  requests: number;
  scriptBytes: number;
  cssBytes: number;
  imageBytes: number;
  fontBytes: number;
  thirdPartyRequests: number;
  renderBlocking: number;
  longTasks: number;
  unusedJavaScriptBytes: number;
  unusedCssBytes: number;
  lcpElement: string | null;
  lcpDiscoveryDelay: number;
  layoutShiftContributors: number;
  failedRequests: number;
  consoleErrors: number;
  uncaughtExceptions: number;
  repeatedDownloads: number;
  preloads: number;
  unusedPreloads: number;
  renderedTextLength: number;
  mainTextLength: number;
  javascriptLinks: number;
  imageCount: number;
  failedImages: number;
  distortedImages: number;
  oversizedImages: number;
  belowFoldImagesWithoutLazyLoading: number;
  lcpImageLazy: boolean;
  missingRequiredAria: number;
  invalidAriaNames: number;
  invalidAriaValues: number;
  invalidRoles: number;
  ariaRoleConflicts: number;
  missingAriaParents: number;
  missingAriaChildren: number;
  focusableInAriaHidden: number;
  unfocusableScrollableRegions: number;
  lowContrastText: number;
  smallTouchTargets: number;
  tableAssociationIssues: number;
  emptyTableHeaders: number;
  viewportMetaCount: number;
  viewportDeviceWidth: boolean;
  viewportRestrictsZoom: boolean;
  horizontalOverflow: boolean;
  overflowingElements: number;
  overflowingImages: number;
  overflowingTables: number;
  fixedContentOverlaps: number;
  smallTextElements: number;
  visibleMainHeading: boolean;
  unnamedPrimaryNavigation: number;
  securityPolicyViolations: number;
  networkResources: RenderedViewportEvidence["networkResources"];
  occurrences: Record<string, AuditOccurrence[]>;
  axe: RenderedViewportEvidence["axe"];
  axeError: string | null;
  links: LinkDeclaration[];
  resources: ResourceDeclaration[];
};

function labMetricScore(value: number, good: number, poor: number) {
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round(100 - ((value - good) / (poor - good)) * 100);
}

export async function withAuditDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeBrowserWithDeadline(
  close: () => Promise<unknown>,
  timeoutMs = 5_000,
): Promise<void> {
  await withAuditDeadline(
    Promise.resolve().then(close),
    timeoutMs,
    "BrowserLab close timed out",
  ).catch(() => undefined);
}

async function collectBrowserLab(env: Env, url: string) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const collect = async (strategy: "desktop" | "mobile"): Promise<BrowserLabResult> => {
      const viewportStarted = Date.now();
      const page = await browser.newPage();
      const failed = new Set<string>();
      const failedOccurrences: AuditOccurrence[] = [];
      const consoleOccurrences: AuditOccurrence[] = [];
      const exceptionOccurrences: AuditOccurrence[] = [];
      const responseMetadata = new Map<string, { status: number; headers: Record<string, string>; resourceType: string }>();
      let consoleErrors = 0;
      let uncaughtExceptions = 0;
      let securityPolicyViolations = 0;
      page.on("requestfailed", (request) => {
        failed.add(request.url());
        failedOccurrences.push({ url: request.url(), source: "network", viewport: strategy, values: { failure: request.failure()?.errorText || "request failed" } });
      });
      page.on("response", (response) => {
        responseMetadata.set(response.url(), {
          status: response.status(),
          headers: response.headers(),
          resourceType: response.request().resourceType(),
        });
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors += 1;
          consoleOccurrences.push({ source: "rendered", viewport: strategy, values: { message: message.text() } });
        }
        if (/content security policy|refused to (?:load|execute|connect|frame)/i.test(message.text())) securityPolicyViolations += 1;
      });
      page.on("pageerror", (error) => {
        uncaughtExceptions += 1;
        exceptionOccurrences.push({ source: "rendered", viewport: strategy, values: { message: error.message } });
      });
      await page.setViewport(strategy === "mobile"
        ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      if (strategy === "mobile")
        await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1 Claritude-Audit/1.0");
      await Promise.all([
        page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => undefined),
        page.coverage.startCSSCoverage({ resetOnNavigation: false }).catch(() => undefined),
      ]);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 55_000 });
      await page.evaluate(async () => {
        await Promise.race([
          document.fonts?.ready || Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      let axe: RenderedViewportEvidence["axe"] = null;
      let axeError: string | null = null;
      try {
        // Runtime.evaluate is not blocked by a site's Content-Security-Policy,
        // unlike injecting an inline script element with addScriptTag.
        await page.evaluate(AXE_SOURCE);
        axe = await page.evaluate(async (viewport) => {
          const instance = (window as any).axe;
          const report = await instance.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
          return {
            version: instance.version,
            violations: report.violations.map((violation: any) => ({
              id: violation.id,
              impact: violation.impact || null,
              nodes: violation.nodes.map((node: any) => ({
                locator: Array.isArray(node.target) ? node.target.join(" ") : String(node.target || ""),
                html: node.html,
                source: "accessibility",
                viewport,
                values: { failureSummary: node.failureSummary, impact: node.impact || violation.impact || null },
              })),
            })),
            passes: report.passes.map((rule: any) => ({ id: rule.id, nodes: rule.nodes.length })),
            incomplete: report.incomplete.map((rule: any) => ({
              id: rule.id,
              impact: rule.impact || null,
              nodes: rule.nodes.map((node: any) => ({
                locator: Array.isArray(node.target) ? node.target.join(" ") : String(node.target || ""),
                html: node.html,
                source: "accessibility",
                viewport,
                values: { failureSummary: node.failureSummary, impact: node.impact || rule.impact || null },
              })),
            })),
          };
        }, strategy);
      } catch (error) {
        axeError = error instanceof Error ? error.message : String(error);
        axe = null;
      }
      const measured = await page.evaluate(async (viewport) => {
        const buffered = (type: string) => new Promise<any[]>((resolve) => {
          const values: any[] = [];
          try {
            const observer = new PerformanceObserver((list) => values.push(...list.getEntries().map((entry: any) => ({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
              value: entry.value,
              hadRecentInput: entry.hadRecentInput,
              sources: entry.sources?.length || 0,
              element: entry.element ? `${entry.element.tagName?.toLowerCase() || "element"}${entry.element.id ? `#${entry.element.id}` : ""}${entry.element.className && typeof entry.element.className === "string" ? `.${entry.element.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}` : null,
              lazy: entry.element?.getAttribute?.("loading") === "lazy",
              renderTime: entry.renderTime,
              loadTime: entry.loadTime,
            }))));
            observer.observe({ type, buffered: true } as any);
            setTimeout(() => { observer.disconnect(); resolve(values); }, 800);
          } catch { resolve([]); }
        });
        const [lcpEntries, shiftEntries, longTasks] = await Promise.all([buffered("largest-contentful-paint"), buffered("layout-shift"), buffered("longtask")]);
        const navigation: any = performance.getEntriesByType("navigation")[0];
        const resources: any[] = performance.getEntriesByType("resource") as any[];
        const fcp: any = performance.getEntriesByName("first-contentful-paint")[0];
        const lcp: any = lcpEntries.at(-1);
        const preloads = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="preload"]')).map((link) => new URL(link.href, location.href).href);
        const resourceUrls = new Set(resources.map((entry) => entry.name));
        const blocking = document.querySelectorAll('link[rel="stylesheet"]:not([media="print"]),script[src]:not([async]):not([defer]):not([type="module"])').length;
        const hosts = resources.map((entry) => { try { return new URL(entry.name).hostname; } catch { return ""; } });
        const counts = new Map<string, number>();
        resources.forEach((entry) => counts.set(entry.name, (counts.get(entry.name) || 0) + 1));
        const bytes = (entry: any) => Number(entry.transferSize || entry.encodedBodySize || 0);
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
        };
        const focusableSelector = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
        const images = Array.from(document.images);
        const imageMetrics = images.map((image) => {
          const rect = image.getBoundingClientRect();
          const naturalRatio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0;
          const displayRatio = rect.width && rect.height ? rect.width / rect.height : 0;
          return {
            failed: image.complete && image.naturalWidth === 0,
            distorted: Boolean(naturalRatio && displayRatio && Math.abs(naturalRatio - displayRatio) / naturalRatio > .05),
            oversized: Boolean(image.naturalWidth && rect.width && image.naturalWidth > rect.width * Math.max(2, devicePixelRatio)),
            belowFoldWithoutLazy: rect.top > innerHeight && image.loading !== "lazy",
            overflowing: rect.right > Math.max(document.documentElement.clientWidth, innerWidth) + 1 || rect.left < -1,
          };
        });
        const allowedAria = new Set(["aria-activedescendant","aria-atomic","aria-autocomplete","aria-braillelabel","aria-brailleroledescription","aria-busy","aria-checked","aria-colcount","aria-colindex","aria-colindextext","aria-colspan","aria-controls","aria-current","aria-describedby","aria-description","aria-details","aria-disabled","aria-dropeffect","aria-errormessage","aria-expanded","aria-flowto","aria-grabbed","aria-haspopup","aria-hidden","aria-invalid","aria-keyshortcuts","aria-label","aria-labelledby","aria-level","aria-live","aria-modal","aria-multiline","aria-multiselectable","aria-orientation","aria-owns","aria-placeholder","aria-posinset","aria-pressed","aria-readonly","aria-relevant","aria-required","aria-roledescription","aria-rowcount","aria-rowindex","aria-rowindextext","aria-rowspan","aria-selected","aria-setsize","aria-sort","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"]);
        const validRoles = new Set(["alert","alertdialog","application","article","banner","button","cell","checkbox","columnheader","combobox","complementary","contentinfo","definition","dialog","directory","document","feed","figure","form","grid","gridcell","group","heading","img","link","list","listbox","listitem","log","main","marquee","math","menu","menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note","option","presentation","progressbar","radio","radiogroup","region","row","rowgroup","rowheader","scrollbar","search","searchbox","separator","slider","spinbutton","status","switch","tab","table","tablist","tabpanel","term","textbox","timer","toolbar","tooltip","tree","treegrid","treeitem"]);
        const ariaElements = Array.from(document.querySelectorAll("*"));
        const invalidAriaNames = ariaElements.reduce((total, element) => total + Array.from(element.attributes).filter((attribute) => attribute.name.startsWith("aria-") && !allowedAria.has(attribute.name)).length, 0);
        const invalidAriaValues = document.querySelectorAll('[aria-hidden]:not([aria-hidden="true"]):not([aria-hidden="false"]),[aria-expanded]:not([aria-expanded="true"]):not([aria-expanded="false"]),[aria-selected]:not([aria-selected="true"]):not([aria-selected="false"])').length;
        const roleElements = Array.from(document.querySelectorAll("[role]"));
        const invalidRoles = roleElements.filter((element) => !validRoles.has((element.getAttribute("role") || "").split(/\s+/)[0])).length;
        const missingRequiredAria = roleElements.filter((element) => {
          const role = element.getAttribute("role");
          if (["checkbox","radio","switch"].includes(role || "")) return !element.hasAttribute("aria-checked");
          if (["slider","spinbutton"].includes(role || "")) return !element.hasAttribute("aria-valuenow");
          if (role === "combobox") return !element.hasAttribute("aria-expanded");
          return false;
        }).length;
        const focusableInAriaHidden = Array.from(document.querySelectorAll('[aria-hidden="true"]')).reduce((total, element) => total + element.querySelectorAll(focusableSelector).length, 0);
        const scrollable = ariaElements.filter((element) => { const node = element as HTMLElement; const style = getComputedStyle(node); return /(auto|scroll)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`) && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1); });
        const textElements = ariaElements.filter((element) => element.children.length === 0 && (element.textContent || "").trim() && visible(element));
        const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (colour: number[]) => { const values = colour.map((part) => { const channel = part / 255; return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return .2126 * (values[0] || 0) + .7152 * (values[1] || 0) + .0722 * (values[2] || 0); };
        const lowContrastText = textElements.filter((element) => { const style = getComputedStyle(element); const foreground = rgb(style.color); const background = rgb(style.backgroundColor); if (foreground.length < 3 || background.length < 3 || /rgba\([^)]*,\s*0\s*\)/.test(style.backgroundColor)) return false; const high = Math.max(luminance(foreground), luminance(background)); const low = Math.min(luminance(foreground), luminance(background)); return (high + .05) / (low + .05) < (parseFloat(style.fontSize) >= 24 ? 3 : 4.5); }).length;
        const interactive = Array.from(document.querySelectorAll(focusableSelector)).filter(visible);
        const smallTouchTargets = interactive.filter((element) => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).length;
        const tables = Array.from(document.querySelectorAll("table"));
        const tableAssociationIssues = tables.reduce((total, table) => total + Array.from(table.querySelectorAll("td")).filter((cell) => !cell.closest("table")?.querySelector("th") && !cell.hasAttribute("headers")).length, 0);
        const emptyTableHeaders = document.querySelectorAll("th:empty").length;
        const viewportContent = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content || "";
        const viewportWidth = Math.max(document.documentElement.clientWidth, innerWidth);
        const overflowing = ariaElements.filter((element) => { if (!visible(element)) return false; const rect = element.getBoundingClientRect(); return rect.right > viewportWidth + 1 || rect.left < -1; });
        const fixedElements = ariaElements.filter((element) => visible(element) && getComputedStyle(element).position === "fixed");
        const main = document.querySelector("main,[role=main]");
        const mainRect = main?.getBoundingClientRect();
        const fixedContentOverlaps = mainRect ? fixedElements.filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < mainRect.right && rect.right > mainRect.left && rect.top < mainRect.bottom && rect.bottom > mainRect.top; }).length : 0;
        const securityPolicyViolations = performance.getEntriesByType("resource").filter((entry) => entry.name.startsWith("data:") === false && !entry.name).length;
        const locator = (element: Element) => {
          if ((element as HTMLElement).id) return `#${CSS.escape((element as HTMLElement).id)}`;
          const parts: string[] = [];
          let current: Element | null = element;
          while (current && parts.length < 6) {
            const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current!.tagName) : [];
            parts.unshift(`${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`);
            current = current.parentElement;
          }
          return parts.join(" > ");
        };
        const occurrences: Record<string, AuditOccurrence[]> = {
          h1: Array.from(document.querySelectorAll("h1")).map((element) => ({ locator: locator(element), html: element.outerHTML, source: "rendered", viewport, values: { text: element.textContent?.trim() || "", visible: visible(element) } })),
          images: images.map((element, index) => {
            const rect = element.getBoundingClientRect();
            return { locator: locator(element), html: element.outerHTML, url: element.currentSrc || element.src, source: "rendered", viewport, values: { displayWidth: rect.width, displayHeight: rect.height, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, ...imageMetrics[index] } };
          }),
          smallTouchTargets: interactive.filter((element) => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map((element) => { const rect = element.getBoundingClientRect(); return { locator: locator(element), html: element.outerHTML, source: "rendered", viewport, values: { width: rect.width, height: rect.height } }; }),
          overflow: overflowing.map((element) => { const rect = element.getBoundingClientRect(); return { locator: locator(element), html: element.outerHTML, source: "rendered", viewport, values: { left: rect.left, right: rect.right, viewportWidth } }; }),
        };
        const renderedLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href],area[href]")).map((element) => {
          let resolvedUrl: string | null = null;
          try { const target = new URL(element.getAttribute("href") || "", location.href); resolvedUrl = ["http:", "https:"].includes(target.protocol) ? target.href : null; } catch { resolvedUrl = null; }
          return {
            originalUrl: element.getAttribute("href") || "",
            resolvedUrl,
            sourceElement: element.tagName.toLowerCase(),
            locator: locator(element),
            internal: resolvedUrl ? new URL(resolvedUrl).hostname === location.hostname : null,
            source: "rendered",
            accessibleName: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("title") || "").trim(),
          };
        });
        const renderedResources = Array.from(document.querySelectorAll<HTMLElement>("img[src],source[src],script[src],iframe[src],video[src],audio[src],track[src],link[href],meta[property='og:image'][content],meta[name='twitter:image'][content]")).flatMap((element) => {
          const tag = element.tagName.toLowerCase();
          const rel = (element.getAttribute("rel") || "").toLowerCase().split(/\s+/);
          const declarationType = tag === "track" ? "caption"
            : tag === "link" && rel.includes("manifest") ? "manifest"
            : tag === "link" && rel.includes("apple-touch-icon") ? "apple-touch-icon"
            : tag === "link" && (rel.includes("icon") || rel.includes("shortcut")) ? "favicon"
            : tag === "link" && (element.getAttribute("type") || "").toLowerCase() === "text/markdown" ? "markdown-alternative"
            : tag === "link" && rel.includes("stylesheet") ? "stylesheet"
            : tag === "meta" ? "social-image"
            : tag;
          const declaredUrl = element.getAttribute(tag === "link" ? "href" : tag === "meta" ? "content" : "src") || "";
          if (!declaredUrl) return [];
          let resolvedUrl: string | null = null;
          try { const target = new URL(declaredUrl, location.href); resolvedUrl = ["http:", "https:"].includes(target.protocol) ? target.href : null; } catch { resolvedUrl = null; }
          return [{ declaredUrl, resolvedUrl, declarationType, locator: locator(element), source: "rendered" }];
        });
        return {
          fcp: Number(fcp?.startTime || 0),
          lcp: Number(lcp?.renderTime || lcp?.loadTime || lcp?.startTime || 0),
          cls: shiftEntries.filter((entry) => !entry.hadRecentInput).reduce((sum, entry) => sum + Number(entry.value || 0), 0),
          tbt: longTasks.reduce((sum, entry) => sum + Math.max(0, Number(entry.duration || 0) - 50), 0),
          documentResponseMs: Math.max(0, Number(navigation?.responseStart || 0) - Number(navigation?.requestStart || 0)),
          bytes: resources.reduce((sum, entry) => sum + bytes(entry), Number(navigation?.transferSize || 0)),
          requests: resources.length + 1,
          scriptBytes: resources.filter((entry) => entry.initiatorType === "script").reduce((sum, entry) => sum + bytes(entry), 0),
          cssBytes: resources.filter((entry) => entry.initiatorType === "link" && /css/i.test(entry.name)).reduce((sum, entry) => sum + bytes(entry), 0),
          imageBytes: resources.filter((entry) => entry.initiatorType === "img" || /\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?|$)/i.test(entry.name)).reduce((sum, entry) => sum + bytes(entry), 0),
          fontBytes: resources.filter((entry) => /\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(entry.name)).reduce((sum, entry) => sum + bytes(entry), 0),
          thirdPartyRequests: hosts.filter((host) => host && host !== location.hostname).length,
          renderBlocking: blocking,
          longTasks: longTasks.length,
          lcpElement: lcp?.element || null,
          lcpDiscoveryDelay: Math.max(0, Number(lcp?.startTime || 0) - Number(navigation?.responseStart || 0)),
          layoutShiftContributors: shiftEntries.reduce((sum, entry) => sum + Number(entry.sources || 0), 0),
          repeatedDownloads: [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
          preloads: preloads.length,
          unusedPreloads: preloads.filter((preload) => !resourceUrls.has(preload)).length,
          renderedTextLength: (document.body?.innerText || "").trim().length,
          mainTextLength: (main?.textContent || "").trim().length,
          javascriptLinks: document.querySelectorAll('a[href^="javascript:"]').length,
          imageCount: images.length,
          failedImages: imageMetrics.filter((item) => item.failed).length,
          distortedImages: imageMetrics.filter((item) => item.distorted).length,
          oversizedImages: imageMetrics.filter((item) => item.oversized).length,
          belowFoldImagesWithoutLazyLoading: imageMetrics.filter((item) => item.belowFoldWithoutLazy).length,
          lcpImageLazy: Boolean(lcp?.element?.startsWith("img") && lcp?.lazy),
          missingRequiredAria,
          invalidAriaNames,
          invalidAriaValues,
          invalidRoles,
          ariaRoleConflicts: roleElements.filter((element) => /^(presentation|none)$/.test(element.getAttribute("role") || "") && (element.matches(focusableSelector) || element.hasAttribute("aria-label"))).length,
          missingAriaParents: document.querySelectorAll('[role="option"]:not([data-claritude-parent])').length ? Array.from(document.querySelectorAll('[role="option"]')).filter((element) => !element.closest('[role="listbox"]')).length : 0,
          missingAriaChildren: Array.from(document.querySelectorAll('[role="listbox"]')).filter((element) => !element.querySelector('[role="option"]')).length,
          focusableInAriaHidden,
          unfocusableScrollableRegions: scrollable.filter((element) => !element.matches(focusableSelector) && !element.hasAttribute("tabindex")).length,
          lowContrastText,
          smallTouchTargets,
          tableAssociationIssues,
          emptyTableHeaders,
          viewportMetaCount: document.querySelectorAll('meta[name="viewport"]').length,
          viewportDeviceWidth: /width\s*=\s*device-width/i.test(viewportContent),
          viewportRestrictsZoom: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?(?:,|$)/i.test(viewportContent),
          horizontalOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
          overflowingElements: overflowing.length,
          overflowingImages: imageMetrics.filter((item) => item.overflowing).length,
          overflowingTables: tables.filter((table) => table.getBoundingClientRect().right > viewportWidth + 1).length,
          fixedContentOverlaps,
          smallTextElements: textElements.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).length,
          visibleMainHeading: Array.from(document.querySelectorAll("h1")).some(visible),
          unnamedPrimaryNavigation: Array.from(document.querySelectorAll("nav,[role=navigation]")).filter((element) => !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")).length,
          securityPolicyViolations,
          networkResources: resources.map((entry) => ({
            url: entry.name,
            resourceType: entry.initiatorType || "other",
            transferSize: Number(entry.transferSize || 0),
            encodedBodySize: Number(entry.encodedBodySize || 0),
            decodedBodySize: Number(entry.decodedBodySize || 0),
          })),
          occurrences,
          links: renderedLinks,
          resources: renderedResources,
        };
      }, strategy);
      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage().catch(() => []),
        page.coverage.stopCSSCoverage().catch(() => []),
      ]);
      await page.close();
      const unused = (entries: any[]) => entries.reduce((sum, entry) => {
        const used = (entry.ranges || []).reduce((rangeSum: number, range: any) => rangeSum + Math.max(0, range.end - range.start), 0);
        return sum + Math.max(0, Number(entry.text?.length || 0) - used);
      }, 0);
      return {
        ...measured,
        collection: { status: "complete" },
        durationMs: Date.now() - viewportStarted,
        score: Math.round(labMetricScore(measured.lcp, 2500, 4000) * .3 + labMetricScore(measured.tbt, 200, 600) * .3 + labMetricScore(measured.cls, .1, .25) * .25 + labMetricScore(measured.fcp, 1800, 3000) * .15),
        unusedJavaScriptBytes: unused(jsCoverage),
        unusedCssBytes: unused(cssCoverage),
        failedRequests: failed.size,
        consoleErrors,
        uncaughtExceptions,
        securityPolicyViolations,
        networkResources: measured.networkResources.map((resource: any) => ({
          ...resource,
          status: responseMetadata.get(resource.url)?.status ?? null,
          headers: responseMetadata.get(resource.url)?.headers || {},
          resourceType: responseMetadata.get(resource.url)?.resourceType || resource.resourceType,
        })),
        occurrences: {
          ...measured.occurrences,
          failedRequests: failedOccurrences,
          consoleErrors: consoleOccurrences,
          uncaughtExceptions: exceptionOccurrences,
          axe: axe?.violations.flatMap((violation) => violation.nodes) || [],
        },
        axe,
        axeError,
        links: measured.links as LinkDeclaration[],
        resources: measured.resources as ResourceDeclaration[],
      };
    };
    const [desktop, mobile] = await withAuditDeadline(Promise.all([
      collect("desktop"),
      collect("mobile"),
    ]), 90_000, "BrowserLab collection timed out", () => {
      void browser.close().catch(() => undefined);
    });
    return { desktop, mobile };
  } finally {
    await closeBrowserWithDeadline(() => browser.close());
  }
}

function renderedViewportEvidence(lab: BrowserLabResult): RenderedViewportEvidence {
  const {
    collection,
    durationMs,
    networkResources,
    occurrences,
    axe,
    axeError,
    links: _links,
    resources: _resources,
    ...metrics
  } = lab;
  return { collection, durationMs, networkResources, occurrences, axe, axeError, metrics };
}

function structuredDataResourceDeclarations(source: ReturnType<typeof parseSourceDom>): ResourceDeclaration[] {
  const declarations: ResourceDeclaration[] = [];
  const imageKeys = new Set(["image", "logo", "thumbnailUrl", "contentUrl"]);
  const visit = (value: unknown, block: number, pointer = "") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, block, `${pointer}/${index}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const next = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (imageKeys.has(key) && typeof nested === "string") {
        try {
          declarations.push({ declaredUrl: nested, resolvedUrl: new URL(nested, source.documentUrl).href, declarationType: "structured-data-image", locator: `json-ld:${block}${next}`, source: "html" });
        } catch {
          declarations.push({ declaredUrl: nested, resolvedUrl: null, declarationType: "structured-data-image", locator: `json-ld:${block}${next}`, source: "html" });
        }
      }
      visit(nested, block, next);
    }
  };
  source.structuredData.forEach((block) => visit(block.parsed, block.index));
  return declarations;
}

async function collectV2AuditEvidence(
  env: Env,
  pageUrl: string,
  response: Response,
  html: string,
  responseMs: number,
  redirects: { url: string; status: number; location: string }[],
  requireBrowser: boolean,
): Promise<{ evidence: AuditEvidenceBundle; telemetry: Record<string, unknown>; sharedEvidence: Array<Record<string, unknown>> }> {
  const phases: Record<string, number> = {};
  const collectStarted = Date.now();
  const sourceStarted = Date.now();
  const source = parseSourceDom(html, response.url || pageUrl);
  phases.sourceParseMs = Date.now() - sourceStarted;
  const http: HttpEvidence = {
    requestedUrl: pageUrl,
    finalUrl: response.url || null,
    status: response.status,
    redirectTrace: redirects.map((item) => ({ ...item, location: item.location || null })),
    responseMs,
    headers: headerMultimap(response.headers),
    contentType: response.headers.get("content-type"),
    encodedBytes: Number(response.headers.get("content-length") || 0) || null,
    decodedBytes: new TextEncoder().encode(html).byteLength,
    collection: { status: "complete" },
  };
  let browserLab: { desktop: BrowserLabResult; mobile: BrowserLabResult } | null = null;
  const browserStarted = Date.now();
  if (requireBrowser) {
    try {
      browserLab = await withAuditDeadline(
        collectBrowserLab(env, pageUrl),
        100_000,
        "BrowserLab operation timed out",
      );
    } catch (error) {
      console.error("browser evidence collection failed", errorMessage(error));
    }
  }
  phases.browserMs = Date.now() - browserStarted;
  console.log("audit evidence phase", JSON.stringify({ pageUrl, phase: "browser_complete", durationMs: phases.browserMs, available: Boolean(browserLab) }));
  const rendered = browserLab ? {
    desktop: renderedViewportEvidence(browserLab.desktop),
    mobile: renderedViewportEvidence(browserLab.mobile),
  } : null;
  const renderedLinks = browserLab ? [...browserLab.desktop.links, ...browserLab.mobile.links] : [];
  const renderedResources = browserLab ? [...browserLab.desktop.resources, ...browserLab.mobile.resources] : [];
  const mergedDeclarations = mergeRenderedDeclarations(source, renderedLinks, renderedResources);
  const linkDeclarations = mergedDeclarations.links;
  const resourceDeclarations = [...mergedDeclarations.resources, ...structuredDataResourceDeclarations(source)];
  const networkStarted = Date.now();
  const validatedHosts = new Set<string>([new URL(source.documentUrl).hostname.toLowerCase()]);
  const precollectedResources = new Map<string, { status: number; headers: Record<string, string>; resourceType: string }>();
  if (browserLab) {
    for (const resource of [...browserLab.desktop.networkResources, ...browserLab.mobile.networkResources]) {
      if (resource.status == null || precollectedResources.has(resource.url)) continue;
      precollectedResources.set(resource.url, {
        status: resource.status,
        headers: resource.headers,
        resourceType: resource.resourceType,
      });
    }
  }
  const [links, resources] = await Promise.all([
    collectLinkInventory(linkDeclarations, safeFetchTrace, undefined, validatedHosts),
    collectResourceInventory(resourceDeclarations, safeFetchTrace, undefined, validatedHosts, undefined, precollectedResources),
  ]);
  const pageDestination = {
    requestedUrl: http.requestedUrl,
    finalUrl: http.finalUrl,
    state: classifyDestination(http.status, null, http.redirectTrace.length),
    status: http.status,
    redirectTrace: http.redirectTrace,
    contentType: http.contentType,
    headers: http.headers,
    body: null,
    bodyTruncated: false,
    error: null,
  } as const;
  const destinationCache = new Map([...links.results, ...resources.results].map((item) => [item.requestedUrl, item]));
  destinationCache.set(http.requestedUrl, pageDestination);
  if (http.finalUrl) destinationCache.set(http.finalUrl, pageDestination);
  console.log("audit evidence phase", JSON.stringify({ pageUrl, phase: "inventories_complete", links: links.retained, resources: resources.retained }));
  const canonicalElement = source.elements.find((element) => element.tagName === "link" && (element.attributes.find((item) => item.name === "rel")?.value || "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalHref = canonicalElement?.attributes.find((item) => item.name === "href")?.value || null;
  const canonicalUrl = canonicalHref ? new URL(canonicalHref, source.documentUrl).href : null;
  const canonical: ResourceEvidence | null = canonicalUrl === source.documentUrl
    ? {
        requestedUrl: canonicalUrl,
        finalUrl: http.finalUrl,
        state: response.ok ? "success" : "unable_to_test",
        status: http.status,
        redirectTrace: http.redirectTrace,
        contentType: http.contentType,
        headers: http.headers,
        body: html,
        bodyTruncated: false,
        error: null,
        declarations: [],
      }
    : canonicalUrl
      ? { ...await inspectDestination(canonicalUrl, safeFetchTrace, { includeBody: true, validatedHosts }), declarations: [] }
      : null;
  const documentUrl = new URL(source.documentUrl);
  const origin = documentUrl.origin;
  const apex = canonicalPropertyHost(documentUrl.hostname);
  const alternateProbeUrls = [...new Set([
    `http://${documentUrl.hostname}/`,
    `http://${apex}/`,
    `http://www.${apex}/`,
  ])];
  const [robotsDestination, probeEntries, llmsTxt, llmsFullTxt] = await Promise.all([
    inspectDestination(`${origin}/robots.txt`, safeFetchTrace, { includeBody: true, validatedHosts }),
    Promise.all(alternateProbeUrls.map(async (url) => [url, destinationCache.get(url) || await inspectDestination(url, safeFetchTrace, { probeChallenge: true, bodyBytes: 16_384, validatedHosts })] as const)),
    collectOptionalAiResource("llms.txt", `${origin}/llms.txt`, safeFetchTrace, validatedHosts, destinationCache),
    collectOptionalAiResource("llms-full.txt", `${origin}/llms-full.txt`, safeFetchTrace, validatedHosts, destinationCache),
  ]);
  const alternateProbeMap = new Map(probeEntries);
  const httpToHttps = alternateProbeMap.get(`http://${documentUrl.hostname}/`);
  const apexHttp = alternateProbeMap.get(`http://${apex}/`);
  const wwwHttp = alternateProbeMap.get(`http://www.${apex}/`);
  if (!httpToHttps || !apexHttp || !wwwHttp)
    throw new Error("alternate_origin_probe_collection_incomplete");
  const alternateOrigins = { httpToHttps, apexHttp, wwwHttp };
  const robots = parseRobotsEvidence(robotsDestination, source.documentUrl, ["Googlebot", "Bingbot", "OAI-SearchBot", "GPTBot", "ClaudeBot", "Claude-SearchBot", "ChatGPT-User", "Claude-User"]);
  const sitemapUrls = [...new Set([...robots.sitemaps, `${origin}/sitemap.xml`])].slice(0, 4);
  const sitemapDestinations = await Promise.all(sitemapUrls.map((url) => inspectDestination(url, safeFetchTrace, { includeBody: true, bodyBytes: 1_000_000, validatedHosts })));
  const sitemaps = sitemapDestinations.map((destination) => {
    const parsed = destination.body && !destination.bodyTruncated
      ? parseSitemapXml(destination.body, destination.requestedUrl)
      : { sourceUrl: destination.requestedUrl, destinationState: destination.state, status: destination.status, urls: [], error: destination.bodyTruncated ? "sitemap body limit exceeded" : destination.error || `HTTP ${destination.status ?? "unavailable"}` };
    return { ...parsed, sourceUrl: destination.requestedUrl, destinationState: destination.state, status: destination.status };
  });
  const nxdomainControlHostname = `claritude-nxdomain-control-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}.${apex}`;
  const dnsQueries: Array<readonly [string, string]> = [[apex, "A"], [apex, "AAAA"], [apex, "CNAME"], [apex, "MX"], [apex, "TXT"], [apex, "CAA"], [apex, "NS"], [apex, "SOA"], [`www.${apex}`, "A"], [`www.${apex}`, "AAAA"], [`_dmarc.${apex}`, "TXT"], [nxdomainControlHostname, "A"]];
  const dns: DnsEvidence[] = [];
  for (let index = 0; index < dnsQueries.length; index += 3) {
    dns.push(...await Promise.all(dnsQueries.slice(index, index + 3).map(async ([hostname, recordType]) => {
      try {
        const answer = await queryDns(hostname, recordType);
        return { queriedHostname: hostname, recordType, responseCode: answer.responseCode, authenticatedData: answer.authenticated, records: answer.records.map((record) => ({ value: record.data, ttl: record.ttl })), error: null };
      } catch (error) {
        return { queriedHostname: hostname, recordType, responseCode: null, authenticatedData: null, records: [], error: errorMessage(error) };
      }
    })));
  }
  const nxdomainControl = dns.find((item) => item.queriedHostname === nxdomainControlHostname && item.recordType === "A") || null;
  phases.networkMs = Date.now() - networkStarted;
  console.log("audit evidence phase", JSON.stringify({ pageUrl, phase: "network_complete", durationMs: phases.networkMs, dnsQueries: dns.length }));
  const fontFaces = resources.results.filter((item) => item.declarations.some((declaration) => declaration.declarationType === "stylesheet") && item.body).flatMap((item) => parseFontFaces(item.body || "", item.finalUrl || item.requestedUrl));
  console.log("audit evidence phase", JSON.stringify({ pageUrl, phase: "font_faces_complete", fontFaces: fontFaces.length }));
  const evidence: AuditEvidenceBundle = { http, source, rendered, links, resources, canonical, dns, robots, sitemaps, fontFaces, alternateOrigins, nxdomainControl, aiResources: { llmsTxt, llmsFullTxt } };
  const approximateEvidenceBytes = new TextEncoder().encode(JSON.stringify({ http, source: { elements: source.elements.length, links: source.links.length, resources: source.resources.length, structuredData: source.structuredData }, rendered, links, resources, dns, robots: { decisions: robots.decisions, sitemaps: robots.sitemaps }, sitemaps, alternateOrigins, aiResources: { llmsTxt, llmsFullTxt } })).byteLength;
  console.log("audit evidence phase", JSON.stringify({ pageUrl, phase: "bundle_sized", approximateEvidenceBytes }));
  const occurrenceCount = Object.values(rendered?.desktop.occurrences || {}).flat().length + Object.values(rendered?.mobile.occurrences || {}).flat().length;
  const httpOperationBreakdown = {
    selectedPage: 1 + http.redirectTrace.length,
    browserNetworkCapture: Number(rendered?.desktop.metrics.requests || 0) + Number(rendered?.mobile.metrics.requests || 0),
    links: links.requests,
    resources: resources.requests,
    canonical: canonicalUrl && canonicalUrl !== source.documentUrl ? 1 + (canonical?.redirectTrace.length || 0) : 0,
    alternateOrigins: probeEntries
      .filter(([url]) => !destinationCache.has(url))
      .reduce((total, [, item]) => total + 1 + item.redirectTrace.length, 0),
    robots: 1 + robotsDestination.redirectTrace.length,
    sitemaps: sitemapDestinations.reduce((total, item) => total + 1 + item.redirectTrace.length, 0),
    llmsResources: 2 + llmsTxt.destination.redirectTrace.length + llmsFullTxt.destination.redirectTrace.length,
    llmsLinks: llmsTxt.links?.requests || 0,
    other: 0,
  };
  const httpOperations = Object.values(httpOperationBreakdown).reduce((total, count) => total + count, 0);
  const telemetry = {
    architectureVersion: "2.0.0",
    collectionMs: Date.now() - collectStarted,
    phases,
    browserDurationMs: (rendered?.desktop.durationMs || 0) + (rendered?.mobile.durationMs || 0),
    browserSessions: browserLab ? 1 : 0,
    httpRequests: httpOperations,
    httpOperationBreakdown,
    collectorInvocations: {
      sourceParses: 1,
      browserSessions: browserLab ? 1 : 0,
      browserViewportRuns: browserLab ? 2 : 0,
      browserNavigations: browserLab ? 2 : 0,
      axeRuns: browserLab ? 2 : 0,
      renderedDomCollections: browserLab ? 2 : 0,
      linkCollectors: 1,
      resourceCollectors: 1,
      canonicalProbes: canonicalUrl && canonicalUrl !== source.documentUrl ? 1 : 0,
      alternateOriginProbes: probeEntries.filter(([url]) => !destinationCache.has(url)).length,
      robotsFetches: 1,
      sitemapFetches: sitemapDestinations.length,
      llmsResourceFetches: 2,
      llmsLinkCollectors: llmsTxt.links ? 1 : 0,
      dnsQueries: dns.length,
    },
    browserExecution: {
      strategy: "parallel_desktop_mobile_pages",
      readiness: "domcontentloaded_fonts_or_2s_two_animation_frames",
      desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
      mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
    },
    uniqueLinksChecked: links.retained + (llmsTxt.links?.retained || 0),
    uniqueResourcesChecked: resources.retained,
    dnsQueries: dns.length,
    queueMessagesUsed: 1,
    approximateEvidenceBytes,
    occurrencesCollected: occurrenceCount,
    truncatedOccurrenceSets: Number(links.truncated) + Number(resources.truncated) + Number(Boolean(llmsTxt.links?.truncated)),
    collectorFailures: [source.collection, rendered?.desktop.collection, rendered?.mobile.collection].filter((state) => state && state.status !== "complete").length + dns.filter((item) => item.error).length + Number(Boolean(robots.parseError)) + sitemaps.filter((item) => item.error).length + probeEntries.filter(([, item]) => Boolean(item.error)).length + [llmsTxt, llmsFullTxt].filter((item) => item.presence === "unavailable").length,
  };
  const sharedEvidence = [
    { evidence_type: "http", schema_version: "2.0.0", summary: { requestedUrl: http.requestedUrl, finalUrl: http.finalUrl, status: http.status, redirects: http.redirectTrace.length, responseMs: http.responseMs, contentType: http.contentType, alternateOrigins: Object.values(alternateOrigins).map((item) => ({ requestedUrl: item.requestedUrl, finalUrl: item.finalUrl, state: item.state, status: item.status, redirects: item.redirectTrace.length })) }, byte_size: JSON.stringify({ http, alternateOrigins }).length, collection_status: Object.values(alternateOrigins).some((item) => item.error) ? "partial" : http.collection.status, error: null },
    { evidence_type: "source", schema_version: "2.0.0", summary: { elements: source.elements.length, links: source.links.length, resources: source.resources.length, structuredDataBlocks: source.structuredData.length, duplicateIds: source.duplicateIds.length }, byte_size: new TextEncoder().encode(html).byteLength, collection_status: source.collection.status, error: source.collection.status === "complete" ? null : source.collection.reason },
    { evidence_type: "links", schema_version: "2.0.0", summary: { totalDiscovered: links.totalDiscovered, retained: links.retained, truncated: links.truncated }, byte_size: JSON.stringify(links).length, collection_status: links.truncated ? "partial" : "complete", error: links.truncated ? "link safety ceiling reached" : null },
    { evidence_type: "resources", schema_version: "2.0.0", summary: { totalDiscovered: resources.totalDiscovered, retained: resources.retained, truncated: resources.truncated, aiResources: [llmsTxt, llmsFullTxt].map((item) => ({ kind: item.kind, sourceUrl: item.sourceUrl, presence: item.presence, state: item.destination.state, status: item.destination.status, readable: item.readable, parseErrors: item.parse?.errors.length || 0, linksDiscovered: item.links?.totalDiscovered || 0, linksChecked: item.links?.retained || 0 })) }, byte_size: JSON.stringify({ resources, llmsTxt, llmsFullTxt }).length, collection_status: resources.truncated || [llmsTxt, llmsFullTxt].some((item) => item.presence === "unavailable") ? "partial" : "complete", error: resources.truncated ? "resource safety ceiling reached" : null },
    { evidence_type: "dns", schema_version: "2.0.0", summary: { queries: dns.length, failures: dns.filter((item) => item.error).length }, byte_size: JSON.stringify(dns).length, collection_status: dns.some((item) => item.error) ? "partial" : "complete", error: null },
  ];
  return { evidence, telemetry, sharedEvidence };
}

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
  const updateRun = async (values: Record<string, unknown>) => {
    let failure: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = db
          .from("audit_runs")
          .update(values)
          .eq("id", id)
          .abortSignal(AbortSignal.timeout(10_000));
        const { error } = await Promise.race([
          Promise.resolve(request),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("audit run update timed out")), 10_000);
          }),
        ]);
        failure = error?.message || null;
      } catch (error) {
        failure = errorMessage(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!failure) return;
    }
    throw new Error(`audit_run_update_failed: ${failure}`);
  };
  try {
    const fetchStarted = Date.now();
    const trace = await safeFetchTrace(run.page_url, {
      headers: { "user-agent": "Claritude-Audit/2.0 (+https://claritude.io)" },
    });
    const res = trace.response;
    const responseMs = Date.now() - fetchStarted;
    const snapshot = run.registry_snapshot as AuditRegistrySnapshot[];
    const html = await limitedText(res, 2_000_000);
    await updateRun({
      execution_stage: "collecting_shared_evidence",
      progress_completed: 0,
      heartbeat_at: new Date().toISOString(),
    });
    const requireBrowser = snapshot.some((check) => {
      const definition = registry(check.id);
      return check.primaryCategory === "performance" || ["rendered_browser", "lab"].includes(definition?.executionMethod || "");
    });
    const collected = await collectV2AuditEvidence(
      env,
      run.page_url,
      res,
      html,
      responseMs,
      trace.redirects,
      requireBrowser,
    );
    const evaluationStarted = Date.now();
    const results = evaluateAuditCatalogue(snapshot.map((check) => check.id), collected.evidence);
    const evaluationMs = Date.now() - evaluationStarted;
    const snapshotById = new Map(snapshot.map((check) => [check.id, check]));
    const decorate = (r: AuditResult) => {
      const check = snapshotById.get(r.check_id);
      const persistedResult = compactAuditResult(r);
      return {
        ...persistedResult,
        audit_run_id: id,
        logic_version: check?.logicVersion || "unknown",
        configuration_version: check?.configurationVersion || 1,
        title_snapshot: check?.title || r.check_id,
      };
    };
    const { coverage } = scoreAuditResults(snapshot, results);
    const groupSnapshot = Array.isArray(run.user_facing_snapshot) && run.user_facing_snapshot.length
      ? run.user_facing_snapshot as UserFacingAuditGroupSnapshot[]
      : fallbackUserFacingSnapshot(snapshot);
    const userFacingResults = deriveUserFacingAuditResults(groupSnapshot, results);
    const score = scoreUserFacingAuditResults(userFacingResults);
    const outcomeCounts = Object.fromEntries(["passed", "failed", "advisory", "not_applicable", "unable_to_test"].map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length]));
    const decoratedResults = results.map(decorate);
    const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const telemetry = {
      ...collected.telemetry,
      phases: { ...(collected.telemetry.phases as Record<string, number>), evaluationMs },
      collectorInvocations: {
        ...(collected.telemetry.collectorInvocations as Record<string, number>),
        userFacingGroupEvaluations: 1,
      },
      queueMessagesUsed: 2,
      databaseBytesWrittenEstimate: jsonBytes(decoratedResults) + jsonBytes(collected.sharedEvidence),
      logicalStorageBreakdown: {
        technicalResultsBytes: jsonBytes(decoratedResults),
        technicalEvidenceBytes: decoratedResults.reduce((total, result) => total + jsonBytes(result.evidence || {}), 0),
        technicalOccurrenceBytes: decoratedResults.reduce((total, result) => total + jsonBytes(Array.isArray(result.evidence?.occurrences) ? result.evidence.occurrences : []), 0),
        technicalSnapshotBytes: jsonBytes(snapshot),
        userFacingSnapshotBytes: jsonBytes(groupSnapshot),
        sharedEvidenceBytes: jsonBytes(collected.sharedEvidence),
      },
      occurrencesStored: results.reduce((total, item) => total + (Array.isArray(item.evidence.occurrences) ? item.evidence.occurrences.length : 0), 0),
      truncatedOccurrenceSets: Number(collected.telemetry.truncatedOccurrenceSets || 0) + results.filter((item) => item.evidence.truncated === true).length,
      checkOutcomeCounts: outcomeCounts,
      unableToTestCount: outcomeCounts.unable_to_test,
    };
    const finalStatus = results.some((r) => r.outcome === "unable_to_test") ? "partial" : "completed";
    await updateRun({
      execution_stage: "persisting_results",
      progress_completed: 0,
      heartbeat_at: new Date().toISOString(),
    });
    await persistAuditResultRows(db, decoratedResults);
    const payload = await encodeAuditContinuationPayload({
      startedAt: started,
      propertyId: run.property_id,
      createdBy: run.created_by || null,
      resultCount: decoratedResults.length,
      testedCount: decoratedResults.filter((result) => result.outcome !== "unable_to_test").length,
      sharedEvidence: collected.sharedEvidence,
      telemetry,
      score,
      coverage,
      finalStatus,
      totalChecks: snapshot.length,
    });
    console.log("audit continuation queued", JSON.stringify({ auditRunId: id, payloadBytes: payload.length, results: decoratedResults.length }));
    await env.JOBS.send({ type: "audit-persist", id, payload });
  } catch (e) {
    const message = errorMessage(e);
    console.error("audit run failed", JSON.stringify({ auditRunId: id, message }));
    await updateRun({
        status: "failed",
        execution_stage: "failed",
        heartbeat_at: new Date().toISOString(),
        error: message,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).catch((error) => {
        console.error("audit failure status update failed", JSON.stringify({ auditRunId: id, message: errorMessage(error) }));
      });
    const notification = auditOutcomeNotification("failed", null, 0, message);
    if (notification)
      await createPropertyNotification(env, run.property_id, {
        ...notification,
        dedupeKey: `audit:${id}:${notification.kind}`,
      }).catch(() => undefined);
  }
}

type AuditContinuationPayload = {
  startedAt: number;
  propertyId: string;
  createdBy: string | null;
  resultCount: number;
  testedCount: number;
  sharedEvidence: Array<Record<string, any>>;
  telemetry: Record<string, any>;
  score: number | null;
  coverage: number;
  finalStatus: "completed" | "partial";
  totalChecks: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

async function persistAuditResultRows(db: SupabaseClient, results: Array<Record<string, any>>) {
  for (const batch of chunkAuditResults(results, 64)) {
    let failure: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { error } = await db.from("audit_results")
          .upsert(batch, { onConflict: "audit_run_id,check_id" })
          .abortSignal(AbortSignal.timeout(15_000));
        failure = error?.message || null;
      } catch (error) {
        failure = errorMessage(error);
      }
      if (!failure) break;
    }
    if (failure) throw new Error(`audit_result_persistence_failed: ${failure}`);
  }
}

export async function encodeAuditContinuationPayload(payload: AuditContinuationPayload) {
  const source = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = new Uint8Array(await new Response(
    new Blob([source]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  const encoded = bytesToBase64(compressed);
  if (new TextEncoder().encode(encoded).byteLength > 120_000)
    throw new Error("Audit continuation exceeded the queue payload limit");
  return encoded;
}

export async function decodeAuditContinuationPayload(payload: string): Promise<AuditContinuationPayload> {
  const decompressed = await new Response(
    new Blob([base64ToBytes(payload)]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(decompressed) as AuditContinuationPayload;
}

export function schemaCompatibleSharedEvidenceRows(rows: Array<Record<string, any>>) {
  const allowedTypes = new Set(["http", "source", "rendered_desktop", "rendered_mobile", "network", "links", "resources", "dns", "robots", "sitemaps", "css", "accessibility"]);
  const compatible: Array<Record<string, any>> = rows.filter((row) => allowedTypes.has(row.evidence_type)).map((row) => ({ ...row, summary: { ...(row.summary || {}) } }));
  const merge = (legacyType: string, targetType: "http" | "resources", summaryKey: string) => {
    const legacy = rows.find((row) => row.evidence_type === legacyType);
    if (!legacy) return;
    const target = compatible.find((row) => row.evidence_type === targetType);
    if (!target) throw new Error(`audit_shared_evidence_${legacyType}_requires_${targetType}`);
    target.summary[summaryKey] = legacy.summary;
    target.byte_size = Number(target.byte_size || 0) + Number(legacy.byte_size || 0);
    if (legacy.collection_status !== "complete")
      target.collection_status = target.collection_status === "failed" || legacy.collection_status === "failed" ? "failed" : "partial";
    target.error = target.error || legacy.error || null;
  };
  merge("alternate_origins", "http", "alternateOrigins");
  merge("ai_resources", "resources", "aiResources");
  const unexpected = rows.filter((row) => !allowedTypes.has(row.evidence_type) && !["alternate_origins", "ai_resources"].includes(row.evidence_type));
  if (unexpected.length) throw new Error(`audit_shared_evidence_unsupported_types: ${unexpected.map((row) => row.evidence_type).join(",")}`);
  return compatible;
}

async function persistAuditContinuation(env: Env, id: string, encodedPayload: string) {
  const db = admin(env);
  const payload = await decodeAuditContinuationPayload(encodedPayload);
  const persistenceStarted = Date.now();
  const { error: stageError } = await db.from("audit_runs").update({
    execution_stage: "persisting_results",
    progress_completed: payload.testedCount,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", id).in("status", ["queued", "running"]);
  if (stageError) throw new Error(`audit_run_update_failed: ${stageError.message}`);

  const { error: sharedEvidenceError } = await db.from("audit_run_evidence").upsert(
    schemaCompatibleSharedEvidenceRows(payload.sharedEvidence).map((row) => ({ ...row, audit_run_id: id })),
    { onConflict: "audit_run_id,evidence_type" },
  );
  if (sharedEvidenceError) throw new Error(`audit_shared_evidence_persistence_failed: ${sharedEvidenceError.message}`);

  const persistenceMs = Date.now() - persistenceStarted;
  const telemetry = {
    ...payload.telemetry,
    phases: { ...(payload.telemetry.phases || {}), persistenceMs },
    totalWallTimeMs: Date.now() - payload.startedAt,
  };
  const { error: completionError } = await db.from("audit_runs").update({
    status: payload.finalStatus,
    score: payload.score,
    coverage: payload.coverage,
    execution_stage: "completed",
    progress_completed: payload.resultCount,
    progress_total: payload.totalChecks,
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - payload.startedAt,
    telemetry,
    architecture_version: "2.0.0",
    error: null,
  }).eq("id", id).in("status", ["queued", "running"]);
  if (completionError) throw new Error(`audit_run_update_failed: ${completionError.message}`);

  const notification = auditOutcomeNotification(payload.finalStatus, payload.score, payload.coverage);
  if (notification)
    await createPropertyNotification(env, payload.propertyId, {
      ...notification,
      dedupeKey: `audit:${id}:${notification.kind}`,
    });
  if (payload.createdBy)
    await recordActivity(env, payload.createdBy, "audit.completed", payload.propertyId, {
      auditRunId: id,
      score: payload.score,
      coverage: payload.coverage,
    });
}

export function auditOutcomeNotification(status: string, score: number | null, coverage: number, error?: string) {
  if (status === "failed") return {
    kind: "failed",
    category: "audit_issues",
    title: "Audit failed",
    body: error ? `The audit failed: ${error}` : "The audit could not be completed.",
    severity: "warning",
  };
  if (score != null && score < 50) return {
    kind: "score-below-50",
    category: "audit_issues",
    title: "Audit score below 50",
    body: `The latest audit scored ${score} with ${coverage}% coverage and needs attention.`,
    severity: "critical",
  };
  return null;
}

export function chunkAuditResults<T>(values: T[], size = 24) {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += safeSize)
    chunks.push(values.slice(index, index + safeSize));
  return chunks;
}

export function compactAuditResult<T extends Record<string, any>>(result: T) {
  const { reason: _reason, ...persisted } = result;
  return persisted;
}

async function queryDns(query: string, type: string) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(query)}&type=${type}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(2500),
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
    responseCode: Number(body.Status || 0),
    authenticated: Boolean(body.AD),
    records: (body.Answer || []).map((answer) => ({
      query,
      type,
      ttl: Number(answer.TTL || 0),
      data: String(answer.data || ""),
    })),
  };
}

export function auditCheckHasExecutableLogic(id: string) {
  const key = AUDIT_EVALUATOR_KEYS[id];
  return Boolean(key && key !== "unsupported");
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
    .select("id,name,url,workspaces(account_id)")
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
            ? `Claritude downtime alert · ${property?.name || "Property"}`
            : `Claritude recovery notice · ${property?.name || "Property"}`,
        html: renderUptimeAlertEmail({
          property: property || { id: incident.property_id, name: "Property", url: "" },
          incident,
          kind,
          appOrigin: env.APP_ORIGIN,
        }),
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

export function renderUptimeAlertEmail({
  property,
  incident,
  kind,
  appOrigin,
  test = false,
}: {
  property: { id: string; name: string; url?: string | null };
  incident: { opened_at: string; resolved_at?: string | null; cause?: string | null };
  kind: "down" | "recovered";
  appOrigin: string;
  test?: boolean;
}) {
  const heading = kind === "down" ? "Website unavailable" : "Website recovered";
  const detail = kind === "down"
    ? "Claritude opened an incident after the configured failure threshold."
    : "Claritude confirmed a successful response and closed the incident.";
  const dashboardUrl = `${appOrigin.replace(/\/$/, "")}/uptime?property=${encodeURIComponent(property.id)}`;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5">
    ${test ? '<p style="font-weight:700;color:#b45309">TEST ALERT — sample incident data only</p>' : ""}
    <h1>${escapeHtml(test ? `Test: ${heading}` : heading)}</h1>
    <p>${escapeHtml(detail)}</p>
    <table role="presentation" style="border-collapse:collapse"><tbody>
      <tr><td style="padding:4px 16px 4px 0;color:#666">Property</td><td><b>${escapeHtml(property.name)}</b></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#666">URL</td><td>${escapeHtml(property.url || "Not supplied")}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#666">Incident</td><td>${escapeHtml(incident.cause || "Monitor failure")}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#666">Started</td><td>${escapeHtml(incident.opened_at)}</td></tr>
      ${incident.resolved_at ? `<tr><td style="padding:4px 16px 4px 0;color:#666">Recovered</td><td>${escapeHtml(incident.resolved_at)}</td></tr>` : ""}
    </tbody></table>
    <p><a href="${escapeHtml(dashboardUrl)}">Open Claritude uptime</a></p>
    ${test ? '<p style="color:#666">This test did not create an incident or change uptime statistics.</p>' : ""}
  </body></html>`;
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
    const aggregateResult = await db.rpc("aggregate_analytics_day_v2", {
      p_day: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    });
    if (aggregateResult.error) throw aggregateResult.error;
    // The product exposes at most a 90-day analytics window. Keep an extra
    // 30-day safety margin before pruning source events in bounded batches.
    const pruneResult = await db.rpc("prune_analytics_raw", {
      p_before: new Date(Date.now() - 120 * 864e5).toISOString(),
      p_limit: 50000,
    });
    if (pruneResult.error) throw pruneResult.error;
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
        loadAnalyticsWindow(
          db,
          schedule.property_id,
          from.toISOString(),
          now.toISOString(),
          true,
        ),
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
        analytics: buildAnalyticsSummary(
          events.events,
          days,
          from.toISOString(),
          now.toISOString(),
          "UTC",
          events.rollups,
          events.views,
        ),
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

type AnalyticsRange = { from: string; to: string };
type AnalyticsWindowData = {
  events: any[];
  rollups: any[];
  views: any[];
  truncated: boolean;
};

const utcDayStart = (value: number) => {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export function analyticsRollupPlan(
  from: string,
  to: string,
  today = Date.now(),
) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs)
    throw new Error("invalid_analytics_window");
  const fromDay = utcDayStart(fromMs);
  const rollupFromMs = fromMs === fromDay ? fromDay : fromDay + 864e5;
  const rollupToMs = Math.min(utcDayStart(toMs + 1), utcDayStart(today));
  if (rollupFromMs >= rollupToMs) {
    return {
      rollupFrom: null,
      rollupTo: null,
      expectedDays: [] as string[],
      rawRanges: [{ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() }],
    };
  }
  const expectedDays: string[] = [];
  for (let cursor = rollupFromMs; cursor < rollupToMs; cursor += 864e5)
    expectedDays.push(new Date(cursor).toISOString().slice(0, 10));
  const rawRanges: AnalyticsRange[] = [];
  if (fromMs < rollupFromMs)
    rawRanges.push({ from: new Date(fromMs).toISOString(), to: new Date(rollupFromMs - 1).toISOString() });
  if (rollupToMs <= toMs)
    rawRanges.push({ from: new Date(rollupToMs).toISOString(), to: new Date(toMs).toISOString() });
  return {
    rollupFrom: new Date(rollupFromMs).toISOString(),
    rollupTo: new Date(rollupToMs).toISOString(),
    expectedDays,
    rawRanges,
  };
}

function mergeAnalyticsRanges(ranges: AnalyticsRange[]) {
  const ordered = ranges
    .map((range) => ({ ...range, fromMs: Date.parse(range.from), toMs: Date.parse(range.to) }))
    .filter((range) => Number.isFinite(range.fromMs) && Number.isFinite(range.toMs) && range.fromMs <= range.toMs)
    .sort((left, right) => left.fromMs - right.fromMs);
  const merged: Array<AnalyticsRange & { fromMs: number; toMs: number }> = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.fromMs <= previous.toMs + 1) {
      previous.toMs = Math.max(previous.toMs, range.toMs);
      previous.to = new Date(previous.toMs).toISOString();
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map(({ fromMs: _fromMs, toMs: _toMs, ...range }) => range);
}

async function fetchRawAnalyticsRange(
  db: SupabaseClient,
  propertyId: string,
  range: AnalyticsRange,
) {
  const { data, error } = await db.rpc("analytics_raw_window", {
    p_property_id: propertyId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw new Error(error.message);
  const events = Array.isArray(data) ? data : [];
  return { events, truncated: events.length >= 50000 };
}

async function loadAnalyticsWindow(
  db: SupabaseClient,
  propertyId: string,
  from: string,
  to: string,
  useRollups: boolean,
): Promise<AnalyticsWindowData> {
  if (!useRollups) {
    const raw = await fetchRawAnalyticsRange(db, propertyId, { from, to });
    return { events: raw.events, rollups: [], views: [], truncated: raw.truncated };
  }
  const plan = analyticsRollupPlan(from, to);
  if (!plan.rollupFrom || !plan.rollupTo) {
    const raw = await fetchRawAnalyticsRange(db, propertyId, plan.rawRanges[0]);
    return { events: raw.events, rollups: [], views: [], truncated: raw.truncated };
  }
  const { data, error } = await db.rpc("analytics_rollup_window", {
    p_property_id: propertyId,
    p_from: plan.rollupFrom,
    p_to: plan.rollupTo,
  });
  if (error) throw new Error(error.message);
  const payload = data && typeof data === "object" ? data as Record<string, any> : {};
  const coveredDays = new Set(
    (Array.isArray(payload.coveredDays) ? payload.coveredDays : []).map(String),
  );
  const missingRanges = plan.expectedDays
    .filter((day) => !coveredDays.has(day))
    .map((day) => ({
      from: `${day}T00:00:00.000Z`,
      to: new Date(Date.parse(`${day}T00:00:00.000Z`) + 864e5 - 1).toISOString(),
    }));
  const rawResults = await Promise.all(
    mergeAnalyticsRanges([...plan.rawRanges, ...missingRanges])
      .map((range) => fetchRawAnalyticsRange(db, propertyId, range)),
  );
  const rollups = (Array.isArray(payload.events) ? payload.events : [])
    .filter((row: any) => coveredDays.has(String(row.bucket_start || "").slice(0, 10)));
  const views = (Array.isArray(payload.views) ? payload.views : [])
    .filter((row: any) => coveredDays.has(String(row.day || "")));
  return {
    events: rawResults.flatMap((result) => result.events),
    rollups,
    views,
    truncated: rawResults.some((result) => result.truncated),
  };
}

function hasAnalyticsFilters(filters: AnalyticsFilters) {
  return Object.values(filters).some(Boolean);
}

function analyticsRollupAsEvent(row: any) {
  return {
    event_type: row.event_type,
    path: row.path,
    referrer_host: row.referrer_host || null,
    source: row.source || null,
    device: row.device || null,
    country_code: row.country_code || null,
    name: row.name || null,
    value: row.value_sum == null ? null : Number(row.value_sum),
    metadata: {
      browser: row.browser || undefined,
      screen: row.screen || undefined,
      utm_source: row.utm_source || undefined,
      utm_medium: row.utm_medium || undefined,
      utm_campaign: row.utm_campaign || undefined,
      tracker_version: row.tracker_version || undefined,
    },
    occurred_at: row.bucket_start,
    _aggregateCount: Math.max(0, Number(row.event_count || 0)),
    _aggregateValues: Array.isArray(row.values_json)
      ? row.values_json.map(Number).filter(Number.isFinite)
      : [],
  };
}

export function buildAnalyticsSummary(
  events: any[],
  days: number,
  from = new Date(Date.now() - days * 864e5).toISOString(),
  to = new Date().toISOString(),
  timeZone = "UTC",
  rollups: any[] = [],
  historicalViews: any[] = [],
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
  const deviceVitals = new Map<string, Map<string, number[]>>();
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
  const timeZoneDayCache = new Map<string, string>();
  const timeZoneFormatter = timeZone === "UTC"
    ? null
    : new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
  const eventDay = (value: string) => {
    if (timeZone === "UTC") return value.slice(0, 10);
    const cacheKey = value.slice(0, 13);
    const cached = timeZoneDayCache.get(cacheKey);
    if (cached) return cached;
    const parts = timeZoneFormatter!.formatToParts(new Date(value));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    timeZoneDayCache.set(cacheKey, day);
    return day;
  };
  const bump = (map: Map<string, number>, key: unknown, amount = 1) => {
    const clean = String(key || "Unknown").trim() || "Unknown";
    map.set(clean, (map.get(clean) || 0) + amount);
  };
  const sourceEntry = (name: string) => {
    const current = sourceMap.get(name) || { pageviews: 0, events: 0 };
    sourceMap.set(name, current);
    return current;
  };
  for (const row of historicalViews) {
    if (!SUPPORTED_TRACKER_VERSIONS.has(row.tracker_version)) continue;
    const occurredAt = String(row.occurred_at || `${row.day}T00:00:00.000Z`);
    const day = eventDay(occurredAt);
    const bucket = days === 1
      ? new Date(Math.floor(new Date(occurredAt).valueOf() / 3600000) * 3600000).toISOString()
      : day;
    const sessionId = String(row.session_id || "");
    if (sessionId) {
      sessions.add(sessionId);
      const daySessions = dailySessions.get(day) || new Set<string>();
      daySessions.add(sessionId);
      dailySessions.set(day, daySessions);
      const point = seriesMap.get(bucket) || { pageviews: 0, events: 0, sessions: new Set<string>() };
      point.sessions.add(sessionId);
      seriesMap.set(bucket, point);
    }
    const viewVitals = new Map<string, number>();
    if (row.vitals && typeof row.vitals === "object") {
      for (const [name, values] of Object.entries(row.vitals)) {
        const samples = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
        if (samples.length) viewVitals.set(name.toUpperCase(), samples.at(-1)!);
      }
    }
    views.set(`${row.day}:${row.view_key}`, {
      path: normalizeAnalyticsPath(row.path),
      activeSeconds: Number(row.active_seconds || 0),
      maxScroll: Number(row.max_scroll || 0),
      keyEvents: Number(row.key_events || 0),
      jsErrors: Number(row.javascript_errors || 0),
      visibleSections: new Set(Array.isArray(row.visible_sections) ? row.visible_sections.map(String) : []),
      vitals: viewVitals,
    });
  }
  let totalEvents = 0;
  const observations = [...rollups.map(analyticsRollupAsEvent), ...events];
  for (const event of observations) {
    const amount = event._aggregateCount == null ? 1 : Math.max(0, Number(event._aggregateCount || 0));
    totalEvents += amount;
    const path = normalizeAnalyticsPath(event.path);
    const page = pageMap.get(path) || { pageviews: 0, events: 0 };
    const day = eventDay(event.occurred_at);
    const bucket = days === 1
      ? new Date(Math.floor(new Date(event.occurred_at).valueOf() / 3600000) * 3600000).toISOString()
      : day;
    const point = seriesMap.get(bucket) || { pageviews: 0, events: 0, sessions: new Set<string>() };
    const viewId = typeof event.metadata?.view_id === "string" ? event.metadata.view_id : "";
    if (event.event_type === "pageview") {
      pageviews += amount;
      page.pageviews += amount;
      point.pageviews += amount;
      const source = analyticsSourceCategory(event);
      sourceEntry(source).pageviews += amount;
      bump(countryMap, event.country_code || "Unknown", amount);
      bump(deviceMap, event.device || "Unknown", amount);
      bump(browserMap, event.metadata?.browser || "Unknown", amount);
      bump(screenMap, analyticsScreenCategory(event.metadata?.screen), amount);
      if (event.metadata?.utm_campaign)
        bump(campaignMap, event.metadata.utm_campaign, amount);
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
      keyEvents += amount;
      page.events += amount;
      point.events += amount;
      bump(eventMap, event.name || event.event_type, amount);
      sourceEntry(analyticsSourceCategory(event)).events += amount;
      if (viewId && views.has(viewId)) views.get(viewId)!.keyEvents += 1;
    }
    if (event.event_type === "active_time" && Number.isFinite(event.value) && viewId && views.has(viewId))
      views.get(viewId)!.activeSeconds += Number(event.value);
    if (event.event_type === "scroll" && Number.isFinite(event.value) && viewId && views.has(viewId))
      views.get(viewId)!.maxScroll = Math.max(views.get(viewId)!.maxScroll, Number(event.value));
    if (event.event_type === "js_error") {
      javascriptErrors += amount;
      if (viewId && views.has(viewId)) views.get(viewId)!.jsErrors += 1;
    }
    if (event.event_type === "visible_section" && event.name && viewId && views.has(viewId))
      views.get(viewId)!.visibleSections.add(String(event.name));
    const aggregateValues = Array.isArray(event._aggregateValues)
      ? event._aggregateValues.map(Number).filter(Number.isFinite)
      : [];
    const vitalValues = aggregateValues.length
      ? aggregateValues
      : Number.isFinite(event.value) ? [Number(event.value)] : [];
    if (event.event_type === "web_vital" && event.name && vitalValues.length && SUPPORTED_TRACKER_VERSIONS.has(event.metadata?.tracker_version)) {
      const name = String(event.name).toUpperCase();
      const samples = vitals.get(name) || [];
      samples.push(...vitalValues);
      vitals.set(name, samples);
      const daily = vitalDays.get(name) || new Map<string, number[]>();
      const dailySamples = daily.get(day) || [];
      dailySamples.push(...vitalValues);
      daily.set(day, dailySamples);
      vitalDays.set(name, daily);
      const device = String(event.device || "Unknown").toLocaleLowerCase();
      const deviceSamples = deviceVitals.get(device) || new Map<string, number[]>();
      const metricSamples = deviceSamples.get(name) || [];
      metricSamples.push(...vitalValues);
      deviceSamples.set(name, metricSamples);
      deviceVitals.set(device, deviceSamples);
      if (viewId && views.has(viewId)) views.get(viewId)!.vitals.set(name, vitalValues.at(-1)!);
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
  const performanceByDevice = Object.fromEntries(
    [...deviceVitals].map(([device, metrics]) => [
      device,
      {
        vitals: [...metrics].map(([name, values]) => ({
          name,
          value: Math.round(Number(percentile(values, 0.75)) * 100) / 100,
          samples: values.length,
          percentile: 75,
        })),
        minimumSamples: 1,
        method: "p75",
        collectionStatus: metrics.size ? "available" : "versioned_web_vitals_unavailable",
        trackerVersion: TRACKER_VERSION,
      },
    ]),
  );
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
  const visitTimes = buildVisitTimeHeatmap(events, historicalViews, timeZone);
  return {
    from,
    to,
    timeZone,
    pageviews,
    events: totalEvents,
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
      visitTimes,
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
    performanceByDevice,
  };
}

export type VisitTimeHeatmapCell = {
  weekday: number;
  hour: number;
  visitors: number | null;
  visitorsComplete: boolean;
  pageCount: number;
};

export function buildVisitTimeHeatmap(
  rawEvents: any[],
  historicalViews: any[],
  timeZone = "UTC",
): VisitTimeHeatmapCell[] {
  const buckets = new Map<string, { pageCount: number; sessions: Set<string>; missingSessions: number }>();
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    });
  }
  const weekdayIndexes: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const addPageview = (occurredAt: unknown, sessionId: unknown) => {
    const instant = new Date(String(occurredAt || ""));
    if (!Number.isFinite(instant.valueOf())) return;
    const parts = formatter.formatToParts(instant);
    const weekday = weekdayIndexes[parts.find((part) => part.type === "weekday")?.value || ""];
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (!Number.isInteger(weekday) || !Number.isInteger(hour) || hour < 0 || hour > 23) return;
    const key = `${weekday}:${hour}`;
    const bucket = buckets.get(key) || { pageCount: 0, sessions: new Set<string>(), missingSessions: 0 };
    bucket.pageCount += 1;
    const session = String(sessionId || "").trim();
    if (session) bucket.sessions.add(session);
    else bucket.missingSessions += 1;
    buckets.set(key, bucket);
  };
  for (const view of historicalViews)
    addPageview(view.occurred_at || `${view.day}T00:00:00.000Z`, view.session_id);
  for (const event of rawEvents)
    if (event.event_type === "pageview") addPageview(event.occurred_at, event.metadata?.session);
  return Array.from({ length: 7 * 24 }, (_, index) => {
    const weekday = Math.floor(index / 24);
    const hour = index % 24;
    const bucket = buckets.get(`${weekday}:${hour}`);
    const knownVisitors = bucket?.sessions.size || 0;
    const missingSessions = bucket?.missingSessions || 0;
    return {
      weekday,
      hour,
      visitors: missingSessions > 0 && knownVisitors === 0 ? null : knownVisitors,
      visitorsComplete: missingSessions === 0,
      pageCount: bucket?.pageCount || 0,
    };
  });
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
  if (!Object.values(filters).some(Boolean)) return events;
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
  const values = {
    paths: new Set<string>(),
    devices: new Set<string>(),
    sources: new Set<string>(),
    countries: new Set<string>(),
    browsers: new Set<string>(),
    eventNames: new Set<string>(),
    metrics: new Set<string>(),
    sourceTypes: new Set<string>(),
    utmSources: new Set<string>(),
    utmMediums: new Set<string>(),
    utmCampaigns: new Set<string>(),
  };
  for (const event of events) {
    if (event.event_type === "pageview") values.paths.add(normalizeAnalyticsPath(event.path));
    values.devices.add(String(event.device || "Unknown"));
    values.sources.add(analyticsSourceCategory(event));
    values.countries.add(String(event.country_code || "Unknown"));
    values.browsers.add(String(event.metadata?.browser || "Unknown"));
    if (["click", "outbound", "form_success"].includes(event.event_type))
      values.eventNames.add(String(event.name || event.event_type));
    if (event.event_type === "web_vital")
      values.metrics.add(String(event.name || "").toUpperCase());
    values.sourceTypes.add(analyticsSourceType(event));
    values.utmSources.add(String(event.metadata?.utm_source || ""));
    values.utmMediums.add(String(event.metadata?.utm_medium || ""));
    values.utmCampaigns.add(String(event.metadata?.utm_campaign || ""));
  }
  const sorted = (set: Set<string>) => [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return {
    paths: sorted(values.paths),
    devices: sorted(values.devices),
    sources: sorted(values.sources),
    countries: sorted(values.countries),
    browsers: sorted(values.browsers),
    eventNames: sorted(values.eventNames),
    metrics: sorted(values.metrics),
    sourceTypes: sorted(values.sourceTypes),
    utmSources: sorted(values.utmSources),
    utmMediums: sorted(values.utmMediums),
    utmCampaigns: sorted(values.utmCampaigns),
  };
}

function analyticsSource(event: any) {
  return String(
    event.metadata?.utm_source
      || event.metadata?.acquisition_source
      || event.source
      || event.metadata?.original_referrer
      || event.referrer_host
      || "Direct / unknown",
  ).trim() || "Direct / unknown";
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

const ANALYTICS_KEY_EVENT_TYPES = new Set(["click", "outbound", "form_success"]);

export function buildAnalyticsEventDetailSummary(
  observations: any[],
  eventName: string,
  timeZone = "UTC",
) {
  const events = observations.filter((event) =>
    ANALYTICS_KEY_EVENT_TYPES.has(String(event.event_type)) &&
    String(event.name || event.event_type).toLocaleLowerCase() === eventName.toLocaleLowerCase(),
  );
  const amount = (event: any) => event._aggregateCount == null
    ? 1
    : Math.max(0, Number(event._aggregateCount || 0));
  const rank = (selector: (event: any) => string) => {
    const counts = new Map<string, number>();
    for (const event of events) {
      const name = selector(event).trim() || "Unknown";
      counts.set(name, (counts.get(name) || 0) + amount(event));
    }
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  };
  const series = new Map<string, number>();
  const sessions = new Set<string>();
  let firstRecorded: string | null = null;
  let mostRecent: string | null = null;
  let containsRollups = false;
  let sessionCoverageComplete = true;
  for (const event of events) {
    const occurredAt = String(event.occurred_at || "");
    const lastOccurredAt = String(event._lastOccurredAt || event.occurred_at || "");
    if (occurredAt) {
      const day = dateKeyInTimeZone(occurredAt, timeZone);
      series.set(day, (series.get(day) || 0) + amount(event));
      if (!firstRecorded || Date.parse(occurredAt) < Date.parse(firstRecorded)) firstRecorded = occurredAt;
      if (!mostRecent || Date.parse(lastOccurredAt) > Date.parse(mostRecent)) mostRecent = lastOccurredAt;
    }
    if (event._aggregateCount != null && event._isRollup !== false) containsRollups = true;
    if (event._aggregateCount != null && !event.metadata?.session) sessionCoverageComplete = false;
    if (event.metadata?.session) sessions.add(String(event.metadata.session));
  }
  const pages = rank((event) => normalizeAnalyticsPath(event.path));
  const sources = rank(analyticsSourceCategory);
  const countries = rank((event) => String(event.country_code || "Unknown"));
  const devices = rank((event) => String(event.device || "Unknown"));
  const browsers = rank((event) => String(event.metadata?.browser || "Unknown"));
  const totalCount = events.reduce((total, event) => total + amount(event), 0);
  return {
    name: eventName,
    eventType: events[0]?.event_type || null,
    totalCount,
    uniqueSessions: containsRollups || !sessionCoverageComplete ? null : sessions.size,
    firstRecorded,
    mostRecent,
    topPage: pages[0] || null,
    topSource: sources[0] || null,
    topCountry: countries[0] || null,
    topDevice: devices[0] || null,
    topBrowser: browsers[0] || null,
    series: [...series].sort(([left], [right]) => left.localeCompare(right)).map(([day, count]) => ({ day, count })),
    breakdowns: { pages, sources, countries, devices, browsers },
    filterOptions: {
      paths: pages.map((row) => row.name),
      sources: sources.map((row) => row.name),
      countries: countries.map((row) => row.name),
      devices: devices.map((row) => row.name),
      browsers: browsers.map((row) => row.name),
    },
    aggregateCoverage: containsRollups ? "hybrid_rollups_and_raw" : "raw",
  };
}

export function buildAnalyticsOccurrenceContext(
  occurrence: any,
  viewEvents: any[] = [],
  sessionEvents: any[] = [],
) {
  const chronological = (rows: any[]) => [...rows].sort((left, right) =>
    Date.parse(left.occurred_at || "") - Date.parse(right.occurred_at || "") || Number(left.id || 0) - Number(right.id || 0));
  const viewRows = chronological(viewEvents);
  const sessionRows = chronological(sessionEvents);
  const occurrenceTime = Date.parse(occurrence.occurred_at || "");
  const viewPage = viewRows.find((event) => event.event_type === "pageview");
  const firstSessionPage = sessionRows
    .find((event) => event.event_type === "pageview" && Date.parse(event.occurred_at || "") <= occurrenceTime);
  const sessionPage = sessionRows
    .filter((event) => event.event_type === "pageview" && Date.parse(event.occurred_at || "") <= occurrenceTime)
    .at(-1);
  const acquisitionEvent = firstSessionPage || viewPage || sessionPage || occurrence;
  const acquisitionMetadata = acquisitionEvent.metadata || {};
  const occurrenceMetadata = occurrence.metadata || {};
  const metadata = { ...acquisitionMetadata, ...occurrenceMetadata };
  for (const key of [
    "acquisition_source",
    "original_referrer",
    "landing_page",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    if (!occurrenceMetadata[key] && acquisitionMetadata[key]) metadata[key] = acquisitionMetadata[key];
  }
  const acquisitionSourceEvent = {
    ...acquisitionEvent,
    metadata,
    source: metadata.acquisition_source || metadata.utm_source || acquisitionEvent.source,
    referrer_host: metadata.original_referrer || acquisitionEvent.referrer_host,
  };
  const activeSeconds = viewRows
    .filter((event) => event.event_type === "active_time" && Number.isFinite(Number(event.value)))
    .reduce((total, event) => total + Number(event.value), 0);
  const maxScroll = viewRows
    .filter((event) => event.event_type === "scroll" && Number.isFinite(Number(event.value)))
    .reduce((maximum, event) => Math.max(maximum, Number(event.value)), 0);
  const visibleSections = [...new Set(viewRows
    .filter((event) => event.event_type === "visible_section" && event.name)
    .map((event) => String(event.name)))];
  const vitalMap = new Map<string, number>();
  for (const event of viewRows)
    if (event.event_type === "web_vital" && event.name && Number.isFinite(Number(event.value)))
      vitalMap.set(String(event.name).toUpperCase(), Number(event.value));
  const meaningful = sessionRows.filter((event) =>
    event.event_type === "pageview" || ANALYTICS_KEY_EVENT_TYPES.has(String(event.event_type)));
  const occurrenceIndex = meaningful.findIndex((event) => String(event.id) === String(occurrence.id));
  const compact = (event: any) => event ? {
    type: event.event_type,
    path: normalizeAnalyticsPath(event.path),
    name: event.name || null,
    occurredAt: event.occurred_at,
  } : null;
  const pageSequence: string[] = [];
  for (const event of sessionRows.filter((row) => row.event_type === "pageview")) {
    const path = normalizeAnalyticsPath(event.path);
    if (pageSequence.at(-1) !== path) pageSequence.push(path);
  }
  const relatedKeyEvents = meaningful
    .filter((event) => ANALYTICS_KEY_EVENT_TYPES.has(String(event.event_type)) && String(event.id) !== String(occurrence.id))
    .map(compact)
    .slice(0, 30);
  const journey: Array<{ type: string; label: string }> = [];
  journey.push({ type: "source", label: analyticsSourceCategory(acquisitionSourceEvent) });
  for (const path of pageSequence.filter((path) => Date.parse(sessionRows.find((event) => event.event_type === "pageview" && normalizeAnalyticsPath(event.path) === path)?.occurred_at || "") <= occurrenceTime))
    journey.push({ type: "page", label: path });
  if (maxScroll > 0) journey.push({ type: "behaviour", label: `Scrolled ${Math.round(maxScroll)}%` });
  journey.push({ type: "event", label: String(occurrence.name || occurrence.event_type || "Event") });
  return {
    name: occurrence.name || occurrence.event_type,
    eventType: occurrence.event_type,
    occurredAt: occurrence.occurred_at,
    receivedAt: occurrence.received_at,
    path: normalizeAnalyticsPath(occurrence.path),
    acquisition: {
      source: analyticsSourceCategory(acquisitionSourceEvent),
      sourceDetail: analyticsSource(acquisitionSourceEvent),
      referrer: metadata.original_referrer || acquisitionEvent.referrer_host || null,
      landingPage: metadata.landing_page
        ? normalizeAnalyticsPath(metadata.landing_page)
        : firstSessionPage?.path
          ? normalizeAnalyticsPath(firstSessionPage.path)
          : null,
      utmSource: metadata.utm_source || null,
      utmMedium: metadata.utm_medium || null,
      utmCampaign: metadata.utm_campaign || null,
      utmContent: metadata.utm_content || null,
      utmTerm: metadata.utm_term || null,
    },
    visitor: {
      country: occurrence.country_code || acquisitionEvent.country_code || null,
      device: occurrence.device || acquisitionEvent.device || null,
      browser: occurrence.metadata?.browser || acquisitionEvent.metadata?.browser || null,
      screen: analyticsScreenCategory(occurrence.metadata?.screen || acquisitionEvent.metadata?.screen),
      language: occurrence.metadata?.language || acquisitionEvent.metadata?.language || null,
    },
    behaviour: {
      activeSeconds,
      maxScroll,
      visibleSections,
      javascriptErrors: viewRows.filter((event) => event.event_type === "js_error").length,
      pageSequence,
      relatedKeyEvents,
      previous: occurrenceIndex > 0 ? compact(meaningful[occurrenceIndex - 1]) : null,
      next: occurrenceIndex >= 0 && occurrenceIndex < meaningful.length - 1 ? compact(meaningful[occurrenceIndex + 1]) : null,
      journey,
    },
    webVitals: [...vitalMap].map(([name, value]) => ({ name, value })),
    contextAvailability: {
      view: Boolean(occurrence.metadata?.view_id && viewRows.length),
      session: Boolean(occurrence.metadata?.session && sessionRows.length),
    },
  };
}

function cleanAnalyticsFilter(value: string | undefined, maximumLength: number) {
  const clean = value?.trim();
  return clean ? clean.slice(0, maximumLength) : undefined;
}

export function normalizeAnalyticsPath(value: unknown) {
  const raw = String(value || "/").trim() || "/";
  if (raw.startsWith("/") && !raw.includes("?") && !raw.includes("#")) {
    const collapsed = `/${raw.split("/").filter(Boolean).join("/")}`;
    return collapsed === "/" ? "/" : `${collapsed}/`;
  }
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

export function isProtectedAuditPagePath(path: unknown) {
  return cleanPath(path) === "/";
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
async function safeFetchTrace(
  value: string,
  init: RequestInit = {},
  validatedHosts?: Set<string>,
) {
  let url = validPublicUrl(value);
  if (!url) throw new Error("Target must be a public HTTP or HTTPS URL");
  const redirects: { url: string; status: number; location: string }[] = [];
  const visited = new Set<string>();
  for (let i = 0; i < 5; i++) {
    if (visited.has(url.href)) throw new Error("redirect_loop");
    visited.add(url.href);
    const hostname = url.hostname.toLowerCase();
    if (!validatedHosts?.has(hostname)) {
      await assertPublicResolution(url.hostname);
      validatedHosts?.add(hostname);
    }
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: init.signal || AbortSignal.timeout(15000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      return { response, redirects };
    const location = response.headers.get("location") || "";
    redirects.push({ url: url.href, status: response.status, location });
    await response.body?.cancel().catch(() => undefined);
    const next = validPublicUrl(
      new URL(location, url).href,
    );
    if (!next) throw new Error("Redirect target is not permitted");
    url = next;
  }
  throw new Error("redirect_limit_exceeded");
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

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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

type TrackerSessionStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function trackerSessionAcquisition(
  storage: TrackerSessionStorage,
  session: string,
  href: string,
  referrer: string,
) {
  const key = "_claritude_acquisition";
  try {
    const existing = JSON.parse(storage.getItem(key) || "null");
    if (existing && existing.session === session && existing.landingPage)
      return existing;
  } catch {
    // A missing or malformed value starts a fresh tab-session attribution.
  }
  let page: URL;
  try {
    page = new URL(href);
  } catch {
    page = new URL("https://invalid.local/");
  }
  let referrerHost = "";
  try {
    referrerHost = referrer ? new URL(referrer).hostname.slice(0, 200) : "";
  } catch {
    referrerHost = "";
  }
  const params = page.searchParams;
  const value = (name: string) => (params.get(name) || "").slice(0, 200);
  const attribution = {
    session,
    source: value("utm_source") || referrerHost || "Direct / unknown",
    referrer: referrerHost,
    landingPage: (page.pathname || "/").slice(0, 500),
    utmSource: value("utm_source"),
    utmMedium: value("utm_medium"),
    utmCampaign: value("utm_campaign"),
    utmContent: value("utm_content"),
    utmTerm: value("utm_term"),
  };
  try {
    storage.setItem(key, JSON.stringify(attribution));
  } catch {
    // Collection remains functional if sessionStorage is unavailable.
  }
  return attribution;
}

export const TRACKER_SOURCE = `(()=>{
  let s=document.currentScript;if(!s){const scripts=document.getElementsByTagName('script');for(let i=scripts.length-1;i>=0;i--){const candidate=scripts[i],src=candidate.getAttribute('src')||'';if(candidate.getAttribute('data-property')&&/(?:\\/c|\\/tracker)\\.js(?:[?#]|$)/.test(src)){s=candidate;break}}}
  const p=s&&s.getAttribute('data-property'),endpoint=s&&new URL('/collect',s.src).href,base=s&&new URL('/',s.src).href;
  if(!p||!endpoint||window.__claritude)return;window.__claritude=1;
  const uuid=()=>{try{return crypto.randomUUID()}catch(uuidError){const b=new Uint8Array(16);try{crypto.getRandomValues(b)}catch(randomError){for(let i=0;i<b.length;i++)b[i]=Math.floor(Math.random()*256)}b[6]=b[6]&15|64;b[8]=b[8]&63|128;return Array.prototype.map.call(b,(x,i)=>(i===4||i===6||i===8||i===10?'-':'')+x.toString(16).padStart(2,'0')).join('')}};
  let q=[],timer,retryTimer,retryDelay=1000,sending=false,lastUrl=location.href,view=uuid(),generation=0,active=0,reportedActive=0,lastActivity=Date.now(),errorCount=0,vitalsReady=null;
  const marks=new Set,visibleSections=new Set,observedSections=new WeakSet;
  const session=sessionStorage.getItem('_claritude_session')||uuid();
  sessionStorage.setItem('_claritude_session',session);
  const acquisition=(${trackerSessionAcquisition.toString()})(sessionStorage,session,location.href,document.referrer);
  const browser=/Edg\\//.test(navigator.userAgent)?'Edge':/OPR\\//.test(navigator.userAgent)?'Opera':/SamsungBrowser\\//.test(navigator.userAgent)?'Samsung Internet':/Firefox\\//.test(navigator.userAgent)?'Firefox':/Chrome\\//.test(navigator.userAgent)?'Chrome':/Safari\\//.test(navigator.userAgent)?'Safari':/MSIE|Trident/.test(navigator.userAgent)?'Internet Explorer':'Other';
  const common=()=>({session,view_id:view,browser,screen:innerWidth<768?'small':innerWidth<1280?'medium':'large',language:navigator.language||'',tracker_version:'${TRACKER_VERSION}',acquisition_source:acquisition.source,original_referrer:acquisition.referrer,landing_page:acquisition.landingPage,utm_source:acquisition.utmSource,utm_medium:acquisition.utmMedium,utm_campaign:acquisition.utmCampaign,utm_content:acquisition.utmContent,utm_term:acquisition.utmTerm});
  const retry=()=>{if(retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=0;send()},retryDelay);retryDelay=Math.min(retryDelay*2,30000)};
  const send=async()=>{if(sending||!q.length)return;sending=true;const batch=q.splice(0,20),body=JSON.stringify(batch);try{if(navigator.sendBeacon&&document.visibilityState==='hidden'){if(!navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'})))throw new Error('beacon-rejected')}else{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true});if(!response.ok)throw new Error('collect-'+response.status)}retryDelay=1000}catch(sendError){q=batch.concat(q).slice(0,200);retry()}finally{sending=false;if(q.length&&!retryTimer){clearTimeout(timer);timer=setTimeout(send,500)}}};
  const emit=(type,data={})=>{const supplied=data.meta&&typeof data.meta==='object'?data.meta:{},event_id=uuid(),baseMeta=common();q.push(Object.assign({},data,{type,property:p,path:location.pathname,source:data.source||acquisition.source,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',meta:Object.assign({event_id},baseMeta,supplied,baseMeta,{event_id})}));if(q.length>200)q=q.slice(-200);clearTimeout(timer);timer=setTimeout(send,500)};
  addEventListener('click',e=>{lastActivity=Date.now();const a=e.target.closest('[data-claritude-event],a[href]');if(!a)return;const name=a.dataset.claritudeEvent;if(name)emit('click',{name});if(a.href&&new URL(a.href,location.href).host!==location.host)emit('outbound',{name:new URL(a.href).host})},{passive:true});
  ['keydown','pointerdown','touchstart'].forEach(name=>addEventListener(name,()=>{lastActivity=Date.now()},{passive:true}));
  const checkScroll=()=>{const root=document.documentElement,height=Math.max(root.scrollHeight,document.body&&document.body.scrollHeight||0,1),n=Math.min(100,Math.round((scrollY+innerHeight)/height*100));[25,50,75,90].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);emit('scroll',{value:x})}})};
  addEventListener('scroll',checkScroll,{passive:true});addEventListener('resize',checkScroll,{passive:true});
  const reportActive=()=>{const delta=active-reportedActive;if(delta>0){reportedActive=active;emit('active_time',{value:delta})}};
  const tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus()&&Date.now()-lastActivity<30000)active+=1;if(active-reportedActive>=5)reportActive()},1000);
  const sectionObserver='IntersectionObserver'in window?new IntersectionObserver(entries=>entries.forEach(entry=>{const name=entry.target.dataset.claritudeSection;if(entry.isIntersecting&&name&&!visibleSections.has(name)){visibleSections.add(name);emit('visible_section',{name})}}),{threshold:.5}):null;
  const observeSections=()=>{if(!sectionObserver)return;document.querySelectorAll('[data-claritude-section]').forEach(node=>{if(!observedSections.has(node)){observedSections.add(node);sectionObserver.observe(node)}})};
  const initVitals=()=>{if(!window.webVitals)return;const own=generation,record=metric=>{if(own===generation&&metric&&Number.isFinite(metric.value))emit('web_vital',{name:metric.name,value:metric.value,meta:{metric_id:metric.id,navigation_type:metric.navigationType}})};try{webVitals.onLCP(record)}catch(lcpError){}try{webVitals.onINP(record)}catch(inpError){}try{webVitals.onCLS(record)}catch(clsError){}};
  const loadVitals=()=>vitalsReady||(vitalsReady=new Promise(resolve=>{if(window.webVitals){resolve();return}const script=document.createElement('script');script.src=new URL('/vendor/web-vitals.js',base).href;script.async=true;script.crossOrigin='anonymous';script.onload=resolve;script.onerror=resolve;document.head.appendChild(script)}));
  const page=()=>{emit('pageview',{source:acquisition.source});observeSections();requestAnimationFrame(checkScroll);loadVitals().then(initVitals)};page();
  const navigation=(forcedPath)=>{if(!forcedPath&&location.href===lastUrl)return;reportActive();send();lastUrl=location.href;view=uuid();generation+=1;active=0;reportedActive=0;lastActivity=Date.now();errorCount=0;marks.clear();visibleSections.clear();page()};
  new MutationObserver(()=>{navigation();observeSections();checkScroll()}).observe(document,{subtree:true,childList:true});
  ['pushState','replaceState'].forEach(k=>{const original=history[k];history[k]=function(){const result=original.apply(this,arguments);Promise.resolve().then(()=>navigation());return result}});
  addEventListener('popstate',()=>navigation());
  const reportError=(name,source)=>{if(errorCount>=5)return;errorCount+=1;let resource_origin='';try{resource_origin=source?new URL(source,location.href).origin:''}catch(urlError){}emit('js_error',{name,meta:{resource_origin}})};
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
        if (message.body.type === "audit") await runAudit(env, message.body.id);
        else if (message.body.type === "audit-persist") await persistAuditContinuation(env, message.body.id, message.body.payload);
        else await runUptime(env, message.body.id);
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
