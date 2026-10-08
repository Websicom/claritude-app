import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import Stripe from "stripe";
import puppeteer from "@cloudflare/puppeteer";
import WEB_VITALS_SOURCE from "../../node_modules/web-vitals/dist/web-vitals.iife.js?raw";
import AXE_SOURCE from "../../node_modules/axe-core/axe.min.js?raw";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "../shared/audit-evaluator-map.generated";
import { USER_FACING_AUDIT_GROUPS } from "../shared/audit-user-facing-registry.generated";
import { AI_PLATFORMS, identifyAiPlatform } from "../shared/ai-platforms";
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
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  STRIPE_TEST_PORTAL_CONFIGURATION_ID?: string;
  STRIPE_LIVE_SECRET_KEY?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  STRIPE_LIVE_PORTAL_CONFIGURATION_ID?: string;
  APP_ORIGIN: string;
  DEPLOY_COMMIT_SHA?: string;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;
  BROWSER: Fetcher;
};
type Variables = {
  db: SupabaseClient;
  userId: string;
  userEmail: string;
  userEmailConfirmed: boolean;
  accessToken: string;
  authAal: "aal1" | "aal2";
  authSessionId: string | null;
  delegation: any | null;
};
type Job =
  | { type: "audit" | "uptime"; id: string }
  | { type: "audit-persist"; id: string; payload: string }
  | { type: "admin-export"; id: string }
  | { type: "billing-event"; id: string }
  | { type: "billing-reconcile"; id: string };
type AuditResult = TypedAuditResult;

const LIMITS = {
  propertiesPerAccount: 200,
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

export function uptimeMinimumInterval(entitlement: unknown) {
  const plan = customEventPlan(entitlement);
  return plan === "Pro" ? 1 : plan === "Scale" ? 2 : plan === "Essentials" ? 5 : 15;
}

export function allowedUptimeIntervals(entitlement: unknown) {
  const minimum = uptimeMinimumInterval(entitlement);
  return [1, 2, 5, 10, 15, 30, 60].filter((interval) => interval >= minimum);
}

export function propertyCreateError(message: string) {
  if (message.includes("property_limit_reached"))
    return { error: "property_limit_reached", status: 409 as const };
  if (message.includes("property_already_exists_in_account"))
    return { error: "property_already_exists_in_account", status: 409 as const };
  if (message.includes("workspace_access_denied"))
    return { error: "workspace_access_denied", status: 403 as const };
  if (message.includes("analytics_plan_rule_unavailable"))
    return { error: "analytics_plan_rule_unavailable", status: 503 as const };
  return { error: "property_create_failed", status: 400 as const };
}

function effectiveCustomEventAllowance(effective: Awaited<ReturnType<typeof effectiveEntitlements>>, used: number) {
  const configured = effective.values.customEventsPerProperty;
  const limit = configured === null ? null : Number(configured);
  const safeUsed = Math.max(0, Math.floor(Number(used) || 0));
  return { plan: customEventPlan(effective.packageKey), used: safeUsed, limit: Number.isFinite(limit) ? limit : null, remaining: Number.isFinite(limit) ? Math.max(0, Number(limit) - safeUsed) : null, unlimited: !Number.isFinite(limit), canCreate: !Number.isFinite(limit) || safeUsed < Number(limit) };
}

export function resolveEffectiveEntitlements(
  packageConfiguration: { packageKey: string; version: number; allowances?: Record<string, unknown>; features?: Record<string, unknown>; retention?: Record<string, unknown>; hardCeilings?: Record<string, unknown> },
  overrides: Array<{ key: string; value: unknown }> = [],
) {
  const values: Record<string, unknown> = { ...(packageConfiguration.allowances || {}), ...(packageConfiguration.features || {}), ...(packageConfiguration.retention || {}) };
  const sources: Record<string, string> = Object.fromEntries(Object.keys(values).map((key) => [key, `package:${packageConfiguration.packageKey}@${packageConfiguration.version}`]));
  const hardCeilings = packageConfiguration.hardCeilings || {};
  for (const override of overrides) {
    let value = override.value;
    const ceiling = hardCeilings[override.key];
    if (typeof value === "number" && typeof ceiling === "number") value = Math.min(value, ceiling);
    values[override.key] = value;
    sources[override.key] = "account_override";
  }
  return { packageKey: packageConfiguration.packageKey, version: packageConfiguration.version, values, sources, hardCeilings };
}

const COMPLIMENTARY_OVERRIDE_KEYS = new Set([
  "propertiesPerAccount",
  "editingSeats",
  "auditCreditsPerWeek",
]);

export function validateComplimentaryGrantInput(input: any, now = Date.now()) {
  const packageVersionId = String(input?.packageVersionId || "").trim();
  const reason = String(input?.reason || "").trim();
  const permanent = input?.permanent !== false;
  const expiresAt = permanent ? null : String(input?.expiresAt || "").trim();
  const rawOverrides = input?.overrides && typeof input.overrides === "object" && !Array.isArray(input.overrides) ? input.overrides : {};
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(packageVersionId)) return { error: "package_version_required" as const };
  if (reason.length < 3 || reason.length > 500) return { error: "reason_required" as const };
  if (!permanent && (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now)) return { error: "grant_expiry_must_be_future" as const };
  const overrides: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(rawOverrides)) {
    if (!COMPLIMENTARY_OVERRIDE_KEYS.has(key)) return { error: "unsupported_override_key" as const, key };
    if (rawValue === "" || rawValue === null || rawValue === undefined) continue;
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < 0) return { error: "override_must_be_non_negative_integer" as const, key };
    overrides[key] = value;
  }
  return { value: { packageVersionId, reason, permanent, expiresAt, expiryBehavior: "return_to_standard" as const, overrides } };
}

export function packageLimitConflicts(
  values: Record<string, unknown>,
  counts: { properties: number; editingSeats: number },
) {
  return [
    typeof values.propertiesPerAccount === "number" && counts.properties > values.propertiesPerAccount
      ? `${counts.properties - values.propertiesPerAccount} properties exceed the effective allowance`
      : null,
    typeof values.editingSeats === "number" && counts.editingSeats > values.editingSeats
      ? `${counts.editingSeats - values.editingSeats} editing seats exceed the effective allowance`
      : null,
  ].filter((value): value is string => Boolean(value));
}

async function effectiveEntitlements(env: Env, accountId: string) {
  const db = admin(env);
  const now = new Date().toISOString();
  const [assignment, grant, overrides, account] = await Promise.all([
    db.from("account_package_assignments").select("price_grandfathered,allowances_grandfathered,complimentary,billing_state,starts_at,ends_at,package_versions(package_key,version,allowances,features,retention,hard_ceilings,unresolved_values)").eq("account_id", accountId).is("ends_at", null).maybeSingle(),
    db.from("account_package_grants").select("id,arrangement,status,starts_at,expires_at,expiry_behavior,reason,created_at,package_versions(package_key,version,display_name,allowances,features,retention,hard_ceilings,unresolved_values)").eq("account_id", accountId).eq("status", "active").lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle(),
    db.from("account_entitlement_overrides").select("key,value,starts_at,expires_at,grant_id").eq("account_id", accountId).is("revoked_at", null).lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`),
    db.from("accounts").select("entitlement").eq("id", accountId).maybeSingle(),
  ]);
  if (assignment.error || grant.error || overrides.error || account.error) throw new Error("effective_entitlements_unavailable");
  const grantPackageVersion = grant.data?.package_versions as any;
  const standardPackageVersion = assignment.data?.package_versions as any;
  const packageVersion = grantPackageVersion || standardPackageVersion;
  const fallbackKey = account.data?.entitlement || "free";
  const configuration = packageVersion || {
    package_key: fallbackKey,
    version: 0,
    allowances: {
      customEventsPerProperty: customEventPlan(fallbackKey) === "Pro" ? null : customEventPlan(fallbackKey) === "Scale" ? 20 : customEventPlan(fallbackKey) === "Essentials" ? 5 : 2,
      uptimeIntervalMinutes: uptimeMinimumInterval(fallbackKey),
      ...(customEventPlan(fallbackKey) === "Free" ? { workspacesPerAccount: 1 } : {}),
    },
    features: {}, retention: {}, hard_ceilings: { propertiesPerAccount: LIMITS.propertiesPerAccount }, unresolved_values: ["packageVersion"],
  };
  return {
    ...resolveEffectiveEntitlements({ packageKey: configuration.package_key, version: configuration.version, allowances: configuration.allowances, features: configuration.features, retention: configuration.retention, hardCeilings: configuration.hard_ceilings }, overrides.data || []),
    arrangement: grant.data ? "complimentary" : "standard",
    grant: grant.data || null,
    assignment: assignment.data || null,
    unresolvedValues: configuration.unresolved_values || [],
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

type StaffIdentity = {
  id: string;
  email?: string | null;
  emailConfirmed: boolean;
};

export type StaffRole = "owner" | "support" | "finance" | "engineering";
export type StaffPermission =
  | "overview.read"
  | "staff.read"
  | "staff.write"
  | "customers.read"
  | "customers.write"
  | "delegation.read"
  | "delegation.write"
  | "packages.read"
  | "packages.write"
  | "audits.read"
  | "audits.write"
  | "operations.read"
  | "operations.write"
  | "financials.read"
  | "financials.write"
  | "communications.read"
  | "communications.write"
  | "exports.read"
  | "exports.write"
  | "settings.read"
  | "settings.write";

const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  "overview.read", "staff.read", "staff.write", "customers.read", "customers.write",
  "delegation.read", "delegation.write", "packages.read", "packages.write", "audits.read",
  "audits.write", "operations.read", "operations.write", "financials.read", "financials.write",
  "communications.read", "communications.write", "exports.read", "exports.write", "settings.read",
  "settings.write",
];

const STAFF_ROLE_PERMISSIONS: Record<StaffRole, StaffPermission[]> = {
  owner: ALL_STAFF_PERMISSIONS,
  support: [
    "overview.read", "customers.read", "customers.write", "delegation.read", "delegation.write",
    "packages.read", "audits.read", "operations.read", "communications.read", "communications.write",
    "exports.read",
  ],
  finance: [
    "overview.read", "customers.read", "packages.read", "financials.read", "financials.write",
    "communications.read", "exports.read",
  ],
  engineering: [
    "overview.read", "customers.read", "delegation.read", "packages.read", "packages.write",
    "audits.read", "audits.write", "operations.read", "operations.write", "communications.read",
    "exports.read", "exports.write", "settings.read", "settings.write",
  ],
};

export function staffPermissions(role: StaffRole) {
  return [...STAFF_ROLE_PERMISSIONS[role]];
}

export function staffRoleCan(role: StaffRole, permission: StaffPermission) {
  return STAFF_ROLE_PERMISSIONS[role].includes(permission);
}

export function parseAuthAssurance(token: string): {
  aal: "aal1" | "aal2";
  sessionId: string | null;
} {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return {
      aal: payload.aal === "aal2" ? "aal2" : "aal1",
      sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
    };
  } catch {
    return { aal: "aal1", sessionId: null };
  }
}

type StaffAccess = {
  userId: string;
  role: StaffRole;
  status: "active" | "suspended";
  displayName: string | null;
  permissions: StaffPermission[];
};

function fallbackUserFacingSnapshot(technicalSnapshot: AuditRegistrySnapshot[]): UserFacingAuditGroupSnapshot[] {
  return buildUserFacingGroupSnapshot(
    GENERATED_USER_FACING_ROWS.groups,
    GENERATED_USER_FACING_ROWS.mappings,
    new Set(technicalSnapshot.map((check) => check.id)),
  );
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const TRACKER_VERSION = "2.3.3";
const SUPPORTED_TRACKER_VERSIONS = new Set(["2.0.0", "2.1.0", "2.1.1", "2.1.2", "2.1.3", "2.1.4", "2.1.5", "2.3.0", "2.3.2", TRACKER_VERSION]);
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

async function resolveStaffAccess(env: Env, identity: StaffIdentity): Promise<StaffAccess | null> {
  if (!identity.emailConfirmed || !identity.email) return null;
  const service = admin(env);
  const selectStaff = () => service
    .from("staff_members")
    .select("user_id,role,status,display_name")
    .eq("user_id", identity.id)
    .maybeSingle();
  let { data: member, error } = await selectStaff();
  if (error) {
    console.error("staff_access_lookup_failed", error);
    return null;
  }

  if (!member) {
    const email = identity.email.trim().toLowerCase();
    const { data: invitation, error: invitationError } = await service
      .from("staff_invitations")
      .select("id,role")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invitationError) {
      console.error("staff_invitation_lookup_failed", invitationError);
      return null;
    }
    if (invitation) {
      const acceptedAt = new Date().toISOString();
      const { error: insertError } = await service.from("staff_members").insert({
        user_id: identity.id,
        role: invitation.role,
        status: "active",
      });
      if (insertError && insertError.code !== "23505") {
        console.error("staff_invitation_binding_failed", insertError);
        return null;
      }
      const { error: acceptError } = await service
        .from("staff_invitations")
        .update({ accepted_by: identity.id, accepted_at: acceptedAt })
        .eq("id", invitation.id)
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (acceptError) console.error("staff_invitation_acceptance_failed", acceptError);
      ({ data: member, error } = await selectStaff());
      if (error) {
        console.error("staff_access_refresh_failed", error);
        return null;
      }
    }
  }
  if (!member) return null;
  const role = member.role as StaffRole;
  return {
    userId: member.user_id,
    role,
    status: member.status,
    displayName: member.display_name,
    permissions: member.status === "active" ? staffPermissions(role) : [],
  };
}

async function requestStaffAccess(c: any) {
  return resolveStaffAccess(c.env, {
    id: c.get("userId"),
    email: c.get("userEmail"),
    emailConfirmed: c.get("userEmailConfirmed"),
  });
}

async function recordAdminActivity(
  env: Env,
  actorStaffId: string | null,
  action: string,
  outcome: "success" | "denied" | "failed" | "previewed",
  details: {
    targetType?: string;
    targetId?: string;
    accountId?: string;
    reason?: string;
    previousValues?: unknown;
    newValues?: unknown;
    metadata?: Record<string, unknown>;
    delegationSessionId?: string;
    representedUserId?: string;
  } = {},
) {
  const { error } = await admin(env).from("admin_activity_log").insert({
    actor_staff_id: actorStaffId,
    represented_user_id: details.representedUserId,
    delegation_session_id: details.delegationSessionId,
    action,
    outcome,
    target_type: details.targetType,
    target_id: details.targetId,
    account_id: details.accountId,
    reason: details.reason,
    previous_values: details.previousValues,
    new_values: details.newValues,
    metadata: details.metadata || {},
  });
  if (error) console.error("admin_activity_log_failed", error);
}

async function requireStaff(c: any, permission: StaffPermission) {
  const staff = await requestStaffAccess(c);
  if (!staff || staff.status !== "active" || !staffRoleCan(staff.role, permission)) {
    await recordAdminActivity(c.env, staff?.userId || null, "staff.permission_denied", "denied", {
      metadata: { permission },
    });
    return { staff: null, response: c.json({ error: "staff_permission_required", permission }, 403) };
  }
  if (c.get("authAal") !== "aal2") {
    await recordAdminActivity(c.env, staff.userId, "staff.mfa_required", "denied", {
      metadata: { permission },
    });
    return { staff: null, response: c.json({ error: "mfa_assurance_required", required: "aal2" }, 403) };
  }
  return { staff, response: null };
}

type EmergencyControlKey = "new_audits" | "scheduled_audits" | "browser_collection" | "uptime_checks" | "uptime_notifications" | "analytics_ingestion" | "reports" | "campaigns";

async function processingAccess(env: Env, key: EmergencyControlKey, accountId?: string | null) {
  const db = admin(env);
  const [control, account, scoped] = await Promise.all([
    db.from("emergency_controls").select("paused,reason").eq("key", key).maybeSingle(),
    accountId ? db.from("accounts").select("access_state").eq("id", accountId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    accountId ? db.from("account_service_controls").select("paused,reason").eq("account_id", accountId).eq("service", key === "new_audits" || key === "scheduled_audits" || key === "browser_collection" ? "audits" : key === "uptime_checks" || key === "uptime_notifications" ? "uptime" : key === "analytics_ingestion" ? "analytics" : key === "reports" ? "reports" : "email").maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (control.error || account.error || scoped.error || !control.data)
    return { allowed: false, error: "safety_configuration_unavailable" };
  if (control.data.paused) return { allowed: false, error: `${key}_paused` };
  if (account.data && account.data.access_state !== "active") return { allowed: false, error: "account_processing_paused" };
  if (scoped.data?.paused) return { allowed: false, error: "account_service_paused" };
  return { allowed: true, error: null };
}

async function safetyLimits(env: Env) {
  const { data, error } = await admin(env).from("platform_settings").select("value").eq("key", "safety_limits").maybeSingle();
  if (error || !data?.value) return null;
  const value = data.value as Record<string, unknown>;
  const daily = Math.floor(Number(value.platformAuditStartsPerDay));
  const concurrent = Math.floor(Number(value.concurrentAudits));
  if (!Number.isFinite(daily) || daily < 1 || !Number.isFinite(concurrent) || concurrent < 1) return null;
  return { daily, concurrent };
}

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "claritude",
    time: new Date().toISOString(),
    deployment: {
      commitSha: c.env.DEPLOY_COMMIT_SHA || null,
    },
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
    .select("id,account_id,canonical_host,tracking_enabled,access_state,tracking_last_received_at")
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
  const eventInputs = events.filter((event: any) => event?.type !== "view_state");
  const requestCountry = String(
    (c.req.raw as Request & { cf?: { country?: string } }).cf?.country || "",
  ).toUpperCase();
  const userAgent = c.req.header("user-agent") || "";
  const rows = eventInputs
    .map((e: any) =>
      sanitizeEvent(e, property.id, now, requestCountry, userAgent),
    )
    .filter(Boolean);
  const viewStates = events
    .filter((event: any) => event?.type === "view_state")
    .map((event: any) => sanitizeViewState(event, property.id, now, requestCountry, userAgent))
    .filter(Boolean);
  if (!rows.length && !viewStates.length) return c.json({ error: "no_valid_events" }, 400);
  const { data: ingestion, error: ingestionError } = await db.rpc("ingest_analytics_batch", {
    p_property_id: property.id,
    p_events: rows,
    p_view_states: viewStates,
    p_daily_limit: LIMITS.analyticsEventsPerPropertyPerDay,
  });
  if (ingestionError) return c.json({ error: "ingestion_failed" }, 503);
  if (!ingestion?.ok) {
    const error = String(ingestion?.error || "ingestion_failed");
    const status = ["analytics_daily_limit_reached", "analytics_monthly_pageview_limit_reached"].includes(error) ? 429
      : error === "unknown_property" ? 404
        : error === "invalid_batch" ? 400 : 503;
    return c.json({ error }, status as any);
  }
  if (!property.tracking_last_received_at) {
    await db.from("notifications")
      .update({ read_at: now })
      .eq("property_id", property.id)
      .eq("category", "tracking_problems")
      .is("read_at", null);
  }
  return c.body(null, 202);
});

export type BillingEnvironment = "test" | "live";

export function stripeKeyEnvironment(value: unknown): BillingEnvironment | null {
  const key = String(value || "").trim();
  if (/^(?:sk|rk)_test_/.test(key)) return "test";
  if (/^(?:sk|rk)_live_/.test(key)) return "live";
  return null;
}

function stripeContext(env: Env, environment: BillingEnvironment) {
  const dedicatedKey = environment === "test" ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_LIVE_SECRET_KEY;
  const legacyKey = stripeKeyEnvironment(env.STRIPE_SECRET_KEY) === environment ? env.STRIPE_SECRET_KEY : undefined;
  const secretKey = dedicatedKey || legacyKey;
  const detected = stripeKeyEnvironment(secretKey);
  if (!secretKey || detected !== environment) return { environment, client: null, webhookSecret: null, portalConfigurationId: null, configured: false };
  const webhookSecret = environment === "test"
    ? env.STRIPE_TEST_WEBHOOK_SECRET || (legacyKey ? env.STRIPE_WEBHOOK_SECRET : undefined)
    : env.STRIPE_LIVE_WEBHOOK_SECRET || (legacyKey ? env.STRIPE_WEBHOOK_SECRET : undefined);
  const portalConfigurationId = environment === "test" ? env.STRIPE_TEST_PORTAL_CONFIGURATION_ID : env.STRIPE_LIVE_PORTAL_CONFIGURATION_ID;
  const client = new Stripe(secretKey, {
    apiVersion: "2026-08-26.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
  return { environment, client, webhookSecret: webhookSecret || null, portalConfigurationId: portalConfigurationId || null, configured: Boolean(webhookSecret) };
}

function stripeClient(env: Env, environment: BillingEnvironment) {
  return stripeContext(env, environment).client;
}

function billingEnvironmentForLivemode(livemode: unknown): BillingEnvironment {
  return livemode === true ? "live" : "test";
}

function stripeTimestamp(value: unknown) {
  const seconds = Number(value || 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

async function billingAccess(env: Env, userId: string, accountId: string) {
  const db = admin(env);
  const [membership, billing] = await Promise.all([
    db.from("account_memberships").select("role").eq("account_id", accountId).eq("user_id", userId).maybeSingle(),
    db.from("account_billing_memberships").select("can_view,can_manage").eq("account_id", accountId).eq("user_id", userId).maybeSingle(),
  ]);
  const owner = membership.data?.role === "owner";
  return { canView: owner || billing.data?.can_view === true || billing.data?.can_manage === true, canManage: owner || billing.data?.can_manage === true };
}

function entitlementLimit(effective: any, ...keys: string[]): number | null | undefined {
  for (const source of [effective?.values, effective?.hardCeilings]) {
    for (const key of keys) {
      if (!source || !Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (source[key] === null) return null;
      const value = Number(source[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return undefined;
}

async function accountBillingUsage(env: Env, accountId: string, subscriptions: any[], effective: any) {
  const db = admin(env);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const packageKey = String(effective.packageKey || "free").toLowerCase().startsWith("pro") ? "pro" : String(effective.packageKey || "free").toLowerCase();
  const [properties, workspaces, accountMembers, monthlyAnalytics, analyticsRule] = await Promise.all([
    db.from("properties").select("id").eq("account_id", accountId),
    db.from("workspaces").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    db.from("account_memberships").select("user_id,role").eq("account_id", accountId),
    db.from("account_analytics_monthly_usage").select("accepted_pageviews,rejected_pageviews").eq("account_id", accountId).eq("period_start", monthStart.slice(0, 10)).maybeSingle(),
    db.from("analytics_plan_rules").select("monthly_pageview_limit").eq("package_key", packageKey).maybeSingle(),
  ]);
  const baseError = properties.error || workspaces.error || accountMembers.error || monthlyAnalytics.error || analyticsRule.error;
  if (baseError) throw new Error("account_usage_unavailable");
  const propertyIds = (properties.data || []).map((property) => property.id);
  const emptyCount = Promise.resolve({ count: 0, error: null } as any);
  const [eventDefinitions, audits, analyticsEvents, propertyViewers] = await Promise.all([
    propertyIds.length ? db.from("event_definitions").select("id", { count: "exact", head: true }).in("property_id", propertyIds) : emptyCount,
    propertyIds.length ? db.from("audit_runs").select("id", { count: "exact", head: true }).in("property_id", propertyIds).gte("created_at", monthStart) : emptyCount,
    propertyIds.length ? db.from("analytics_events").select("id", { count: "exact", head: true }).in("property_id", propertyIds).gte("occurred_at", monthStart) : emptyCount,
    propertyIds.length ? db.from("property_memberships").select("user_id").in("property_id", propertyIds) : Promise.resolve({ data: [], error: null } as any),
  ]);
  const scopedError = eventDefinitions.error || audits.error || analyticsEvents.error || propertyViewers.error;
  if (scopedError) throw new Error("account_usage_unavailable");
  const editingUserIds = new Set((accountMembers.data || []).filter((member) => member.role !== "viewer").map((member) => member.user_id));
  const viewerUserIds = new Set([
    ...(accountMembers.data || []).filter((member) => member.role === "viewer").map((member) => member.user_id),
    ...(propertyViewers.data || []).map((member: any) => member.user_id),
  ]);
  const includedUsers = entitlementLimit(effective, "editingSeats", "includedUsers");
  const activeSubscription = (subscriptions || []).find((subscription) => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(subscription.status));
  const purchasedUsers = Number(activeSubscription?.billable_additional_seats || 0);
  const customEventsPerProperty = entitlementLimit(effective, "customEventsPerProperty");
  const customEventsPerAccount = entitlementLimit(effective, "customEventsPerAccount");
  const customEventLimit = customEventsPerAccount !== undefined
    ? customEventsPerAccount
    : customEventsPerProperty == null
      ? customEventsPerProperty
      : customEventsPerProperty * propertyIds.length;
  const pageviewLimit = Number(analyticsRule.data?.monthly_pageview_limit || entitlementLimit(effective, "trackedPageviewsPerMonth", "accountPageviewsPerMonth"));
  const analyticsLimit = entitlementLimit(effective, "accountAnalyticsCount", "accountAnalyticsPerMonth", "analyticsEventsPerMonth");
  const auditLimit = entitlementLimit(effective, "auditsPerMonth", "auditCreditsPerMonth");
  const viewerLimit = entitlementLimit(effective, "propertyViewers", "viewerUsers");
  return {
    measuredAt: now.toISOString(),
    properties: { used: propertyIds.length, limit: entitlementLimit(effective, "propertiesPerAccount") },
    workspaces: { used: workspaces.count || 0, limit: entitlementLimit(effective, "workspacesPerAccount") },
    customEvents: { used: eventDefinitions.count || 0, limit: customEventLimit },
    audits: { used: audits.count || 0, limit: auditLimit, resetsAt },
    pageviews: { used: Number(monthlyAnalytics.data?.accepted_pageviews || 0), limit: Number.isFinite(pageviewLimit) && pageviewLimit > 0 ? pageviewLimit : undefined, resetsAt },
    analyticsEvents: { used: analyticsEvents.count || 0, limit: analyticsLimit, resetsAt },
    includedUsers: { used: includedUsers == null ? editingUserIds.size : Math.min(editingUserIds.size, includedUsers), limit: includedUsers },
    paidUsers: { used: Math.max(0, editingUserIds.size - (typeof includedUsers === "number" ? includedUsers : editingUserIds.size)), limit: purchasedUsers },
    viewerUsers: { used: viewerUserIds.size, limit: viewerLimit },
  };
}

async function billingAccountForObject(env: Env, object: any, billingEnvironment = billingEnvironmentForLivemode(object?.livemode)) {
  const db = admin(env);
  const providerCustomerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  const metadataAccountId = String(object.metadata?.claritudeAccountId || object.subscription_details?.metadata?.claritudeAccountId || "");
  if (metadataAccountId) {
    const account = await db.from("accounts").select("id,billing_environment").eq("id", metadataAccountId).eq("billing_environment", billingEnvironment).maybeSingle();
    if (account.data) return { accountId: metadataAccountId, providerCustomerId: providerCustomerId || null };
  }
  if (!providerCustomerId) return null;
  const customer = await db.from("billing_customers").select("account_id").eq("provider_customer_id", providerCustomerId).eq("billing_environment", billingEnvironment).maybeSingle();
  return customer.data ? { accountId: customer.data.account_id, providerCustomerId } : null;
}

async function notifyBillingMembers(env: Env, accountId: string, eventType: string, object: any) {
  const messages: Record<string, { title: string; body: string; severity: string }> = {
    "invoice.payment_failed": { title: "Payment failed", body: "Stripe could not collect the latest subscription invoice. Update the payment method in Billing.", severity: "warning" },
    "invoice.paid": { title: "Payment received", body: `Invoice ${object.number || object.id} was paid successfully.`, severity: "success" },
    "customer.subscription.trial_will_end": { title: "Trial ending soon", body: "Your Stripe subscription trial is approaching its end date.", severity: "info" },
    "customer.subscription.deleted": { title: "Subscription ended", body: "The Stripe subscription has ended. Your retained Claritude data has not been deleted.", severity: "warning" },
    "checkout.session.completed": { title: "Checkout completed", body: "Stripe checkout completed. Access updates after the subscription is verified by webhook reconciliation.", severity: "success" },
  };
  const message = messages[eventType];
  if (!message) return;
  const db = admin(env);
  const [billingMembers, owners] = await Promise.all([
    db.from("account_billing_memberships").select("user_id").eq("account_id", accountId).eq("can_view", true),
    db.from("account_memberships").select("user_id").eq("account_id", accountId).eq("role", "owner"),
  ]);
  const recipients = new Set([...(billingMembers.data || []), ...(owners.data || [])].map((item) => item.user_id));
  if (recipients.size) await db.from("notifications").insert([...recipients].map((userId) => ({ account_id: accountId, user_id: userId, ...message })));
}

export function calculateSubscriptionMrr(items: any[], discounts: any[] = [], atSeconds = Math.floor(Date.now() / 1000)) {
  const normalizedItems = (items || []).map((item) => {
    const price = typeof item.price === "string" ? {} : item.price || {};
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitAmountMinor = Math.max(0, Number(price.unit_amount ?? item.unit_amount_minor ?? 0));
    const interval = String(price.recurring?.interval || item.interval || "month");
    const gross = unitAmountMinor * quantity;
    const monthlyGrossMinor = interval === "year" ? Math.round(gross / 12) : gross;
    return { item, interval, quantity, unitAmountMinor, monthlyGrossMinor };
  });
  const grossMrrMinor = normalizedItems.reduce((sum, item) => sum + item.monthlyGrossMinor, 0);
  let netMrrMinor = grossMrrMinor;
  const recurringDiscounts = (discounts || []).flatMap((entry) => {
    const discount = typeof entry === "string" ? null : entry?.discount || entry;
    if (!discount) return [];
    const source = discount.source || discount.coupon || {};
    const coupon = source.coupon || source;
    const duration = String(coupon.duration || discount.duration || "once");
    const end = Number(discount.end || 0);
    const recurring = duration === "forever" || (duration === "repeating" && (!end || end > atSeconds));
    return recurring ? [{ discount, coupon, duration }] : [];
  });
  for (const { coupon } of recurringDiscounts) {
    const percentOff = Number(coupon.percent_off || 0);
    if (percentOff > 0) netMrrMinor = Math.max(0, Math.round(netMrrMinor * (1 - percentOff / 100)));
    const amountOff = Number(coupon.amount_off || 0);
    if (amountOff > 0) {
      const normalizedAmountOff = normalizedItems.length > 0 && normalizedItems.every((item) => item.interval === "year") ? Math.round(amountOff / 12) : amountOff;
      netMrrMinor = Math.max(0, netMrrMinor - normalizedAmountOff);
    }
  }
  const recurringDiscountMinor = grossMrrMinor - netMrrMinor;
  let allocated = 0;
  const projectedItems = normalizedItems.map((item, index) => {
    const monthlyDiscountMinor = index === normalizedItems.length - 1
      ? recurringDiscountMinor - allocated
      : grossMrrMinor ? Math.round(recurringDiscountMinor * item.monthlyGrossMinor / grossMrrMinor) : 0;
    allocated += monthlyDiscountMinor;
    return { ...item, monthlyDiscountMinor, monthlyNetMinor: Math.max(0, item.monthlyGrossMinor - monthlyDiscountMinor) };
  });
  return { grossMrrMinor, recurringDiscountMinor, mrrMinor: netMrrMinor, items: projectedItems, recurringDiscounts };
}

export function financeMetrics(input: {
  subscriptions: any[]; invoices: any[]; payments: any[]; refunds: any[]; disputes: any[];
}, environment?: BillingEnvironment) {
  const scoped = Object.fromEntries(Object.entries(input).map(([key, rows]) => [key, environment ? rows.filter((row: any) => row.billing_environment === environment) : rows])) as typeof input;
  const currencies = new Set<string>();
  for (const collection of Object.values(scoped)) for (const row of collection) if (row.currency) currencies.add(String(row.currency).toLowerCase());
  return [...currencies].sort().map((currency) => {
    const subscriptions = scoped.subscriptions.filter((row) => row.currency === currency && ["active", "trialing", "past_due"].includes(row.status));
    const recurringMinor = subscriptions.reduce((sum, row) => sum + Number(row.mrr_minor ?? (row.interval === "year" ? Math.round(Number(row.unit_amount_minor || 0) * Math.max(1, Number(row.quantity || 1)) / 12) : Number(row.unit_amount_minor || 0) * Math.max(1, Number(row.quantity || 1)))), 0);
    const invoices = scoped.invoices.filter((row) => row.currency === currency);
    const payments = scoped.payments.filter((row) => row.currency === currency);
    const refunds = scoped.refunds.filter((row) => row.currency === currency);
    const disputes = scoped.disputes.filter((row) => row.currency === currency && !["won", "warning_closed"].includes(row.status));
    return {
      currency,
      mrrMinor: recurringMinor,
      arrMinor: recurringMinor * 12,
      invoicedMinor: invoices.reduce((sum, row) => sum + Number(row.total_minor || 0), 0),
      cashCollectedMinor: payments.filter((row) => ["succeeded", "paid"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount_received_minor || 0), 0),
      refundsMinor: refunds.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + Number(row.amount_minor || 0), 0),
      pendingRefundsMinor: refunds.filter((row) => ["pending", "requires_action"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount_minor || 0), 0),
      feesMinor: payments.filter((row) => ["succeeded", "paid"].includes(row.status)).reduce((sum, row) => sum + Number(row.fee_minor || 0), 0),
      netMinor: payments.filter((row) => ["succeeded", "paid"].includes(row.status)).reduce((sum, row) => sum + Number(row.net_minor || row.amount_received_minor || 0), 0),
      disputedMinor: disputes.reduce((sum, row) => sum + Number(row.amount_minor || 0), 0),
      activeSubscriptions: subscriptions.filter((row) => row.status === "active").length,
      trialingSubscriptions: subscriptions.filter((row) => row.status === "trialing").length,
      pastDueSubscriptions: subscriptions.filter((row) => row.status === "past_due").length,
      failedPayments: payments.filter((row) => ["requires_payment_method", "canceled"].includes(row.status)).length,
    };
  });
}

async function projectStripeSubscription(env: Env, subscription: any, eventCreated: number) {
  const billingEnvironment = billingEnvironmentForLivemode(subscription.livemode);
  const relation = await billingAccountForObject(env, subscription, billingEnvironment);
  if (!relation) return null;
  const db = admin(env);
  const existing = await db.from("billing_subscriptions").select("last_event_created_at").eq("provider_subscription_id", subscription.id).eq("billing_environment", billingEnvironment).maybeSingle();
  if (existing.data?.last_event_created_at && Date.parse(existing.data.last_event_created_at) > eventCreated * 1000) return relation;
  const items = subscription.items?.data || [];
  const priceIds = items.map((item: any) => typeof item.price === "string" ? item.price : item.price?.id).filter(Boolean);
  const mappingsResponse = priceIds.length ? await db.from("billing_catalogue_prices").select("provider_price_id,package_version_id,interval,component,unit_amount_minor,active,provider_livemode,billing_environment,package_versions(allowances,unresolved_values)").eq("billing_environment", billingEnvironment).in("provider_price_id", priceIds) : { data: [] };
  const mappingByPrice = new Map((mappingsResponse.data || []).map((mapping: any) => [mapping.provider_price_id, mapping]));
  const baseItem = items.find((item: any) => mappingByPrice.get(typeof item.price === "string" ? item.price : item.price?.id)?.component === "base");
  const basePriceId = baseItem ? (typeof baseItem.price === "string" ? baseItem.price : baseItem.price?.id) : null;
  const baseMapping: any = basePriceId ? mappingByPrice.get(basePriceId) : null;
  const allowances = (baseMapping?.package_versions as any)?.allowances || {};
  const includedEditingSeats = Number.isSafeInteger(Number(allowances.editingSeats)) ? Number(allowances.editingSeats) : null;
  const billableAdditionalSeats = items.reduce((sum: number, item: any) => {
    const priceId = typeof item.price === "string" ? item.price : item.price?.id;
    return sum + (mappingByPrice.get(priceId)?.component === "additional_editing_seat" ? Math.max(0, Number(item.quantity || 0)) : 0);
  }, 0);
  const discounts = Array.isArray(subscription.discounts) ? subscription.discounts : subscription.discount ? [subscription.discount] : [];
  const mrr = calculateSubscriptionMrr(items, discounts, eventCreated);
  const interval = baseItem?.price?.recurring?.interval || baseMapping?.interval || null;
  await db.from("billing_subscriptions").upsert({
    billing_environment: billingEnvironment,
    provider_subscription_id: subscription.id,
    account_id: relation.accountId,
    provider_customer_id: relation.providerCustomerId,
    package_version_id: baseMapping?.package_version_id || null,
    status: subscription.status,
    currency: subscription.currency || baseItem?.price?.currency || null,
    interval,
    quantity: Number(baseItem?.quantity || 1),
    unit_amount_minor: Number(baseItem?.price?.unit_amount ?? baseMapping?.unit_amount_minor ?? 0),
    mrr_minor: mrr.mrrMinor,
    recurring_discount_minor: mrr.recurringDiscountMinor,
    included_editing_seats: includedEditingSeats,
    billable_additional_seats: billableAdditionalSeats,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    current_period_start: stripeTimestamp(subscription.current_period_start || baseItem?.current_period_start),
    current_period_end: stripeTimestamp(subscription.current_period_end || baseItem?.current_period_end),
    trial_end: stripeTimestamp(subscription.trial_end),
    cancelled_at: stripeTimestamp(subscription.canceled_at),
    ended_at: stripeTimestamp(subscription.ended_at),
    provider_created_at: stripeTimestamp(subscription.created),
    livemode: Boolean(subscription.livemode),
    metadata: { ...(subscription.metadata || {}), basePriceId, itemCount: items.length },
    last_event_created_at: stripeTimestamp(eventCreated),
    updated_at: new Date().toISOString(),
  }, { onConflict: "billing_environment,provider_subscription_id" });
  await db.from("billing_subscription_items").delete().eq("billing_environment", billingEnvironment).eq("provider_subscription_id", subscription.id);
  if (mrr.items.length) await db.from("billing_subscription_items").insert(mrr.items.map((projection) => {
    const item = projection.item;
    const priceId = typeof item.price === "string" ? item.price : item.price?.id;
    const mapping: any = mappingByPrice.get(priceId);
    return { billing_environment: billingEnvironment, provider_subscription_id: subscription.id, provider_subscription_item_id: item.id, provider_price_id: priceId, package_version_id: mapping?.package_version_id || null, component: mapping?.component || "unmapped", currency: item.price?.currency || subscription.currency, interval: projection.interval, quantity: projection.quantity, unit_amount_minor: projection.unitAmountMinor, monthly_gross_minor: projection.monthlyGrossMinor, monthly_discount_minor: projection.monthlyDiscountMinor, monthly_net_minor: projection.monthlyNetMinor, metadata: item.metadata || {} };
  }));
  await db.from("billing_subscription_discounts").delete().eq("billing_environment", billingEnvironment).eq("provider_subscription_id", subscription.id);
  if (mrr.recurringDiscounts.length) await db.from("billing_subscription_discounts").insert(mrr.recurringDiscounts.map(({ discount, coupon, duration }) => ({ billing_environment: billingEnvironment, provider_subscription_id: subscription.id, provider_discount_id: discount.id, provider_coupon_id: coupon.id || null, duration, duration_in_months: coupon.duration_in_months || null, percent_off: coupon.percent_off || null, amount_off_minor: coupon.amount_off || null, currency: coupon.currency || null, starts_at: stripeTimestamp(discount.start), ends_at: stripeTimestamp(discount.end), recurring_for_mrr: true, metadata: discount.metadata || {} })));
  const billingState = ["active", "trialing", "past_due", "unpaid"].includes(subscription.status) ? subscription.status : ["canceled", "incomplete_expired"].includes(subscription.status) ? "cancelled" : "unconfigured";
  if (baseMapping?.active && baseMapping.provider_livemode === Boolean(subscription.livemode) && baseMapping.billing_environment === billingEnvironment) {
    const current = await db.from("account_package_assignments").select("id,package_version_id").eq("account_id", relation.accountId).is("ends_at", null).maybeSingle();
    if (current.data && current.data.package_version_id !== baseMapping.package_version_id) {
      await db.from("account_package_assignments").update({ ends_at: new Date().toISOString() }).eq("id", current.data.id);
      await db.from("account_package_assignments").insert({ account_id: relation.accountId, package_version_id: baseMapping.package_version_id, billing_state: billingState, starts_at: new Date().toISOString(), complimentary: false });
    } else if (current.data) {
      await db.from("account_package_assignments").update({ billing_state: billingState }).eq("id", current.data.id);
    }
  }
  return relation;
}

async function projectStripeInvoice(env: Env, invoice: any, eventCreated = Math.floor(Date.now() / 1000)) {
  const billingEnvironment = billingEnvironmentForLivemode(invoice.livemode);
  const relation = await billingAccountForObject(env, invoice, billingEnvironment);
  if (!relation) return null;
  const db = admin(env);
  const existing = await db.from("billing_invoices").select("last_event_created_at").eq("provider_invoice_id", invoice.id).eq("billing_environment", billingEnvironment).maybeSingle();
  if (existing.data?.last_event_created_at && Date.parse(existing.data.last_event_created_at) > eventCreated * 1000) return relation;
  const paidAt = stripeTimestamp(invoice.status_transitions?.paid_at);
  await db.from("billing_invoices").upsert({
    billing_environment: billingEnvironment, provider_invoice_id: invoice.id, account_id: relation.accountId,
    provider_subscription_id: typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || invoice.parent?.subscription_details?.subscription || null,
    number: invoice.number || null, status: invoice.status || null, currency: invoice.currency,
    subtotal_minor: Number(invoice.subtotal || 0), discount_minor: Number(invoice.total_discount_amounts?.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0) || 0),
    tax_minor: Number(invoice.total_taxes?.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0) || invoice.tax || 0),
    total_minor: Number(invoice.total || 0), amount_paid_minor: Number(invoice.amount_paid || 0), amount_remaining_minor: Number(invoice.amount_remaining || 0),
    hosted_invoice_url: invoice.hosted_invoice_url || null, invoice_pdf: invoice.invoice_pdf || null,
    period_start: stripeTimestamp(invoice.period_start), period_end: stripeTimestamp(invoice.period_end), due_at: stripeTimestamp(invoice.due_date), paid_at: paidAt,
    voided_at: stripeTimestamp(invoice.status_transitions?.voided_at), provider_created_at: stripeTimestamp(invoice.created), livemode: Boolean(invoice.livemode), metadata: invoice.metadata || {}, last_event_created_at: stripeTimestamp(eventCreated), updated_at: new Date().toISOString(),
  }, { onConflict: "billing_environment,provider_invoice_id" });
  return relation;
}

async function applyVerifiedBillingEvent(env: Env, event: Stripe.Event) {
  const db = admin(env);
  const object = event.data.object as any;
  const billingEnvironment = billingEnvironmentForLivemode(event.livemode);
  let relation: { accountId: string; providerCustomerId: string | null } | null = null;
  if (event.type.startsWith("customer.subscription.")) {
    const stripe = stripeClient(env, billingEnvironment);
    const subscription = stripe ? await stripe.subscriptions.retrieve(object.id, { expand: ["discounts.source.coupon"] }) : object;
    relation = await projectStripeSubscription(env, subscription, event.created);
  }
  else if (event.type.startsWith("invoice.")) relation = await projectStripeInvoice(env, object, event.created);
  else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
    relation = await billingAccountForObject(env, object, billingEnvironment);
    const checkoutAttemptId = String(object.metadata?.checkoutAttemptId || "");
    const state = event.type === "checkout.session.expired" ? "expired" : event.type === "checkout.session.async_payment_failed" ? "failed" : "completed";
    if (checkoutAttemptId) await db.from("billing_checkout_attempts").update({ state, updated_at: new Date().toISOString(), error: state === "failed" ? "Stripe reported asynchronous payment failure" : null }).eq("id", checkoutAttemptId);
  }
  else if (event.type.startsWith("payment_intent.")) {
    relation = await billingAccountForObject(env, object, billingEnvironment);
    const existing = await db.from("billing_payments").select("last_event_created_at").eq("provider_payment_intent_id", object.id).eq("billing_environment", billingEnvironment).maybeSingle();
    if (relation && (!existing.data?.last_event_created_at || Date.parse(existing.data.last_event_created_at) <= event.created * 1000)) await db.from("billing_payments").upsert({ billing_environment: billingEnvironment, provider_payment_intent_id: object.id, account_id: relation.accountId, provider_invoice_id: typeof object.invoice === "string" ? object.invoice : object.invoice?.id || null, status: object.status, currency: object.currency, amount_minor: Number(object.amount || 0), amount_received_minor: Number(object.amount_received || 0), payment_method_summary: { type: object.payment_method_types?.[0] || null }, failure_code: object.last_payment_error?.code || null, failure_message: object.last_payment_error?.message || null, provider_created_at: stripeTimestamp(object.created), livemode: Boolean(object.livemode), metadata: object.metadata || {}, last_event_created_at: stripeTimestamp(event.created), updated_at: new Date().toISOString() }, { onConflict: "billing_environment,provider_payment_intent_id" });
  } else if (event.type.startsWith("charge.") && !event.type.startsWith("charge.dispute.")) {
    relation = await billingAccountForObject(env, object, billingEnvironment);
    const paymentIntentId = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
    const balanceTransactionId = typeof object.balance_transaction === "string" ? object.balance_transaction : object.balance_transaction?.id;
    if (relation && paymentIntentId) {
      const stripe = stripeClient(env, billingEnvironment);
      const balanceTransaction = balanceTransactionId && stripe ? await stripe.balanceTransactions.retrieve(balanceTransactionId) : null;
      await db.from("billing_payments").upsert({ billing_environment: billingEnvironment, provider_payment_intent_id: paymentIntentId, account_id: relation.accountId, provider_invoice_id: typeof object.invoice === "string" ? object.invoice : object.invoice?.id || null, status: object.paid ? "succeeded" : object.status || "failed", currency: object.currency, amount_minor: Number(object.amount || 0), amount_received_minor: object.paid ? Number(object.amount || 0) : 0, fee_minor: Number(balanceTransaction?.fee || 0), net_minor: Number(balanceTransaction?.net || 0), provider_balance_transaction_id: balanceTransactionId || null, available_on: balanceTransaction?.available_on ? new Date(balanceTransaction.available_on * 1000).toISOString().slice(0, 10) : null, payment_method_summary: { type: object.payment_method_details?.type || null, brand: object.payment_method_details?.card?.brand || null, last4: object.payment_method_details?.card?.last4 || null }, failure_code: object.failure_code || null, failure_message: object.failure_message || null, provider_created_at: stripeTimestamp(object.created), livemode: Boolean(object.livemode), metadata: object.metadata || {}, last_event_created_at: stripeTimestamp(event.created), updated_at: new Date().toISOString() }, { onConflict: "billing_environment,provider_payment_intent_id" });
    }
  } else if (event.type.startsWith("refund.")) {
    relation = await billingAccountForObject(env, object, billingEnvironment);
    const existing = await db.from("billing_refunds").select("last_event_created_at").eq("provider_refund_id", object.id).eq("billing_environment", billingEnvironment).maybeSingle();
    if (relation && (!existing.data?.last_event_created_at || Date.parse(existing.data.last_event_created_at) <= event.created * 1000)) await db.from("billing_refunds").upsert({ billing_environment: billingEnvironment, provider_refund_id: object.id, account_id: relation.accountId, provider_payment_intent_id: typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null, status: object.status || null, currency: object.currency, amount_minor: Number(object.amount || 0), reason: object.reason || null, provider_created_at: stripeTimestamp(object.created), livemode: Boolean(object.livemode), metadata: object.metadata || {}, last_event_created_at: stripeTimestamp(event.created), updated_at: new Date().toISOString() }, { onConflict: "billing_environment,provider_refund_id" });
  } else if (event.type.startsWith("charge.dispute.")) {
    relation = await billingAccountForObject(env, object, billingEnvironment);
    const existing = await db.from("billing_disputes").select("last_event_created_at").eq("provider_dispute_id", object.id).eq("billing_environment", billingEnvironment).maybeSingle();
    if (relation && (!existing.data?.last_event_created_at || Date.parse(existing.data.last_event_created_at) <= event.created * 1000)) await db.from("billing_disputes").upsert({ billing_environment: billingEnvironment, provider_dispute_id: object.id, account_id: relation.accountId, provider_payment_intent_id: typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null, status: object.status, currency: object.currency, amount_minor: Number(object.amount || 0), reason: object.reason || null, evidence_due_at: stripeTimestamp(object.evidence_details?.due_by), provider_created_at: stripeTimestamp(object.created), livemode: Boolean(object.livemode), metadata: object.metadata || {}, last_event_created_at: stripeTimestamp(event.created), updated_at: new Date().toISOString() }, { onConflict: "billing_environment,provider_dispute_id" });
  } else if (event.type.startsWith("payout.")) {
    await db.from("billing_payouts").upsert({ billing_environment: billingEnvironment, provider_payout_id: object.id, status: object.status, currency: object.currency, amount_minor: Number(object.amount || 0), arrival_at: stripeTimestamp(object.arrival_date), provider_created_at: stripeTimestamp(object.created), metadata: object.metadata || {}, last_event_created_at: stripeTimestamp(event.created), updated_at: new Date().toISOString() }, { onConflict: "billing_environment,provider_payout_id" });
  } else relation = await billingAccountForObject(env, object, billingEnvironment);
  if (relation?.providerCustomerId) await db.from("billing_customers").update({ sync_state: "synced", last_synced_at: new Date().toISOString(), currency: object.currency || undefined, metadata: { lastProviderEventCreated: event.created, lastProviderEventId: event.id } }).eq("account_id", relation.accountId).eq("billing_environment", billingEnvironment);
  if (relation) await notifyBillingMembers(env, relation.accountId, event.type, object);
  return relation;
}

async function processBillingEvent(env: Env, id: string) {
  const db = admin(env);
  const record = await db.from("billing_events").select("*").eq("id", id).maybeSingle();
  if (!record.data || record.data.processing_state === "processed" || record.data.processing_state === "ignored") return;
  const attempts = Number(record.data.attempts || 0) + 1;
  try {
    const relation = await applyVerifiedBillingEvent(env, record.data.payload as Stripe.Event);
    await db.from("billing_events").update({ account_id: relation?.accountId || null, processing_state: relation ? "processed" : "ignored", attempts, error: null, last_attempt_at: new Date().toISOString(), processed_at: new Date().toISOString(), next_attempt_at: null }).eq("id", id);
  } catch (error) {
    const backoffMinutes = Math.min(360, 2 ** Math.min(attempts, 8));
    await db.from("billing_events").update({ processing_state: "failed", attempts, error: errorMessage(error).slice(0, 1000), last_attempt_at: new Date().toISOString(), next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString() }).eq("id", id);
    throw error;
  }
}

async function reconcileBillingAccount(env: Env, accountId: string, mode: "scheduled" | "manual" | "webhook_repair", requestedBy?: string) {
  const db = admin(env);
  const account = await db.from("accounts").select("billing_environment").eq("id", accountId).maybeSingle();
  const billingEnvironment = account.data?.billing_environment as BillingEnvironment | undefined;
  if (!billingEnvironment) throw new Error("billing_environment_unavailable");
  const stripe = stripeClient(env, billingEnvironment);
  const run = await db.from("billing_reconciliation_runs").insert({ account_id: accountId, billing_environment: billingEnvironment, mode, requested_by: requestedBy || null }).select("id").single();
  if (!run.data) throw new Error("reconciliation_run_persistence_failed");
  try {
    const customer = await db.from("billing_customers").select("provider_customer_id").eq("account_id", accountId).eq("billing_environment", billingEnvironment).maybeSingle();
    if (!stripe || !customer.data?.provider_customer_id) throw new Error("stripe_customer_unavailable");
    const [subscriptions, invoices] = await Promise.all([
      stripe.subscriptions.list({ customer: customer.data.provider_customer_id, status: "all", limit: 100, expand: ["data.discounts.source.coupon"] }),
      stripe.invoices.list({ customer: customer.data.provider_customer_id, limit: 100 }),
    ]);
    for (const subscription of subscriptions.data) await projectStripeSubscription(env, subscription, Math.floor(Date.now() / 1000));
    for (const invoice of invoices.data) await projectStripeInvoice(env, invoice);
    const counts = { subscriptions: subscriptions.data.length, invoices: invoices.data.length };
    await db.from("billing_reconciliation_runs").update({ state: "completed", completed_at: new Date().toISOString(), counts, differences: [] }).eq("id", run.data.id);
    return { id: run.data.id, state: "completed", counts };
  } catch (error) {
    await db.from("billing_reconciliation_runs").update({ state: "failed", completed_at: new Date().toISOString(), error: errorMessage(error).slice(0, 1000) }).eq("id", run.data.id);
    throw error;
  }
}

async function receiveStripeWebhook(c: any, billingEnvironment: BillingEnvironment) {
  const context = stripeContext(c.env, billingEnvironment);
  const stripe = context.client;
  if (!stripe || !context.webhookSecret) return c.json({ error: "stripe_webhook_unconfigured", environment: billingEnvironment }, 503);
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "stripe_signature_required" }, 400);
  const rawBody = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, context.webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (error) {
    console.error("stripe_webhook_verification_failed", errorMessage(error));
    return c.json({ error: "invalid_stripe_signature" }, 400);
  }
  if (billingEnvironmentForLivemode(event.livemode) !== billingEnvironment) return c.json({ error: "stripe_webhook_environment_mismatch" }, 400);
  const db = admin(c.env);
  const inserted = await db.from("billing_events").insert({
    billing_environment: billingEnvironment,
    provider_event_id: event.id,
    event_type: event.type,
    provider_created_at: new Date(event.created * 1000).toISOString(),
    livemode: event.livemode,
    payload: event,
  }).select("id").maybeSingle();
  if (inserted.error?.code === "23505") return c.json({ received: true, duplicate: true });
  if (inserted.error || !inserted.data) return c.json({ error: "billing_event_persistence_failed" }, 503);
  await c.env.JOBS.send({ type: "billing-event", id: inserted.data.id });
  return c.json({ received: true }, 202);
}

async function provisionSandboxAcceptanceScenarios(env: Env, runId: string) {
  const db = admin(env);
  const scenarioRun = await db.from("sandbox_acceptance_scenario_runs").select("created_at").eq("id", runId).single();
  if (!scenarioRun.data?.created_at) throw new Error("sandbox_scenario_run_missing");
  const scenarioFrozenTime = Math.floor(new Date(scenarioRun.data.created_at).getTime() / 1000);
  const context = stripeContext(env, "test");
  if (!context.client || !context.webhookSecret) throw new Error("stripe_test_credentials_and_webhook_required");
  const stripe = context.client;
  const websi = await db.from("accounts").select("id").eq("name", "Websi").eq("billing_environment", "live").maybeSingle();
  const owner = websi.data ? await db.from("account_memberships").select("user_id").eq("account_id", websi.data.id).eq("role", "owner").limit(1).maybeSingle() : { data: null } as any;
  if (!owner.data?.user_id) throw new Error("websi_owner_required_for_sandbox_scenarios");
  const user = await db.auth.admin.getUserById(owner.data.user_id);
  const testRecipient = user.data.user?.email;
  if (!testRecipient) throw new Error("designated_test_recipient_required");
  const prices = await db.from("billing_catalogue_prices").select("provider_price_id,package_version_id,interval,package_versions(package_key)").eq("billing_environment", "test").eq("currency", "gbp").eq("component", "base").eq("active", true);
  if (prices.error) throw prices.error;
  const priceFor = (packageKey: string, interval: "month" | "year") => (prices.data || []).find((price: any) => (price.package_versions as any)?.package_key === packageKey && price.interval === interval);
  const proMonth: any = priceFor("pro", "month");
  const proYear: any = priceFor("pro", "year");
  const essentialsMonth: any = priceFor("essentials", "month");
  const scaleMonth: any = priceFor("scale", "month");
  if (!proMonth || !proYear || !essentialsMonth || !scaleMonth) throw new Error("sandbox_fixture_catalogue_incomplete");

  async function ensureAccount(name: string) {
    const existing = await db.from("accounts").select("id,name").eq("billing_environment", "test").eq("name", name).maybeSingle();
    if (existing.data) return existing.data;
    const created = await db.rpc("create_superadmin_test_account", { p_name: name, p_owner: owner.data.user_id, p_test_recipients: [testRecipient] });
    if (created.error) throw created.error;
    return { id: (created.data as any).accountId, name };
  }
  async function ensureCustomer(account: { id: string; name: string }, paymentToken = "tok_visa", testClock?: string) {
    const existing = await db.from("billing_customers").select("provider_customer_id").eq("account_id", account.id).eq("billing_environment", "test").maybeSingle();
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: { token: paymentToken },
      metadata: { claritudeAccountId: account.id, billingEnvironment: "test", sandboxAcceptanceFixture: "true", fixtureRunId: runId },
    } as any, { idempotencyKey: `sandbox-acceptance-payment-method:v2:${account.id}:${paymentToken}` });
    if (existing.data?.provider_customer_id) {
      const customerId = existing.data.provider_customer_id as string;
      try { await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId }); } catch (error) { if (!/already been attached/i.test(errorMessage(error))) throw error; }
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod.id } });
      return customerId;
    }
    const customer = await stripe.customers.create({
      name: account.name, email: testRecipient, payment_method: paymentMethod.id,
      invoice_settings: { default_payment_method: paymentMethod.id },
      ...(testClock ? { test_clock: testClock } : {}),
      metadata: { claritudeAccountId: account.id, billingEnvironment: "test", sandboxAcceptanceScenario: "true", fixtureRunId: runId },
    } as any, { idempotencyKey: `sandbox-acceptance-customer:v2:${account.id}` });
    if (customer.livemode) throw new Error("sandbox_customer_environment_mismatch");
    const stored = await db.from("billing_customers").upsert({ account_id: account.id, billing_environment: "test", provider_customer_id: customer.id, provider: "stripe", currency: "gbp", sync_state: "pending", metadata: { livemode: false, sandboxAcceptanceScenario: true } }, { onConflict: "account_id,billing_environment" });
    if (stored.error) throw stored.error;
    return customer.id;
  }
  async function ensureSubscription(scenario: string, account: { id: string; name: string }, customerId: string, priceId: string, extra: Record<string, unknown> = {}) {
    const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100, expand: ["data.discounts.source.coupon"] });
    let subscription: any = existing.data.find((item: any) => item.metadata?.sandboxAcceptanceScenario === scenario);
    if (!subscription) {
      const customer: any = await stripe.customers.retrieve(customerId);
      const defaultPaymentMethod = typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id;
      if (!defaultPaymentMethod) throw new Error(`sandbox_payment_method_missing:${account.id}`);
      subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      default_payment_method: defaultPaymentMethod,
      payment_behavior: "error_if_incomplete",
      metadata: { claritudeAccountId: account.id, billingEnvironment: "test", sandboxAcceptanceScenario: scenario, fixtureRunId: runId },
      expand: ["discounts.source.coupon"],
      ...extra,
    } as any, { idempotencyKey: `sandbox-acceptance-subscription:v2:${scenario}:${account.id}` });
    }
    if (subscription.livemode) throw new Error("sandbox_subscription_environment_mismatch");
    await reconcileBillingAccount(env, account.id, "manual");
    return subscription;
  }

  const annualAccount = await ensureAccount("Sandbox Annual Pro");
  const annualCustomer = await ensureCustomer(annualAccount);
  const annual = await ensureSubscription("annual", annualAccount, annualCustomer, proYear.provider_price_id);

  const trialAccount = await ensureAccount("Sandbox Trial Pro");
  const trialCustomer = await ensureCustomer(trialAccount);
  const trial = await ensureSubscription("trial", trialAccount, trialCustomer, proMonth.provider_price_id, { trial_period_days: 14 });

  const coupon = await stripe.coupons.create({ percent_off: 25, duration: "forever", name: "Claritude sandbox acceptance 25%", metadata: { sandboxAcceptanceFixture: "true", fixtureRunId: runId } }, { idempotencyKey: "sandbox-acceptance-coupon:25-percent" });
  const existingCodes = await stripe.promotionCodes.list({ code: "SANDBOX25", active: true, limit: 10 });
  const promotion = existingCodes.data[0] || await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: coupon.id }, code: "SANDBOX25", metadata: { sandboxAcceptanceFixture: "true", fixtureRunId: runId } } as any, { idempotencyKey: "sandbox-acceptance-promotion:SANDBOX25" });
  const rule = await db.from("promotion_rules").upsert({ billing_environment: "test", provider_coupon_id: coupon.id, provider_promotion_code_id: promotion.id, code: "SANDBOX25", internal_name: "Sandbox acceptance 25%", description: "Sandbox fixture only; no live commercial authority", discount_type: "percentage", percentage: 25, duration_type: "forever", eligible_packages: ["pro"], eligible_intervals: ["month"], enabled: true, provider_sync_state: "synced", synced_at: new Date().toISOString(), operation_key: "decc23bc-3a6c-45f0-8b1d-11982f848bc2", updated_at: new Date().toISOString() }, { onConflict: "billing_environment,code" });
  if (rule.error) throw rule.error;
  const discountAccount = await ensureAccount("Sandbox Discount Pro");
  const discountCustomer = await ensureCustomer(discountAccount);
  const discounted = await ensureSubscription("discounted", discountAccount, discountCustomer, proMonth.provider_price_id, { discounts: [{ coupon: coupon.id }] });

  const cancellationAccount = await ensureAccount("Sandbox Cancellation Pro");
  const cancellationCustomer = await ensureCustomer(cancellationAccount);
  let cancellation = await ensureSubscription("cancellation", cancellationAccount, cancellationCustomer, proMonth.provider_price_id);
  if (!cancellation.cancel_at_period_end) cancellation = await stripe.subscriptions.update(cancellation.id, { cancel_at_period_end: true }, { idempotencyKey: `sandbox-acceptance-cancel:${cancellation.id}` });
  await reconcileBillingAccount(env, cancellationAccount.id, "manual");

  const refundAccount = await ensureAccount("Sandbox Refund Pro");
  const refundCustomer = await ensureCustomer(refundAccount);
  const refundable: any = await ensureSubscription("refund", refundAccount, refundCustomer, proMonth.provider_price_id);
  const refundInvoiceId = typeof refundable.latest_invoice === "string" ? refundable.latest_invoice : refundable.latest_invoice?.id;
  const invoicePayments: any = refundInvoiceId ? await stripe.invoicePayments.list({ invoice: refundInvoiceId, status: "paid", limit: 10, expand: ["data.payment.payment_intent"] }) : null;
  const invoicePayment = invoicePayments?.data?.find((item: any) => item.payment?.type === "payment_intent");
  const paymentIntentId = typeof invoicePayment?.payment?.payment_intent === "string" ? invoicePayment.payment.payment_intent : invoicePayment?.payment?.payment_intent?.id;
  let refund: any = null;
  if (paymentIntentId) {
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 10 });
    refund = refunds.data.find((item: any) => item.metadata?.sandboxAcceptanceScenario === "refund") || await stripe.refunds.create({ payment_intent: paymentIntentId, amount: 100, reason: "requested_by_customer", metadata: { claritudeAccountId: refundAccount.id, billingEnvironment: "test", sandboxAcceptanceScenario: "refund", fixtureRunId: runId } }, { idempotencyKey: `sandbox-acceptance-refund:${paymentIntentId}` });
  }

  const upgradeAccount = await ensureAccount("Sandbox Upgrade Pro");
  const upgradeCustomer = await ensureCustomer(upgradeAccount);
  let upgrade: any = await ensureSubscription("upgrade", upgradeAccount, upgradeCustomer, essentialsMonth.provider_price_id);
  const upgradeItem = upgrade.items?.data?.[0];
  if (upgradeItem?.price?.id !== scaleMonth.provider_price_id) upgrade = await stripe.subscriptions.update(upgrade.id, { items: [{ id: upgradeItem.id, price: scaleMonth.provider_price_id }], proration_behavior: "always_invoice", metadata: { ...upgrade.metadata, packageVersionId: scaleMonth.package_version_id } }, { idempotencyKey: `sandbox-acceptance-upgrade:${upgrade.id}` });
  await reconcileBillingAccount(env, upgradeAccount.id, "manual");
  await db.from("billing_scheduled_changes").upsert({ billing_environment: "test", operation_key: "b5d23c13-7e5f-4324-a1aa-32d9d421c78a", account_id: upgradeAccount.id, provider_subscription_id: upgrade.id, effective_at: stripeTimestamp(upgrade.current_period_end || upgrade.items?.data?.[0]?.current_period_end), requested_change: { packageVersionId: essentialsMonth.package_version_id, currency: "gbp", interval: "month", editingSeats: 1, sandboxAcceptanceScenario: true }, state: "scheduled", requested_by: owner.data.user_id }, { onConflict: "billing_environment,operation_key" });

  const failureClock = await stripe.testHelpers.testClocks.create({ frozen_time: scenarioFrozenTime, name: "Claritude sandbox past-due acceptance" }, { idempotencyKey: `sandbox-acceptance-clock:v2:${runId}` });
  const failedAccount = await ensureAccount("Sandbox Past Due Pro");
  const failedCustomer = await ensureCustomer(failedAccount, "tok_visa", failureClock.id);
  const failed = await ensureSubscription("past-due", failedAccount, failedCustomer, proMonth.provider_price_id, { trial_end: failureClock.frozen_time + 86400 });
  const failureCustomer: any = await stripe.customers.retrieve(failedCustomer);
  const failurePaymentMethod = typeof failureCustomer.invoice_settings?.default_payment_method === "string"
    ? failureCustomer.invoice_settings.default_payment_method
    : failureCustomer.invoice_settings?.default_payment_method?.id;
  if (!failurePaymentMethod) throw new Error("sandbox_failure_payment_method_missing");
  await stripe.paymentMethods.detach(failurePaymentMethod);
  if (failureClock.status === "ready") {
    try {
      await stripe.testHelpers.testClocks.advance(failureClock.id, { frozen_time: failureClock.frozen_time + 172800 });
    } catch (error) {
      if (!/card was declined/i.test(errorMessage(error))) throw error;
    }
  }
  await reconcileBillingAccount(env, failedAccount.id, "manual");

  return {
    environment: "test", livemode: false,
    scenarios: {
      annual: { accountId: annualAccount.id, subscriptionId: annual.id, status: annual.status },
      trial: { accountId: trialAccount.id, subscriptionId: trial.id, status: trial.status },
      discounted: { accountId: discountAccount.id, subscriptionId: discounted.id, status: discounted.status, promotionCodeId: promotion.id },
      cancellation: { accountId: cancellationAccount.id, subscriptionId: cancellation.id, cancelAtPeriodEnd: cancellation.cancel_at_period_end },
      refund: { accountId: refundAccount.id, subscriptionId: refundable.id, refundId: refund?.id || null, refundStatus: refund?.status || null },
      upgradeAndScheduledDowngrade: { accountId: upgradeAccount.id, subscriptionId: upgrade.id, status: upgrade.status },
      failedPayment: { accountId: failedAccount.id, subscriptionId: failed.id, initialStatus: failed.status, testClockId: failureClock.id },
    },
  };
}

async function refreshBillingFinanceEnvironment(env: Env, billingEnvironment: BillingEnvironment) {
  const db = admin(env);
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;
  const [subscriptions, invoices, payments, refunds, disputes, grants] = await Promise.all([
    db.from("billing_subscriptions").select("*,package_versions(package_key)").eq("billing_environment", billingEnvironment),
    db.from("billing_invoices").select("*").eq("billing_environment", billingEnvironment),
    db.from("billing_payments").select("*").eq("billing_environment", billingEnvironment),
    db.from("billing_refunds").select("*").eq("billing_environment", billingEnvironment),
    db.from("billing_disputes").select("*").eq("billing_environment", billingEnvironment),
    db.from("account_package_grants").select("account_id,accounts!inner(billing_environment)").eq("accounts.billing_environment", billingEnvironment).eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
  ]);
  const provider = stripeContext(env, billingEnvironment);
  let availableByCurrency: Record<string, number> = {};
  let pendingByCurrency: Record<string, number> = {};
  if (provider.client) {
    const [balance, payouts] = await Promise.all([
      provider.client.balance.retrieve(),
      provider.client.payouts.list({ created: { gte: Math.floor(Date.parse(dayStart) / 1000), lte: Math.floor(Date.parse(dayEnd) / 1000) }, limit: 100 }),
    ]);
    availableByCurrency = Object.fromEntries(balance.available.map((item) => [item.currency, Number(item.amount || 0)]));
    pendingByCurrency = Object.fromEntries(balance.pending.map((item) => [item.currency, Number(item.amount || 0)]));
    if (payouts.data.length) await db.from("billing_payouts").upsert(payouts.data.map((payout) => ({ billing_environment: billingEnvironment, provider_payout_id: payout.id, status: payout.status, currency: payout.currency, amount_minor: payout.amount, arrival_at: stripeTimestamp(payout.arrival_date), provider_created_at: stripeTimestamp(payout.created), metadata: payout.metadata || {}, updated_at: new Date().toISOString() })), { onConflict: "billing_environment,provider_payout_id" });
  }
  const metrics = financeMetrics({ subscriptions: subscriptions.data || [], invoices: invoices.data || [], payments: payments.data || [], refunds: refunds.data || [], disputes: disputes.data || [] }, billingEnvironment);
  for (const metric of metrics) {
    const dailyPayments = (payments.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
    const dailyRefunds = (refunds.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
    const dailyInvoices = (invoices.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
    const currentSubscriptions = (subscriptions.data || []).filter((row: any) => row.currency === metric.currency && ["active", "trialing", "past_due"].includes(row.status));
    const packageRevenue = currentSubscriptions.reduce((result: Record<string, number>, row: any) => { const key = row.package_versions?.package_key || "unmapped"; result[key] = (result[key] || 0) + Number(row.mrr_minor || 0); return result; }, {});
    const intervalMix = currentSubscriptions.reduce((result: Record<string, number>, row: any) => { const key = row.interval || "unknown"; result[key] = (result[key] || 0) + 1; return result; }, {});
    const collectionsDayMinor = dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.amount_received_minor || 0), 0);
    const succeededRefunds = dailyRefunds.filter((row: any) => row.status === "succeeded").reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0);
    const pendingRefunds = dailyRefunds.filter((row: any) => ["pending", "requires_action"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0);
    const feesDayMinor = dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.fee_minor || 0), 0);
    const payouts = await db.from("billing_payouts").select("amount_minor").eq("billing_environment", billingEnvironment).eq("currency", metric.currency).gte("provider_created_at", dayStart).lte("provider_created_at", dayEnd);
    await db.from("billing_daily_finance").upsert({ day: today, currency: metric.currency, billing_environment: billingEnvironment, livemode: billingEnvironment === "live", mrr_minor: metric.mrrMinor, arr_minor: metric.arrMinor, invoiced_minor: dailyInvoices.reduce((sum: number, row: any) => sum + Number(row.total_minor || 0), 0), cash_collected_minor: collectionsDayMinor, refunds_minor: succeededRefunds, collections_day_minor: collectionsDayMinor, refunds_succeeded_day_minor: succeededRefunds, refunds_pending_day_minor: pendingRefunds, fees_day_minor: feesDayMinor, net_balance_day_minor: collectionsDayMinor - succeededRefunds - feesDayMinor, available_balance_minor: availableByCurrency[metric.currency] || 0, pending_balance_minor: pendingByCurrency[metric.currency] || 0, new_subscriptions: currentSubscriptions.filter((row: any) => row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd).length, cancellations: (subscriptions.data || []).filter((row: any) => row.currency === metric.currency && row.cancelled_at >= dayStart && row.cancelled_at <= dayEnd).length, recovered_payments: dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status) && row.metadata?.recovered === true).length, payouts_day_minor: (payouts.data || []).reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0), package_revenue: packageRevenue, billing_interval_mix: intervalMix, failed_payments: dailyPayments.filter((row: any) => ["requires_payment_method", "canceled"].includes(row.status)).length, active_subscriptions: metric.activeSubscriptions, trialing_subscriptions: metric.trialingSubscriptions, past_due_subscriptions: metric.pastDueSubscriptions, complimentary_accounts: new Set((grants.data || []).map((grant) => grant.account_id)).size, calculated_at: new Date().toISOString() }, { onConflict: "day,currency,billing_environment" });
  }
  return { day: today, metrics };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function provisionSandboxAcceptanceFixtures(env: Env, runId: string, request: any) {
  const db = admin(env);
  const provider = stripeContext(env, "test");
  if (!provider.client || !provider.webhookSecret) throw new Error("stripe_test_credentials_and_webhook_required");
  const stripe = provider.client;
  const configured = request?.packages || {};
  const packageKeys = ["essentials", "scale", "pro"] as const;
  const currencies = ["gbp", "eur", "usd"] as const;
  const intervals = ["month", "year"] as const;
  const versions = await db.from("package_versions").select("id,package_key,display_name,state,allowances").in("package_key", packageKeys);
  if (versions.error) throw versions.error;
  const versionByKey = new Map((versions.data || []).map((version: any) => [version.package_key, version]));
  for (const packageKey of packageKeys) if (!versionByKey.has(packageKey)) throw new Error(`package_version_missing:${packageKey}`);

  const products = await stripe.products.list({ active: true, limit: 100 });
  const catalogue: any[] = [];
  for (const packageKey of packageKeys) {
    const version: any = versionByKey.get(packageKey);
    let product = products.data.find((candidate) => candidate.metadata?.claritudeSandboxFixture === "true" && candidate.metadata?.claritudePackageKey === packageKey);
    if (!product) product = await stripe.products.create({
      name: `Claritude ${version.display_name} — Sandbox fixture`,
      description: "Isolated Claritude acceptance fixture. No real payments; not approved live pricing.",
      metadata: { claritudeSandboxFixture: "true", claritudePackageKey: packageKey, billingEnvironment: "test", fixtureRunId: runId },
    }, { idempotencyKey: `sandbox-fixture-product:${packageKey}` });
    if (product.livemode) throw new Error("sandbox_fixture_product_environment_mismatch");
    const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    for (const currency of currencies) for (const interval of intervals) {
      const amountMinor = Number(configured?.[packageKey]?.[interval === "month" ? "monthMinor" : "yearMinor"]);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new Error(`sandbox_fixture_amount_invalid:${packageKey}:${interval}`);
      let price = existingPrices.data.find((candidate) => candidate.currency === currency && candidate.recurring?.interval === interval && candidate.unit_amount === amountMinor && candidate.metadata?.claritudeSandboxFixture === "true");
      if (!price) price = await stripe.prices.create({
        product: product.id, currency, unit_amount: amountMinor,
        recurring: { interval }, tax_behavior: "unspecified",
        nickname: `${version.display_name} ${currency.toUpperCase()} ${interval} — sandbox fixture`,
        metadata: { claritudeSandboxFixture: "true", claritudePackageKey: packageKey, billingEnvironment: "test", additionalSeatsEnabled: "false", fixtureRunId: runId },
      }, { idempotencyKey: `sandbox-fixture-price:${packageKey}:${currency}:${interval}:${amountMinor}` });
      if (price.livemode) throw new Error("sandbox_fixture_price_environment_mismatch");
      const row = {
        package_version_id: version.id, provider_product_id: product.id, provider_price_id: price.id,
        currency, interval, component: "base", unit_amount_minor: amountMinor, tax_behavior: "unspecified",
        active: true, provider_livemode: false, billing_environment: "test",
        metadata: { sandboxFixture: true, fixtureLabel: "Sandbox fixture — no real payments", additionalSeatsEnabled: false, fixtureRunId: runId },
        verified_at: new Date().toISOString(),
      };
      const saved = await db.from("billing_catalogue_prices").upsert(row, { onConflict: "billing_environment,package_version_id,currency,interval,component" }).select("id").single();
      if (saved.error) throw saved.error;
      catalogue.push({ packageKey, currency, interval, amountMinor, productId: product.id, priceId: price.id });
    }
  }

  const websi = await db.from("accounts").select("id").eq("name", "Websi").eq("billing_environment", "live").maybeSingle();
  if (!websi.data) throw new Error("websi_account_required_for_test_owner");
  const ownerMembership = await db.from("account_memberships").select("user_id").eq("account_id", websi.data.id).eq("role", "owner").limit(1).maybeSingle();
  if (!ownerMembership.data?.user_id) throw new Error("websi_owner_required_for_test_accounts");
  const ownerUser = await db.auth.admin.getUserById(ownerMembership.data.user_id);
  const testRecipient = ownerUser.data.user?.email;
  if (!testRecipient) throw new Error("designated_test_recipient_required");
  const accountSpecs = [
    { key: "free", name: "Sandbox Free", assignment: "free" },
    { key: "essentials", name: "Sandbox Essentials", assignment: "essentials" },
    { key: "scale", name: "Sandbox Scale", assignment: "scale" },
    { key: "pro", name: "Sandbox Pro Checkout", assignment: "free" },
    { key: "complimentary_pro", name: "Sandbox Complimentary Pro", assignment: "free", complimentary: true },
  ];
  const accounts: any[] = [];
  for (const spec of accountSpecs) {
    let account = await db.from("accounts").select("id,name").eq("billing_environment", "test").eq("name", spec.name).maybeSingle();
    if (!account.data) {
      const created = await db.rpc("create_superadmin_test_account", { p_name: spec.name, p_owner: ownerMembership.data.user_id, p_test_recipients: [testRecipient] });
      if (created.error) throw created.error;
      account = { data: { id: (created.data as any).accountId, name: spec.name }, error: null } as any;
    }
    const accountId = account.data!.id;
    const targetVersion: any = spec.assignment === "free"
      ? (await db.from("package_versions").select("id,package_key").eq("package_key", "free").eq("state", "published").order("version", { ascending: false }).limit(1).single()).data
      : versionByKey.get(spec.assignment);
    if (!targetVersion?.id) throw new Error(`test_assignment_package_missing:${spec.assignment}`);
    await db.from("account_package_assignments").update({ package_version_id: targetVersion.id, billing_state: "unconfigured", complimentary: false }).eq("account_id", accountId).is("ends_at", null);
    await db.from("accounts").update({ entitlement: targetVersion.package_key }).eq("id", accountId);
    const workspace = await db.from("workspaces").select("id").eq("account_id", accountId).order("created_at").limit(1).single();
    if (workspace.data) {
      const host = `${spec.key.replaceAll("_", "-")}.sandbox.invalid`;
      await db.from("properties").upsert({ workspace_id: workspace.data.id, name: `${spec.name} Property`, url: `https://${host}/`, canonical_host: host, verification_status: "pending", tracking_id: `sandbox_${accountId.replaceAll("-", "")}`, tracking_enabled: false }, { onConflict: "tracking_id" });
    }
    if (spec.complimentary) {
      const historicPro = await db.from("package_versions").select("id").eq("package_key", "pro_early_access").eq("state", "published").order("version", { ascending: false }).limit(1).single();
      if (!historicPro.data) throw new Error("published_historic_pro_required");
      const grant = await db.rpc("apply_complimentary_package_grant_internal", { p_account_id: accountId, p_package_version_id: historicPro.data.id, p_expires_at: null, p_reason: "Isolated sandbox complimentary Pro acceptance fixture", p_overrides: { editingSeats: 3 }, p_actor: null });
      if (grant.error) throw grant.error;
    }
    accounts.push({ key: spec.key, id: accountId, name: spec.name, complimentary: Boolean(spec.complimentary) });
  }
  const configuration = await db.from("billing_environment_configurations").update({ checkout_enabled: true, tax_enabled: false, tax_reviewed_at: null, tax_reviewed_by: null, portal_configuration_id: provider.portalConfigurationId, webhook_configured: true, updated_at: new Date().toISOString() }).eq("environment", "test").select().single();
  if (configuration.error) throw configuration.error;
  const websiGrant = await db.from("account_package_grants").select("id,status,expires_at,accounts!inner(name)").eq("status", "active").eq("accounts.name", "Websi").maybeSingle();
  if (!websiGrant.data) throw new Error("websi_complimentary_grant_not_preserved");
  return { catalogue, accounts, configuration: configuration.data, websiComplimentaryGrantPreserved: true };
}

app.post("/webhooks/sandbox-acceptance-fixtures", async (c) => {
  const token = String(c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 40) return c.json({ error: "fixture_token_required" }, 401);
  const tokenHash = await sha256Hex(token);
  const db = admin(c.env);
  const run = await db.from("sandbox_acceptance_fixture_runs").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (!run.data || new Date(run.data.expires_at).getTime() <= Date.now()) return c.json({ error: "fixture_request_missing_or_expired" }, 403);
  if (run.data.state === "completed") return c.json({ runId: run.data.id, state: "completed", result: run.data.result, reused: true });
  if (run.data.state === "processing") return c.json({ runId: run.data.id, state: "processing" }, 409);
  const claimed = await db.from("sandbox_acceptance_fixture_runs").update({ state: "processing", started_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq("id", run.data.id).in("state", ["requested", "failed"]).select("id").maybeSingle();
  if (!claimed.data) return c.json({ error: "fixture_request_already_claimed" }, 409);
  try {
    const result = await provisionSandboxAcceptanceFixtures(c.env, run.data.id, run.data.request);
    await db.from("sandbox_acceptance_fixture_runs").update({ state: "completed", result, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.data.id);
    return c.json({ runId: run.data.id, state: "completed", result });
  } catch (error) {
    const detail = errorMessage(error).slice(0, 2000);
    await db.from("sandbox_acceptance_fixture_runs").update({ state: "failed", error: detail, updated_at: new Date().toISOString() }).eq("id", run.data.id);
    return c.json({ error: "sandbox_fixture_provisioning_failed", detail }, 503);
  }
});

app.post("/webhooks/sandbox-acceptance-scenarios", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "scenario_request_token_required" }, 401);
  const tokenHash = await sha256Hex(token);
  const db = admin(c.env);
  const run = await db.from("sandbox_acceptance_scenario_runs").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (!run.data || new Date(run.data.expires_at).getTime() <= Date.now()) return c.json({ error: "scenario_request_missing_or_expired" }, 403);
  if (run.data.state === "completed") return c.json({ runId: run.data.id, state: "completed", result: run.data.result, reused: true });
  if (run.data.state === "processing") return c.json({ runId: run.data.id, state: "processing" }, 409);
  const claimed = await db.from("sandbox_acceptance_scenario_runs").update({ state: "processing", started_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq("id", run.data.id).in("state", ["requested", "failed"]).select("id").maybeSingle();
  if (!claimed.data) return c.json({ error: "scenario_request_already_claimed" }, 409);
  try {
    const result = await provisionSandboxAcceptanceScenarios(c.env, run.data.id);
    await db.from("sandbox_acceptance_scenario_runs").update({ state: "completed", result, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.data.id);
    return c.json({ runId: run.data.id, state: "completed", result });
  } catch (error) {
    const detail = errorMessage(error).slice(0, 2000);
    await db.from("sandbox_acceptance_scenario_runs").update({ state: "failed", error: detail, updated_at: new Date().toISOString() }).eq("id", run.data.id);
    return c.json({ error: "sandbox_scenario_provisioning_failed", detail }, 503);
  }
});

app.post("/webhooks/sandbox-acceptance-refresh", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "scenario_request_token_required" }, 401);
  const tokenHash = await sha256Hex(token);
  const db = admin(c.env);
  const run = await db.from("sandbox_acceptance_scenario_runs").select("id,state,expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (!run.data || new Date(run.data.expires_at).getTime() <= Date.now() || run.data.state !== "completed") return c.json({ error: "completed_scenario_request_required" }, 403);
  const pending = await db.from("billing_events").select("id").eq("billing_environment", "test").neq("processing_state", "processed").neq("processing_state", "ignored").limit(500);
  for (const event of pending.data || []) await processBillingEvent(c.env, event.id);
  const customers = await db.from("billing_customers").select("account_id").eq("billing_environment", "test").not("provider_customer_id", "is", null).limit(1000);
  for (const customer of customers.data || []) await reconcileBillingAccount(c.env, customer.account_id, "webhook_repair");
  const finance = await refreshBillingFinanceEnvironment(c.env, "test");
  const [accounts, subscriptions, invoices, payments, refunds, events] = await Promise.all([
    db.from("accounts").select("id", { count: "exact", head: true }).eq("billing_environment", "test"),
    db.from("billing_subscriptions").select("provider_subscription_id", { count: "exact", head: true }).eq("billing_environment", "test"),
    db.from("billing_invoices").select("id", { count: "exact", head: true }).eq("billing_environment", "test"),
    db.from("billing_payments").select("id", { count: "exact", head: true }).eq("billing_environment", "test"),
    db.from("billing_refunds").select("id", { count: "exact", head: true }).eq("billing_environment", "test"),
    db.from("billing_events").select("id", { count: "exact", head: true }).eq("billing_environment", "test").eq("processing_state", "processed"),
  ]);
  return c.json({ environment: "test", livemode: false, runId: run.data.id, processedPendingEvents: pending.data?.length || 0, reconciledCustomers: customers.data?.length || 0, counts: { accounts: accounts.count || 0, subscriptions: subscriptions.count || 0, invoices: invoices.count || 0, payments: payments.count || 0, refunds: refunds.count || 0, processedEvents: events.count || 0 }, finance });
});

app.post("/webhooks/stripe/test", (c) => receiveStripeWebhook(c, "test"));
app.post("/webhooks/stripe/live", (c) => receiveStripeWebhook(c, "live"));
app.post("/webhooks/stripe", (c) => c.json({ error: "environment_specific_webhook_required", endpoints: ["/webhooks/stripe/test", "/webhooks/stripe/live"] }, 410));

app.use("/api/*", async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "authentication_required" }, 401);
  const db = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ error: "invalid_session" }, 401);
  const assurance = parseAuthAssurance(token);
  c.set("db", db);
  c.set("userId", data.user.id);
  c.set("userEmail", data.user.email || "");
  c.set("userEmailConfirmed", Boolean(data.user.email_confirmed_at));
  c.set("accessToken", token);
  c.set("authAal", assurance.aal);
  c.set("authSessionId", assurance.sessionId);
  c.set("delegation", null);
  const delegationId = c.req.header("x-claritude-delegation");
  if (delegationId && !c.req.path.startsWith("/api/superadmin")) {
    const service = admin(c.env);
    const { data: staff } = await service.from("staff_members").select("role,status").eq("user_id", data.user.id).maybeSingle();
    if (!staff || staff.status !== "active") return c.json({ error: "active_staff_membership_required" }, 403);
    const { data: delegation } = await service.from("delegation_sessions").select("*").eq("id", delegationId).eq("staff_user_id", data.user.id).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!delegation) return c.json({ error: "delegation_session_expired_or_revoked" }, 403);
    if (c.req.method !== "GET" && delegation.mode !== "write") return c.json({ error: "delegation_is_read_only" }, 403);
    const propertyMatch = c.req.path.match(/^\/api\/properties\/([^/]+)/);
    if (propertyMatch) {
      const { data: property } = await service.from("properties").select("id,workspaces(account_id)").eq("id", propertyMatch[1]).maybeSingle();
      if ((property?.workspaces as any)?.account_id !== delegation.account_id) return c.json({ error: "delegation_scope_violation" }, 403);
    }
    const workspaceMatch = c.req.path.match(/^\/api\/workspaces\/([^/]+)/);
    if (workspaceMatch) {
      const { data: workspace } = await service.from("workspaces").select("account_id").eq("id", workspaceMatch[1]).maybeSingle();
      if (workspace?.account_id !== delegation.account_id) return c.json({ error: "delegation_scope_violation" }, 403);
    }
    if (!/^\/api\/(bootstrap|account(?:\/|$)|properties\/|workspaces\/|notifications(?:\/|$))/.test(c.req.path)) return c.json({ error: "delegation_route_not_allowed" }, 403);
    c.set("db", service);
    c.set("userId", delegation.represented_user_id);
    c.set("delegation", delegation);
  }
  await next();
});

app.get("/api/bootstrap", async (c) => {
  const db = c.get("db");
  const delegation = c.get("delegation");
  if (delegation) {
    const service = admin(c.env);
    const [account, workspaces, memberships, profile, notifications, activity, accountServiceControls] = await Promise.all([
      service.from("accounts").select("*").eq("id", delegation.account_id).single(),
      service.from("workspaces").select("*").eq("account_id", delegation.account_id).order("created_at"),
      service.from("account_memberships").select("role").eq("account_id", delegation.account_id).eq("user_id", delegation.represented_user_id).single(),
      service.from("profiles").select("*").eq("id", delegation.represented_user_id).maybeSingle(),
      service.from("notifications").select("*").eq("account_id", delegation.account_id).eq("user_id", delegation.represented_user_id).order("created_at", { ascending: false }).limit(50),
      service.from("activity_log").select("*").eq("account_id", delegation.account_id).order("created_at", { ascending: false }).limit(100),
      service.from("account_service_controls").select("account_id,service,paused,reason,changed_at").eq("account_id", delegation.account_id).eq("paused", true),
    ]);
    const workspaceRows = workspaces.data || [];
    const workspaceIds = workspaceRows.map((item) => item.id);
    const properties = workspaceIds.length ? await service.from("properties").select("*,uptime_monitors(*),audit_runs(id,status,score,coverage,created_at)").in("workspace_id", workspaceIds).order("created_at") : { data: [], error: null };
    const propertyIds = (properties.data || []).map((item: any) => item.id);
    const incidents = propertyIds.length ? await service.from("incidents").select("*").in("property_id", propertyIds).order("opened_at", { ascending: false }).limit(50) : { data: [], error: null };
    return c.json({ superadmin: true, staff: null, delegated: { ...delegation, actorUserId: delegation.staff_user_id }, profile: profile.data, accounts: [{ role: memberships.data?.role || delegation.represented_role, accounts: account.data }], accountEntitlements: { [delegation.account_id]: await effectiveEntitlements(c.env, delegation.account_id) }, accountServiceControls: accountServiceControls.data || [], workspaces: workspaceRows.map((item) => ({ role: memberships.data?.role || delegation.represented_role, workspaces: item })), properties: normalizePropertyRelations(properties.data || []), incidents: incidents.data || [], notifications: notifications.data || [], activity: activity.data || [], propertyMemberships: [] });
  }
  const staff = await requestStaffAccess(c);
  const superadmin = staff?.status === "active";
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
  const accessibleAccountIds = [...new Set((accounts.data || []).map((membership: any) => membership.accounts?.id).filter(Boolean))] as string[];
  const accountEntitlements = Object.fromEntries(await Promise.all(accessibleAccountIds.map(async (accountId) => {
    try { return [accountId, await effectiveEntitlements(c.env, accountId)]; }
    catch { return [accountId, null]; }
  })));
  const [billingMemberships, accountServiceControls] = await Promise.all([
    admin(c.env).from("account_billing_memberships").select("account_id,can_view,can_manage,created_at").eq("user_id", c.get("userId")),
    accessibleAccountIds.length ? admin(c.env).from("account_service_controls").select("account_id,service,paused,reason,changed_at").in("account_id", accessibleAccountIds).eq("paused", true) : Promise.resolve({ data: [], error: null }),
  ]);
  return c.json({
    superadmin,
    staff: staff ? {
      role: staff.role,
      status: staff.status,
      displayName: staff.displayName,
      permissions: staff.permissions,
      aal: c.get("authAal"),
    } : null,
    profile: profile.data,
    accounts: accounts.data,
    accountEntitlements,
    accountServiceControls: accountServiceControls.data || [],
    billingMemberships: billingMemberships.data || [],
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
  if (error) return c.json({ error: error.message }, 400);
  const propertyId = String((data as any)?.propertyId || "");
  if (propertyId) {
    const service = admin(c.env);
    const { data: monitor, error: monitorError } = await service
      .from("uptime_monitors")
      .select("id")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (monitorError) console.error("onboarding_monitor_lookup_failed", monitorError);
    else if (monitor?.id) {
      try { await c.env.JOBS.send({ type: "uptime", id: monitor.id }); }
      catch (queueError) {
        // The due monitor remains eligible for the scheduled dispatcher, so a
        // transient queue failure must not undo otherwise-complete onboarding.
        console.error("onboarding_initial_uptime_queue_failed", errorMessage(queueError));
      }
    }
    await createPropertyNotification(c.env, propertyId, {
      category: "tracking_problems",
      title: "Tracking script not installed",
      body: "Install the tracking snippet, clear site or CDN caches, then verify the public page.",
      severity: "warning",
      dedupeKey: `tracking-install:${propertyId}`,
    }).catch((notificationError) => {
      console.error("onboarding_notification_failed", {
        propertyId,
        error: errorMessage(notificationError),
      });
    });
  }
  return c.json(data);
});

app.post("/api/accounts/:id/reactivate", async (c) => {
  const accountId = c.req.param("id");
  const db = c.get("db");
  const { data: membership } = await db.from("account_memberships").select("role").eq("account_id", accountId).eq("user_id", c.get("userId")).maybeSingle();
  if (membership?.role !== "owner") return c.json({ error: "account_owner_access_required" }, 403);
  const service = admin(c.env);
  const { data: account } = await service.from("accounts").select("access_state").eq("id", accountId).maybeSingle();
  if (!account || !["frozen", "pending_deletion"].includes(account.access_state)) return c.json({ error: "account_is_not_reactivatable" }, 409);
  const now = new Date().toISOString();
  const { error } = await service.from("accounts").update({ access_state: "active", access_state_reason: "Owner explicitly reactivated the account", access_state_changed_at: now, scheduled_deletion_at: null }).eq("id", accountId);
  if (error) return c.json({ error: error.message }, 400);
  await service.from("account_inactivity").update({ state: "active", last_meaningful_activity_at: now, notice_delivery_failed: false, analytics_review_required: false, updated_at: now }).eq("account_id", accountId);
  await recordActivity(c.env, c.get("userId"), "account.reactivated", undefined, { accountId });
  return c.json({ reactivated: true, allowancesReset: false });
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
  let entitlements;
  try { entitlements = await effectiveEntitlements(c.env, accountId); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
  const configuredUptimeValue = entitlements.values.uptimeIntervalMinutes;
  const configuredUptimeInterval = typeof configuredUptimeValue === "number" ? configuredUptimeValue : NaN;
  const uptimeInterval = Number.isSafeInteger(configuredUptimeInterval)
    ? configuredUptimeInterval
    : uptimeMinimumInterval(entitlements.packageKey);
  const trackingId = `cl_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data: created, error: createError } = await db.rpc("create_property_atomic", {
    p_account_id: accountId,
    p_workspace_id: b.workspaceId,
    p_name: name,
    p_url: target.href,
    p_canonical_host: canonicalHost,
    p_tracking_id: trackingId,
    p_uptime_interval: uptimeInterval,
  });
  if (createError || !created?.property || !created?.monitorId) {
    const message = createError?.message || "property_create_failed";
    console.error("property_create_atomic_failed", {
      code: createError?.code,
      message,
      workspaceId: b.workspaceId,
      userId: c.get("userId"),
    });
    const mapped = propertyCreateError(message);
    return c.json({ error: mapped.error }, mapped.status);
  }
  try {
    await c.env.JOBS.send({ type: "uptime", id: created.monitorId });
  } catch (queueError) {
    // Creation is already complete. The scheduled uptime dispatcher will pick
    // up this due monitor, so a transient queue failure must not be reported as
    // a failed property creation.
    console.error("property_create_initial_uptime_queue_failed", {
      propertyId: created.property.id,
      monitorId: created.monitorId,
      error: queueError instanceof Error ? queueError.message : String(queueError),
    });
  }
  await createPropertyNotification(c.env, created.property.id, {
    category: "tracking_problems",
    title: "Tracking script not installed",
    body: "Install the tracking snippet, clear site or CDN caches, then verify the public page.",
    severity: "warning",
    dedupeKey: `tracking-install:${created.property.id}`,
  }).catch((notificationError) => {
    console.error("property_create_notification_failed", {
      propertyId: created.property.id,
      error: errorMessage(notificationError),
    });
  });
  return c.json(created.property, 201);
});

app.patch("/api/properties/:id", async (c) => {
  const body = await c.req.json<{ name?: string; workspace_id?: string; settings?: Record<string, unknown> }>();
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
  let workspaceId: string | undefined;
  if (body.workspace_id) {
    const { data: currentProperty } = await db
      .from("properties")
      .select("workspace_id,workspaces(account_id)")
      .eq("id", c.req.param("id"))
      .single();
    const { data: targetWorkspace } = await db
      .from("workspaces")
      .select("id,account_id")
      .eq("id", body.workspace_id)
      .single();
    const currentAccountId = (currentProperty as any)?.workspaces?.account_id;
    if (!currentProperty || !targetWorkspace) return c.json({ error: "workspace_not_found" }, 404);
    if (targetWorkspace.account_id !== currentAccountId)
      return c.json({ error: "workspace_account_mismatch" }, 400);
    if (!(await canManageWorkspace(db, c.get("userId"), currentProperty.workspace_id)) ||
        !(await canManageWorkspace(db, c.get("userId"), targetWorkspace.id)))
      return c.json({ error: "workspace_manage_access_required" }, 403);
    workspaceId = targetWorkspace.id;
  }
  const { data, error } = await db
    .from("properties")
    .update({
      name,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
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
    date_format?: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
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
    ...(body.date_format !== undefined
      ? { date_format: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(body.date_format) ? body.date_format : "DD/MM/YYYY" }
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
  return error
    ? c.json({ error: error.message }, error.message.includes("workspace_limit_reached") ? 409 : 400)
    : c.json(data, 201);
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
      confirmedAt: users.find((user) => user.id === member.user_id)?.confirmedAt || null,
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

app.get("/api/properties/:id/export", async (c) => {
  const propertyId = c.req.param("id");
  const db = c.get("db");
  const [property, monitors, incidents, analytics, definitions, audits, reports, schedules, viewers] = await Promise.all([
    db.from("properties").select("*").eq("id", propertyId).single(),
    db.from("uptime_monitors").select("*,uptime_checks(*)").eq("property_id", propertyId),
    db.from("incidents").select("*").eq("property_id", propertyId).order("opened_at", { ascending: false }),
    db.from("analytics_events").select("*").eq("property_id", propertyId).order("occurred_at", { ascending: false }).limit(50000),
    db.from("event_definitions").select("*").eq("property_id", propertyId),
    db.from("audit_runs").select("*,audit_results(*)").eq("property_id", propertyId).order("created_at", { ascending: false }),
    db.from("saved_reports").select("*").eq("property_id", propertyId),
    db.from("report_schedules").select("*").eq("property_id", propertyId),
    db.from("property_memberships").select("user_id,role,created_at").eq("property_id", propertyId),
  ]);
  const firstError = [property, monitors, incidents, analytics, definitions, audits, reports, schedules, viewers].find((response) => response.error)?.error;
  if (firstError) return c.json({ error: firstError.message }, 400);
  return c.json({
    exportedAt: new Date().toISOString(),
    property: property.data,
    uptime: { monitors: monitors.data, incidents: incidents.data },
    analytics: { events: analytics.data, definitions: definitions.data },
    audits: audits.data,
    reports: reports.data,
    reportSchedules: schedules.data,
    propertyViewers: viewers.data,
  });
});

app.get("/api/superadmin/bootstrap", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;

  const service = admin(c.env);
  const selectedBillingEnvironment = c.req.query("billingEnvironment") || "live";
  if (!["test", "live"].includes(selectedBillingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const [
    accountResult,
    workspaceResult,
    propertyResult,
    membershipResult,
    profileResult,
    monitorResult,
    activeMonitorResult,
    offlineMonitorResult,
    openIncidentResult,
    auditTodayResult,
    userResult,
    packageAssignmentResult,
    packageGrantResult,
  ] = await Promise.all([
    service.from("accounts").select("id,name,entitlement,created_at,billing_environment,is_test_account,test_notification_recipients", { count: "exact" }).eq("billing_environment", selectedBillingEnvironment).order("created_at", { ascending: false }).limit(500),
    service.from("workspaces").select("id,account_id,name,created_at", { count: "exact" }).limit(2000),
    service.from("properties").select("id,workspace_id,name,canonical_host,verification_status,tracking_last_received_at,created_at", { count: "exact" }).limit(5000),
    service.from("account_memberships").select("account_id,user_id,role,created_at").limit(5000),
    service.from("profiles").select("id,full_name,created_at").limit(5000),
    service.from("uptime_monitors").select("property_id,enabled,last_status,last_checked_at").limit(5000),
    service.from("uptime_monitors").select("id", { count: "exact", head: true }).eq("enabled", true),
    service.from("uptime_monitors").select("id", { count: "exact", head: true }).eq("enabled", true).eq("last_status", "offline"),
    service.from("incidents").select("id", { count: "exact", head: true }).is("resolved_at", null),
    service.from("audit_runs").select("id", { count: "exact", head: true }).gte("created_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    service.from("account_package_assignments").select("account_id,billing_state,package_versions(package_key,display_name,version)").is("ends_at", null).limit(1000),
    service.from("account_package_grants").select("account_id,arrangement,status,expires_at,package_versions(package_key,display_name,version)").eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).limit(1000),
  ]);
  const databaseError = [
    accountResult,
    workspaceResult,
    propertyResult,
    membershipResult,
    profileResult,
    monitorResult,
    activeMonitorResult,
    offlineMonitorResult,
    openIncidentResult,
    auditTodayResult,
    packageAssignmentResult,
    packageGrantResult,
  ].find((result) => result.error)?.error;
  if (databaseError || userResult.error) {
    console.error("superadmin_bootstrap_failed", databaseError || userResult.error);
    return c.json({ error: "superadmin_dashboard_unavailable" }, 503);
  }

  const accounts = accountResult.data || [];
  const accountIds = new Set(accounts.map((account) => account.id));
  const workspaces = (workspaceResult.data || []).filter((workspace) => accountIds.has(workspace.account_id));
  const workspaceIdSet = new Set(workspaces.map((workspace) => workspace.id));
  const properties = (propertyResult.data || []).filter((property) => workspaceIdSet.has(property.workspace_id));
  const memberships = (membershipResult.data || []).filter((membership) => accountIds.has(membership.account_id));
  const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile]));
  const monitors = monitorResult.data || [];
  const workspaceIdsByAccount = new Map<string, Set<string>>();
  for (const workspace of workspaces) {
    const ids = workspaceIdsByAccount.get(workspace.account_id) || new Set<string>();
    ids.add(workspace.id);
    workspaceIdsByAccount.set(workspace.account_id, ids);
  }
  const propertyIdsByAccount = new Map<string, Set<string>>();
  for (const account of accounts) {
    const workspaceIds = workspaceIdsByAccount.get(account.id) || new Set<string>();
    propertyIdsByAccount.set(
      account.id,
      new Set(properties.filter((property) => workspaceIds.has(property.workspace_id)).map((property) => property.id)),
    );
  }
  const users = userResult.data.users || [];
  const userTotal = Number((userResult.data as any).total ?? users.length);

  return c.json({
    stats: {
      accounts: accountResult.count ?? accounts.length,
      workspaces: workspaces.length,
      properties: properties.length,
      users: new Set(memberships.map((membership) => membership.user_id)).size,
      activeMonitors: activeMonitorResult.count || 0,
      offlineMonitors: offlineMonitorResult.count || 0,
      openIncidents: openIncidentResult.count || 0,
      auditsToday: auditTodayResult.count || 0,
    },
    accounts: accounts.map((account) => {
      const workspaceIds = workspaceIdsByAccount.get(account.id) || new Set<string>();
      const propertyIds = propertyIdsByAccount.get(account.id) || new Set<string>();
      const packageGrant = (packageGrantResult.data || []).find((item) => item.account_id === account.id);
      const packageAssignment = (packageAssignmentResult.data || []).find((item) => item.account_id === account.id);
      const packageVersion = (packageGrant?.package_versions || packageAssignment?.package_versions) as any;
      return {
        ...account,
        effectivePackageKey: packageVersion?.package_key || account.entitlement,
        effectivePackageName: packageVersion?.display_name || String(account.entitlement).replaceAll("_", " "),
        billingArrangement: packageGrant?.arrangement || "standard",
        workspaceCount: workspaceIds.size,
        propertyCount: propertyIds.size,
        userCount: new Set(memberships.filter((membership) => membership.account_id === account.id).map((membership) => membership.user_id)).size,
        offlineCount: monitors.filter((monitor) => propertyIds.has(monitor.property_id) && monitor.enabled && monitor.last_status === "offline").length,
      };
    }),
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      propertyCount: properties.filter((property) => property.workspace_id === workspace.id).length,
    })),
    properties: properties.map((property) => ({
      ...property,
      accountId: accounts.find((account) => workspaceIdsByAccount.get(account.id)?.has(property.workspace_id))?.id || null,
      monitor: monitors.find((monitor) => monitor.property_id === property.id) || null,
    })),
    users: users.map((user) => ({
      id: user.id,
      email: user.email || "",
      name: profiles.get(user.id)?.full_name || "",
      confirmedAt: user.email_confirmed_at || null,
      lastSignInAt: user.last_sign_in_at || null,
      createdAt: user.created_at,
      accountCount: new Set(memberships.filter((membership) => membership.user_id === user.id).map((membership) => membership.account_id)).size,
      accountIds: [...new Set(memberships.filter((membership) => membership.user_id === user.id).map((membership) => membership.account_id))],
      roles: [...new Set(memberships.filter((membership) => membership.user_id === user.id).map((membership) => membership.role))],
    })),
  });
});

app.get("/api/superadmin/overview", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  const billingEnvironment = c.req.query("billingEnvironment") || "live";
  if (!['test', 'live'].includes(billingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 29 * 86400_000);
  const fromText = c.req.query("from") || defaultFrom.toISOString().slice(0, 10);
  const toText = c.req.query("to") || now.toISOString().slice(0, 10);
  const fromMs = Date.parse(`${fromText}T00:00:00.000Z`);
  const toMs = Date.parse(`${toText}T23:59:59.999Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText) || !/^\d{4}-\d{2}-\d{2}$/.test(toText) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs || toMs - fromMs > 3650 * 86400_000) {
    return c.json({ error: "valid_overview_date_range_required" }, 400);
  }
  const service = admin(c.env);
  const rangeFrom = new Date(fromMs).toISOString();
  const rangeTo = new Date(toMs).toISOString();
  const [accountsResult, assignmentsResult, grantsResult, subscriptionsResult, databaseResult, settingsResult, countersResult, snapshotsResult] = await Promise.all([
    service.from("accounts").select("id,entitlement,access_state,created_at,is_test_account,billing_environment").eq("billing_environment", billingEnvironment).lte("created_at", rangeTo).limit(10000),
    service.from("account_package_assignments").select("account_id,billing_state,complimentary,starts_at,ends_at,package_versions(package_key)").limit(10000),
    service.from("account_package_grants").select("account_id,arrangement,status,starts_at,expires_at,package_versions(package_key)").limit(10000),
    service.from("billing_subscriptions").select("account_id,status,mrr_minor,provider_created_at,trial_end,cancelled_at,ended_at").eq("billing_environment", billingEnvironment).limit(10000),
    service.rpc("superadmin_database_metrics"),
    service.from("platform_settings").select("key,value").in("key", ["safety_limits", "retention_policy"]),
    service.from("processing_daily_counters").select("day,metric,value").gte("day", fromText).lte("day", toText).limit(5000),
    service.from("superadmin_overview_daily_snapshots").select("day,accounts,properties,workload,infrastructure,measured_at,source").eq("billing_environment", billingEnvironment).gte("day", fromText).lte("day", toText).order("day").limit(4000),
  ]);
  const requiredError = [accountsResult, assignmentsResult, grantsResult, subscriptionsResult, settingsResult, countersResult, snapshotsResult].find((result) => result.error)?.error;
  if (requiredError) {
    console.error("superadmin_overview_base_failed", requiredError);
    return c.json({ error: "superadmin_overview_unavailable" }, 503);
  }
  const accounts = accountsResult.data || [];
  const accountIds = new Set(accounts.map((item: any) => item.id));
  const accountIdList = [...accountIds];
  const [propertiesResult, workspacesResult, activityResult] = await Promise.all([
    accountIdList.length ? service.from("properties").select("id,account_id,workspace_id,access_state,tracking_enabled,tracking_last_received_at,created_at").in("account_id", accountIdList).lte("created_at", rangeTo).limit(20000) : Promise.resolve({ data: [], error: null }),
    accountIdList.length ? service.from("workspaces").select("id,account_id,created_at").in("account_id", accountIdList).lte("created_at", rangeTo).limit(10000) : Promise.resolve({ data: [], error: null }),
    service.rpc("superadmin_overview_activity", { p_billing_environment: billingEnvironment, p_from: fromText, p_to: toText }),
  ]);
  const resourceError = propertiesResult.error || workspacesResult.error;
  if (resourceError) {
    console.error("superadmin_overview_resources_failed", resourceError);
    return c.json({ error: "superadmin_overview_resources_unavailable" }, 503);
  }
  if (activityResult.error) {
    console.error("superadmin_overview_activity_rollup_failed", activityResult.error);
    return c.json({ error: "superadmin_overview_activity_unavailable", source: "postgres_aggregated" }, 503);
  }
  const properties = propertiesResult.data || [];
  const propertyIds = new Set(properties.map((item: any) => item.id));
  const propertyIdList = [...propertyIds];
  const monitorsResult = propertyIdList.length
    ? await service.from("uptime_monitors").select("id,property_id,enabled,last_status,last_checked_at").in("property_id", propertyIdList).limit(20000)
    : { data: [], error: null };
  if (monitorsResult.error) {
    console.error("superadmin_overview_monitors_failed", monitorsResult.error);
    return c.json({ error: "superadmin_overview_monitors_unavailable" }, 503);
  }
  const monitors = monitorsResult.data || [];
  const enabledMonitorPropertyIds = new Set(monitors.filter((item: any) => item.enabled).map((item: any) => item.property_id));
  const activeSubscriptions = (subscriptionsResult.data || []).filter((item: any) => ["active", "trialing", "past_due", "unpaid"].includes(item.status));
  const activeGrants = (grantsResult.data || []).filter((item: any) => accountIds.has(item.account_id) && item.status === "active" && Date.parse(item.starts_at) <= now.getTime() && (!item.expires_at || Date.parse(item.expires_at) > now.getTime()));
  const assignments = (assignmentsResult.data || []).filter((item: any) => accountIds.has(item.account_id) && (!item.ends_at || Date.parse(item.ends_at) > now.getTime()));
  const payingIds = new Set(activeSubscriptions.filter((item: any) => item.status !== "trialing").map((item: any) => item.account_id));
  const trialIds = new Set(activeSubscriptions.filter((item: any) => item.status === "trialing").map((item: any) => item.account_id));
  const delinquentIds = new Set(activeSubscriptions.filter((item: any) => ["past_due", "unpaid"].includes(item.status)).map((item: any) => item.account_id));
  const complimentaryIds = new Set(activeGrants.filter((item: any) => item.arrangement === "complimentary").map((item: any) => item.account_id));
  const freeIds = new Set(assignments.filter((item: any) => (item.package_versions as any)?.package_key === "free").map((item: any) => item.account_id));
  const accountSnapshot = {
    total: accounts.length,
    active: accounts.filter((item: any) => item.access_state === "active").length,
    free: [...freeIds].filter((id) => !payingIds.has(id) && !complimentaryIds.has(id)).length,
    paying: payingIds.size,
    complimentary: complimentaryIds.size,
    trial: trialIds.size,
    delinquent: delinquentIds.size,
    test: accounts.filter((item: any) => item.is_test_account).length,
  };
  const propertySnapshot = {
    total: properties.length,
    active: properties.filter((item: any) => item.access_state === "active" && (item.tracking_enabled || enabledMonitorPropertyIds.has(item.id))).length,
    monitored: enabledMonitorPropertyIds.size,
    analyticsEnabled: properties.filter((item: any) => item.tracking_enabled).length,
    inactive: properties.filter((item: any) => item.access_state !== "active").length,
  };
  const today = now.toISOString().slice(0, 10);
  const dayRows = new Map<string, any>();
  for (let cursor = Date.parse(`${fromText}T00:00:00.000Z`); cursor <= Date.parse(`${toText}T00:00:00.000Z`); cursor += 86400_000) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    dayRows.set(day, { day, accounts: null, properties: null, workload: { audits: 0, auditsCompleted: 0, auditsFailed: 0, auditsPartial: 0, auditEvaluations: 0, analyticsEvents: 0, analyticsPageviews: 0, analyticsSessions: 0, uptimeChecks: 0, uptimePassed: 0, uptimeFailed: 0, incidents: 0, reports: 0, notifications: 0, queueJobs: null, queueFailures: null, queueRetries: null }, infrastructure: null, sources: [] });
  }
  for (const snapshot of snapshotsResult.data || []) dayRows.set(snapshot.day, { ...(dayRows.get(snapshot.day) || { day: snapshot.day }), accounts: snapshot.accounts, properties: snapshot.properties, workload: { ...(dayRows.get(snapshot.day)?.workload || {}), ...(snapshot.workload || {}) }, infrastructure: snapshot.infrastructure, sources: [snapshot.source] });
  const activity = (activityResult.data || {}) as any;
  for (const daily of activity.days || []) {
    const row = dayRows.get(String(daily.day));
    if (row) dayRows.set(String(daily.day), { ...row, workload: { ...row.workload, ...(daily.workload || {}) }, sources: [...new Set([...(row.sources || []), activity.source || "postgres_aggregated"])] });
  }
  for (const counter of countersResult.data || []) { const row = dayRows.get(counter.day); if (row) row.workload[counter.metric] = Number(counter.value || 0); }
  const infrastructure = databaseResult.error ? { state: "unavailable", reason: "postgres_metrics_unavailable" } : { ...(databaseResult.data || {}), state: "measured" };
  const workloadToday = dayRows.get(today)?.workload || { audits: 0, auditsCompleted: 0, auditsFailed: 0, auditsPartial: 0, auditEvaluations: 0, analyticsEvents: 0, analyticsPageviews: 0, analyticsSessions: 0, uptimeChecks: 0, uptimePassed: 0, uptimeFailed: 0, incidents: 0, reports: 0, notifications: 0, queueJobs: null, queueFailures: null, queueRetries: null };
  if (dayRows.has(today)) {
    const snapshot = { billing_environment: billingEnvironment, day: today, accounts: accountSnapshot, properties: propertySnapshot, workload: workloadToday, infrastructure, measured_at: now.toISOString(), source: databaseResult.error ? "application_measured" : "postgres_reported" };
    const stored = await service.from("superadmin_overview_daily_snapshots").upsert(snapshot, { onConflict: "billing_environment,day" });
    if (!stored.error) dayRows.set(today, { ...dayRows.get(today), ...snapshot, sources: [snapshot.source] });
  }
  const limits = Object.fromEntries((settingsResult.data || []).map((item: any) => [item.key, item.value]));
  const operational = activity.operational || [];
  return c.json({
    billingEnvironment,
    range: { from: fromText, to: toText, maximumDays: 3651 },
    current: { accounts: accountSnapshot, properties: propertySnapshot, workload: workloadToday, infrastructure },
    history: [...dayRows.values()],
    capacity: { limits, operational, leases: { runningAudits: Number((countersResult.data || []).find((item: any) => item.day === today && item.metric === "running_audits")?.value || 0) } },
    provenance: {
      accountHistory: "Daily account-category history begins when measured snapshots are recorded; missing earlier category values are shown as unavailable, not backfilled.",
      activity: "PostgreSQL aggregates authoritative application records by UTC day within the selected billing environment; source rows are not truncated in transit.",
      infrastructure: databaseResult.error ? "PostgreSQL provider measurements unavailable." : "Current PostgreSQL-reported measurements; daily history begins with stored snapshots.",
      properties: "Active properties have active resource access and at least one enabled application service: analytics tracking or uptime monitoring.",
      uptimeChecks: "Persisted uptime_checks records grouped by checked_at UTC day.",
    },
  });
});

app.get("/api/superadmin/allocations", async (c) => {
  const authorization = await requireStaff(c, "packages.read");
  if (authorization.response) return authorization.response;
  const billingEnvironment = c.req.query("billingEnvironment") as BillingEnvironment;
  if (!["test", "live"].includes(billingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const db = admin(c.env);
  const now = new Date().toISOString();
  const accountsResult = await db.from("accounts").select("id,name,billing_environment,is_test_account").eq("billing_environment", billingEnvironment).order("name").limit(5000);
  if (accountsResult.error) return c.json({ error: "allocation_accounts_unavailable" }, 503);
  const accounts = accountsResult.data || [];
  const accountIds = accounts.map((account) => account.id);
  if (!accountIds.length) return c.json({ billingEnvironment, accounts: [], measuredAt: now, source: "effective_package_configuration_and_usage_ledgers" });
  const monthStart = `${now.slice(0, 7)}-01`;
  const [assignments, grants, overrides, properties, workspaces, memberships, usage, storage, analyticsUsage] = await Promise.all([
    db.from("account_package_assignments").select("account_id,price_grandfathered,allowances_grandfathered,complimentary,billing_state,starts_at,ends_at,package_versions(package_key,version,display_name,allowances,features,retention,hard_ceilings)").in("account_id", accountIds).is("ends_at", null),
    db.from("account_package_grants").select("id,account_id,arrangement,status,starts_at,expires_at,package_versions(package_key,version,display_name,allowances,features,retention,hard_ceilings)").in("account_id", accountIds).eq("status", "active").lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`),
    db.from("account_entitlement_overrides").select("account_id,key,value,starts_at,expires_at,grant_id").in("account_id", accountIds).is("revoked_at", null).lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`),
    db.from("properties").select("id,account_id").in("account_id", accountIds),
    db.from("workspaces").select("id,account_id").in("account_id", accountIds),
    db.from("account_memberships").select("account_id,user_id,role").in("account_id", accountIds),
    db.from("account_usage_periods").select("account_id,metric,period_start,period_end,consumed,reserved,restored,updated_at").in("account_id", accountIds).lte("period_start", now).gt("period_end", now),
    db.from("analytics_storage_snapshots").select("account_id,total_bytes,detailed_bytes,rollup_bytes,measured_at,source").eq("snapshot_date", now.slice(0, 10)).eq("scope_type", "account").in("account_id", accountIds),
    db.from("account_analytics_monthly_usage").select("account_id,accepted_pageviews,rejected_pageviews,period_start,updated_at").eq("period_start", monthStart).in("account_id", accountIds),
  ]);
  const propertyIds = (properties.data || []).map((item: any) => item.id);
  const [analyticsTotals, eventDefinitions, alertRecipients] = propertyIds.length ? await Promise.all([
    db.from("analytics_compact_totals").select("property_id,pageviews,events,sessions,period_start").eq("grain", "day").gte("period_start", monthStart).in("property_id", propertyIds),
    db.from("event_definitions").select("property_id,id,enabled").in("property_id", propertyIds),
    db.from("alert_recipients").select("property_id,id,enabled").in("property_id", propertyIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const dataError = [assignments, grants, overrides, properties, workspaces, memberships, usage, storage, analyticsUsage, analyticsTotals, eventDefinitions, alertRecipients].find((result) => result.error)?.error;
  if (dataError) {
    console.error("superadmin_allocations_failed", dataError);
    return c.json({ error: "superadmin_allocations_unavailable" }, 503);
  }
  const rows = accounts.map((account) => {
    const grant = (grants.data || []).find((item: any) => item.account_id === account.id);
    const assignment = (assignments.data || []).find((item: any) => item.account_id === account.id);
    const version = (grant?.package_versions || assignment?.package_versions) as any;
    const effective = resolveEffectiveEntitlements({ packageKey: version?.package_key || "free", version: Number(version?.version || 0), allowances: version?.allowances || {}, features: version?.features || {}, retention: version?.retention || {}, hardCeilings: version?.hard_ceilings || {} }, (overrides.data || []).filter((item: any) => item.account_id === account.id).map((item: any) => ({ key: item.key, value: item.value })));
    const usagePeriod = (usage.data || []).filter((item: any) => item.account_id === account.id);
    const storageSnapshot = (storage.data || []).find((item: any) => item.account_id === account.id) || null;
    const accountProperties = (properties.data || []).filter((item: any) => item.account_id === account.id);
    const accountPropertyIds = new Set(accountProperties.map((item: any) => item.id));
    const pageviewUsage = (analyticsUsage.data || []).find((item: any) => item.account_id === account.id);
    const monthlyAnalytics = (analyticsTotals.data || []).filter((item: any) => accountPropertyIds.has(item.property_id));
    const chartWorkspaceLimit = effective.values.workspacesPerAccount ?? effective.hardCeilings.workspacesPerAccount ?? (effective.packageKey === "pro" || effective.packageKey === "pro_early_access" ? 200 : effective.packageKey === "scale" ? 50 : null);
    return {
      accountId: account.id,
      accountName: account.name,
      billingEnvironment,
      packageKey: effective.packageKey,
      packageName: version?.display_name || String(effective.packageKey).replaceAll("_", " "),
      packageVersion: effective.version,
      billingArrangement: grant?.arrangement || "standard",
      grandfathered: Boolean(assignment?.allowances_grandfathered || assignment?.price_grandfathered),
      overrideCount: (overrides.data || []).filter((item: any) => item.account_id === account.id).length,
      allocations: {
        properties: effective.values.propertiesPerAccount ?? effective.hardCeilings.propertiesPerAccount ?? null,
        workspaces: chartWorkspaceLimit,
        editingSeats: effective.values.editingSeats ?? null,
        auditCreditsPerWeek: effective.values.auditCreditsPerWeek ?? null,
        trackedPageviewsPerMonth: effective.values.trackedPageviewsPerMonth ?? effective.hardCeilings.trackedPageviewsPerMonth ?? null,
        analyticsEventsPerMonth: effective.values.analyticsEventsPerMonth ?? null,
        customEventsPerProperty: effective.values.customEventsPerProperty ?? null,
        auditPagesPerProperty: effective.values.auditPagesPerProperty ?? null,
        alertContacts: effective.values.alertContacts ?? effective.values.emailAlertLimit ?? null,
      },
      utilisation: {
        properties: accountProperties.length,
        workspaces: (workspaces.data || []).filter((item: any) => item.account_id === account.id).length,
        editingSeats: new Set((memberships.data || []).filter((item: any) => item.account_id === account.id).map((item: any) => item.user_id)).size,
        auditCreditsPerWeek: usagePeriod.filter((item: any) => item.metric === "page_audit_credit").reduce((sum: number, item: any) => sum + Number(item.consumed || 0) + Number(item.reserved || 0) - Number(item.restored || 0), 0),
        trackedPageviewsPerMonth: Number(pageviewUsage?.accepted_pageviews || 0),
        analyticsEventsPerMonth: monthlyAnalytics.reduce((sum: number, item: any) => sum + Number(item.events || 0), 0),
        customEventsPerProperty: Math.max(0, ...[...accountPropertyIds].map((propertyId) => (eventDefinitions.data || []).filter((item: any) => item.property_id === propertyId && item.enabled).length)),
        auditPagesPerProperty: usagePeriod.some((item: any) => item.metric === "page_audit_credit" && Number(item.consumed || 0) > 0) ? 1 : 0,
        alertContacts: Math.max(0, ...[...accountPropertyIds].map((propertyId) => (alertRecipients.data || []).filter((item: any) => item.property_id === propertyId && item.enabled).length)),
        databaseBytes: storageSnapshot?.total_bytes == null ? null : Number(storageSnapshot.total_bytes),
      },
      databaseStorage: storageSnapshot,
      usagePeriods: usagePeriod,
    };
  });
  return c.json({ billingEnvironment, accounts: rows, measuredAt: now, source: "effective_package_configuration_and_usage_ledgers" });
});

app.post("/api/superadmin/test-accounts", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  if (!staffRoleCan(authorization.staff!.role, "financials.write")) return c.json({ error: "financials_write_permission_required" }, 403);
  const body = await c.req.json<{ name?: string; testRecipients?: string[]; reason?: string }>().catch(() => ({} as any));
  const name = String(body.name || "").trim();
  const reason = String(body.reason || "").trim();
  const testRecipients = [...new Set((body.testRecipients || []).map((value: string) => String(value).trim().toLowerCase()).filter(Boolean))];
  if (name.length < 2 || name.length > 100 || reason.length < 3 || reason.length > 500 || !testRecipients.length) return c.json({ error: "name_test_recipient_and_reason_required" }, 400);
  const created = await admin(c.env).rpc("create_superadmin_test_account", { p_name: name, p_owner: authorization.staff!.userId, p_test_recipients: testRecipients });
  if (created.error) return c.json({ error: "test_account_creation_failed", detail: created.error.message }, 400);
  const accountId = (created.data as any)?.accountId;
  await recordAdminActivity(c.env, authorization.staff!.userId, "test_account.created", "success", { targetType: "account", targetId: accountId, accountId, reason, newValues: { billingEnvironment: "test", testRecipients } });
  return c.json({ account: created.data }, 201);
});

app.get("/api/superadmin/staff", async (c) => {
  const authorization = await requireStaff(c, "staff.read");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const [membersResult, invitationsResult, usersResult] = await Promise.all([
    service.from("staff_members").select("user_id,role,status,display_name,invited_by,created_at,updated_at").order("created_at"),
    service.from("staff_invitations").select("id,email,role,invited_by,reason,expires_at,accepted_by,accepted_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(100),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const firstError = membersResult.error || invitationsResult.error || usersResult.error;
  if (firstError) return c.json({ error: "staff_directory_unavailable" }, 503);
  const users = new Map((usersResult.data.users || []).map((user) => [user.id, user]));
  const members = await Promise.all((membersResult.data || []).map(async (member) => {
    const user = users.get(member.user_id);
    const factors = await service.auth.admin.mfa.listFactors({ userId: member.user_id });
    return {
      ...member,
      email: user?.email || "",
      emailConfirmedAt: user?.email_confirmed_at || null,
      lastSignInAt: user?.last_sign_in_at || null,
      mfaFactorCount: factors.data?.factors?.length || 0,
      mfaError: factors.error ? "factor_status_unavailable" : null,
    };
  }));
  return c.json({ members, invitations: invitationsResult.data || [] });
});

app.post("/api/superadmin/staff/invitations", async (c) => {
  const authorization = await requireStaff(c, "staff.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ email?: string; role?: StaffRole; reason?: string }>().catch(() => ({} as { email?: string; role?: StaffRole; reason?: string }));
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role;
  const reason = String(body.reason || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "valid_email_required" }, 400);
  if (!role || !Object.prototype.hasOwnProperty.call(STAFF_ROLE_PERMISSIONS, role))
    return c.json({ error: "valid_staff_role_required" }, 400);
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: existing } = await service.from("staff_invitations")
    .select("id").eq("email", email).is("accepted_at", null).is("revoked_at", null).maybeSingle();
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const result = existing
    ? await service.from("staff_invitations").update({ role, reason, invited_by: authorization.staff!.userId, expires_at: expiresAt }).eq("id", existing.id).select().single()
    : await service.from("staff_invitations").insert({ email, role, reason, invited_by: authorization.staff!.userId, expires_at: expiresAt }).select().single();
  if (result.error) return c.json({ error: result.error.message }, 400);

  const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = users.data.users.find((user) => user.email?.toLowerCase() === email);
  let delivery: "existing_user" | "invite_sent" | "invite_failed" = "existing_user";
  if (!existingUser) {
    const invited = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${c.env.APP_ORIGIN}/`,
      data: { claritude_staff_invitation: true },
    });
    delivery = invited.error ? "invite_failed" : "invite_sent";
  }
  await recordAdminActivity(c.env, authorization.staff!.userId, "staff.invitation_created", "success", {
    targetType: "staff_invitation", targetId: result.data.id, reason,
    newValues: { email, role, expiresAt }, metadata: { delivery },
  });
  return c.json({ invitation: result.data, delivery }, 201);
});

app.delete("/api/superadmin/staff/invitations/:id", async (c) => {
  const authorization = await requireStaff(c, "staff.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  const { data, error } = await admin(c.env).from("staff_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", c.req.param("id")).is("accepted_at", null).is("revoked_at", null).select().single();
  if (error) return c.json({ error: "pending_invitation_not_found" }, 404);
  await recordAdminActivity(c.env, authorization.staff!.userId, "staff.invitation_revoked", "success", { targetType: "staff_invitation", targetId: data.id, reason, previousValues: { email: data.email, role: data.role }, newValues: { revokedAt: data.revoked_at } });
  return c.json({ invitation: data });
});

app.patch("/api/superadmin/staff/:id", async (c) => {
  const authorization = await requireStaff(c, "staff.write");
  if (authorization.response) return authorization.response;
  const targetId = c.req.param("id");
  if (targetId === authorization.staff!.userId)
    return c.json({ error: "self_role_changes_are_not_allowed" }, 409);
  const body = await c.req.json<{ role?: StaffRole; status?: "active" | "suspended"; displayName?: string; reason?: string }>().catch(() => ({} as { role?: StaffRole; status?: "active" | "suspended"; displayName?: string; reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  if (body.role && !Object.prototype.hasOwnProperty.call(STAFF_ROLE_PERMISSIONS, body.role))
    return c.json({ error: "valid_staff_role_required" }, 400);
  if (body.status && !["active", "suspended"].includes(body.status))
    return c.json({ error: "valid_staff_status_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("staff_members").select("role,status,display_name").eq("user_id", targetId).single();
  if (!previous) return c.json({ error: "staff_member_not_found" }, 404);
  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.role) changes.role = body.role;
  if (body.status) changes.status = body.status;
  if (body.displayName !== undefined) changes.display_name = String(body.displayName).trim().slice(0, 120) || null;
  const { data, error } = await service.from("staff_members").update(changes).eq("user_id", targetId).select().single();
  if (error) return c.json({ error: error.message.includes("last_platform_owner") ? "last_platform_owner_is_protected" : error.message }, 409);
  await recordAdminActivity(c.env, authorization.staff!.userId, "staff.member_updated", "success", {
    targetType: "staff_member", targetId, reason, previousValues: previous, newValues: data,
  });
  return c.json({ member: data });
});

app.post("/api/superadmin/staff/:id/mfa/reset", async (c) => {
  const authorization = await requireStaff(c, "staff.write");
  if (authorization.response) return authorization.response;
  const targetId = c.req.param("id");
  if (targetId === authorization.staff!.userId)
    return c.json({ error: "owner_assisted_reset_requires_another_owner" }, 409);
  const body = await c.req.json<{ factorId?: string; reason?: string }>().catch(() => ({} as { factorId?: string; reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const listed = await service.auth.admin.mfa.listFactors({ userId: targetId });
  if (listed.error) return c.json({ error: "mfa_factors_unavailable" }, 503);
  const factors = listed.data.factors.filter((factor) => !body.factorId || factor.id === body.factorId);
  if (!factors.length) return c.json({ error: "mfa_factor_not_found" }, 404);
  for (const factor of factors) {
    const deleted = await service.auth.admin.mfa.deleteFactor({ userId: targetId, id: factor.id });
    if (deleted.error) return c.json({ error: "mfa_factor_reset_failed" }, 503);
  }
  await recordAdminActivity(c.env, authorization.staff!.userId, "staff.mfa_factors_reset", "success", {
    targetType: "staff_member", targetId, reason, metadata: { factorCount: factors.length },
  });
  return c.json({ reset: true, factorCount: factors.length });
});

app.get("/api/superadmin/activity", async (c) => {
  const authorization = await requireStaff(c, "staff.read");
  if (authorization.response) return authorization.response;
  const limit = Math.min(250, Math.max(1, Number(c.req.query("limit")) || 100));
  const service = admin(c.env);
  let query = service.from("admin_activity_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (c.req.query("actor")) query = query.eq("actor_staff_id", c.req.query("actor"));
  if (c.req.query("action")) query = query.eq("action", c.req.query("action"));
  if (c.req.query("outcome")) query = query.eq("outcome", c.req.query("outcome"));
  if (c.req.query("from")) query = query.gte("created_at", c.req.query("from"));
  if (c.req.query("to")) query = query.lte("created_at", c.req.query("to"));
  const [{ data, error }, staff, accounts] = await Promise.all([query, service.from("staff_members").select("user_id,display_name"), service.from("accounts").select("id,name")]);
  const staffUsers = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map(staffUsers.data.users.map((item) => [item.id, item.email || ""]));
  const staffById = new Map((staff.data || []).map((item) => [item.user_id, item]));
  const accountById = new Map((accounts.data || []).map((item) => [item.id, item.name]));
  return error ? c.json({ error: "admin_activity_unavailable" }, 503) : c.json({ activity: (data || []).map((item) => ({ ...item, actorName: staffById.get(item.actor_staff_id)?.display_name || null, actorEmail: emailById.get(item.actor_staff_id) || null, targetName: item.account_id ? accountById.get(item.account_id) || null : null })) });
});

app.get("/api/superadmin/delegations", async (c) => {
  const authorization = await requireStaff(c, "delegation.read");
  if (authorization.response) return authorization.response;
  const { data, error } = await admin(c.env).from("delegation_sessions").select("*")
    .eq("staff_user_id", authorization.staff!.userId).order("created_at", { ascending: false }).limit(50);
  return error ? c.json({ error: "delegation_sessions_unavailable" }, 503) : c.json({ sessions: data || [] });
});

app.post("/api/superadmin/delegations", async (c) => {
  const authorization = await requireStaff(c, "delegation.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ accountId?: string; representedUserId?: string; mode?: "read" | "write"; durationMinutes?: number; reason?: string }>().catch(() => ({} as { accountId?: string; representedUserId?: string; mode?: "read" | "write"; durationMinutes?: number; reason?: string }));
  const service = admin(c.env);
  const { data: staffSessionSetting } = await service.from("platform_settings").select("value").eq("key", "staff_sessions").maybeSingle();
  const sessionPolicy = (staffSessionSetting?.value || { defaultMinutes: 30, maximumMinutes: 60, writeModeAllowed: true, requireReason: true }) as Record<string, any>;
  const reason = String(body.reason || "").trim();
  const durationMinutes = Math.floor(Number(body.durationMinutes) || Number(sessionPolicy.defaultMinutes) || 30);
  const mode = body.mode === "write" ? "write" : "read";
  if (!body.accountId || !body.representedUserId) return c.json({ error: "account_and_user_required" }, 400);
  if ((sessionPolicy.requireReason !== false && reason.length < 3) || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  if (durationMinutes < 5 || durationMinutes > Math.min(60, Number(sessionPolicy.maximumMinutes) || 60)) return c.json({ error: "delegation_duration_out_of_range" }, 400);
  if (mode === "write" && sessionPolicy.writeModeAllowed !== true) return c.json({ error: "delegation_write_mode_disabled" }, 403);
  if (mode === "write" && !staffRoleCan(authorization.staff!.role, "customers.write"))
    return c.json({ error: "customer_write_permission_required" }, 403);
  const { data: membership } = await service.from("account_memberships").select("role")
    .eq("account_id", body.accountId).eq("user_id", body.representedUserId).maybeSingle();
  if (!membership) return c.json({ error: "represented_membership_not_found" }, 404);
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const { data, error } = await service.from("delegation_sessions").insert({
    staff_user_id: authorization.staff!.userId,
    account_id: body.accountId,
    represented_user_id: body.representedUserId,
    represented_role: membership.role,
    mode,
    reason,
    expires_at: expiresAt,
  }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "delegation.started", "success", {
    targetType: "account", targetId: body.accountId, accountId: body.accountId, reason,
    delegationSessionId: data.id, representedUserId: body.representedUserId,
    metadata: { mode, expiresAt, representedRole: membership.role },
  });
  return c.json({ session: data }, 201);
});

app.delete("/api/superadmin/delegations/:id", async (c) => {
  const authorization = await requireStaff(c, "delegation.write");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const { data, error } = await service.from("delegation_sessions").update({ revoked_at: new Date().toISOString() })
    .eq("id", c.req.param("id")).eq("staff_user_id", authorization.staff!.userId).is("revoked_at", null).select().maybeSingle();
  if (error || !data) return c.json({ error: "delegation_session_not_found" }, 404);
  await recordAdminActivity(c.env, authorization.staff!.userId, "delegation.ended", "success", {
    targetType: "account", targetId: data.account_id, accountId: data.account_id,
    delegationSessionId: data.id, representedUserId: data.represented_user_id,
  });
  return c.json({ revoked: true });
});

app.get("/api/superadmin/delegations/:id/bootstrap", async (c) => {
  const authorization = await requireStaff(c, "delegation.read");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const now = new Date().toISOString();
  const { data: session } = await service.from("delegation_sessions").select("*")
    .eq("id", c.req.param("id")).eq("staff_user_id", authorization.staff!.userId)
    .is("revoked_at", null).gt("expires_at", now).maybeSingle();
  if (!session) return c.json({ error: "delegation_session_expired_or_revoked" }, 403);
  const [account, workspaces, memberships] = await Promise.all([
    service.from("accounts").select("*").eq("id", session.account_id).single(),
    service.from("workspaces").select("*").eq("account_id", session.account_id).order("created_at"),
    service.from("account_memberships").select("user_id,role,created_at").eq("account_id", session.account_id),
  ]);
  if (account.error || workspaces.error || memberships.error) return c.json({ error: "delegated_account_unavailable" }, 503);
  const workspaceIds = (workspaces.data || []).map((workspace) => workspace.id);
  const properties = workspaceIds.length
    ? await service.from("properties").select("*").in("workspace_id", workspaceIds).order("created_at")
    : { data: [], error: null };
  if (properties.error) return c.json({ error: "delegated_account_unavailable" }, 503);
  return c.json({ session, account: account.data, workspaces: workspaces.data || [], properties: properties.data || [], memberships: memberships.data || [] });
});

function adminPageParams(c: any) {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(c.req.query("pageSize")) || 25)));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

async function subscriptionChangeSelection(env: Env, accountId: string, selection: { packageVersionId: string; currency: string; interval: string; editingSeats: number }) {
  const db = admin(env);
  const account = await db.from("accounts").select("billing_environment").eq("id", accountId).maybeSingle();
  const billingEnvironment = account.data?.billing_environment as BillingEnvironment | undefined;
  if (!billingEnvironment) throw new Error("account_not_found");
  const stripe = stripeClient(env, billingEnvironment);
  if (!stripe) throw new Error("stripe_credentials_required");
  const [subscription, packageVersion, prices] = await Promise.all([
    db.from("billing_subscriptions").select("provider_subscription_id,provider_customer_id,current_period_end,billing_subscription_items(*)").eq("account_id", accountId).eq("billing_environment", billingEnvironment).in("status", ["active", "trialing", "past_due", "unpaid"]).maybeSingle(),
    db.from("package_versions").select("id,allowances").eq("id", selection.packageVersionId).maybeSingle(),
    db.from("billing_catalogue_prices").select("*").eq("billing_environment", billingEnvironment).eq("package_version_id", selection.packageVersionId).eq("currency", selection.currency).eq("interval", selection.interval).eq("active", true),
  ]);
  if (!subscription.data) throw new Error("active_subscription_not_found");
  const includedEditingSeats = Number((packageVersion.data?.allowances as any)?.editingSeats);
  if (!Number.isSafeInteger(includedEditingSeats) || includedEditingSeats < 1) throw new Error("package_editing_seat_allowance_unresolved");
  const additionalSeats = Math.max(0, selection.editingSeats - includedEditingSeats);
  const basePrice = (prices.data || []).find((price) => price.component === "base");
  const seatPrice = (prices.data || []).find((price) => price.component === "additional_editing_seat");
  if (!basePrice || (additionalSeats > 0 && !seatPrice)) throw new Error("verified_catalogue_price_missing");
  const currentItems = (subscription.data.billing_subscription_items || []) as any[];
  const items: Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }> = [];
  let baseUpdated = false, seatUpdated = false;
  for (const item of currentItems) {
    if (item.component === "base") {
      if (!baseUpdated) { items.push({ id: item.provider_subscription_item_id, price: basePrice.provider_price_id, quantity: 1 }); baseUpdated = true; }
      else items.push({ id: item.provider_subscription_item_id, deleted: true });
    } else if (item.component === "additional_editing_seat") {
      if (additionalSeats > 0 && !seatUpdated) { items.push({ id: item.provider_subscription_item_id, price: seatPrice.provider_price_id, quantity: additionalSeats }); seatUpdated = true; }
      else items.push({ id: item.provider_subscription_item_id, deleted: true });
    }
  }
  if (!baseUpdated) items.push({ price: basePrice.provider_price_id, quantity: 1 });
  if (additionalSeats > 0 && !seatUpdated) items.push({ price: seatPrice.provider_price_id, quantity: additionalSeats });
  return { db, stripe, billingEnvironment, subscription: subscription.data, items, includedEditingSeats, additionalSeats };
}

app.post("/api/billing/:accountId/change-preview", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canManage) return c.json({ error: "billing_manage_access_required" }, 403);
  const body = await c.req.json<{ packageVersionId?: string; currency?: string; interval?: string; editingSeats?: number }>().catch(() => ({} as any));
  const selection = { packageVersionId: String(body.packageVersionId || ""), currency: String(body.currency || "").toLowerCase(), interval: String(body.interval || ""), editingSeats: Math.floor(Number(body.editingSeats || 0)) };
  if (!selection.packageVersionId || !/^[a-z]{3}$/.test(selection.currency) || !["month", "year"].includes(selection.interval) || selection.editingSeats < 1) return c.json({ error: "invalid_subscription_change" }, 400);
  try {
    const prepared = await subscriptionChangeSelection(c.env, accountId, selection);
    const prorationDate = Math.floor(Date.now() / 1000);
    const preview = await prepared.stripe.invoices.createPreview({ customer: prepared.subscription.provider_customer_id, subscription: prepared.subscription.provider_subscription_id, subscription_details: { items: prepared.items, proration_behavior: "create_prorations", proration_date: prorationDate } });
    return c.json({ prorationDate, currency: preview.currency, subtotalMinor: preview.subtotal, discountMinor: preview.total_discount_amounts?.reduce((sum, item) => sum + item.amount, 0) || 0, taxMinor: preview.total_taxes?.reduce((sum, item) => sum + item.amount, 0) || 0, totalMinor: preview.total, amountDueMinor: preview.amount_due, includedEditingSeats: prepared.includedEditingSeats, additionalSeats: prepared.additionalSeats, lines: preview.lines.data.map((line: any) => ({ description: line.description, amountMinor: line.amount, proration: line.parent?.subscription_item_details?.proration === true, periodStart: stripeTimestamp(line.period?.start), periodEnd: stripeTimestamp(line.period?.end) })) });
  } catch (error) { return c.json({ error: errorMessage(error) }, 409); }
});

app.post("/api/billing/:accountId/change", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canManage) return c.json({ error: "billing_manage_access_required" }, 403);
  const body = await c.req.json<{ packageVersionId?: string; currency?: string; interval?: string; editingSeats?: number; prorationDate?: number; effective?: "now" | "period_end"; operationKey?: string }>().catch(() => ({} as any));
  const operationKey = String(body.operationKey || "");
  const selection = { packageVersionId: String(body.packageVersionId || ""), currency: String(body.currency || "").toLowerCase(), interval: String(body.interval || ""), editingSeats: Math.floor(Number(body.editingSeats || 0)) };
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(operationKey) || !["now", "period_end"].includes(body.effective || "") || !selection.packageVersionId || !/^[a-z]{3}$/.test(selection.currency) || !["month", "year"].includes(selection.interval) || selection.editingSeats < 1) return c.json({ error: "valid_change_and_stable_operation_key_required" }, 400);
  try {
    const prepared = await subscriptionChangeSelection(c.env, accountId, selection);
    const existing = await prepared.db.from("billing_financial_operations").select("state,response").eq("billing_environment", prepared.billingEnvironment).eq("operation_type", "subscription_change").eq("operation_key", operationKey).maybeSingle();
    if (existing.data) return c.json({ ...(existing.data.response || {}), reused: true });
    const operation = await prepared.db.from("billing_financial_operations").insert({ billing_environment: prepared.billingEnvironment, operation_key: operationKey, operation_type: "subscription_change", account_id: accountId, requested_by: c.get("userId"), request: { ...selection, effective: body.effective, prorationDate: body.prorationDate || null } }).select("id").single();
    if (operation.error || !operation.data) throw operation.error || new Error("financial_operation_persistence_failed");
    if (body.effective === "period_end") {
      const scheduled = await prepared.db.from("billing_scheduled_changes").insert({ billing_environment: prepared.billingEnvironment, operation_key: operationKey, account_id: accountId, provider_subscription_id: prepared.subscription.provider_subscription_id, effective_at: prepared.subscription.current_period_end, requested_change: selection, requested_by: c.get("userId") }).select("id,effective_at").single();
      if (scheduled.error) throw scheduled.error;
      const response = { scheduled: true, scheduledChangeId: scheduled.data.id, effectiveAt: scheduled.data.effective_at };
      await prepared.db.from("billing_financial_operations").update({ response, updated_at: new Date().toISOString() }).eq("id", operation.data.id);
      return c.json(response);
    }
    const prorationDate = Number(body.prorationDate || Math.floor(Date.now() / 1000));
    const updated = await prepared.stripe.subscriptions.update(prepared.subscription.provider_subscription_id, { items: prepared.items, proration_behavior: "always_invoice", proration_date: prorationDate, payment_behavior: "pending_if_incomplete", metadata: { claritudeAccountId: accountId, billingEnvironment: prepared.billingEnvironment, packageVersionId: selection.packageVersionId, includedEditingSeats: String(prepared.includedEditingSeats) } }, { idempotencyKey: `subscription-change:${prepared.billingEnvironment}:${operationKey}` });
    await projectStripeSubscription(c.env, updated, Math.floor(Date.now() / 1000));
    const response = { scheduled: false, subscriptionId: updated.id, status: updated.status, includedEditingSeats: prepared.includedEditingSeats, additionalSeats: prepared.additionalSeats };
    await prepared.db.from("billing_financial_operations").update({ provider_reference: updated.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("id", operation.data.id);
    return c.json(response);
  } catch (error) { return c.json({ error: errorMessage(error) }, 409); }
});

app.get("/api/billing/:accountId", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canView) return c.json({ error: "billing_view_access_required" }, 403);
  const db = admin(c.env);
  const account = await db.from("accounts").select("id,billing_environment,is_test_account").eq("id", accountId).maybeSingle();
  if (!account.data) return c.json({ error: "account_not_found" }, 404);
  const billingEnvironment = account.data.billing_environment as BillingEnvironment;
  const provider = stripeContext(c.env, billingEnvironment);
  const [configuration, customer, subscriptions, invoices, payments, refunds, disputes, catalogue, grant] = await Promise.all([
    db.from("billing_environment_configurations").select("*").eq("environment", billingEnvironment).maybeSingle(),
    db.from("billing_customers").select("*").eq("account_id", accountId).eq("billing_environment", billingEnvironment).maybeSingle(),
    db.from("billing_subscriptions").select("*,billing_subscription_items(*),billing_subscription_discounts(*)").eq("account_id", accountId).eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }),
    db.from("billing_invoices").select("*").eq("account_id", accountId).eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(100),
    db.from("billing_payments").select("*").eq("account_id", accountId).eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(100),
    db.from("billing_refunds").select("*").eq("account_id", accountId).eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(100),
    db.from("billing_disputes").select("*").eq("account_id", accountId).eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(100),
    db.from("billing_catalogue_prices").select("id,package_version_id,currency,interval,component,unit_amount_minor,tax_behavior,active,provider_livemode,billing_environment,metadata,package_versions(package_key,display_name,state,allowances,unresolved_values)").eq("billing_environment", billingEnvironment).eq("active", true).order("currency"),
    db.from("account_package_grants").select("id,status,starts_at,expires_at,reason,overrides,package_versions(package_key,display_name)").eq("account_id", accountId).eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle(),
  ]);
  const config = configuration.data;
  const checkoutReady = Boolean(provider.configured && config?.checkout_enabled && catalogue.data?.some((price) => price.billing_environment === billingEnvironment));
  const effective = await effectiveEntitlements(c.env, accountId);
  let usage = null;
  let usageError = null;
  try { usage = await accountBillingUsage(c.env, accountId, subscriptions.data || [], effective); }
  catch (error) { usageError = errorMessage(error); }
  return c.json({ accountId, billingEnvironment, isTestAccount: account.data.is_test_account, canManage: access.canManage, providerMode: provider.client ? billingEnvironment : "unconfigured", checkoutReady, portalReady: Boolean(provider.client && (config?.portal_configuration_id || provider.portalConfigurationId)), configuration: config || null, customer: customer.data || null, subscriptions: subscriptions.data || [], invoices: invoices.data || [], payments: payments.data || [], refunds: refunds.data || [], disputes: disputes.data || [], catalogue: catalogue.data || [], complimentaryGrant: grant.data || null, effectiveEntitlements: effective, usage, usageError });
});

app.post("/api/billing/:accountId/checkout", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canManage) return c.json({ error: "billing_manage_access_required" }, 403);
  const body = await c.req.json<{ packageVersionId?: string; currency?: string; interval?: string; editingSeats?: number; requestKey?: string }>().catch(() => ({} as { packageVersionId?: string; currency?: string; interval?: string; editingSeats?: number; requestKey?: string }));
  const currency = String(body.currency || "").toLowerCase();
  const interval = String(body.interval || "");
  const editingSeats = Math.floor(Number(body.editingSeats));
  const operationKey = String(body.requestKey || "");
  if (!body.packageVersionId || !/^[a-z]{3}$/.test(currency) || !["month", "year"].includes(interval) || editingSeats < 1 || editingSeats > 10000 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(operationKey)) return c.json({ error: "invalid_checkout_selection_or_operation_key" }, 400);
  const db = admin(c.env);
  const account = await db.from("accounts").select("id,name,billing_environment,is_test_account").eq("id", accountId).maybeSingle();
  if (!account.data) return c.json({ error: "account_not_found" }, 404);
  const billingEnvironment = account.data.billing_environment as BillingEnvironment;
  const provider = stripeContext(c.env, billingEnvironment);
  const stripe = provider.client;
  if (!stripe || !provider.webhookSecret) return c.json({ error: "stripe_credentials_required_for_account_environment", environment: billingEnvironment }, 409);
  const [configuration, grant, existingSubscription, prices, packageVersion] = await Promise.all([
    db.from("billing_environment_configurations").select("*").eq("environment", billingEnvironment).maybeSingle(),
    db.from("account_package_grants").select("id").eq("account_id", accountId).eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle(),
    db.from("billing_subscriptions").select("provider_subscription_id,status").eq("account_id", accountId).eq("billing_environment", billingEnvironment).in("status", ["active", "trialing", "past_due", "unpaid", "incomplete"]).maybeSingle(),
    db.from("billing_catalogue_prices").select("*").eq("billing_environment", billingEnvironment).eq("package_version_id", body.packageVersionId).eq("currency", currency).eq("interval", interval).eq("active", true),
    db.from("package_versions").select("id,allowances,unresolved_values").eq("id", body.packageVersionId).maybeSingle(),
  ]);
  if (grant.data) return c.json({ error: "complimentary_account_checkout_blocked", detail: "Revoke the complimentary grant through the audited SuperAdmin workflow before creating paid billing." }, 409);
  if (existingSubscription.data) return c.json({ error: "existing_subscription_requires_portal", subscriptionId: existingSubscription.data.provider_subscription_id }, 409);
  const config = configuration.data;
  if (!config?.checkout_enabled) return c.json({ error: "checkout_not_approved_for_environment", environment: billingEnvironment }, 409);
  if (config.tax_enabled && !config.tax_reviewed_at) return c.json({ error: "tax_configuration_not_verified" }, 409);
  const includedEditingSeats = Number((packageVersion.data?.allowances as any)?.editingSeats);
  if (!Number.isSafeInteger(includedEditingSeats) || includedEditingSeats < 1) return c.json({ error: "package_editing_seat_allowance_unresolved", packageVersionId: body.packageVersionId }, 409);
  const additionalSeats = Math.max(0, editingSeats - includedEditingSeats);
  const base = (prices.data || []).find((price) => price.component === "base" && price.provider_livemode === (billingEnvironment === "live"));
  const seat = (prices.data || []).find((price) => price.component === "additional_editing_seat" && price.provider_livemode === (billingEnvironment === "live"));
  if (!base || (additionalSeats > 0 && !seat)) return c.json({ error: "verified_catalogue_price_missing", detail: "Approved product and price mappings are required for this currency, interval and billable seat selection.", includedEditingSeats, additionalSeats }, 409);
  const idempotencyKey = `checkout:${billingEnvironment}:${operationKey}`;
  const priorOperation = await db.from("billing_financial_operations").select("provider_reference,state,response").eq("billing_environment", billingEnvironment).eq("operation_type", "checkout").eq("operation_key", operationKey).maybeSingle();
  if (priorOperation.data?.provider_reference) return c.json({ sessionId: priorOperation.data.provider_reference, ...(priorOperation.data.response || {}), reused: true });
  const prior = await db.from("billing_checkout_attempts").select("provider_session_id,state").eq("billing_environment", billingEnvironment).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (prior.data?.provider_session_id) return c.json({ sessionId: prior.data.provider_session_id, reused: true });
  const operation = await db.from("billing_financial_operations").insert({ billing_environment: billingEnvironment, operation_key: operationKey, operation_type: "checkout", account_id: accountId, requested_by: c.get("userId"), request: { packageVersionId: body.packageVersionId, currency, interval, editingSeats, includedEditingSeats, additionalSeats } }).select("id").maybeSingle();
  if (operation.error?.code === "23505") return c.json({ error: "financial_operation_in_progress", operationKey }, 409);
  if (operation.error || !operation.data) return c.json({ error: "financial_operation_persistence_failed" }, 503);
  let customer = await db.from("billing_customers").select("provider_customer_id").eq("account_id", accountId).eq("billing_environment", billingEnvironment).maybeSingle();
  let customerId = customer.data?.provider_customer_id || null;
  if (!customerId) {
    const created = await stripe.customers.create({ name: account.data.name, email: c.get("userEmail") || undefined, metadata: { claritudeAccountId: accountId, billingEnvironment } }, { idempotencyKey: `customer:${billingEnvironment}:${accountId}` });
    customerId = created.id;
    await db.from("billing_customers").upsert({ account_id: accountId, billing_environment: billingEnvironment, provider_customer_id: customerId, provider: "stripe", currency, sync_state: "pending", metadata: { livemode: billingEnvironment === "live" } }, { onConflict: "account_id,billing_environment" });
  }
  const attempt = await db.from("billing_checkout_attempts").insert({ account_id: accountId, billing_environment: billingEnvironment, requested_by: c.get("userId"), package_version_id: body.packageVersionId, currency, interval, editing_seats: editingSeats, idempotency_key: idempotencyKey }).select("id").single();
  if (attempt.error) return c.json({ error: "checkout_attempt_persistence_failed" }, 503);
  try {
    const activePromotions = await db.from("promotion_rules").select("id").eq("billing_environment", billingEnvironment).eq("enabled", true).limit(1);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription", customer: customerId,
      integration_identifier: `claritude_${operationKey.replaceAll("-", "")}`,
      line_items: [{ price: base.provider_price_id, quantity: 1 }, ...(additionalSeats > 0 && seat ? [{ price: seat.provider_price_id, quantity: additionalSeats }] : [])],
      allow_promotion_codes: Boolean(activePromotions.data?.length),
      automatic_tax: { enabled: config.tax_enabled === true },
      billing_address_collection: config.tax_enabled ? "required" : "auto",
      success_url: `${c.env.APP_ORIGIN.replace(/\/$/, "")}/account?accountTab=Billing%20%26%20plan&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${c.env.APP_ORIGIN.replace(/\/$/, "")}/account?accountTab=Billing%20%26%20plan&checkout=cancelled`,
      metadata: { claritudeAccountId: accountId, billingEnvironment, packageVersionId: body.packageVersionId, checkoutAttemptId: attempt.data.id, includedEditingSeats: String(includedEditingSeats), additionalSeats: String(additionalSeats) },
      subscription_data: { metadata: { claritudeAccountId: accountId, billingEnvironment, packageVersionId: body.packageVersionId, includedEditingSeats: String(includedEditingSeats) } },
    }, { idempotencyKey });
    await db.from("billing_checkout_attempts").update({ provider_session_id: session.id, state: "created", updated_at: new Date().toISOString() }).eq("id", attempt.data.id);
    await db.from("billing_financial_operations").update({ provider_reference: session.id, state: "completed", response: { sessionId: session.id, url: session.url }, updated_at: new Date().toISOString() }).eq("id", operation.data.id);
    return c.json({ sessionId: session.id, url: session.url, includedEditingSeats, additionalSeats });
  } catch (error) {
    await db.from("billing_checkout_attempts").update({ state: "failed", error: errorMessage(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", attempt.data.id);
    await db.from("billing_financial_operations").update({ state: "failed", error: errorMessage(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", operation.data.id);
    return c.json({ error: "stripe_checkout_failed" }, 503);
  }
});

app.post("/api/billing/:accountId/portal", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canManage) return c.json({ error: "billing_manage_access_required" }, 403);
  const db = admin(c.env);
  const account = await db.from("accounts").select("billing_environment").eq("id", accountId).maybeSingle();
  const billingEnvironment = account.data?.billing_environment as BillingEnvironment | undefined;
  if (!billingEnvironment) return c.json({ error: "account_not_found" }, 404);
  const provider = stripeContext(c.env, billingEnvironment);
  const stripe = provider.client;
  const configuration = await db.from("billing_environment_configurations").select("portal_configuration_id").eq("environment", billingEnvironment).maybeSingle();
  const portalConfigurationId = configuration.data?.portal_configuration_id || provider.portalConfigurationId;
  if (!stripe || !portalConfigurationId) return c.json({ error: "verified_customer_portal_configuration_required", environment: billingEnvironment }, 409);
  const customer = await db.from("billing_customers").select("provider_customer_id").eq("account_id", accountId).eq("billing_environment", billingEnvironment).maybeSingle();
  if (!customer.data?.provider_customer_id) return c.json({ error: "billing_customer_not_found" }, 404);
  const portal = await stripe.billingPortal.sessions.create({ customer: customer.data.provider_customer_id, configuration: portalConfigurationId, return_url: `${c.env.APP_ORIGIN.replace(/\/$/, "")}/account?accountTab=Billing%20%26%20plan` });
  return c.json({ url: portal.url });
});

app.post("/api/billing/:accountId/cancellation", async (c) => {
  const accountId = c.req.param("accountId");
  const access = await billingAccess(c.env, c.get("userId"), accountId);
  if (!access.canManage) return c.json({ error: "billing_manage_access_required" }, 403);
  const body = await c.req.json<{ cancelAtPeriodEnd?: boolean; operationKey?: string }>().catch(() => ({} as { cancelAtPeriodEnd?: boolean; operationKey?: string }));
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(body.operationKey || ""))) return c.json({ error: "stable_operation_key_required" }, 400);
  const db = admin(c.env);
  const account = await db.from("accounts").select("billing_environment").eq("id", accountId).maybeSingle();
  const billingEnvironment = account.data?.billing_environment as BillingEnvironment | undefined;
  if (!billingEnvironment) return c.json({ error: "account_not_found" }, 404);
  const stripe = stripeClient(c.env, billingEnvironment);
  if (!stripe) return c.json({ error: "stripe_credentials_required" }, 409);
  const current = await db.from("billing_subscriptions").select("provider_subscription_id").eq("account_id", accountId).eq("billing_environment", billingEnvironment).in("status", ["active", "trialing", "past_due", "unpaid"]).maybeSingle();
  if (!current.data) return c.json({ error: "active_subscription_not_found" }, 404);
  const existing = await db.from("billing_financial_operations").select("response,state").eq("billing_environment", billingEnvironment).eq("operation_type", "subscription_change").eq("operation_key", body.operationKey).maybeSingle();
  if (existing.data?.state === "completed") return c.json({ ...(existing.data.response || {}), reused: true });
  const operation = await db.from("billing_financial_operations").insert({ billing_environment: billingEnvironment, operation_key: body.operationKey, operation_type: "subscription_change", account_id: accountId, requested_by: c.get("userId"), request: { cancelAtPeriodEnd: body.cancelAtPeriodEnd !== false } }).select("id").maybeSingle();
  if (operation.error) return c.json({ error: operation.error.code === "23505" ? "financial_operation_in_progress" : "financial_operation_persistence_failed" }, operation.error.code === "23505" ? 409 : 503);
  const subscription = await stripe.subscriptions.update(current.data.provider_subscription_id, { cancel_at_period_end: body.cancelAtPeriodEnd !== false }, { idempotencyKey: `subscription-change:${billingEnvironment}:${body.operationKey}` });
  await projectStripeSubscription(c.env, subscription, Math.floor(Date.now() / 1000));
  const response = { subscriptionId: subscription.id, cancelAtPeriodEnd: subscription.cancel_at_period_end };
  await db.from("billing_financial_operations").update({ provider_reference: subscription.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("id", operation.data!.id);
  return c.json(response);
});

function safeSearchTerm(value: unknown) {
  return String(value || "").trim().slice(0, 120).replace(/[,%_()]/g, "");
}

export function normalizeAccountTags(value: unknown) {
  if (!Array.isArray(value)) return null;
  const tags = [...new Set(value.map((item) => String(item).trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) return null;
  return tags;
}

export function validSafetyLimits(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const limits = value as Record<string, unknown>;
  const ranges: Record<string, [number, number]> = {
    platformAuditStartsPerDay: [1, 10_000], concurrentAudits: [1, 50], auditWallTimeSeconds: [60, 600],
    httpResponseBytes: [100_000, 10_000_000], linksPerAudit: [10, 10_000], resourcesPerAudit: [10, 10_000],
    redirects: [0, 10], queueRetries: [0, 10], analyticsPayloadBytes: [1024, 1_000_000],
    analyticsEventsPerPropertyPerDay: [100, 1_000_000], exportsPerAccountPerDay: [1, 100],
  };
  return Object.entries(ranges).every(([key, [min, max]]) => Number.isInteger(limits[key]) && Number(limits[key]) >= min && Number(limits[key]) <= max);
}

export type EffectiveFeatureState = "draft" | "awaiting_configuration" | "ready_to_activate" | "enabled" | "paused" | "unavailable";

export function deriveFeatureState(input: {
  permitted: boolean;
  configured: boolean;
  enabled: boolean;
  dependencyAvailable?: boolean;
  draftExists?: boolean;
  runningJobs?: number;
  dependency?: string;
}) {
  const runningJobs = Math.max(0, Number(input.runningJobs) || 0);
  if (input.dependencyAvailable === false) return { state: "unavailable" as EffectiveFeatureState, reason: input.dependency || "Required dependency is unavailable", permitted: input.permitted, runningJobs };
  if (!input.configured) return { state: input.draftExists ? "draft" as EffectiveFeatureState : "awaiting_configuration" as EffectiveFeatureState, reason: "Required policy or recipients are not configured", permitted: input.permitted, runningJobs };
  if (!input.enabled) return { state: "ready_to_activate" as EffectiveFeatureState, reason: "Configuration is valid but activation is disabled", permitted: input.permitted, runningJobs };
  if (!input.permitted) return { state: "paused" as EffectiveFeatureState, reason: "Operational control is paused", permitted: false, runningJobs };
  return { state: "enabled" as EffectiveFeatureState, reason: runningJobs ? `${runningJobs} job${runningJobs === 1 ? "" : "s"} currently running` : "Permitted and configured; no job is currently running", permitted: true, runningJobs };
}

export function renderEmailTemplate(source: string, variables: Record<string, unknown>) {
  const missing = [...source.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)]
    .map((match) => match[1])
    .filter((key, index, all) => !Object.prototype.hasOwnProperty.call(variables, key) && all.indexOf(key) === index);
  if (missing.length) return { rendered: source, missing };
  return {
    rendered: source.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_match, key) => escapeHtml(variables[key])),
    missing: [],
  };
}

async function publishedEmailTemplate(db: SupabaseClient, templateKey: string) {
  const { data, error } = await db.from("email_templates").select("id,subject,html_body,text_body,variables,version").eq("template_key", templateKey).eq("state", "active").order("version", { ascending: false }).limit(1).maybeSingle();
  return error ? null : data;
}

export function deriveEmailAutomationDecision(input: { configured: boolean; enabled: boolean; enabledCategories?: string[]; suppressionHandling?: string; suppressed: boolean; category: string }) {
  if (!input.configured) return { allowed: false, reason: "automation_not_configured" };
  if (!input.enabled) return { allowed: false, reason: "automation_paused" };
  const configuredCategory = input.category === "scheduled_report" ? "report" : input.category;
  if (Array.isArray(input.enabledCategories) && !input.enabledCategories.includes(configuredCategory)) return { allowed: false, reason: "category_disabled" };
  if (input.suppressionHandling !== "report_only" && input.suppressed) return { allowed: false, reason: "recipient_suppressed" };
  return { allowed: true, reason: null };
}

async function emailAutomationDecision(db: SupabaseClient, key: string, recipient: string, category: string) {
  const [automation, settings, suppression] = await Promise.all([
    db.from("email_automations").select("enabled,eligibility").eq("key", key).maybeSingle(),
    db.from("platform_settings").select("value").eq("key", "email_settings").maybeSingle(),
    db.from("email_suppressions").select("id,category").eq("recipient", recipient.trim().toLowerCase()).in("category", [category, "all"]).is("lifted_at", null).limit(1),
  ]);
  const emailSettings = (settings.data?.value || {}) as Record<string, any>;
  return deriveEmailAutomationDecision({ configured: Boolean(automation.data), enabled: Boolean(automation.data?.enabled), enabledCategories: emailSettings.enabledCategories, suppressionHandling: emailSettings.suppressionHandling, suppressed: Boolean((suppression.data || []).length), category });
}

export function validatePlatformSetting(key: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "setting_value_must_be_an_object";
  const item = value as Record<string, any>;
  if (key === "safety_limits") return validSafetyLimits(value) ? null : "invalid_safety_limits";
  if (key === "inactivity_policy") {
    const warnings = item.warningDays;
    if (!Array.isArray(warnings) || warnings.length !== 2 || !warnings.every(Number.isInteger) || warnings[0] < 1 || warnings[1] <= warnings[0] || !Number.isInteger(item.freezeDay) || item.freezeDay <= warnings[1] || !Number.isInteger(item.deletionEligibleDay) || item.deletionEligibleDay - item.freezeDay !== 21 || item.automaticDeletionEnabled !== false) return "invalid_inactivity_policy";
  }
  if (key === "retention_policy") {
    const numericValues = Object.entries(item).filter(([name]) => name !== "freeAuditExpiryEnabled").map(([, entry]) => entry);
    if (typeof item.freeAuditExpiryEnabled !== "boolean" || !Number.isInteger(item.freeAuditExpiryDays) || item.freeAuditExpiryDays < 1 || item.freeAuditExpiryDays > 3650 || !numericValues.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 3650)) return "invalid_retention_policy";
  }
  if (key === "outbound_automation" && (!Array.isArray(item.safeTestRecipients) || !item.safeTestRecipients.every((email: unknown) => /^\S+@\S+\.\S+$/.test(String(email))) || typeof item.campaignsEnabled !== "boolean" || typeof item.inactivityNoticesEnabled !== "boolean" || typeof item.weeklyDigestEnabled !== "boolean")) return "invalid_outbound_automation";
  if (key === "email_settings" && (!String(item.senderName || "").trim() || (String(item.replyTo || "") && !/^\S+@\S+\.\S+$/.test(String(item.replyTo))) || !Array.isArray(item.enabledCategories) || !["enforce", "report_only"].includes(item.suppressionHandling) || !Number.isInteger(item.hourlySendLimit) || item.hourlySendLimit < 1 || item.hourlySendLimit > 100000)) return "invalid_email_settings";
  if (key === "staff_sessions" && (!Number.isInteger(item.defaultMinutes) || !Number.isInteger(item.maximumMinutes) || item.defaultMinutes < 5 || item.maximumMinutes > 60 || item.defaultMinutes > item.maximumMinutes || item.requireReason !== true)) return "invalid_staff_sessions";
  if (key === "alert_digest" && (!Array.isArray(item.recipients) || !item.recipients.every((email: unknown) => /^\S+@\S+\.\S+$/.test(String(email))) || typeof item.enabled !== "boolean" || !String(item.schedule || "").trim() || !String(item.timezone || "").trim() || !Array.isArray(item.includedMetrics))) return "invalid_alert_digest";
  if (key === "provider_capabilities") return "provider_capabilities_are_discovered_not_editable";
  return null;
}

app.get("/api/superadmin/search", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  const query = safeSearchTerm(c.req.query("q"));
  if (query.length < 2) return c.json({ results: [] });
  const billingEnvironment = c.req.query("billingEnvironment") || "live";
  if (!["test", "live"].includes(billingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const service = admin(c.env);
  const scopedAccounts = await service.from("accounts").select("id,name").eq("billing_environment", billingEnvironment).limit(5000);
  const accountIds = (scopedAccounts.data || []).map((item) => item.id);
  const scopedProperties = accountIds.length ? await service.from("properties").select("id").in("account_id", accountIds).limit(10000) : { data: [] };
  const [workspaces, properties, memberships, users, invoices] = await Promise.all([
    accountIds.length ? service.from("workspaces").select("id,name,account_id").in("account_id", accountIds).ilike("name", `%${query}%`).limit(8) : Promise.resolve({ data: [], error: null }),
    accountIds.length ? service.from("properties").select("id,name,canonical_host,account_id").in("account_id", accountIds).or(`name.ilike.%${query}%,canonical_host.ilike.%${query}%`).limit(8) : Promise.resolve({ data: [], error: null }),
    accountIds.length ? service.from("account_memberships").select("user_id").in("account_id", accountIds).limit(10000) : Promise.resolve({ data: [], error: null }),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    service.from("billing_invoices").select("id,provider_invoice_id,number,status,account_id").eq("billing_environment", billingEnvironment).or(`provider_invoice_id.ilike.%${query}%,number.ilike.%${query}%`).limit(8),
  ]);
  const scopedUserIds = new Set((memberships.data || []).map((item: any) => item.user_id));
  const matchedUsers = users.data.users.filter((user) => scopedUserIds.has(user.id) && `${user.email || ""} ${user.user_metadata?.full_name || ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const matchedAccounts = (scopedAccounts.data || []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const propertyIds = (scopedProperties.data || []).map((item: any) => item.id);
  const audits = /^[0-9a-f-]{4,}$/i.test(query) && propertyIds.length ? await service.from("audit_runs").select("id,property_id,status,created_at").in("property_id", propertyIds).ilike("id", `${query}%`).limit(8) : { data: [] };
  return c.json({ results: [
    ...matchedAccounts.map((item) => ({ type: "account", id: item.id, label: item.name, href: `/superadmin?view=accounts&account=${item.id}&billingEnvironment=${billingEnvironment}` })),
    ...matchedUsers.map((item) => ({ type: "user", id: item.id, label: item.email || item.id, href: `/superadmin?view=users&user=${item.id}&billingEnvironment=${billingEnvironment}` })),
    ...(workspaces.data || []).map((item) => ({ type: "workspace", id: item.id, label: item.name, href: `/superadmin?view=resources&workspace=${item.id}&billingEnvironment=${billingEnvironment}` })),
    ...(properties.data || []).map((item) => ({ type: "property", id: item.id, label: `${item.name} · ${item.canonical_host}`, href: `/superadmin?view=resources&property=${item.id}&billingEnvironment=${billingEnvironment}` })),
    ...(audits.data || []).map((item) => ({ type: "audit", id: item.id, label: `${item.id} · ${item.status}`, href: `/superadmin?view=audits&audit=${item.id}&billingEnvironment=${billingEnvironment}` })),
    ...(invoices.data || []).map((item) => ({ type: "invoice", id: item.id, label: `${item.number || item.provider_invoice_id} · ${item.status}`, href: `/superadmin?view=financials&tab=Invoices+%26+Payments&billingEnvironment=${billingEnvironment}` })),
  ] });
});

app.get("/api/superadmin/accounts", async (c) => {
  const authorization = await requireStaff(c, "customers.read");
  if (authorization.response) return authorization.response;
  const { page, pageSize, from, to } = adminPageParams(c);
  const query = safeSearchTerm(c.req.query("q"));
  const state = c.req.query("state");
  const service = admin(c.env);
  let request = service.from("accounts")
    .select("id,name,entitlement,access_state,tags,scheduled_deletion_at,created_at", { count: "exact" })
    .order(["name", "created_at"].includes(c.req.query("sort") || "") ? c.req.query("sort")! : "created_at", { ascending: c.req.query("direction") === "asc" })
    .range(from, to);
  if (query) request = request.ilike("name", `%${query}%`);
  if (state && ["active", "frozen", "blocked", "pending_deletion"].includes(state)) request = request.eq("access_state", state);
  const result = await request;
  if (result.error) return c.json({ error: "account_directory_unavailable" }, 503);
  const ids = (result.data || []).map((account) => account.id);
  const [workspaces, properties, memberships, inactivity, assignments, overrides] = await Promise.all([
    ids.length ? service.from("workspaces").select("id,account_id").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from("properties").select("id,account_id,access_state").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from("account_memberships").select("account_id,user_id,role").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from("account_inactivity").select("*").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from("account_package_assignments").select("account_id,price_grandfathered,allowances_grandfathered,complimentary,billing_state,starts_at,ends_at,package_versions(package_key,version,display_name)").in("account_id", ids).is("ends_at", null) : Promise.resolve({ data: [] }),
    ids.length ? service.from("account_entitlement_overrides").select("account_id,key,value,expires_at").in("account_id", ids).lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`) : Promise.resolve({ data: [] }),
  ]);
  return c.json({ page, pageSize, total: result.count || 0, rows: (result.data || []).map((account) => ({
    ...account,
    workspaceCount: (workspaces.data || []).filter((item) => item.account_id === account.id).length,
    propertyCount: (properties.data || []).filter((item) => item.account_id === account.id).length,
    lockedPropertyCount: (properties.data || []).filter((item) => item.account_id === account.id && item.access_state === "locked").length,
    userCount: new Set((memberships.data || []).filter((item) => item.account_id === account.id).map((item) => item.user_id)).size,
    inactivity: (inactivity.data || []).find((item) => item.account_id === account.id) || null,
    packageAssignment: (assignments.data || []).find((item) => item.account_id === account.id) || null,
    overrides: (overrides.data || []).filter((item) => item.account_id === account.id),
  })) });
});

app.get("/api/superadmin/accounts/:id", async (c) => {
  const authorization = await requireStaff(c, "customers.read");
  if (authorization.response) return authorization.response;
  const accountId = c.req.param("id");
  const service = admin(c.env);
  const [account, workspaces, properties, memberships, billingMemberships, notes, controls, activity, messages, usage, assignments, grants, overrides, inactivity] = await Promise.all([
    service.from("accounts").select("*").eq("id", accountId).single(),
    service.from("workspaces").select("*").eq("account_id", accountId).order("created_at"),
    service.from("properties").select("*").eq("account_id", accountId).order("created_at"),
    service.from("account_memberships").select("*").eq("account_id", accountId),
    service.from("account_billing_memberships").select("*").eq("account_id", accountId),
    service.from("account_internal_notes").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
    service.from("account_service_controls").select("*").eq("account_id", accountId),
    service.from("activity_log").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(100),
    service.from("customer_messages").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(100),
    service.from("account_usage_periods").select("*").eq("account_id", accountId).order("period_start", { ascending: false }).limit(100),
    service.from("account_package_assignments").select("*,package_versions(*)").eq("account_id", accountId).order("starts_at", { ascending: false }),
    service.from("account_package_grants").select("*,package_versions(*)").eq("account_id", accountId).order("created_at", { ascending: false }),
    service.from("account_entitlement_overrides").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
    service.from("account_inactivity").select("*").eq("account_id", accountId).maybeSingle(),
  ]);
  if (account.error) return c.json({ error: "account_not_found" }, 404);
  let effective;
  try { effective = await effectiveEntitlements(c.env, accountId); } catch { effective = null; }
  const [billingCustomer, billingSubscriptions, billingInvoices, billingPayments, billingRefunds, billingDisputes, billingReconciliation] = await Promise.all([
    service.from("billing_customers").select("*").eq("account_id", accountId).maybeSingle(),
    service.from("billing_subscriptions").select("*").eq("account_id", accountId).order("updated_at", { ascending: false }),
    service.from("billing_invoices").select("*").eq("account_id", accountId).order("provider_created_at", { ascending: false }).limit(100),
    service.from("billing_payments").select("*").eq("account_id", accountId).order("provider_created_at", { ascending: false }).limit(100),
    service.from("billing_refunds").select("*").eq("account_id", accountId).order("provider_created_at", { ascending: false }).limit(100),
    service.from("billing_disputes").select("*").eq("account_id", accountId).order("provider_created_at", { ascending: false }).limit(100),
    service.from("billing_reconciliation_runs").select("*").eq("account_id", accountId).order("started_at", { ascending: false }).limit(25),
  ]);
  return c.json({ account: account.data, workspaces: workspaces.data || [], properties: properties.data || [], memberships: memberships.data || [], billingMemberships: billingMemberships.data || [], notes: notes.data || [], controls: controls.data || [], activity: activity.data || [], messages: messages.data || [], usage: usage.data || [], assignments: assignments.data || [], grants: grants.data || [], overrides: overrides.data || [], inactivity: inactivity.data, effectiveEntitlements: effective, billing: { customer: billingCustomer.data || null, subscriptions: billingSubscriptions.data || [], invoices: billingInvoices.data || [], payments: billingPayments.data || [], refunds: billingRefunds.data || [], disputes: billingDisputes.data || [], reconciliation: billingReconciliation.data || [] } });
});

app.get("/api/superadmin/users/:id", async (c) => {
  const authorization = await requireStaff(c, "customers.read");
  if (authorization.response) return authorization.response;
  const userId = c.req.param("id");
  const service = admin(c.env);
  const [identity, profile, accounts, workspaces, properties, billing] = await Promise.all([
    service.auth.admin.getUserById(userId),
    service.from("profiles").select("*").eq("id", userId).maybeSingle(),
    service.from("account_memberships").select("*,accounts(id,name,access_state)").eq("user_id", userId),
    service.from("workspace_memberships").select("*,workspaces(id,name,account_id)").eq("user_id", userId),
    service.from("property_memberships").select("*,properties(id,name,canonical_host,account_id)").eq("user_id", userId),
    service.from("account_billing_memberships").select("*,accounts(id,name)").eq("user_id", userId),
  ]);
  if (identity.error || !identity.data.user) return c.json({ error: "user_not_found" }, 404);
  return c.json({ identity: { id: identity.data.user.id, email: identity.data.user.email, confirmedAt: identity.data.user.email_confirmed_at, lastSignInAt: identity.data.user.last_sign_in_at, createdAt: identity.data.user.created_at }, profile: profile.data, accountMemberships: accounts.data || [], workspaceMemberships: workspaces.data || [], propertyMemberships: properties.data || [], billingMemberships: billing.data || [] });
});

app.patch("/api/superadmin/users/:id/profile", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ fullName?: string; reason?: string }>().catch(() => ({} as any));
  const fullName = String(body.fullName || "").trim();
  const reason = String(body.reason || "").trim();
  if (!fullName || fullName.length > 120 || reason.length < 3 || reason.length > 500) return c.json({ error: "name_and_reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("profiles").select("full_name").eq("id", c.req.param("id")).maybeSingle();
  const { data, error } = await service.from("profiles").upsert({ id: c.req.param("id"), full_name: fullName, updated_at: new Date().toISOString() }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "user.profile_changed", "success", { targetType: "user", targetId: c.req.param("id"), reason, previousValues: previous, newValues: { full_name: fullName } });
  return c.json({ profile: data });
});

app.get("/api/superadmin/properties/:id", async (c) => {
  const authorization = await requireStaff(c, "customers.read");
  if (authorization.response) return authorization.response;
  const propertyId = c.req.param("id");
  const service = admin(c.env);
  const [property, monitor, viewers, audits, events, incidents] = await Promise.all([
    service.from("properties").select("*,workspaces(id,name,account_id),accounts(id,name,access_state)").eq("id", propertyId).maybeSingle(),
    service.from("uptime_monitors").select("*").eq("property_id", propertyId).maybeSingle(),
    service.from("property_memberships").select("*").eq("property_id", propertyId),
    service.from("audit_runs").select("id,status,created_at,completed_at,score,coverage").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(50),
    service.from("analytics_events").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
    service.from("incidents").select("*").eq("property_id", propertyId).order("opened_at", { ascending: false }).limit(50),
  ]);
  if (property.error || !property.data) return c.json({ error: "property_not_found" }, 404);
  return c.json({ property: property.data, monitor: monitor.data, viewers: viewers.data || [], audits: audits.data || [], analyticsEventCount: events.count || 0, incidents: incidents.data || [] });
});

app.patch("/api/superadmin/properties/:id", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ name?: string; workspaceId?: string; accessState?: string; reason?: string }>().catch(() => ({} as any));
  const name = String(body.name || "").trim();
  const reason = String(body.reason || "").trim();
  if (!name || name.length > 160 || reason.length < 3 || reason.length > 500) return c.json({ error: "name_and_reason_required" }, 400);
  if (body.accessState && !["active", "locked", "paused"].includes(body.accessState)) return c.json({ error: "invalid_property_access_state" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("properties").select("id,name,workspace_id,account_id,access_state").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "property_not_found" }, 404);
  if (body.workspaceId) {
    const workspace = await service.from("workspaces").select("id,account_id").eq("id", body.workspaceId).maybeSingle();
    if (!workspace.data || workspace.data.account_id !== previous.account_id) return c.json({ error: "workspace_must_belong_to_property_account" }, 409);
  }
  const { data, error } = await service.from("properties").update({ name, workspace_id: body.workspaceId || previous.workspace_id, access_state: body.accessState || previous.access_state }).eq("id", previous.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "property.settings_changed", "success", { targetType: "property", targetId: data.id, accountId: data.account_id, reason, previousValues: previous, newValues: { name: data.name, workspace_id: data.workspace_id, access_state: data.access_state } });
  return c.json({ property: data });
});

app.post("/api/superadmin/accounts/:id/deletion-preview", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  if (authorization.staff!.role !== "owner") return c.json({ error: "owner_permission_required" }, 403);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const accountId = c.req.param("id");
  const service = admin(c.env);
  const [account, workspaces, properties, members, usage, notices] = await Promise.all([
    service.from("accounts").select("id,name,access_state,scheduled_deletion_at").eq("id", accountId).single(),
    service.from("workspaces").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    service.from("properties").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    service.from("account_memberships").select("user_id", { count: "exact", head: true }).eq("account_id", accountId),
    service.from("account_usage_periods").select("consumed,reserved,restored").eq("account_id", accountId),
    service.from("account_inactivity").select("*").eq("account_id", accountId).maybeSingle(),
  ]);
  if (account.error) return c.json({ error: "account_not_found" }, 404);
  const dryRun = {
    generatedAt: new Date().toISOString(), account: account.data,
    accountScopedResources: { workspaces: workspaces.count || 0, properties: properties.count || 0, memberships: members.count || 0 },
    preserved: { globalUserIdentities: true, usageLedgerRows: usage.data?.length || 0, adminActivity: true },
    holds: { automaticDeletionEnabled: false, inactivityState: notices.data?.state || "not_evaluated", noticeDeliveryFailed: Boolean(notices.data?.notice_delivery_failed), analyticsReviewRequired: Boolean(notices.data?.analytics_review_required) },
  };
  const { data, error } = await service.from("deletion_requests").insert({ account_id: accountId, state: "preview", dry_run: dryRun, reason, requested_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.deletion_previewed", "previewed", { targetType: "account", targetId: accountId, accountId, reason, metadata: { deletionRequestId: data.id } });
  return c.json({ request: data, dryRun });
});

app.post("/api/superadmin/deletion-requests/:id/execute", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  if (authorization.staff!.role !== "owner") return c.json({ error: "owner_permission_required" }, 403);
  const body = await c.req.json<{ accountName?: string; confirmation?: string; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500 || body.confirmation !== "DELETE") return c.json({ error: "reason_and_delete_confirmation_required" }, 400);
  const service = admin(c.env);
  const request = await service.from("deletion_requests").select("id,account_id,state,accounts(name)").eq("id", c.req.param("id")).maybeSingle();
  if (!request.data) return c.json({ error: "deletion_request_not_found" }, 404);
  const accountName = String((request.data.accounts as any)?.name || "");
  if (!accountName || String(body.accountName || "") !== accountName) return c.json({ error: "account_name_confirmation_required" }, 400);
  const execution = await service.rpc("execute_account_master_deletion_internal", { p_request_id: request.data.id, p_actor: authorization.staff!.userId, p_reason: reason });
  if (execution.error) return c.json({ error: execution.error.message }, 409);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.master_deletion_completed", "success", { targetType: "account", targetId: request.data.account_id, accountId: request.data.account_id, reason, metadata: execution.data });
  return c.json({ completed: true, result: execution.data });
});

app.patch("/api/superadmin/accounts/:id/state", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ state?: "active" | "frozen" | "blocked" | "pending_deletion"; reason?: string; scheduledDeletionAt?: string | null }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (!body.state || !["active", "frozen", "blocked", "pending_deletion"].includes(body.state)) return c.json({ error: "valid_account_state_required" }, 400);
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  if (body.state === "pending_deletion" && authorization.staff!.role !== "owner") return c.json({ error: "owner_permission_required" }, 403);
  const service = admin(c.env);
  const { data: previous } = await service.from("accounts").select("access_state,access_state_reason,scheduled_deletion_at").eq("id", c.req.param("id")).single();
  if (!previous) return c.json({ error: "account_not_found" }, 404);
  const { data, error } = await service.from("accounts").update({ access_state: body.state, access_state_reason: reason, access_state_changed_at: new Date().toISOString(), scheduled_deletion_at: body.state === "pending_deletion" ? body.scheduledDeletionAt || null : null }).eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.state_changed", "success", { targetType: "account", targetId: data.id, accountId: data.id, reason, previousValues: previous, newValues: { access_state: data.access_state, scheduled_deletion_at: data.scheduled_deletion_at } });
  return c.json({ account: data });
});

app.post("/api/superadmin/accounts/:id/notes", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ body?: string }>().catch(() => ({} as any));
  const note = String(body.body || "").trim();
  if (!note || note.length > 5000) return c.json({ error: "valid_note_required" }, 400);
  const { data, error } = await admin(c.env).from("account_internal_notes").insert({ account_id: c.req.param("id"), body: note, created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.note_added", "success", { targetType: "account", targetId: c.req.param("id"), accountId: c.req.param("id"), metadata: { noteId: data.id } });
  return c.json({ note: data }, 201);
});

app.patch("/api/superadmin/accounts/:id/tags", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ tags?: unknown; reason?: string }>().catch(() => ({} as any));
  const tags = normalizeAccountTags(body.tags);
  const reason = String(body.reason || "").trim();
  if (!tags || reason.length < 3 || reason.length > 500) return c.json({ error: "valid_tags_and_reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("accounts").select("tags").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "account_not_found" }, 404);
  const { data, error } = await service.from("accounts").update({ tags }).eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.tags_changed", "success", { targetType: "account", targetId: data.id, accountId: data.id, reason, previousValues: { tags: previous.tags || [] }, newValues: { tags } });
  return c.json({ account: data });
});

app.patch("/api/superadmin/accounts/:id/services/:service", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const serviceKey = c.req.param("service");
  if (!["audits", "analytics", "uptime", "reports", "email"].includes(serviceKey)) return c.json({ error: "valid_account_service_required" }, 400);
  const body = await c.req.json<{ paused?: boolean; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (typeof body.paused !== "boolean" || reason.length < 3 || reason.length > 500) return c.json({ error: "paused_state_and_reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("account_service_controls").select("paused,reason,changed_at").eq("account_id", c.req.param("id")).eq("service", serviceKey).maybeSingle();
  const { data, error } = await service.from("account_service_controls").upsert({ account_id: c.req.param("id"), service: serviceKey, paused: body.paused, reason, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() }, { onConflict: "account_id,service" }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.service_control_changed", "success", { targetType: "account", targetId: c.req.param("id"), accountId: c.req.param("id"), reason, previousValues: previous || { paused: false }, newValues: { service: serviceKey, paused: body.paused } });
  return c.json({ control: data });
});

app.post("/api/superadmin/accounts/:id/messages", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ subject?: string; body?: string; channel?: "in_app" | "email"; userId?: string; propertyId?: string; reason?: string }>().catch(() => ({} as any));
  const subject = String(body.subject || "").trim();
  const message = String(body.body || "").trim();
  const reason = String(body.reason || "").trim();
  if (!subject || subject.length > 200 || !message || message.length > 10000 || !["in_app", "email"].includes(body.channel || "") || reason.length < 3 || reason.length > 500) return c.json({ error: "valid_draft_message_and_reason_required" }, 400);
  const { data, error } = await admin(c.env).from("customer_messages").insert({ account_id: c.req.param("id"), user_id: body.userId || null, property_id: body.propertyId || null, subject, body: message, channel: body.channel, status: "draft", created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "customer_message.drafted", "success", { targetType: "customer_message", targetId: data.id, accountId: c.req.param("id"), reason, metadata: { channel: body.channel, userId: body.userId || null, propertyId: body.propertyId || null } });
  return c.json({ message: data, delivery: "not_sent" }, 201);
});

app.get("/api/superadmin/saved-views", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  let request = admin(c.env).from("saved_admin_views").select("id,page,name,filters,created_at").eq("staff_user_id", authorization.staff!.userId).order("name");
  if (c.req.query("page")) request = request.eq("page", String(c.req.query("page")));
  const { data, error } = await request;
  if (error) return c.json({ error: "saved_views_unavailable" }, 503);
  return c.json({ views: data || [] });
});

app.post("/api/superadmin/saved-views", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ page?: string; name?: string; filters?: Record<string, unknown> }>().catch(() => ({} as any));
  const page = String(body.page || "").trim().slice(0, 80);
  const name = String(body.name || "").trim().slice(0, 80);
  const serialized = JSON.stringify(body.filters || {});
  if (!page || !name || serialized.length > 10000) return c.json({ error: "valid_saved_view_required" }, 400);
  const { data, error } = await admin(c.env).from("saved_admin_views").upsert({ staff_user_id: authorization.staff!.userId, page, name, filters: body.filters || {} }, { onConflict: "staff_user_id,page,name" }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "admin_view.saved", "success", { targetType: "saved_admin_view", targetId: data.id, metadata: { page, name } });
  return c.json({ view: data }, 201);
});

app.delete("/api/superadmin/saved-views/:id", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  const { data, error } = await admin(c.env).from("saved_admin_views").delete().eq("id", c.req.param("id")).eq("staff_user_id", authorization.staff!.userId).select().maybeSingle();
  if (error || !data) return c.json({ error: "saved_view_not_found" }, 404);
  await recordAdminActivity(c.env, authorization.staff!.userId, "admin_view.removed", "success", { targetType: "saved_admin_view", targetId: data.id, metadata: { page: data.page, name: data.name } });
  return c.json({ removed: true });
});

app.post("/api/superadmin/users/:id/verification-resend", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const userResult = await service.auth.admin.getUserById(c.req.param("id"));
  const user = userResult.data.user;
  if (userResult.error || !user?.email) return c.json({ error: "user_not_found" }, 404);
  if (user.email_confirmed_at) return c.json({ error: "email_already_confirmed" }, 409);
  const resend = await service.auth.resend({ type: "signup", email: user.email, options: { emailRedirectTo: `${c.env.APP_ORIGIN.replace(/\/$/, "")}/auth/confirmed` } });
  if (resend.error) {
    await recordAdminActivity(c.env, authorization.staff!.userId, "user.verification_resent", "failed", { targetType: "user", targetId: user.id, reason, metadata: { error: resend.error.message } });
    return c.json({ error: "verification_resend_failed" }, 503);
  }
  await recordAdminActivity(c.env, authorization.staff!.userId, "user.verification_resent", "success", { targetType: "user", targetId: user.id, reason });
  return c.json({ resent: true });
});

app.patch("/api/superadmin/users/:id/confirm-email", async (c) => {
  const authorization = await requireStaff(c, "customers.write");
  if (authorization.response) return authorization.response;
  if (authorization.staff!.role !== "owner") return c.json({ error: "owner_permission_required" }, 403);
  const body = await c.req.json<{ reason?: string; confirmation?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500 || body.confirmation !== "CONFIRM EMAIL") return c.json({ error: "reason_and_confirmation_required" }, 400);
  const service = admin(c.env);
  const before = await service.auth.admin.getUserById(c.req.param("id"));
  if (before.error || !before.data.user) return c.json({ error: "user_not_found" }, 404);
  const updated = await service.auth.admin.updateUserById(c.req.param("id"), { email_confirm: true });
  if (updated.error) return c.json({ error: "manual_confirmation_failed" }, 503);
  await recordAdminActivity(c.env, authorization.staff!.userId, "user.email_manually_confirmed", "success", { targetType: "user", targetId: c.req.param("id"), reason, previousValues: { confirmedAt: before.data.user.email_confirmed_at || null }, newValues: { confirmedAt: updated.data.user.email_confirmed_at || "confirmed" }, metadata: { membershipCreated: false } });
  return c.json({ user: { id: updated.data.user.id, email: updated.data.user.email, confirmedAt: updated.data.user.email_confirmed_at }, membershipCreated: false });
});

app.get("/api/superadmin/platform", async (c) => {
  const authorization = await requireStaff(c, "overview.read");
  if (authorization.response) return authorization.response;
  const selectedBillingEnvironment = c.req.query("billingEnvironment") || "live";
  if (!["test", "live"].includes(selectedBillingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const billingEnvironment = selectedBillingEnvironment as BillingEnvironment;
  const stripeProvider = stripeContext(c.env, billingEnvironment);
  const service = admin(c.env);
  const today = new Date().toISOString().slice(0, 10);
  const storageRefresh = c.req.query("refreshStorage") === "force"
    ? await service.rpc("refresh_analytics_storage_snapshots")
    : { data: null, error: null };
  const [settings, settingHistory, controls, alerts, alertRules, alertHistory, incidents, packages, grants, overrides, inactivity, auditDefinitions, auditGroups, auditGroupChecks, auditGroupHistory, auditPackageAvailability, auditRuns, exports, deletionRequests, templates, automations, campaigns, billingCustomers, billingEvents, promotions, deliveries, suppressions, databaseMetrics, operationalEvents, leases] = await Promise.all([
    service.from("platform_settings").select("*").order("key"),
    service.from("platform_setting_history").select("*").order("changed_at", { ascending: false }).limit(250),
    service.from("emergency_controls").select("*").order("key"),
    service.from("platform_alerts").select("*").order("created_at", { ascending: false }).limit(100),
    service.from("alert_rules").select("*").order("created_at", { ascending: false }).limit(250),
    service.from("platform_alert_history").select("*").order("created_at", { ascending: false }).limit(250),
    service.from("platform_incidents").select("*").order("opened_at", { ascending: false }).limit(100),
    service.from("package_versions").select("*").order("package_key").order("version", { ascending: false }),
    service.from("account_package_grants").select("id,account_id,package_version_id,arrangement,status,starts_at,expires_at,reason,created_at,package_versions(display_name,package_key,version)").order("created_at", { ascending: false }).limit(250),
    service.from("account_entitlement_overrides").select("id,account_id,key,value,reason,starts_at,expires_at,created_at,grant_id,revoked_at").order("created_at", { ascending: false }).limit(250),
    service.from("account_inactivity").select("*").order("updated_at", { ascending: false }).limit(5000),
    service.from("audit_check_definitions").select("id,title,primary_category,subcategory,severity,lifecycle,configuration_version,changed_at,thresholds,weight,timeout_class,execution_method").order("id"),
    service.from("audit_user_facing_groups").select("*").order("sort_order"),
    service.from("audit_user_facing_group_checks").select("group_id,check_id,sort_order").order("sort_order"),
    service.from("audit_group_history").select("id,group_id,snapshot,reason,changed_by,changed_at").order("changed_at", { ascending: false }).limit(250),
    service.from("audit_catalogue_package_availability").select("target_kind,target_id,entitlement,enabled,changed_at").order("entitlement").limit(5000),
    service.from("audit_runs").select("id,status,duration_ms,error,created_at").gte("created_at", `${today}T00:00:00.000Z`).limit(1000),
    service.from("admin_export_jobs").select("id,scope,format,state,progress,row_count,error,expires_at,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
    service.from("deletion_requests").select("*").order("created_at", { ascending: false }).limit(100),
    service.from("email_templates").select("id,template_key,version,subject,html_body,text_body,variables,state,description,provider_managed,sending_path,published_at,supersedes_id,created_at").order("template_key").order("version", { ascending: false }),
    service.from("email_automations").select("*").order("key"),
    service.from("email_campaigns").select("*").order("created_at", { ascending: false }).limit(100),
    service.from("billing_customers").select("*").eq("billing_environment", billingEnvironment).limit(1000),
    service.from("billing_events").select("id,provider_event_id,event_type,provider_created_at,processing_state,attempts,error,received_at,processed_at,billing_environment").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(250),
    service.from("promotion_rules").select("*").eq("billing_environment", billingEnvironment).order("created_at", { ascending: false }).limit(100),
    service.from("notification_deliveries").select("id,kind,recipient,status,provider,provider_status,provider_id,error,is_test,account_id,property_id,template_id,automation_key,campaign_id,payload,created_at,updated_at").order("created_at", { ascending: false }).limit(250),
    service.from("email_suppressions").select("id,recipient,category,reason,source,created_at,lifted_at").is("lifted_at", null).order("created_at", { ascending: false }).limit(250),
    service.rpc("superadmin_database_metrics"),
    service.from("operational_events").select("id,service,metric,value,unit,source,account_id,property_id,metadata,observed_at").gte("observed_at", `${today}T00:00:00.000Z`).order("observed_at", { ascending: false }).limit(2000),
    service.from("processing_leases").select("id,job_type,job_id,account_id,state,expires_at,created_at,updated_at").order("created_at", { ascending: false }).limit(500),
  ]);
  const runs = auditRuns.data || [];
  const auditStatus = Object.fromEntries(["queued", "running", "completed", "partial", "failed"].map((status) => [status, runs.filter((run) => run.status === status).length]));
  const settingValues = Object.fromEntries((settings.data || []).map((item) => [item.key, item.value]));
  const controlByKey = new Map((controls.data || []).map((item) => [item.key, item]));
  const outbound = settingValues.outbound_automation || {};
  const digest = settingValues.alert_digest || {};
  const campaignConfigured = Array.isArray(outbound.safeTestRecipients) && outbound.safeTestRecipients.length > 0 && (templates.data || []).some((item) => item.state === "active" && !item.provider_managed);
  const weeklyConfigured = Array.isArray(digest.recipients) && digest.recipients.length > 0;
  const featureStates = {
    campaigns: deriveFeatureState({ permitted: !controlByKey.get("campaigns")?.paused, configured: campaignConfigured, enabled: outbound.campaignsEnabled === true, dependencyAvailable: Boolean(c.env.RESEND_API_KEY && c.env.RESEND_FROM), dependency: "Resend credentials and sender identity are unavailable", draftExists: (campaigns.data || []).some((item) => item.state === "draft"), runningJobs: (campaigns.data || []).filter((item) => item.state === "sending").length }),
    inactivityNotices: deriveFeatureState({ permitted: true, configured: Array.isArray(outbound.safeTestRecipients) && outbound.safeTestRecipients.length > 0, enabled: outbound.inactivityNoticesEnabled === true, dependencyAvailable: Boolean(c.env.RESEND_API_KEY && c.env.RESEND_FROM), dependency: "Resend credentials and safe test recipients are required" }),
    weeklyDigest: deriveFeatureState({ permitted: true, configured: weeklyConfigured, enabled: digest.enabled === true && outbound.weeklyDigestEnabled === true, dependencyAvailable: Boolean(c.env.RESEND_API_KEY && c.env.RESEND_FROM), dependency: "Resend credentials and digest recipients are required" }),
  };
  const [billingConfiguration, billingCatalogue, billingSubscriptions, billingInvoices, billingPayments, billingRefunds, billingDisputes, billingReconciliation, billingDaily, billingPayouts] = await Promise.all([
    service.from("billing_environment_configurations").select("*").eq("environment", billingEnvironment).maybeSingle(),
    service.from("billing_catalogue_prices").select("*,package_versions(package_key,display_name,version,state,allowances,unresolved_values)").eq("billing_environment", billingEnvironment).order("currency").order("interval"),
    service.from("billing_subscriptions").select("*,accounts(name),package_versions(package_key,display_name,version,allowances),billing_subscription_items(*),billing_subscription_discounts(*)").eq("billing_environment", billingEnvironment).order("updated_at", { ascending: false }).limit(2000),
    service.from("billing_invoices").select("*,accounts(name)").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(2000),
    service.from("billing_payments").select("*,accounts(name)").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(2000),
    service.from("billing_refunds").select("*,accounts(name)").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(1000),
    service.from("billing_disputes").select("*,accounts(name)").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(1000),
    service.from("billing_reconciliation_runs").select("*,accounts(name)").eq("billing_environment", billingEnvironment).order("started_at", { ascending: false }).limit(250),
    service.from("billing_daily_finance").select("*").eq("billing_environment", billingEnvironment).order("day", { ascending: true }).limit(2000),
    service.from("billing_payouts").select("*").eq("billing_environment", billingEnvironment).order("provider_created_at", { ascending: false }).limit(1000),
  ]);
  const [analyticsRules, analyticsStorage, analyticsUsage, analyticsWarnings] = await Promise.all([
    service.from("analytics_plan_rules").select("*").order("monthly_pageview_limit"),
    service.from("analytics_storage_snapshots").select("*,accounts(name),properties(name,canonical_host)").order("measured_at", { ascending: false }).limit(10000),
    service.from("account_analytics_monthly_usage").select("*,accounts(name)").eq("period_start", `${today.slice(0, 7)}-01`).order("accepted_pageviews", { ascending: false }).limit(5000),
    service.from("analytics_usage_warnings").select("*,accounts(name)").order("created_at", { ascending: false }).limit(250),
  ]);
  const finance = financeMetrics({ subscriptions: billingSubscriptions.data || [], invoices: billingInvoices.data || [], payments: billingPayments.data || [], refunds: billingRefunds.data || [], disputes: billingDisputes.data || [] }, billingEnvironment);
  const subscriptionRows = (billingSubscriptions.data || []).map((subscription: any) => ({
    ...subscription,
    metadata: {
      ...(subscription.metadata || {}),
      basePriceId: subscription.package_versions
        ? `${subscription.package_versions.display_name} v${subscription.package_versions.version}`
        : subscription.metadata?.basePriceId,
    },
    included_editing_seats: subscription.included_editing_seats ?? subscription.package_versions?.allowances?.editingSeats ?? null,
  }));
  const providerMode = stripeProvider.client ? billingEnvironment : "unconfigured";
  const paidPackages = ["essentials", "scale", "pro"];
  const baseCatalogueKeys = paidPackages.flatMap((packageKey) => ["gbp", "eur", "usd"].flatMap((currency) => ["month", "year"].map((interval) => `${packageKey}:${currency}:${interval}:base`)));
  const unresolvedSeatPackages = (packages.data || []).filter((item: any) => paidPackages.includes(item.package_key) && item.state === "published" && !Number.isSafeInteger(Number(item.allowances?.editingSeats))).map((item: any) => item.package_key);
  const packagesRequiringSeatPrices = (packages.data || []).filter((item: any) => paidPackages.includes(item.package_key) && item.state === "published" && Number.isSafeInteger(Number(item.allowances?.editingSeats)) && item.features?.billableAdditionalEditingSeats === true).map((item: any) => item.package_key);
  const seatCatalogueKeys = packagesRequiringSeatPrices.flatMap((packageKey: string) => ["gbp", "eur", "usd"].flatMap((currency) => ["month", "year"].map((interval) => `${packageKey}:${currency}:${interval}:additional_editing_seat`)));
  const requiredCatalogueKeys = [...baseCatalogueKeys, ...seatCatalogueKeys];
  const catalogueKeys = new Set((billingCatalogue.data || []).filter((price) => price.active && price.billing_environment === billingEnvironment).map((price: any) => `${price.package_versions?.package_key}:${price.currency}:${price.interval}:${price.component}`));
  const catalogueReady = requiredCatalogueKeys.every((key) => catalogueKeys.has(key));
  const portalReady = Boolean(billingConfiguration.data?.portal_configuration_id || stripeProvider.portalConfigurationId);
  const liveReadiness = {
    credentials: Boolean(stripeProvider.client),
    webhook: Boolean(stripeProvider.webhookSecret),
    catalogue: catalogueReady,
    portal: portalReady,
    tax: Boolean(billingConfiguration.data?.tax_reviewed_at),
    sandboxAcceptance: Boolean(billingConfiguration.data?.sandbox_acceptance_completed_at),
  };
  const monthStartIso = `${today.slice(0, 7)}-01T00:00:00.000Z`;
  const [resendDailyUsage, resendMonthlyUsage] = await Promise.all([
    service.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("provider", "Resend").in("status", ["sent", "delivered"]).gte("created_at", `${today}T00:00:00.000Z`),
    service.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("provider", "Resend").in("status", ["sent", "delivered"]).gte("created_at", monthStartIso),
  ]);
  return c.json({
    environment: { name: c.env.APP_ORIGIN.includes("app.claritude.io") ? "Production" : "Preview", commitSha: c.env.DEPLOY_COMMIT_SHA || null, refreshedAt: new Date().toISOString() },
    providers: { stripe: { configured: stripeProvider.configured, mode: providerMode, keyType: stripeKeyEnvironment(billingEnvironment === "test" ? c.env.STRIPE_TEST_SECRET_KEY || c.env.STRIPE_SECRET_KEY : c.env.STRIPE_LIVE_SECRET_KEY || c.env.STRIPE_SECRET_KEY), webhookConfigured: Boolean(stripeProvider.webhookSecret), portalConfigured: Boolean(billingConfiguration.data?.portal_configuration_id || stripeProvider.portalConfigurationId), tax: billingConfiguration.data?.tax_enabled ? "enabled" : "disabled" }, resend: { configured: Boolean(c.env.RESEND_API_KEY), from: c.env.RESEND_FROM || null, usage: { daily: resendDailyUsage.error ? null : resendDailyUsage.count || 0, monthly: resendMonthlyUsage.error ? null : resendMonthlyUsage.count || 0, dailyLimit: 100, monthlyLimit: 3000, source: "Claritude delivery ledger; plan limits supplied by administrator" } }, cloudflareTelemetry: "unavailable", supabaseBackups: "unverified" },
    settings: settings.data || [], settingHistory: settingHistory.data || [], controls: controls.data || [], featureStates, alerts: alerts.data || [], alertRules: alertRules.data || [], alertHistory: alertHistory.data || [], alertCoverage: { enabledRuleCount: (alertRules.data || []).filter((item) => item.enabled).length, lastEvaluationAt: (alertRules.data || []).map((item) => item.last_evaluated_at).filter(Boolean).sort().at(-1) || null, evaluatorHealth: !(alertRules.data || []).length ? "no_rules" : (alertRules.data || []).some((item) => item.evaluation_state === "failing") ? "failing" : (alertRules.data || []).every((item) => item.evaluation_state === "not_started") ? "not_started" : (alertRules.data || []).some((item) => item.evaluation_state === "telemetry_unavailable") ? "telemetry_unavailable" : "healthy" }, incidents: incidents.data || [], packages: packages.data || [], grants: grants.data || [], overrides: overrides.data || [], inactivity: inactivity.data || [],
    audits: { technicalChecks: auditDefinitions.data || [], groups: auditGroups.data || [], groupChecks: auditGroupChecks.data || [], groupHistory: auditGroupHistory.data || [], packageAvailability: auditPackageAvailability.data || [], today: auditStatus, runs: runs, source: "application_measured", period: "UTC day" },
    infrastructure: { database: databaseMetrics.data || null, databaseError: databaseMetrics.error?.message || null, events: operationalEvents.data || [], leases: leases.data || [], period: "UTC day" },
    analyticsManagement: { rules: analyticsRules.data || [], storage: analyticsStorage.data || [], usage: analyticsUsage.data || [], warnings: analyticsWarnings.data || [], storageRefresh: storageRefresh.data || null, storageError: storageRefresh.error?.message || analyticsStorage.error?.message || null },
    exports: exports.data || [], deletionRequests: deletionRequests.data || [], email: { templates: templates.data || [], automations: automations.data || [], campaigns: campaigns.data || [], deliveries: deliveries.data || [], suppressions: suppressions.data || [] },
    billing: { environment: billingEnvironment, configured: stripeProvider.configured, providerMode, configuration: billingConfiguration.data || null, catalogueReady, liveReadiness, catalogueRequirements: { requiredCount: requiredCatalogueKeys.length, basePriceCount: 18, maximumWithSeatPrices: 36, missing: requiredCatalogueKeys.filter((key) => !catalogueKeys.has(key)), unresolvedSeatPackages, packagesRequiringSeatPrices, explanation: "Eighteen base prices cover 3 paid packages × 3 currencies × 2 billing intervals. The total becomes 36 only if every package separately sells additional seats; a package needs a seat price only when its approved allowance and commercial policy permit paid seat overage." }, catalogue: billingCatalogue.data || [], customers: billingCustomers.data || [], subscriptions: subscriptionRows, invoices: billingInvoices.data || [], payments: billingPayments.data || [], refunds: billingRefunds.data || [], disputes: billingDisputes.data || [], payouts: billingPayouts.data || [], reconciliation: billingReconciliation.data || [], daily: billingDaily.data || [], events: billingEvents.data || [], promotions: promotions.data || [], calculations: finance, currencyPolicy: "Every finance query is scoped to one billing environment and each series to one currency. No implicit FX conversion is applied. MRR includes every recurring item, annual values divided by 12, and applicable recurring discounts. Daily activity is distinct from available and pending balances; only succeeded refunds reduce completed refund totals." },
  });
});

app.post("/api/superadmin/analytics-storage/refresh", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const { data, error } = await service.rpc("refresh_analytics_storage_snapshots");
  if (error) return c.json({ error: error.message }, 503);
  await recordAdminActivity(c.env, authorization.staff!.userId, "analytics.storage_estimates_refreshed", "success", {
    targetType: "analytics_storage",
    reason: "Manual SuperAdmin refresh",
    metadata: data || {},
  });
  return c.json(data || { refreshed: true });
});

app.post("/api/superadmin/billing/events/:id/reprocess", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const db = admin(c.env);
  const { data: record } = await db.from("billing_events").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!record) return c.json({ error: "billing_event_not_found" }, 404);
  try {
    await applyVerifiedBillingEvent(c.env, record.payload as Stripe.Event);
    const { data, error } = await db.from("billing_events").update({ processing_state: "processed", attempts: Number(record.attempts || 0) + 1, error: null, processed_at: new Date().toISOString() }).eq("id", record.id).select().single();
    if (error) throw error;
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.event_reprocessed", "success", { targetType: "billing_event", targetId: record.id, reason, metadata: { providerEventId: record.provider_event_id } });
    return c.json({ event: data });
  } catch (error) {
    await db.from("billing_events").update({ processing_state: "failed", attempts: Number(record.attempts || 0) + 1, error: errorMessage(error).slice(0, 1000) }).eq("id", record.id);
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.event_reprocessed", "failed", { targetType: "billing_event", targetId: record.id, reason, metadata: { providerEventId: record.provider_event_id, error: errorMessage(error) } });
    return c.json({ error: "billing_event_reprocessing_failed" }, 503);
  }
});

app.post("/api/superadmin/billing/catalogue", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ billingEnvironment?: BillingEnvironment; packageVersionId?: string; priceId?: string; component?: "base" | "additional_editing_seat"; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (!["test", "live"].includes(body.billingEnvironment || "") || !body.packageVersionId || !body.priceId || !["base", "additional_editing_seat"].includes(body.component || "") || reason.length < 3) return c.json({ error: "environment_package_price_component_and_reason_required" }, 400);
  const stripe = stripeClient(c.env, body.billingEnvironment!);
  if (!stripe) return c.json({ error: "stripe_credentials_required" }, 409);
  const db = admin(c.env);
  const packageVersion = await db.from("package_versions").select("id,package_key,display_name").eq("id", body.packageVersionId).maybeSingle();
  if (!packageVersion.data || !["essentials", "scale", "pro"].includes(packageVersion.data.package_key)) return c.json({ error: "paid_package_version_required" }, 400);
  const price = await stripe.prices.retrieve(body.priceId, { expand: ["product"] });
  const product: any = price.product;
  if (!price.active || !price.recurring || price.unit_amount == null || typeof product === "string" || !product.active) return c.json({ error: "active_recurring_price_and_product_required" }, 409);
  if (!["month", "year"].includes(price.recurring.interval)) return c.json({ error: "unsupported_billing_interval" }, 409);
  const livemode = body.billingEnvironment === "live";
  if (price.livemode !== livemode) return c.json({ error: "stripe_environment_mismatch" }, 409);
  const row = { billing_environment: body.billingEnvironment, package_version_id: body.packageVersionId, provider_product_id: product.id, provider_price_id: price.id, currency: price.currency, interval: price.recurring.interval, component: body.component, unit_amount_minor: price.unit_amount, tax_behavior: price.tax_behavior || "unspecified", active: true, provider_livemode: price.livemode, verified_at: new Date().toISOString(), verified_by: authorization.staff!.userId, updated_at: new Date().toISOString(), metadata: { productName: product.name, productTaxCode: product.tax_code || null, recurringUsageType: price.recurring.usage_type || null } };
  const saved = await db.from("billing_catalogue_prices").upsert(row, { onConflict: "billing_environment,package_version_id,currency,interval,component" }).select().single();
  if (saved.error) return c.json({ error: saved.error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "billing.catalogue_price_verified", "success", { targetType: "stripe_price", targetId: price.id, reason, newValues: row, metadata: { packageKey: packageVersion.data.package_key } });
  return c.json({ price: saved.data });
});

app.post("/api/superadmin/billing/promotions", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{
    billingEnvironment?: BillingEnvironment; operationKey?: string; code?: string; internalName?: string; description?: string;
    discountType?: "percentage" | "fixed"; percentage?: number; fixedAmountMinor?: number; currency?: string;
    durationType?: "once" | "billing_periods" | "forever"; durationCount?: number; eligiblePackages?: string[];
    eligibleIntervals?: string[]; newCustomersOnly?: boolean; redemptionLimit?: number; expiresAt?: string;
    enabled?: boolean; reason?: string;
  }>().catch(() => ({} as any));
  const billingEnvironment = body.billingEnvironment;
  const operationKey = String(body.operationKey || "");
  const code = String(body.code || "").trim().toUpperCase();
  const internalName = String(body.internalName || "").trim();
  const description = String(body.description || "").trim();
  const reason = String(body.reason || "").trim();
  const eligiblePackages: string[] = [...new Set<string>(((body.eligiblePackages || []) as unknown[]).map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean))];
  const eligibleIntervals: string[] = [...new Set<string>(((body.eligibleIntervals || []) as unknown[]).map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean))];
  const percentage = Number(body.percentage || 0);
  const fixedAmountMinor = Math.trunc(Number(body.fixedAmountMinor || 0));
  const durationCount = Math.trunc(Number(body.durationCount || 0));
  const redemptionLimit = body.redemptionLimit == null || body.redemptionLimit === 0 ? null : Math.trunc(Number(body.redemptionLimit));
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (!billingEnvironment || !["test", "live"].includes(billingEnvironment) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(operationKey) || !/^[A-Z0-9-]{3,40}$/.test(code) || internalName.length < 3 || internalName.length > 120 || description.length > 500 || reason.length < 3 || reason.length > 500) return c.json({ error: "valid_environment_operation_code_name_and_reason_required" }, 400);
  if (!body.discountType || !["percentage", "fixed"].includes(body.discountType) || !body.durationType || !["once", "billing_periods", "forever"].includes(body.durationType)) return c.json({ error: "valid_discount_and_duration_required" }, 400);
  if (body.discountType === "percentage" ? !(percentage > 0 && percentage <= 100) : !(fixedAmountMinor > 0 && /^[a-z]{3}$/.test(String(body.currency || "").toLowerCase()))) return c.json({ error: "valid_discount_value_required" }, 400);
  if (body.durationType === "billing_periods" && (durationCount < 1 || durationCount > 36)) return c.json({ error: "valid_billing_period_duration_required" }, 400);
  if (redemptionLimit != null && (redemptionLimit < 1 || redemptionLimit > 1_000_000)) return c.json({ error: "valid_redemption_limit_required" }, 400);
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 5 * 365 * 86400_000)) return c.json({ error: "redemption_expiry_must_be_future_within_five_years" }, 400);
  if (eligiblePackages.some((key) => !["essentials", "scale", "pro"].includes(key))) return c.json({ error: "unsupported_eligible_package" }, 400);
  if (eligibleIntervals.some((interval) => !["month", "year"].includes(interval))) return c.json({ error: "unsupported_eligible_interval" }, 400);
  if (eligibleIntervals.length) return c.json({ error: "stripe_promotion_interval_restrictions_not_supported", detail: "Stripe promotion codes cannot safely restrict Checkout redemption by recurring interval for this catalogue. Create a package-scoped code without an interval restriction." }, 409);
  const stripe = stripeClient(c.env, billingEnvironment);
  if (!stripe) return c.json({ error: "stripe_credentials_required", environment: billingEnvironment }, 409);
  const db = admin(c.env);
  const existing = await db.from("promotion_rules").select("*").eq("billing_environment", billingEnvironment).eq("operation_key", operationKey).maybeSingle();
  if (existing.data?.provider_sync_state === "synced") return c.json({ promotion: existing.data, reused: true });
  const catalogue = eligiblePackages.length
    ? await db.from("billing_catalogue_prices").select("provider_product_id,package_versions(package_key)").eq("billing_environment", billingEnvironment).eq("active", true)
    : { data: [], error: null };
  if (catalogue.error) return c.json({ error: "promotion_catalogue_unavailable" }, 503);
  const productIds = [...new Set((catalogue.data || []).filter((row: any) => eligiblePackages.includes(row.package_versions?.package_key)).map((row: any) => row.provider_product_id))];
  const mappedPackageKeys = new Set((catalogue.data || []).filter((row: any) => productIds.includes(row.provider_product_id)).map((row: any) => row.package_versions?.package_key));
  const missingPackages = eligiblePackages.filter((key) => !mappedPackageKeys.has(key));
  if (missingPackages.length) return c.json({ error: "verified_catalogue_products_required", missingPackages }, 409);
  const row = {
    billing_environment: billingEnvironment, operation_key: operationKey, code, internal_name: internalName, description: description || null,
    discount_type: body.discountType, percentage: body.discountType === "percentage" ? percentage : null,
    fixed_amount_minor: body.discountType === "fixed" ? fixedAmountMinor : null, currency: body.discountType === "fixed" ? String(body.currency).toLowerCase() : null,
    duration_type: body.durationType, duration_count: body.durationType === "billing_periods" ? durationCount : null,
    eligible_packages: eligiblePackages, eligible_intervals: [], new_customers_only: body.newCustomersOnly === true,
    redemption_limit: redemptionLimit, expires_at: expiresAt?.toISOString() || null, enabled: body.enabled !== false,
    provider_sync_state: "draft", provider_sync_error: null, created_by: authorization.staff!.userId, updated_at: new Date().toISOString(),
  };
  const stored = existing.data
    ? await db.from("promotion_rules").update(row).eq("id", existing.data.id).select().single()
    : await db.from("promotion_rules").insert(row).select().single();
  if (stored.error || !stored.data) return c.json({ error: stored.error?.code === "23505" ? "promotion_code_already_exists" : stored.error?.message || "promotion_persistence_failed" }, stored.error?.code === "23505" ? 409 : 503);
  try {
    const couponParams: Stripe.CouponCreateParams = {
      name: internalName,
      duration: body.durationType === "billing_periods" ? "repeating" : body.durationType,
      ...(body.durationType === "billing_periods" ? { duration_in_months: durationCount } : {}),
      ...(body.discountType === "percentage" ? { percent_off: percentage } : { amount_off: fixedAmountMinor, currency: String(body.currency).toLowerCase() }),
      ...(productIds.length ? { applies_to: { products: productIds } } : {}),
      metadata: { claritudePromotionRuleId: stored.data.id, billingEnvironment, operationKey },
    };
    const coupon = await stripe.coupons.create(couponParams, { idempotencyKey: `promotion-coupon:${billingEnvironment}:${operationKey}` });
    const promotion = await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: coupon.id }, code, active: body.enabled !== false, ...(expiresAt ? { expires_at: Math.floor(expiresAt.getTime() / 1000) } : {}), ...(redemptionLimit ? { max_redemptions: redemptionLimit } : {}), restrictions: { first_time_transaction: body.newCustomersOnly === true }, metadata: { claritudePromotionRuleId: stored.data.id, billingEnvironment, operationKey } }, { idempotencyKey: `promotion-code:${billingEnvironment}:${operationKey}` });
    if (coupon.livemode !== (billingEnvironment === "live") || promotion.livemode !== (billingEnvironment === "live")) throw new Error("stripe_environment_mismatch");
    const synced = await db.from("promotion_rules").update({ provider_coupon_id: coupon.id, provider_promotion_code_id: promotion.id, provider_sync_state: "synced", provider_sync_error: null, provider_times_redeemed: promotion.times_redeemed, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", stored.data.id).select().single();
    if (synced.error) throw synced.error;
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.promotion_created", "success", { targetType: "promotion", targetId: stored.data.id, reason, newValues: { ...row, providerCouponId: coupon.id, providerPromotionCodeId: promotion.id } });
    return c.json({ promotion: synced.data }, 201);
  } catch (error) {
    const detail = errorMessage(error).slice(0, 1000);
    await db.from("promotion_rules").update({ provider_sync_state: "failed", provider_sync_error: detail, updated_at: new Date().toISOString() }).eq("id", stored.data.id);
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.promotion_created", "failed", { targetType: "promotion", targetId: stored.data.id, reason, metadata: { error: detail } });
    return c.json({ error: "promotion_synchronisation_failed", detail }, 503);
  }
});

app.patch("/api/superadmin/billing/configuration", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ billingEnvironment?: BillingEnvironment; checkoutEnabled?: boolean; taxEnabled?: boolean; portalConfigurationId?: string; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (!["test", "live"].includes(body.billingEnvironment || "") || reason.length < 3 || reason.length > 500) return c.json({ error: "environment_and_reason_required" }, 400);
  const billingEnvironment = body.billingEnvironment!;
  const db = admin(c.env);
  const previous = await db.from("billing_environment_configurations").select("*").eq("environment", billingEnvironment).single();
  const provider = stripeContext(c.env, billingEnvironment);
  if (!provider.client || !provider.webhookSecret) return c.json({ error: "stripe_credentials_and_webhook_required", environment: billingEnvironment }, 409);
  const mappings = await db.from("billing_catalogue_prices").select("currency,interval,component,provider_livemode,tax_behavior,metadata,package_versions(package_key)").eq("billing_environment", billingEnvironment).eq("active", true);
  const required = ["essentials", "scale", "pro"].flatMap((packageKey) => ["gbp", "eur", "usd"].flatMap((currency) => ["month", "year"].map((interval) => `${packageKey}:${currency}:${interval}:base`)));
  const present = new Set((mappings.data || []).map((item: any) => `${item.package_versions?.package_key}:${item.currency}:${item.interval}:${item.component}`));
  const missing = required.filter((key) => !present.has(key));
  if (body.checkoutEnabled === true && missing.length) return c.json({ error: "catalogue_incomplete", missing }, 409);
  let taxReviewedAt = previous.data.tax_reviewed_at;
  if (body.taxEnabled === true) {
    const stripe = provider.client;
    const registrations = await (stripe.tax.registrations as any).list({ status: "active", limit: 100 });
    const unsafePrices = (mappings.data || []).filter((item: any) => item.tax_behavior === "unspecified" || !item.metadata?.productTaxCode);
    if (!registrations.data?.length || unsafePrices.length) return c.json({ error: "tax_configuration_unverified", activeRegistrations: registrations.data?.length || 0, unsafePriceCount: unsafePrices.length }, 409);
    taxReviewedAt = new Date().toISOString();
  }
  if (billingEnvironment === "live" && body.checkoutEnabled === true) {
    const liveBlockers = [
      !previous.data.sandbox_acceptance_completed_at && "sandbox_acceptance",
      !(body.portalConfigurationId?.trim() || previous.data.portal_configuration_id || provider.portalConfigurationId) && "customer_portal",
      !taxReviewedAt && "tax_configuration",
    ].filter(Boolean);
    if (liveBlockers.length) return c.json({ error: "live_checkout_readiness_incomplete", blockers: liveBlockers }, 409);
  }
  const next = { checkout_enabled: body.checkoutEnabled ?? previous.data.checkout_enabled, tax_enabled: body.taxEnabled ?? previous.data.tax_enabled, tax_reviewed_at: body.taxEnabled === true ? taxReviewedAt : body.taxEnabled === false ? null : previous.data.tax_reviewed_at, tax_reviewed_by: body.taxEnabled === true ? authorization.staff!.userId : body.taxEnabled === false ? null : previous.data.tax_reviewed_by, portal_configuration_id: body.portalConfigurationId?.trim() || previous.data.portal_configuration_id, webhook_configured: Boolean(provider.webhookSecret), updated_at: new Date().toISOString(), updated_by: authorization.staff!.userId };
  const saved = await db.from("billing_environment_configurations").update(next).eq("environment", billingEnvironment).select().single();
  if (saved.error) return c.json({ error: saved.error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "billing.configuration_changed", "success", { targetType: "billing_configuration", targetId: billingEnvironment, reason, previousValues: previous.data, newValues: saved.data });
  return c.json({ configuration: saved.data });
});

app.post("/api/superadmin/billing/sandbox-acceptance", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const db = admin(c.env);
  const [accounts, subscriptions, payments, refunds, events] = await Promise.all([
    db.from("accounts").select("id").eq("billing_environment", "test").eq("is_test_account", true).limit(1),
    db.from("billing_subscriptions").select("id,status,cancel_at_period_end").eq("billing_environment", "test"),
    db.from("billing_payments").select("id,status").eq("billing_environment", "test"),
    db.from("billing_refunds").select("id,status").eq("billing_environment", "test"),
    db.from("billing_events").select("event_type,processing_state").eq("billing_environment", "test").eq("processing_state", "processed"),
  ]);
  const eventTypes = new Set((events.data || []).map((event: any) => event.event_type));
  const evidence = {
    testAccount: Boolean(accounts.data?.length),
    checkout: eventTypes.has("checkout.session.completed"),
    entitlementSubscription: (subscriptions.data || []).some((subscription: any) => ["active", "trialing", "past_due", "unpaid", "canceled"].includes(subscription.status)),
    upgradeOrChange: eventTypes.has("customer.subscription.updated"),
    cancellation: eventTypes.has("customer.subscription.deleted") || (subscriptions.data || []).some((subscription: any) => subscription.cancel_at_period_end || subscription.status === "canceled"),
    successfulPayment: (payments.data || []).some((payment: any) => payment.status === "succeeded"),
    paymentFailure: eventTypes.has("invoice.payment_failed") || (payments.data || []).some((payment: any) => ["requires_payment_method", "canceled"].includes(payment.status)),
    successfulRefund: (refunds.data || []).some((refund: any) => refund.status === "succeeded"),
  };
  const incomplete = Object.entries(evidence).filter(([, value]) => !value).map(([key]) => key);
  if (incomplete.length) return c.json({ error: "sandbox_acceptance_evidence_incomplete", incomplete, evidence }, 409);
  const completedAt = new Date().toISOString();
  await db.from("billing_environment_configurations").update({ sandbox_acceptance_completed_at: completedAt, sandbox_acceptance_completed_by: authorization.staff!.userId, sandbox_acceptance_evidence: evidence, updated_at: completedAt, updated_by: authorization.staff!.userId }).in("environment", ["test", "live"]);
  await recordAdminActivity(c.env, authorization.staff!.userId, "billing.sandbox_acceptance_completed", "success", { targetType: "billing_configuration", targetId: "test", reason, metadata: evidence });
  return c.json({ completedAt, evidence });
});

app.post("/api/superadmin/billing/accounts/:id/reconcile", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  try {
    const result = await reconcileBillingAccount(c.env, c.req.param("id"), "manual", authorization.staff!.userId);
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.account_reconciled", "success", { targetType: "account", targetId: c.req.param("id"), accountId: c.req.param("id"), reason, metadata: result });
    return c.json(result);
  } catch (error) {
    return c.json({ error: "billing_reconciliation_failed", detail: errorMessage(error) }, 503);
  }
});

app.post("/api/superadmin/billing/subscriptions/:id/cancellation", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ action?: "schedule" | "undo"; reason?: string; operationKey?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (!body.action || reason.length < 3 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(body.operationKey || ""))) return c.json({ error: "action_reason_and_operation_key_required" }, 400);
  const db = admin(c.env);
  const previous = await db.from("billing_subscriptions").select("*").eq("provider_subscription_id", c.req.param("id")).maybeSingle();
  if (!previous.data) return c.json({ error: "subscription_not_found" }, 404);
  const billingEnvironment = previous.data.billing_environment as BillingEnvironment;
  const stripe = stripeClient(c.env, billingEnvironment);
  if (!stripe) return c.json({ error: "stripe_credentials_required" }, 409);
  const existing = await db.from("billing_financial_operations").select("response,state").eq("billing_environment", billingEnvironment).eq("operation_type", "subscription_change").eq("operation_key", body.operationKey).maybeSingle();
  if (existing.data?.state === "completed") return c.json(existing.data.response);
  const operation = await db.from("billing_financial_operations").insert({ billing_environment: billingEnvironment, operation_key: body.operationKey, operation_type: "subscription_change", account_id: previous.data.account_id, requested_by: authorization.staff!.userId, request: { action: `cancellation_${body.action}`, reason } }).select("id").maybeSingle();
  if (!operation.data) return c.json({ error: "financial_operation_in_progress" }, 409);
  const updated = await stripe.subscriptions.update(c.req.param("id"), { cancel_at_period_end: body.action === "schedule" }, { idempotencyKey: `admin-subscription-change:${billingEnvironment}:${body.operationKey}` });
  await projectStripeSubscription(c.env, updated, Math.floor(Date.now() / 1000));
  const response = { subscriptionId: updated.id, cancelAtPeriodEnd: updated.cancel_at_period_end };
  await db.from("billing_financial_operations").update({ provider_reference: updated.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("id", operation.data.id);
  await recordAdminActivity(c.env, authorization.staff!.userId, `billing.cancellation_${body.action === "schedule" ? "scheduled" : "undone"}`, "success", { targetType: "subscription", targetId: updated.id, accountId: previous.data.account_id, reason, previousValues: { cancelAtPeriodEnd: previous.data.cancel_at_period_end }, newValues: { cancelAtPeriodEnd: updated.cancel_at_period_end } });
  return c.json(response);
});

app.post("/api/superadmin/billing/accounts/:id/invoice-adjustment", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ amountMinor?: number; currency?: string; description?: string; reason?: string; confirmation?: string; operationKey?: string }>().catch(() => ({} as any));
  const amountMinor = Math.trunc(Number(body.amountMinor || 0));
  const currency = String(body.currency || "").toLowerCase();
  const description = String(body.description || "").trim();
  const reason = String(body.reason || "").trim();
  if (!amountMinor || Math.abs(amountMinor) > 100_000_000 || !/^[a-z]{3}$/.test(currency) || description.length < 3 || reason.length < 3 || body.confirmation !== "ADJUST INVOICE" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(body.operationKey || ""))) return c.json({ error: "valid_adjustment_confirmation_and_operation_key_required" }, 400);
  const db = admin(c.env);
  const account = await db.from("accounts").select("id,billing_environment").eq("id", c.req.param("id")).maybeSingle();
  if (!account.data) return c.json({ error: "account_not_found" }, 404);
  const billingEnvironment = account.data.billing_environment as BillingEnvironment;
  const customer = await db.from("billing_customers").select("provider_customer_id,currency").eq("billing_environment", billingEnvironment).eq("account_id", account.data.id).maybeSingle();
  if (!customer.data) return c.json({ error: "billing_customer_not_found" }, 409);
  if (customer.data.currency && customer.data.currency !== currency) return c.json({ error: "currency_must_match_billing_customer", expected: customer.data.currency }, 409);
  const stripe = stripeClient(c.env, billingEnvironment);
  if (!stripe) return c.json({ error: "stripe_credentials_required" }, 409);
  const existing = await db.from("billing_financial_operations").select("response,state").eq("billing_environment", billingEnvironment).eq("operation_type", "invoice_adjustment").eq("operation_key", body.operationKey).maybeSingle();
  if (existing.data?.state === "completed") return c.json(existing.data.response);
  const operation = await db.from("billing_financial_operations").insert({ billing_environment: billingEnvironment, operation_key: body.operationKey, operation_type: "invoice_adjustment", account_id: account.data.id, requested_by: authorization.staff!.userId, request: { amountMinor, currency, description, reason } }).select("id").maybeSingle();
  if (!operation.data) return c.json({ error: "financial_operation_in_progress" }, 409);
  try {
    const invoiceItem = await stripe.invoiceItems.create({ customer: customer.data.provider_customer_id, amount: amountMinor, currency, description, metadata: { claritudeAccountId: account.data.id, billingEnvironment, operatorReason: reason } }, { idempotencyKey: `invoice-adjustment:${billingEnvironment}:${body.operationKey}` });
    const response = { invoiceItemId: invoiceItem.id, amountMinor, currency, state: "pending_next_invoice" };
    await db.from("billing_financial_operations").update({ provider_reference: invoiceItem.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("id", operation.data.id);
    await recordAdminActivity(c.env, authorization.staff!.userId, "billing.invoice_adjustment_created", "success", { targetType: "stripe_invoice_item", targetId: invoiceItem.id, accountId: account.data.id, reason, newValues: { amountMinor, currency, description, state: "pending_next_invoice" } });
    return c.json(response, 201);
  } catch (error) {
    await db.from("billing_financial_operations").update({ state: "failed", error: errorMessage(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", operation.data.id);
    return c.json({ error: "invoice_adjustment_failed", detail: errorMessage(error) }, 503);
  }
});

app.post("/api/superadmin/billing/payments/:id/refund", async (c) => {
  const authorization = await requireStaff(c, "financials.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ amountMinor?: number; reason?: string; confirmation?: string; operationKey?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  const amountMinor = Math.floor(Number(body.amountMinor || 0));
  if (reason.length < 3 || amountMinor < 1 || body.confirmation !== "REFUND" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(body.operationKey || ""))) return c.json({ error: "amount_reason_confirmation_and_operation_key_required" }, 400);
  const db = admin(c.env);
  const payment = await db.from("billing_payments").select("*").eq("provider_payment_intent_id", c.req.param("id")).maybeSingle();
  if (!payment.data || amountMinor > Number(payment.data.amount_received_minor || 0)) return c.json({ error: "invalid_refund_amount" }, 409);
  const billingEnvironment = payment.data.billing_environment as BillingEnvironment;
  const stripe = stripeClient(c.env, billingEnvironment);
  if (!stripe) return c.json({ error: "stripe_credentials_required" }, 409);
  const existing = await db.from("billing_financial_operations").select("provider_reference,response,state").eq("billing_environment", billingEnvironment).eq("operation_type", "refund").eq("operation_key", body.operationKey).maybeSingle();
  if (existing.data?.state === "completed") return c.json({ ...(existing.data.response || {}), reused: true });
  const operation = await db.from("billing_financial_operations").insert({ billing_environment: billingEnvironment, operation_key: body.operationKey, operation_type: "refund", account_id: payment.data.account_id, requested_by: authorization.staff!.userId, request: { paymentIntentId: payment.data.provider_payment_intent_id, amountMinor, reason } }).select("id").maybeSingle();
  if (operation.error) return c.json({ error: operation.error.code === "23505" ? "financial_operation_in_progress" : "financial_operation_persistence_failed" }, operation.error.code === "23505" ? 409 : 503);
  const refund = await stripe.refunds.create({ payment_intent: payment.data.provider_payment_intent_id, amount: amountMinor, metadata: { claritudeAccountId: payment.data.account_id, billingEnvironment, operatorReason: reason } }, { idempotencyKey: `refund:${billingEnvironment}:${body.operationKey}` });
  const response = { refundId: refund.id, status: refund.status };
  await db.from("billing_financial_operations").update({ provider_reference: refund.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("id", operation.data!.id);
  await recordAdminActivity(c.env, authorization.staff!.userId, "billing.refund_created", "success", { targetType: "refund", targetId: refund.id, accountId: payment.data.account_id, reason, newValues: { amountMinor, currency: payment.data.currency } });
  return c.json(response);
});

app.patch("/api/superadmin/audit-checks/:id", async (c) => {
  const authorization = await requireStaff(c, "audits.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ lifecycle?: "active" | "disabled"; severity?: string; thresholds?: Record<string, unknown>; weight?: number; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  if (body.lifecycle && !["active", "disabled"].includes(body.lifecycle)) return c.json({ error: "unsupported_check_lifecycle" }, 400);
  if (body.weight !== undefined && (!Number.isFinite(body.weight) || body.weight < 0 || body.weight > 100)) return c.json({ error: "invalid_check_weight" }, 400);
  const db = admin(c.env);
  const { data: previous } = await db.from("audit_check_definitions").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "audit_check_not_found" }, 404);
  const next: Record<string, unknown> = { configuration_version: Number(previous.configuration_version || 0) + 1, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() };
  if (body.lifecycle) next.lifecycle = body.lifecycle;
  if (body.severity) next.severity = String(body.severity).slice(0, 40);
  if (body.thresholds) next.thresholds = body.thresholds;
  if (body.weight !== undefined) next.weight = body.weight;
  const history = await db.from("audit_check_history").insert({ check_id: previous.id, snapshot: previous, changed_by: authorization.staff!.userId, reason }).select("id").single();
  if (history.error) return c.json({ error: "audit_configuration_history_failed" }, 503);
  const { data, error } = await db.from("audit_check_definitions").update(next).eq("id", previous.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "audit.check_configuration_changed", "success", { targetType: "audit_check", targetId: previous.id, reason, previousValues: { lifecycle: previous.lifecycle, severity: previous.severity, thresholds: previous.thresholds, weight: previous.weight, configurationVersion: previous.configuration_version }, newValues: { lifecycle: data.lifecycle, severity: data.severity, thresholds: data.thresholds, weight: data.weight, configurationVersion: data.configuration_version }, metadata: { historyId: history.data.id } });
  return c.json({ check: data, historyId: history.data.id });
});

app.patch("/api/superadmin/audit-groups/:id", async (c) => {
  const authorization = await requireStaff(c, "audits.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ lifecycle?: "active" | "disabled"; enabledByDefault?: boolean; failureSeverity?: string; weight?: number; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  if (body.lifecycle && !["active", "disabled"].includes(body.lifecycle)) return c.json({ error: "unsupported_group_lifecycle" }, 400);
  if (body.enabledByDefault !== undefined && typeof body.enabledByDefault !== "boolean") return c.json({ error: "invalid_default_availability" }, 400);
  if (body.weight !== undefined && (!Number.isFinite(body.weight) || body.weight < 0 || body.weight > 100)) return c.json({ error: "invalid_group_weight" }, 400);
  const db = admin(c.env);
  const { data: previous } = await db.from("audit_user_facing_groups").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "audit_group_not_found" }, 404);
  const history = await db.from("audit_group_history").insert({ group_id: previous.id, snapshot: previous, changed_by: authorization.staff!.userId, reason }).select("id").single();
  if (history.error) return c.json({ error: "audit_group_history_failed" }, 503);
  const next: Record<string, unknown> = { configuration_version: Number(previous.configuration_version || 0) + 1, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() };
  if (body.lifecycle) next.lifecycle = body.lifecycle;
  if (body.enabledByDefault !== undefined) next.enabled_by_default = body.enabledByDefault;
  if (body.failureSeverity) next.failure_severity = String(body.failureSeverity).trim().slice(0, 80);
  if (body.weight !== undefined) next.weight = body.weight;
  const { data, error } = await db.from("audit_user_facing_groups").update(next).eq("id", previous.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "audit.group_configuration_changed", "success", { targetType: "audit_group", targetId: previous.id, reason, previousValues: { lifecycle: previous.lifecycle, enabledByDefault: previous.enabled_by_default, failureSeverity: previous.failure_severity, weight: previous.weight, configurationVersion: previous.configuration_version }, newValues: { lifecycle: data.lifecycle, enabledByDefault: data.enabled_by_default, failureSeverity: data.failure_severity, weight: data.weight, configurationVersion: data.configuration_version }, metadata: { historyId: history.data.id } });
  return c.json({ group: data, historyId: history.data.id });
});

app.post("/api/superadmin/audit-groups/:id/rollback/:historyId", async (c) => {
  const authorization = await requireStaff(c, "audits.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const db = admin(c.env);
  const [{ data: current }, { data: historical }] = await Promise.all([
    db.from("audit_user_facing_groups").select("*").eq("id", c.req.param("id")).maybeSingle(),
    db.from("audit_group_history").select("*").eq("id", c.req.param("historyId")).eq("group_id", c.req.param("id")).maybeSingle(),
  ]);
  if (!current || !historical?.snapshot) return c.json({ error: "audit_group_or_history_not_found" }, 404);
  await db.from("audit_group_history").insert({ group_id: current.id, snapshot: current, changed_by: authorization.staff!.userId, reason: `Pre-rollback snapshot: ${reason}` });
  const snapshot = historical.snapshot as Record<string, unknown>;
  const { data, error } = await db.from("audit_user_facing_groups").update({ lifecycle: snapshot.lifecycle, enabled_by_default: snapshot.enabled_by_default, failure_severity: snapshot.failure_severity, weight: snapshot.weight, configuration_version: Number(current.configuration_version || 0) + 1, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() }).eq("id", current.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "audit.group_configuration_rolled_back", "success", { targetType: "audit_group", targetId: current.id, reason, previousValues: current, newValues: data, metadata: { restoredHistoryId: historical.id } });
  return c.json({ group: data });
});

app.put("/api/superadmin/audit-catalogue/package-availability", async (c) => {
  const authorization = await requireStaff(c, "audits.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ targetKind?: "technical_check" | "user_facing_group"; targetId?: string; entitlement?: string; enabled?: boolean; reason?: string }>().catch(() => ({} as any));
  const targetId = String(body.targetId || "").trim();
  const entitlement = String(body.entitlement || "").trim().toLowerCase();
  const reason = String(body.reason || "").trim();
  if (!body.targetKind || !["technical_check", "user_facing_group"].includes(body.targetKind) || !targetId || !/^[a-z0-9_]{2,80}$/.test(entitlement) || typeof body.enabled !== "boolean" || reason.length < 3) return c.json({ error: "valid_package_availability_and_reason_required" }, 400);
  const db = admin(c.env);
  const { data: previous } = await db.from("audit_catalogue_package_availability").select("*").eq("target_kind", body.targetKind).eq("target_id", targetId).eq("entitlement", entitlement).maybeSingle();
  const { data, error } = await db.from("audit_catalogue_package_availability").upsert({ target_kind: body.targetKind, target_id: targetId, entitlement, enabled: body.enabled, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() }, { onConflict: "target_kind,target_id,entitlement" }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "audit.package_availability_changed", "success", { targetType: body.targetKind, targetId, reason, previousValues: previous, newValues: data, metadata: { entitlement } });
  return c.json({ availability: data });
});

app.post("/api/superadmin/packages/:id/migration-preview", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ scope?: "new_signups" | "selected_accounts" | "existing_accounts"; accountIds?: string[]; reason?: string; effectiveAt?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (!body.scope || !["new_signups", "selected_accounts", "existing_accounts"].includes(body.scope) || reason.length < 3) return c.json({ error: "scope_and_reason_required" }, 400);
  const db = admin(c.env);
  const { data: packageVersion } = await db.from("package_versions").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!packageVersion) return c.json({ error: "package_version_not_found" }, 404);
  let accountQuery = db.from("accounts").select("id,name").limit(5000);
  if (body.scope === "selected_accounts") accountQuery = accountQuery.in("id", [...new Set(body.accountIds || [])].slice(0, 500));
  const accounts = body.scope === "new_signups" ? { data: [], error: null } : await accountQuery;
  if (accounts.error) return c.json({ error: "package_migration_preview_unavailable" }, 503);
  const ids = (accounts.data || []).map((account) => account.id);
  const [properties, workspaces, memberships] = await Promise.all([
    ids.length ? db.from("properties").select("account_id,id").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("workspaces").select("account_id,id").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("account_memberships").select("account_id,user_id,role").in("account_id", ids).in("role", ["owner", "member"]) : Promise.resolve({ data: [] }),
  ]);
  const allowances = packageVersion.allowances || {};
  const previewRows = (accounts.data || []).map((account) => {
    const counts = { properties: (properties.data || []).filter((item) => item.account_id === account.id).length, workspaces: (workspaces.data || []).filter((item) => item.account_id === account.id).length, editingSeats: (memberships.data || []).filter((item) => item.account_id === account.id).length };
    const conflicts = [
      typeof allowances.properties === "number" && counts.properties > allowances.properties ? `${counts.properties - allowances.properties} excess properties` : null,
      typeof allowances.workspaces === "number" && counts.workspaces > allowances.workspaces ? `${counts.workspaces - allowances.workspaces} excess workspaces` : null,
      typeof allowances.editingSeats === "number" && counts.editingSeats > allowances.editingSeats ? `${counts.editingSeats - allowances.editingSeats} excess editing seats` : null,
    ].filter(Boolean);
    return { ...account, counts, conflicts };
  });
  const preview = { packageVersionId: packageVersion.id, scope: body.scope, affectedAccounts: previewRows.length, conflictAccounts: previewRows.filter((row) => row.conflicts.length).length, accounts: previewRows, effectiveAt: body.effectiveAt || null, priceGrandfatheringUnaffected: true, usageReset: false };
  const { data: request, error } = await db.from("package_change_requests").insert({ account_id: body.scope === "selected_accounts" && ids.length === 1 ? ids[0] : null, to_package_version_id: packageVersion.id, scope: body.scope, state: "preview", effective_at: body.effectiveAt || null, preview, selection: { accountIds: ids }, reason, created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "package.migration_previewed", "previewed", { targetType: "package_version", targetId: packageVersion.id, reason, metadata: { changeRequestId: request.id, affectedAccounts: previewRows.length, conflictAccounts: preview.conflictAccounts } });
  return c.json({ request, preview });
});

app.post("/api/superadmin/packages/:id/versions", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: source } = await service.from("package_versions").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!source) return c.json({ error: "package_version_not_found" }, 404);
  const objects = ["pricing", "allowances", "features", "retention", "hardCeilings"];
  if (objects.some((key) => body[key] != null && (typeof body[key] !== "object" || Array.isArray(body[key])))) return c.json({ error: "package_configuration_objects_required" }, 400);
  const numericValues = Object.values({ ...(body.allowances || {}), ...(body.hardCeilings || {}) }).filter((value) => value !== null);
  if (numericValues.some((value) => typeof value === "number" && (!Number.isFinite(value) || value < 0))) return c.json({ error: "package_limits_must_be_non_negative" }, 400);
  const latest = await service.from("package_versions").select("version").eq("package_key", source.package_key).order("version", { ascending: false }).limit(1).single();
  const next = {
    package_key: source.package_key,
    version: Number(latest.data?.version || source.version) + 1,
    display_name: String(body.displayName || source.display_name).trim().slice(0, 120),
    state: "draft",
    effective_at: body.effectiveAt || null,
    pricing: body.pricing ?? source.pricing,
    allowances: body.allowances ?? source.allowances,
    features: body.features ?? source.features,
    retention: body.retention ?? source.retention,
    hard_ceilings: body.hardCeilings ?? source.hard_ceilings,
    unresolved_values: Array.isArray(body.unresolvedValues) ? body.unresolvedValues.map(String).slice(0, 100) : source.unresolved_values,
    created_by: authorization.staff!.userId,
  };
  const { data, error } = await service.from("package_versions").insert(next).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "package.version_created", "success", { targetType: "package_version", targetId: data.id, reason, previousValues: source, newValues: data });
  return c.json({ packageVersion: data }, 201);
});

app.patch("/api/superadmin/packages/:id", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: draft } = await service.from("package_versions").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!draft) return c.json({ error: "package_version_not_found" }, 404);
  if (draft.state !== "draft") return c.json({ error: "draft_package_version_required" }, 409);
  const objects = ["pricing", "allowances", "features", "retention", "hardCeilings"];
  if (objects.some((key) => body[key] != null && (typeof body[key] !== "object" || Array.isArray(body[key])))) return c.json({ error: "package_configuration_objects_required" }, 400);
  const numericValues = Object.values({ ...(body.allowances || {}), ...(body.hardCeilings || {}) }).filter((value) => value !== null);
  if (numericValues.some((value) => typeof value === "number" && (!Number.isFinite(value) || value < 0))) return c.json({ error: "package_limits_must_be_non_negative" }, 400);
  const changes = {
    display_name: String(body.displayName || draft.display_name).trim().slice(0, 120),
    pricing: body.pricing ?? draft.pricing,
    allowances: body.allowances ?? draft.allowances,
    features: body.features ?? draft.features,
    retention: body.retention ?? draft.retention,
    hard_ceilings: body.hardCeilings ?? draft.hard_ceilings,
    unresolved_values: Array.isArray(body.unresolvedValues) ? body.unresolvedValues.map(String).slice(0, 100) : draft.unresolved_values,
  };
  const { data, error } = await service.from("package_versions").update(changes).eq("id", draft.id).eq("state", "draft").select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "package.draft_updated", "success", { targetType: "package_version", targetId: data.id, reason, previousValues: draft, newValues: data });
  return c.json({ packageVersion: data });
});

app.post("/api/superadmin/packages/:id/publish", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: draft } = await service.from("package_versions").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!draft) return c.json({ error: "package_version_not_found" }, 404);
  if (draft.state !== "draft") return c.json({ error: "draft_package_version_required" }, 409);
  const { data, error } = await service.from("package_versions").update({ state: "published", effective_at: draft.effective_at || new Date().toISOString() }).eq("id", draft.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "package.version_published", "success", { targetType: "package_version", targetId: data.id, reason, previousValues: draft, newValues: data, metadata: { existingAccountsMigrated: false } });
  return c.json({ packageVersion: data, existingAccountsMigrated: false });
});

app.post("/api/superadmin/accounts/:id/overrides", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ key?: string; value?: unknown; reason?: string; expiresAt?: string | null }>().catch(() => ({} as any));
  const key = String(body.key || "").trim().slice(0, 100);
  const reason = String(body.reason || "").trim();
  if (!key || body.value === undefined || reason.length < 3 || reason.length > 500) return c.json({ error: "key_value_and_reason_required" }, 400);
  let effective;
  try { effective = await effectiveEntitlements(c.env, c.req.param("id")); } catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
  const ceiling = effective.hardCeilings[key];
  if (typeof ceiling === "number" && typeof body.value === "number" && body.value > ceiling) return c.json({ error: "override_exceeds_platform_ceiling", ceiling }, 409);
  if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) return c.json({ error: "override_expiry_must_be_future" }, 400);
  const { data, error } = await admin(c.env).from("account_entitlement_overrides").insert({ account_id: c.req.param("id"), key, value: body.value, reason, expires_at: body.expiresAt || null, created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.entitlement_override_created", "success", { targetType: "account", targetId: c.req.param("id"), accountId: c.req.param("id"), reason, newValues: { key, value: body.value, expiresAt: body.expiresAt || null } });
  return c.json({ override: data }, 201);
});

app.post("/api/superadmin/accounts/:id/package-preview", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json().catch(() => ({}));
  const parsed = validateComplimentaryGrantInput(body);
  if ("error" in parsed) return c.json({ error: parsed.error, key: parsed.key }, 400);
  const billingTreatment = body.billingTreatment === "keep_current_price" ? "billing_unchanged" : body.billingTreatment === "complimentary" || body.billingTreatment == null ? "complimentary" : null;
  if (!billingTreatment) return c.json({ error: "valid_billing_treatment_required" }, 400);
  const accountId = c.req.param("id");
  const db = admin(c.env);
  const [account, packageVersion, properties, memberships, billingCustomer] = await Promise.all([
    db.from("accounts").select("id,name").eq("id", accountId).maybeSingle(),
    db.from("package_versions").select("*").eq("id", parsed.value.packageVersionId).eq("state", "published").maybeSingle(),
    db.from("properties").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    db.from("account_memberships").select("user_id", { count: "exact", head: true }).eq("account_id", accountId).in("role", ["owner", "member"]),
    db.from("billing_customers").select("provider_customer_id,sync_state,last_synced_at").eq("account_id", accountId).maybeSingle(),
  ]);
  if (!account.data) return c.json({ error: "account_not_found" }, 404);
  if (!packageVersion.data) return c.json({ error: "published_package_version_required" }, 400);
  const proposed = resolveEffectiveEntitlements({
    packageKey: packageVersion.data.package_key,
    version: packageVersion.data.version,
    allowances: packageVersion.data.allowances,
    features: packageVersion.data.features,
    retention: packageVersion.data.retention,
    hardCeilings: packageVersion.data.hard_ceilings,
  }, Object.entries(parsed.value.overrides).map(([key, value]) => ({ key, value })));
  for (const [key, value] of Object.entries(parsed.value.overrides)) {
    const ceiling = proposed.hardCeilings[key];
    if (typeof ceiling === "number" && value > ceiling) return c.json({ error: "override_exceeds_platform_ceiling", key, ceiling }, 409);
  }
  let current;
  try { current = await effectiveEntitlements(c.env, accountId); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
  const counts = { properties: properties.count || 0, editingSeats: memberships.count || 0 };
  return c.json({ preview: {
    account: account.data,
    current,
    proposed: { ...proposed, displayName: packageVersion.data.display_name, unresolvedValues: packageVersion.data.unresolved_values || [] },
    arrangement: billingTreatment,
    permanent: parsed.value.permanent,
    expiresAt: parsed.value.expiresAt,
    expiryOutcome: "Returns to the underlying standard package and billing state. No charge, subscription creation or cancellation is triggered.",
    conflicts: packageLimitConflicts(proposed.values, counts),
    counts,
    stripe: billingCustomer.data ? { connected: true, state: billingCustomer.data.sync_state, lastSyncedAt: billingCustomer.data.last_synced_at, unaffected: true } : { connected: false, unaffected: true },
  } });
});

app.put("/api/superadmin/accounts/:id/package", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json().catch(() => ({}));
  const parsed = validateComplimentaryGrantInput(body);
  if ("error" in parsed) return c.json({ error: parsed.error, key: parsed.key }, 400);
  const billingTreatment = body.billingTreatment === "keep_current_price" ? "billing_unchanged" : body.billingTreatment === "complimentary" || body.billingTreatment == null ? "complimentary" : null;
  if (!billingTreatment) return c.json({ error: "valid_billing_treatment_required" }, 400);
  const accountId = c.req.param("id");
  const db = admin(c.env);
  const [packageVersion, previousGrant] = await Promise.all([
    db.from("package_versions").select("id,package_key,version,display_name,hard_ceilings").eq("id", parsed.value.packageVersionId).eq("state", "published").maybeSingle(),
    db.from("account_package_grants").select("*,package_versions(package_key,version,display_name)").eq("account_id", accountId).eq("status", "active").maybeSingle(),
  ]);
  if (!packageVersion.data) return c.json({ error: "published_package_version_required" }, 400);
  for (const [key, value] of Object.entries(parsed.value.overrides)) {
    const ceiling = (packageVersion.data.hard_ceilings as Record<string, unknown> || {})[key];
    if (typeof ceiling === "number" && value > ceiling) return c.json({ error: "override_exceeds_platform_ceiling", key, ceiling }, 409);
  }
  const { data: grant, error } = await db.rpc("apply_package_access_grant_internal", {
    p_account_id: accountId,
    p_package_version_id: parsed.value.packageVersionId,
    p_arrangement: billingTreatment,
    p_expires_at: parsed.value.expiresAt,
    p_reason: parsed.value.reason,
    p_overrides: parsed.value.overrides,
    p_actor: authorization.staff!.userId,
  });
  if (error) return c.json({ error: error.message }, 400);
  const persistedGrant = grant;
  await recordAdminActivity(c.env, authorization.staff!.userId, billingTreatment === "complimentary" ? "account.complimentary_package_granted" : "account.package_access_granted_billing_unchanged", "success", {
    targetType: "account", targetId: accountId, accountId, reason: parsed.value.reason,
    previousValues: previousGrant.data || null,
    newValues: { grant: persistedGrant, package: packageVersion.data, billingTreatment, permanent: parsed.value.permanent, expiresAt: parsed.value.expiresAt, overrides: parsed.value.overrides },
    metadata: { stripeUnaffected: true, existingBillingContinues: billingTreatment === "billing_unchanged", expiryBehavior: parsed.value.expiryBehavior },
  });
  return c.json({ grant: persistedGrant });
});

app.delete("/api/superadmin/accounts/:id/package", async (c) => {
  const authorization = await requireStaff(c, "packages.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const accountId = c.req.param("id");
  const { data, error } = await admin(c.env).rpc("revoke_complimentary_package_grant_internal", { p_account_id: accountId, p_reason: reason, p_actor: authorization.staff!.userId });
  if (error) return c.json({ error: error.message }, error.message.includes("not_found") ? 404 : 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "account.complimentary_package_revoked", "success", { targetType: "account", targetId: accountId, accountId, reason, previousValues: data, metadata: { stripeUnaffected: true } });
  return c.json({ grant: data });
});

app.post("/api/superadmin/audit-checks/:id/rollback/:historyId", async (c) => {
  const authorization = await requireStaff(c, "audits.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const db = admin(c.env);
  const [current, history] = await Promise.all([
    db.from("audit_check_definitions").select("*").eq("id", c.req.param("id")).single(),
    db.from("audit_check_history").select("snapshot").eq("id", c.req.param("historyId")).eq("check_id", c.req.param("id")).single(),
  ]);
  if (current.error || history.error) return c.json({ error: "audit_configuration_history_not_found" }, 404);
  const snapshot = history.data.snapshot as any;
  await db.from("audit_check_history").insert({ check_id: current.data.id, snapshot: current.data, changed_by: authorization.staff!.userId, reason: `Pre-rollback snapshot: ${reason}` });
  const { data, error } = await db.from("audit_check_definitions").update({ lifecycle: snapshot.lifecycle, severity: snapshot.severity, thresholds: snapshot.thresholds, weight: snapshot.weight, configuration_version: Number(current.data.configuration_version || 0) + 1, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() }).eq("id", current.data.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "audit.check_configuration_rolled_back", "success", { targetType: "audit_check", targetId: current.data.id, reason, previousValues: current.data, newValues: data, metadata: { sourceHistoryId: c.req.param("historyId") } });
  return c.json({ check: data });
});

app.patch("/api/superadmin/emergency-controls/:key", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ paused?: boolean; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (typeof body.paused !== "boolean" || reason.length < 3 || reason.length > 500) return c.json({ error: "paused_and_reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("emergency_controls").select("*").eq("key", c.req.param("key")).single();
  if (!previous) return c.json({ error: "emergency_control_not_found" }, 404);
  const { data, error } = await service.from("emergency_controls").update({ paused: body.paused, reason, changed_by: authorization.staff!.userId, changed_at: new Date().toISOString() }).eq("key", c.req.param("key")).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "emergency_control.changed", "success", { targetType: "emergency_control", targetId: data.key, reason, previousValues: previous, newValues: data });
  return c.json({ control: data });
});

app.patch("/api/superadmin/settings/:key", async (c) => {
  const authorization = await requireStaff(c, "settings.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ value?: unknown; reason?: string }>().catch(() => ({} as any));
  const reason = String(body.reason || "").trim();
  if (body.value === undefined || reason.length < 3 || reason.length > 500) return c.json({ error: "value_and_reason_required" }, 400);
  const validationError = validatePlatformSetting(c.req.param("key"), body.value);
  if (validationError) return c.json({ error: validationError }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("platform_settings").select("*").eq("key", c.req.param("key")).single();
  if (!previous) return c.json({ error: "platform_setting_not_found" }, 404);
  const { data, error } = await service.from("platform_settings").update({ value: body.value, updated_by: authorization.staff!.userId, updated_at: new Date().toISOString() }).eq("key", c.req.param("key")).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await service.from("platform_setting_history").insert({ setting_key: data.key, previous_value: previous.value, new_value: data.value, reason, changed_by: authorization.staff!.userId });
  await recordAdminActivity(c.env, authorization.staff!.userId, "platform_setting.changed", "success", { targetType: "platform_setting", targetId: data.key, reason, previousValues: previous.value, newValues: data.value });
  return c.json({ setting: data });
});

app.post("/api/superadmin/exports", async (c) => {
  const authorization = await requireStaff(c, "exports.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ scope?: string; format?: "csv" | "json"; filters?: Record<string, unknown>; reason?: string }>().catch(() => ({} as any));
  const allowedScopes = ["accounts", "users", "properties", "audits", "admin_activity"];
  if (!body.scope || !allowedScopes.includes(body.scope) || !["csv", "json"].includes(body.format || "")) return c.json({ error: "valid_export_scope_and_format_required" }, 400);
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const requestedEnvironment = (body.filters?.billingEnvironment || "live") as BillingEnvironment;
  if (!["test", "live"].includes(requestedEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const filters = { ...(body.filters || {}), billingEnvironment: requestedEnvironment };
  const { data, error } = await admin(c.env).from("admin_export_jobs").insert({ requested_by: authorization.staff!.userId, scope: body.scope, format: body.format, filters }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await c.env.JOBS.send({ type: "admin-export", id: data.id });
  await recordAdminActivity(c.env, authorization.staff!.userId, "export.queued", "success", { targetType: "admin_export", targetId: data.id, reason, metadata: { scope: body.scope, format: body.format } });
  return c.json({ job: data }, 202);
});

app.get("/api/superadmin/exports/:id/download", async (c) => {
  const authorization = await requireStaff(c, "exports.read");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const { data: job } = await service.from("admin_export_jobs").select("*").eq("id", c.req.param("id")).single();
  if (!job || job.state !== "completed" || !job.object_key || !job.expires_at || Date.parse(job.expires_at) <= Date.now()) return c.json({ error: "export_not_available" }, 404);
  const signed = await service.storage.from("admin-exports").createSignedUrl(job.object_key, 60, { download: `${job.scope}-${job.id}.${job.format}` });
  if (signed.error) return c.json({ error: "export_download_unavailable" }, 503);
  await recordAdminActivity(c.env, authorization.staff!.userId, "export.downloaded", "success", { targetType: "admin_export", targetId: job.id });
  return c.json({ url: signed.data.signedUrl, expiresInSeconds: 60 });
});

app.post("/api/superadmin/exports/:id/retry", async (c) => {
  const authorization = await requireStaff(c, "exports.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("admin_export_jobs").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!previous || !["failed", "expired", "cancelled"].includes(previous.state)) return c.json({ error: "failed_or_expired_export_required" }, 409);
  const { data, error } = await service.from("admin_export_jobs").insert({ requested_by: authorization.staff!.userId, scope: previous.scope, format: previous.format, filters: previous.filters }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await c.env.JOBS.send({ type: "admin-export", id: data.id });
  await recordAdminActivity(c.env, authorization.staff!.userId, "export.retried", "success", { targetType: "admin_export", targetId: data.id, reason, metadata: { previousJobId: previous.id } });
  return c.json({ job: data }, 202);
});

app.post("/api/superadmin/email/templates/preview", async (c) => {
  const authorization = await requireStaff(c, "communications.read");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ subject?: string; htmlBody?: string; variables?: Record<string, unknown> }>().catch(() => ({} as { subject?: string; htmlBody?: string; variables?: Record<string, unknown> }));
  const subject = renderEmailTemplate(String(body.subject || ""), body.variables || {});
  const html = renderEmailTemplate(String(body.htmlBody || ""), body.variables || {});
  return c.json({ preview: { subject: subject.rendered, html: html.rendered, missing: [...new Set([...subject.missing, ...html.missing])] } });
});

app.post("/api/superadmin/email/templates", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const key = String(body.templateKey || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const reason = String(body.reason || "").trim();
  if (!key || !String(body.subject || "").trim() || !String(body.htmlBody || "").trim() || reason.length < 3) return c.json({ error: "template_key_subject_body_and_reason_required" }, 400);
  const service = admin(c.env);
  const { data: current } = await service.from("email_templates").select("*").eq("template_key", key).order("version", { ascending: false }).limit(1).maybeSingle();
  if (current?.provider_managed) return c.json({ error: "provider_managed_template_must_be_edited_in_supabase_auth" }, 409);
  const variables = [...new Set([...String(body.subject).matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g), ...String(body.htmlBody).matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)].map((match) => match[1]))];
  const { data, error } = await service.from("email_templates").insert({ template_key: key, version: Number(current?.version || 0) + 1, subject: String(body.subject).trim(), html_body: String(body.htmlBody), text_body: String(body.textBody || ""), variables, state: "draft", description: String(body.description || "").trim() || null, sending_path: current?.sending_path || "Platform automation", supersedes_id: current?.id || null, created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "email_template.version_created", "success", { targetType: "email_template", targetId: data.id, reason, previousValues: current || null, newValues: data });
  return c.json({ template: data }, 201);
});

app.post("/api/superadmin/email/templates/:id/publish", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: draft } = await service.from("email_templates").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!draft) return c.json({ error: "template_not_found" }, 404);
  if (draft.provider_managed) return c.json({ error: "provider_managed_template_must_be_published_in_supabase_auth" }, 409);
  await service.from("email_templates").update({ state: "retired" }).eq("template_key", draft.template_key).eq("state", "active");
  const { data, error } = await service.from("email_templates").update({ state: "active", published_at: new Date().toISOString() }).eq("id", draft.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "email_template.published", "success", { targetType: "email_template", targetId: data.id, reason, previousValues: draft, newValues: data });
  return c.json({ template: data });
});

app.patch("/api/superadmin/email/automations/:key", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("email_automations").select("*").eq("key", c.req.param("key")).maybeSingle();
  if (!previous) return c.json({ error: "automation_not_found" }, 404);
  const changes: Record<string, unknown> = { updated_by: authorization.staff!.userId, updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
  if (body.delayMinutes !== undefined) changes.delay_minutes = Math.max(0, Math.min(525600, Math.floor(Number(body.delayMinutes) || 0)));
  if (body.eligibility && typeof body.eligibility === "object") changes.eligibility = body.eligibility;
  const { data, error } = await service.from("email_automations").update(changes).eq("key", previous.key).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "email_automation.changed", "success", { targetType: "email_automation", targetId: data.key, reason, previousValues: previous, newValues: data });
  return c.json({ automation: data });
});

app.post("/api/superadmin/email/automations/:key/simulate", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ recipient?: string; eventId?: string }>().catch(() => ({} as { recipient?: string; eventId?: string }));
  const recipient = String(body.recipient || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) return c.json({ error: "valid_test_recipient_required" }, 400);
  const dedupeKey = `simulation:${c.req.param("key")}:${String(body.eventId || "manual")}:${recipient}`;
  const { data: claimed, error } = await admin(c.env).rpc("claim_notification", { p_key: dedupeKey, p_kind: c.req.param("key"), p_recipient: recipient, p_payload: { simulation: true, staffUserId: authorization.staff!.userId } });
  if (error) return c.json({ error: error.message }, 400);
  if (claimed) await admin(c.env).from("notification_deliveries").update({ status: "simulated", provider: "none", provider_status: "not_sent", is_test: true, automation_key: c.req.param("key"), updated_at: new Date().toISOString() }).eq("dedupe_key", dedupeKey);
  return c.json({ simulated: true, claimed, duplicatePrevented: !claimed, sentToProvider: false });
});

app.post("/api/superadmin/email/test-delivery", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ recipient?: string; subject?: string; htmlBody?: string; reason?: string; operationKey?: string }>().catch(() => ({} as any));
  const recipient = String(body.recipient || "").trim().toLowerCase();
  const subjectText = String(body.subject || "").trim().replace(/^\[Claritude TEST\]\s*/i, "");
  const htmlBody = String(body.htmlBody || "").trim();
  const reason = String(body.reason || "").trim();
  const operationKey = String(body.operationKey || "").trim();
  if (recipient !== "sales@websi.com") return c.json({ error: "controlled_test_recipient_required" }, 400);
  if (!subjectText || subjectText.length > 180 || !htmlBody || htmlBody.length > 20_000 || reason.length < 3 || reason.length > 500 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(operationKey)) return c.json({ error: "valid_subject_body_reason_and_operation_key_required" }, 400);
  if (/(?:password\s*reset|access[_ -]?token|bearer\s+|https?:\/\/)/i.test(`${subjectText}\n${htmlBody}`)) return c.json({ error: "test_content_must_not_include_links_or_secrets" }, 400);
  if (!c.env.RESEND_API_KEY || !c.env.RESEND_FROM) return c.json({ error: "email_delivery_not_configured" }, 503);
  const dedupeKey = `superadmin:test-delivery:${operationKey}`;
  const service = admin(c.env);
  const { data: claimed, error: claimError } = await service.rpc("claim_notification", { p_key: dedupeKey, p_kind: "acceptance_test", p_recipient: recipient, p_payload: { controlledTest: true, staffUserId: authorization.staff!.userId, subject: `[Claritude TEST] ${subjectText}` } });
  if (claimError) return c.json({ error: claimError.message }, 400);
  if (!claimed) {
    const existing = await service.from("notification_deliveries").select("id,status,provider,provider_status,provider_id,created_at").eq("dedupe_key", dedupeKey).maybeSingle();
    return c.json({ submitted: true, duplicatePrevented: true, delivery: existing.data || null });
  }
  const escapedBody = htmlBody.replace(/[<>&]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character] || character).replace(/\n/g, "<br>");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, "content-type": "application/json", "Idempotency-Key": dedupeKey },
    body: JSON.stringify({ from: c.env.RESEND_FROM, to: [recipient], subject: `[Claritude TEST] ${subjectText}`, html: `<p>${escapedBody}</p>` }),
  });
  const providerBody = response.ok ? await response.json().catch(() => ({})) : null;
  const providerId = String((providerBody as any)?.id || response.headers.get("x-message-id") || "") || null;
  const providerError = response.ok ? null : (await response.text()).slice(0, 1000);
  const delivery = await service.from("notification_deliveries").update({ status: response.ok ? "sent" : "failed", provider: "Resend", provider_status: response.ok ? "accepted" : "rejected", provider_id: providerId, is_test: true, automation_key: "acceptance_test", error: providerError, updated_at: new Date().toISOString() }).eq("dedupe_key", dedupeKey).select("id,kind,recipient,status,provider,provider_status,provider_id,is_test,created_at,updated_at").single();
  await recordAdminActivity(c.env, authorization.staff!.userId, "email.test_delivery_submitted", response.ok ? "success" : "failed", { targetType: "notification_delivery", targetId: delivery.data?.id || dedupeKey, reason, metadata: { recipient, providerId, operationKey } });
  if (!response.ok) return c.json({ error: "email_provider_rejected_request", delivery: delivery.data || null }, 502);
  return c.json({ submitted: true, duplicatePrevented: false, delivery: delivery.data });
});

app.post("/api/superadmin/email/campaigns", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (name.length < 3) return c.json({ error: "campaign_name_required" }, 400);
  const service = admin(c.env);
  const segment = body.segment && typeof body.segment === "object" ? body.segment : {};
  const subject = String(body.subject || "").trim();
  const htmlBody = String(body.htmlBody || "").trim();
  if (!subject || !htmlBody) return c.json({ error: "campaign_subject_and_html_required" }, 400);
  if (segment.role && !["owner", "member", "viewer"].includes(segment.role)) return c.json({ error: "valid_campaign_role_required" }, 400);
  if (segment.billingEnvironment && !["test", "live"].includes(segment.billingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
  const members = await service.from("account_memberships").select("user_id,account_id,role,accounts(billing_environment)").limit(50000);
  const uniqueUsers = new Set((members.data || []).filter((item: any) => (!segment.accountId || item.account_id === segment.accountId) && (!segment.role || item.role === segment.role) && (!segment.billingEnvironment || item.accounts?.billing_environment === segment.billingEnvironment)).map((item: any) => item.user_id));
  const variables = [...new Set([...subject.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g), ...htmlBody.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)].map((match) => match[1]))];
  const { data, error } = await service.from("email_campaigns").insert({ name, template_id: body.templateId || null, subject, html_body: htmlBody, text_body: String(body.textBody || "").trim() || null, variables, segment, recipient_preview_count: uniqueUsers.size, state: "draft", created_by: authorization.staff!.userId }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ campaign: data, preview: { eligibleBeforePreferences: uniqueUsers.size, executionRechecksPreferences: true, sentToCustomers: false } }, 201);
});

app.patch("/api/superadmin/email/campaigns/:id", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const service = admin(c.env);
  const { data: previous } = await service.from("email_campaigns").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "campaign_not_found" }, 404);
  let changes: Record<string, unknown> = {};
  if (body.action === "schedule") {
    const scheduledAt = String(body.scheduledAt || "");
    if (!scheduledAt || Date.parse(scheduledAt) <= Date.now()) return c.json({ error: "future_schedule_required" }, 400);
    if (!String(previous.subject || "").trim() || !String(previous.html_body || "").trim()) return c.json({ error: "campaign_content_required_before_scheduling" }, 409);
    changes = { state: "scheduled", scheduled_at: scheduledAt };
  } else if (body.action === "cancel") changes = { state: "cancelled", cancelled_at: new Date().toISOString() };
  else if (body.action === "edit") {
    const reason = String(body.reason || "").trim();
    const name = String(body.name || "").trim();
    if (previous.state !== "draft") return c.json({ error: "draft_campaign_required" }, 409);
    if (name.length < 3 || reason.length < 3 || reason.length > 500) return c.json({ error: "campaign_name_and_reason_required" }, 400);
    const subject = String(body.subject || "").trim();
    const htmlBody = String(body.htmlBody || "").trim();
    const segment = body.segment && typeof body.segment === "object" ? body.segment : {};
    if (!subject || !htmlBody) return c.json({ error: "campaign_subject_and_html_required" }, 400);
    if (segment.role && !["owner", "member", "viewer"].includes(segment.role)) return c.json({ error: "valid_campaign_role_required" }, 400);
    if (segment.billingEnvironment && !["test", "live"].includes(segment.billingEnvironment)) return c.json({ error: "valid_billing_environment_required" }, 400);
    const members = await service.from("account_memberships").select("user_id,account_id,role,accounts(billing_environment)").limit(50000);
    const uniqueUsers = new Set((members.data || []).filter((candidate: any) => (!segment.accountId || candidate.account_id === segment.accountId) && (!segment.role || candidate.role === segment.role) && (!segment.billingEnvironment || candidate.accounts?.billing_environment === segment.billingEnvironment)).map((candidate: any) => candidate.user_id));
    const variables = [...new Set([...subject.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g), ...htmlBody.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)].map((match) => match[1]))];
    changes = { name, subject, html_body: htmlBody, text_body: String(body.textBody || "").trim() || null, variables, template_id: body.templateId || null, segment, recipient_preview_count: uniqueUsers.size };
  } else return c.json({ error: "valid_campaign_action_required" }, 400);
  const { data, error } = await service.from("email_campaigns").update(changes).eq("id", previous.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  if (body.action === "edit") await recordAdminActivity(c.env, authorization.staff!.userId, "email_campaign.changed", "success", { targetType: "email_campaign", targetId: data.id, reason: String(body.reason || "").trim(), previousValues: previous, newValues: data });
  return c.json({ campaign: data, customerSendActivated: false });
});

app.post("/api/superadmin/email/campaigns/:id/duplicate", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const { data: source } = await service.from("email_campaigns").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!source) return c.json({ error: "campaign_not_found" }, 404);
  const { data, error } = await service.from("email_campaigns").insert({ name: `${source.name} copy`, template_id: source.template_id, subject: source.subject, html_body: source.html_body, text_body: source.text_body, variables: source.variables || [], segment: source.segment, recipient_preview_count: source.recipient_preview_count, state: "draft", duplicated_from: source.id, created_by: authorization.staff!.userId }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json({ campaign: data }, 201);
});

app.post("/api/superadmin/email/campaigns/:id/simulate", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ recipient?: string; eventId?: string }>().catch(() => ({} as { recipient?: string; eventId?: string }));
  const recipient = String(body.recipient || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) return c.json({ error: "valid_test_recipient_required" }, 400);
  const service = admin(c.env);
  const { data: campaign } = await service.from("email_campaigns").select("id,template_id").eq("id", c.req.param("id")).maybeSingle();
  if (!campaign) return c.json({ error: "campaign_not_found" }, 404);
  const dedupeKey = `simulation:campaign:${campaign.id}:${String(body.eventId || "manual")}:${recipient}`;
  const { data: claimed, error } = await service.rpc("claim_notification", { p_key: dedupeKey, p_kind: "campaign", p_recipient: recipient, p_payload: { simulation: true, campaignId: campaign.id, staffUserId: authorization.staff!.userId } });
  if (error) return c.json({ error: error.message }, 400);
  if (claimed) await service.from("notification_deliveries").update({ status: "simulated", provider: "none", provider_status: "not_sent", is_test: true, template_id: campaign.template_id, campaign_id: campaign.id, updated_at: new Date().toISOString() }).eq("dedupe_key", dedupeKey);
  return c.json({ simulated: true, claimed, duplicatePrevented: !claimed, sentToProvider: false });
});

app.post("/api/superadmin/email/suppressions", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const recipient = String(body.recipient || "").trim().toLowerCase();
  const category = String(body.category || "all").trim().slice(0, 80);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (!/^\S+@\S+\.\S+$/.test(recipient) || !category || reason.length < 3) return c.json({ error: "valid_suppression_required" }, 400);
  const { data, error } = await admin(c.env).from("email_suppressions").upsert({ recipient, category, reason, source: "superadmin", created_at: new Date().toISOString(), lifted_at: null }, { onConflict: "recipient,category" }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "email_suppression.changed", "success", { targetType: "email_suppression", targetId: data.id, reason, newValues: { recipient, category, active: true } });
  return c.json({ suppression: data }, 201);
});

app.delete("/api/superadmin/email/suppressions/:id", async (c) => {
  const authorization = await requireStaff(c, "communications.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  const { data, error } = await admin(c.env).from("email_suppressions").update({ lifted_at: new Date().toISOString() }).eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: "suppression_not_found" }, 404);
  await recordAdminActivity(c.env, authorization.staff!.userId, "email_suppression.lifted", "success", { targetType: "email_suppression", targetId: data.id, reason, newValues: { active: false } });
  return c.json({ suppression: data });
});

app.post("/api/superadmin/alert-rules", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  const metric = String(body.metric || "").trim().slice(0, 120);
  const operator = String(body.operator || "gte");
  const threshold = Number(body.threshold);
  const observationMinutes = Math.floor(Number(body.observationMinutes));
  const minimumSamples = Math.floor(Number(body.minimumSamples));
  const cooldownMinutes = Math.floor(Number(body.cooldownMinutes));
  if (name.length < 3 || !metric || !["gt", "gte", "lt", "lte"].includes(operator) || !Number.isFinite(threshold) || observationMinutes < 1 || observationMinutes > 10080 || minimumSamples < 1 || cooldownMinutes < 1 || cooldownMinutes > 43200)
    return c.json({ error: "valid_alert_rule_required" }, 400);
  const { data, error } = await admin(c.env).from("alert_rules").insert({
    name,
    metric,
    operator,
    threshold,
    observation_minutes: observationMinutes,
    minimum_samples: minimumSamples,
    cooldown_minutes: cooldownMinutes,
    scope: body.scope && typeof body.scope === "object" ? body.scope : {},
    enabled: false,
    created_by: authorization.staff!.userId,
  }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "alert_rule.created", "success", { targetType: "alert_rule", targetId: data.id, newValues: data });
  return c.json({ rule: data }, 201);
});

app.patch("/api/superadmin/alert-rules/:id", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<any>().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return c.json({ error: "reason_required" }, 400);
  const service = admin(c.env);
  const { data: previous } = await service.from("alert_rules").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (!previous) return c.json({ error: "alert_rule_not_found" }, 404);
  const changes: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (name.length < 3) return c.json({ error: "valid_rule_name_required" }, 400);
    changes.name = name;
  }
  if (body.metric !== undefined) {
    const metric = String(body.metric).trim().slice(0, 120);
    if (!metric) return c.json({ error: "valid_metric_required" }, 400);
    changes.metric = metric;
  }
  if (body.operator !== undefined) {
    if (!["gt", "gte", "lt", "lte"].includes(String(body.operator))) return c.json({ error: "valid_operator_required" }, 400);
    changes.operator = String(body.operator);
  }
  for (const [inputKey, column, minimum, maximum] of [
    ["threshold", "threshold", Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    ["observationMinutes", "observation_minutes", 1, 10080],
    ["minimumSamples", "minimum_samples", 1, Number.MAX_SAFE_INTEGER],
    ["cooldownMinutes", "cooldown_minutes", 1, 43200],
  ] as const) {
    if (body[inputKey] === undefined) continue;
    const value = Number(body[inputKey]);
    if (!Number.isFinite(value) || value < minimum || value > maximum) return c.json({ error: `valid_${inputKey}_required` }, 400);
    changes[column] = inputKey === "threshold" ? value : Math.floor(value);
  }
  if (body.scope !== undefined) {
    if (!body.scope || typeof body.scope !== "object" || Array.isArray(body.scope)) return c.json({ error: "valid_scope_required" }, 400);
    changes.scope = body.scope;
  }
  if (!Object.keys(changes).length) return c.json({ error: "alert_rule_change_required" }, 400);
  const { data, error } = await service.from("alert_rules").update(changes).eq("id", previous.id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await recordAdminActivity(c.env, authorization.staff!.userId, "alert_rule.changed", "success", { targetType: "alert_rule", targetId: data.id, reason, previousValues: previous, newValues: data });
  return c.json({ rule: data });
});

app.patch("/api/superadmin/alerts/:id", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const body = await c.req.json<{ action?: string; reason?: string; snoozedUntil?: string }>().catch(() => ({} as { action?: string; reason?: string; snoozedUntil?: string }));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || !["acknowledge", "snooze", "resolve"].includes(body.action || "")) return c.json({ error: "valid_action_and_reason_required" }, 400);
  const service = admin(c.env);
  const state = body.action === "acknowledge" ? "acknowledged" : body.action === "snooze" ? "snoozed" : "resolved";
  const snoozedUntil = state === "snoozed" ? String(body.snoozedUntil || "") : null;
  if (state === "snoozed" && Date.parse(snoozedUntil!) <= Date.now()) return c.json({ error: "future_snooze_required" }, 400);
  const { data, error } = await service.from("platform_alerts").update({ state, acknowledged_by: authorization.staff!.userId, snoozed_until: snoozedUntil, resolved_at: state === "resolved" ? new Date().toISOString() : null }).eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: "alert_not_found" }, 404);
  await service.from("platform_alert_history").insert({ alert_id: data.id, event: state === "acknowledged" ? "acknowledged" : state, reason, actor_staff_id: authorization.staff!.userId });
  return c.json({ alert: data });
});

app.post("/api/superadmin/alerts/evaluate", async (c) => {
  const authorization = await requireStaff(c, "operations.write");
  if (authorization.response) return authorization.response;
  const service = admin(c.env);
  const { data: rules } = await service.from("alert_rules").select("*").eq("enabled", true);
  const results: any[] = [];
  for (const rule of rules || []) {
    const since = new Date(Date.now() - Number(rule.observation_minutes) * 60000).toISOString();
    const events = await service.from("operational_events").select("value").eq("metric", rule.metric).gte("observed_at", since).limit(10000);
    if (events.error) {
      await service.from("alert_rules").update({ evaluation_state: "failing", evaluation_error: events.error.message, last_evaluated_at: new Date().toISOString() }).eq("id", rule.id);
      results.push({ ruleId: rule.id, state: "failing" }); continue;
    }
    const values = (events.data || []).map((item) => Number(item.value)).filter(Number.isFinite);
    const latest = values.at(-1);
    const enough = values.length >= rule.minimum_samples;
    const breached = enough && latest !== undefined && ({ gt: latest > rule.threshold, gte: latest >= rule.threshold, lt: latest < rule.threshold, lte: latest <= rule.threshold } as any)[rule.operator];
    const evaluationState = values.length ? "healthy" : "telemetry_unavailable";
    await service.from("alert_rules").update({ evaluation_state: evaluationState, evaluation_error: null, last_evaluated_at: new Date().toISOString() }).eq("id", rule.id);
    if (breached) {
      const title = `${rule.name}: ${latest} ${rule.operator} ${rule.threshold}`;
      const { data: alert } = await service.from("platform_alerts").insert({ rule_id: rule.id, title, details: { value: latest, samples: values.length, observationMinutes: rule.observation_minutes } }).select().single();
      if (alert) await service.from("platform_alert_history").insert({ alert_id: alert.id, event: "created", details: alert.details });
    }
    results.push({ ruleId: rule.id, state: evaluationState, samples: values.length, breached });
  }
  return c.json({ evaluatedAt: new Date().toISOString(), rules: results, simulated: true });
});

app.post("/api/properties/:id/reset", async (c) => {
  const propertyId = c.req.param("id");
  const { data, error } = await c.get("db").rpc("reset_property_data", { p_property_id: propertyId });
  if (error) {
    if (error.message.includes("property_manage_access_required"))
      return c.json({ error: "property_manage_access_required" }, 403);
    return c.json({ error: error.message }, 400);
  }
  await recordActivity(c.env, c.get("userId"), "property.data_reset", propertyId);
  return c.json(data);
});

app.post("/api/properties/:id/verify", async (c) => {
  const db = c.get("db");
  const { data: property, error } = await db
    .from("properties")
    .select("id,url,tracking_id,workspace_id,tracking_last_received_at")
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
    if (verified) {
      const service = admin(c.env);
      await service.from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("property_id", property.id)
        .eq("category", "tracking_problems")
        .is("read_at", null);
      if (!property.tracking_last_received_at)
        await createPropertyNotification(c.env, property.id, {
          category: "tracking_problems",
          title: "Tracking installed — awaiting first visit",
          body: "Visit the published site once to start analytics collection. Clear site or CDN caches if the code was just added.",
          severity: "warning",
          dedupeKey: `tracking-first-visit:${property.id}`,
        });
    }
    return c.json({
      verified,
      trackingActive: Boolean(property.tracking_last_received_at),
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
    idempotencyKey?: string;
  }>();
  const db = c.get("db");
  const { data: property } = await db
    .from("properties")
    .select("id,url,account_id,access_state,workspaces(account_id,accounts(entitlement))")
    .eq("id", b.propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  const processing = await processingAccess(c.env, "new_audits", property.account_id);
  if (!processing.allowed || property.access_state !== "active")
    return c.json({ error: processing.error || "property_processing_paused" }, 503);
  const limits = await safetyLimits(c.env);
  if (!limits) return c.json({ error: "safety_configuration_unavailable" }, 503);
  let entitlements;
  try { entitlements = await effectiveEntitlements(c.env, property.account_id); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
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
      entitlement: entitlements.packageKey || workspace?.accounts?.entitlement || null,
      requestedCheckIds: b.checkIds,
    });
    snapshot = configured.technicalSnapshot;
    userFacingSnapshot = configured.userFacingSnapshot;
  } catch (error) {
    console.error("audit registry configuration failed", errorMessage(error));
    return c.json({ error: "audit_registry_unavailable" }, 503);
  }
  if (!snapshot.length) return c.json({ error: "audit_registry_empty" }, 503);
  const service = admin(c.env);
  const runId = crypto.randomUUID();
  const idempotencyKey = String(b.idempotencyKey || c.req.header("idempotency-key") || runId).slice(0, 200);
  const creditResult = await service.rpc("reserve_audit_credits_internal", {
    p_account_id: property.account_id,
    p_property_id: property.id,
    p_idempotency_key: idempotencyKey,
    p_request_run_id: runId,
    p_page_count: 1,
    p_weekly_limit: typeof entitlements.values.auditCreditsPerWeek === "number" ? Math.floor(entitlements.values.auditCreditsPerWeek) : null,
  });
  if (creditResult.error)
    return c.json({ error: creditResult.error.message.includes("weekly_audit") ? "weekly_audit_credit_limit_reached" : "audit_credit_reservation_failed" }, 429);
  const creditReservation = creditResult.data as any;
  if (creditReservation.request_run_id !== runId) {
    const { data: existingRun } = await service.from("audit_runs").select("*").eq("id", creditReservation.request_run_id).maybeSingle();
    return c.json(existingRun || { id: creditReservation.request_run_id, status: "queued", idempotentReplay: true }, existingRun ? 200 : 202);
  }
  if (creditReservation.audit_run_id) {
    const { data: existingRun } = await service.from("audit_runs").select("*").eq("id", creditReservation.audit_run_id).maybeSingle();
    if (existingRun) return c.json(existingRun, 200);
  }
  const leaseResult = await service.rpc("acquire_audit_processing_slot_internal", {
    p_job_id: runId,
    p_account_id: property.account_id,
    p_daily_limit: limits.daily,
    p_concurrent_limit: limits.concurrent,
    p_lease_minutes: 12,
  });
  if (leaseResult.error) {
    await service.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: creditReservation.id, p_target: "released", p_reason: "processing_slot_unavailable" });
    const error = leaseResult.error.message.includes("daily") ? "platform_daily_audit_limit_reached" : "platform_concurrent_audit_limit_reached";
    return c.json({ error }, 429);
  }
  const lease = leaseResult.data as any;
  const { data: run, error } = await db
    .from("audit_runs")
    .insert({
      id: runId,
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
      credit_reservation_id: creditReservation.id,
      platform_lease_id: lease.id,
    })
    .select()
    .single();
  if (error) {
    await Promise.all([
      service.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: creditReservation.id, p_target: "released", p_reason: "audit_run_insert_failed" }),
      service.rpc("release_processing_slot_internal", { p_lease_id: lease.id }),
    ]);
    return c.json({ error: error.message }, 400);
  }
  await service.from("audit_credit_reservations").update({ audit_run_id: run.id }).eq("id", creditReservation.id);
  try {
    await c.env.JOBS.send({ type: "audit", id: run.id });
  } catch {
    await Promise.all([
      service.from("audit_runs").update({ status: "failed", error: "queue_submission_failed", completed_at: new Date().toISOString() }).eq("id", run.id),
      service.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: creditReservation.id, p_target: "released", p_reason: "queue_submission_failed" }),
      service.rpc("release_processing_slot_internal", { p_lease_id: lease.id }),
    ]);
    return c.json({ error: "audit_queue_unavailable" }, 503);
  }
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
  const [{ data, error }, summaryResult] = await Promise.all([
    query.limit(50),
    (() => {
      let summaryQuery = db.from("audit_run_summaries").select("*")
        .eq("property_id", c.req.param("id"))
        .gte("created_at", window.from).lte("created_at", window.to)
        .order("created_at", { ascending: false });
      if (pageId) summaryQuery = summaryQuery.eq("audit_page_id", pageId);
      return summaryQuery.limit(50);
    })(),
  ]);
  if (error) return c.json({ error: error.message }, 400);
  if (summaryResult.error) return c.json({ error: summaryResult.error.message }, 400);
  const compactRuns = (summaryResult.data || []).map((summary: any) => ({
    id: summary.source_run_id,
    audit_page_id: summary.audit_page_id,
    property_id: summary.property_id,
    page_url: summary.page_url,
    status: summary.status,
    score: summary.score,
    coverage: summary.coverage,
    duration_ms: summary.duration_ms,
    created_at: summary.created_at,
    completed_at: summary.completed_at,
    category_scores: { SEO: summary.seo_score, Accessibility: summary.accessibility_score, Performance: summary.performance_score, Security: summary.security_score, Technical: summary.technical_score, "AI & Crawler Readiness": summary.ai_crawler_readiness_score },
    catalogue_summary: { attemptedChecks: summary.automated_check_count, successfullyExecutedChecks: summary.automated_check_count - summary.not_tested_count, passedChecks: summary.passed_count, issueChecks: summary.issues_count, notApplicableChecks: summary.not_applicable_count, notTestedChecks: summary.not_tested_count },
    compact_summary: true,
    audit_results: [],
    user_facing_results: [],
  }));
  let runs = [...(data || []), ...compactRuns].sort((left: any, right: any) => Date.parse(right.created_at) - Date.parse(left.created_at)).slice(0, 50);
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

export const UPTIME_MAXIMUM_DAYS = 730;

app.get("/api/properties/:id/incidents", async (c) => {
  const window = requestedWindow(c, 30, UPTIME_MAXIMUM_DAYS);
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

export function uptimeResponseBucket(from: string, to: string) {
  const duration = Math.max(0, new Date(to).valueOf() - new Date(from).valueOf() + 1);
  if (duration <= 24 * 60 * 60_000) return "hour" as const;
  if (duration > 93 * 24 * 60 * 60_000) return "month" as const;
  return "day" as const;
}

export function uptimeCheckResponseSeries(checks: Array<{ checked_at: string; response_ms: number | null }>) {
  return checks.flatMap((check) => {
    if (check.response_ms == null || !Number.isFinite(Number(check.response_ms))) return [];
    return [{ label: check.checked_at, value: Number(check.response_ms), samples: 1 }];
  });
}

export function uptimeDailyStatus({
  incidentCount,
  total,
  suppressed,
  partial,
  dayEnd,
  monitorCreated,
}: {
  incidentCount: number;
  total: number;
  suppressed: number;
  partial: boolean;
  dayEnd: number;
  monitorCreated: number;
}) {
  if (dayEnd <= monitorCreated) return "not_started" as const;
  if (incidentCount > 0) return "incident" as const;
  if (total > 0) return partial ? "partial" as const : "available" as const;
  if (suppressed > 0) return "suppressed" as const;
  return "missing" as const;
}

app.get("/api/monitors/:id/checks", async (c) => {
  const individualChecks = c.req.query("response_mode") === "checks";
  const window = requestedWindow(c, individualChecks ? 1 : 30, UPTIME_MAXIMUM_DAYS);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const duration = new Date(window.to).valueOf() - new Date(window.from).valueOf() + 1;
  const previousTo = new Date(new Date(window.from).valueOf() - 1);
  const previousFrom = new Date(previousTo.valueOf() - duration + 1);
  const responseBucket = uptimeResponseBucket(window.from, window.to);
  const fields = "id,checked_at,success,status_code,response_ms,error_code,suppressed_by_maintenance";
  const responseFields = "checked_at,response_ms";
  const now = new Date();
  const currentLocalDay = localDateKey(now, window.timeZone);
  const dailyStartKey = shiftDateKey(currentLocalDay, -29);
  const dailyFrom = zonedDateBoundary(dailyStartKey, window.timeZone, false).toISOString();
  const dailyTo = zonedDateBoundary(currentLocalDay, window.timeZone, true).toISOString();
  const [currentResult, previousResult, dailyResult, monitorResult, currentChecksResult, previousChecksResult, latestCheckResult] = await Promise.all([
    c.get("db").rpc("uptime_response_window", {
      p_monitor_id: c.req.param("id"),
      p_from: window.from,
      p_to: window.to,
      p_time_zone: window.timeZone,
      p_bucket: responseBucket,
    }),
    c.get("db").rpc("uptime_response_window", {
      p_monitor_id: c.req.param("id"),
      p_from: previousFrom.toISOString(),
      p_to: previousTo.toISOString(),
      p_time_zone: window.timeZone,
      p_bucket: responseBucket,
    }),
    c.get("db").rpc("uptime_daily_window", {
      p_monitor_id: c.req.param("id"),
      p_from: dailyFrom,
      p_to: dailyTo,
      p_time_zone: window.timeZone,
    }),
    c.get("db")
      .from("uptime_monitors")
      .select("id,property_id,interval_minutes,created_at")
      .eq("id", c.req.param("id"))
      .single(),
    individualChecks
      ? c.get("db")
          .from("uptime_checks")
          .select(responseFields)
          .eq("monitor_id", c.req.param("id"))
          .gte("checked_at", window.from)
          .lte("checked_at", window.to)
          .order("checked_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    individualChecks
      ? c.get("db")
          .from("uptime_checks")
          .select(responseFields)
          .eq("monitor_id", c.req.param("id"))
          .gte("checked_at", previousFrom.toISOString())
          .lte("checked_at", previousTo.toISOString())
          .order("checked_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    c.get("db")
      .from("uptime_checks")
      .select(fields)
      .eq("monitor_id", c.req.param("id"))
      .order("checked_at", { ascending: false })
      .limit(1),
  ]);
  if (currentResult.error) return c.json({ error: currentResult.error.message }, 400);
  if (previousResult.error) return c.json({ error: previousResult.error.message }, 400);
  if (dailyResult.error) return c.json({ error: dailyResult.error.message }, 400);
  if (currentChecksResult.error) return c.json({ error: currentChecksResult.error.message }, 400);
  if (previousChecksResult.error) return c.json({ error: previousChecksResult.error.message }, 400);
  if (latestCheckResult.error) return c.json({ error: latestCheckResult.error.message }, 400);
  if (monitorResult.error || !monitorResult.data)
    return c.json({ error: "monitor_not_found" }, 404);
  const responseWindow = currentResult.data && typeof currentResult.data === "object"
    ? currentResult.data as Record<string, any>
    : {};
  const previousResponseWindow = previousResult.data && typeof previousResult.data === "object"
    ? previousResult.data as Record<string, any>
    : {};
  const dailyRows = Array.isArray(dailyResult.data) ? dailyResult.data : [];
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
    byDay.set(shiftDateKey(dailyStartKey, index), { total: 0, successful: 0, suppressed: 0, statusCode: null, incidents: [] });
  for (const row of dailyRows) {
    const current = byDay.get(row.day);
    if (!current) continue;
    current.total = Number(row.total || 0);
    current.successful = Number(row.successful || 0);
    current.suppressed = Number(row.suppressed || 0);
    current.statusCode = row.statusCode ?? null;
    byDay.set(row.day, current);
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
    const partial = false;
    return {
      day,
      total: value.total,
      successful: value.successful,
      suppressed: value.suppressed,
      expected,
      partial,
      status: uptimeDailyStatus({
        incidentCount: value.incidents.length,
        total: value.total,
        suppressed: value.suppressed,
        partial,
        dayEnd,
        monitorCreated,
      }),
      statusCode: value.statusCode,
      incidents: value.incidents,
    };
  });
  return c.json({
    responseSeries: individualChecks
      ? uptimeCheckResponseSeries(currentChecksResult.data || [])
      : Array.isArray(responseWindow.series) ? responseWindow.series : [],
    responseBucket: individualChecks ? "check" : responseWindow.bucket || responseBucket,
    summary: responseWindow.summary || {},
    previous: {
      responseSeries: individualChecks
        ? uptimeCheckResponseSeries(previousChecksResult.data || [])
        : Array.isArray(previousResponseWindow.series) ? previousResponseWindow.series : [],
      responseBucket: individualChecks ? "check" : previousResponseWindow.bucket || responseBucket,
      summary: previousResponseWindow.summary || {},
    },
    latestCheck: latestCheckResult.data?.[0] || null,
    range: { from: window.from, to: window.to, timeZone: window.timeZone },
    days: dailyDays,
    dailyScope: { from: dailyFrom, to: dailyTo, timeZone: window.timeZone, days: 30 },
  });
});

app.patch("/api/monitors/:id", async (c) => {
  const requested = (({
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
  const db = c.get("db");
  const { data: monitorAccess, error: accessError } = await db
    .from("uptime_monitors")
    .select("id,properties(account_id)")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  const accountId = (monitorAccess?.properties as any)?.account_id;
  if (accessError || !monitorAccess || !accountId)
    return c.json({ error: "monitor_not_found" }, 404);
  let entitlements;
  try { entitlements = await effectiveEntitlements(c.env, accountId); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
  const configuredMinimumValue = entitlements.values.uptimeIntervalMinutes;
  const configuredMinimum = typeof configuredMinimumValue === "number" ? configuredMinimumValue : NaN;
  const minimum = Number.isSafeInteger(configuredMinimum)
    ? configuredMinimum
    : uptimeMinimumInterval(entitlements.packageKey);
  const permittedIntervals = [1, 2, 5, 10, 15, 30, 60].filter((interval) => interval >= minimum);
  if (!Number.isSafeInteger(Number(requested.interval_minutes)) || !permittedIntervals.includes(Number(requested.interval_minutes)))
    return c.json({ error: "uptime_interval_not_available_for_plan", minimumMinutes: minimum }, 409);
  const { data, error } = await db
    .from("uptime_monitors")
    .update({ ...requested, interval_minutes: Number(requested.interval_minutes) })
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
  const testTemplate = await publishedEmailTemplate(admin(c.env), "uptime_down");
  const testVariables = { propertyName: property.name, propertyUrl: property.url || "", incidentOpenedAt: sampleIncident.opened_at, incidentResolvedAt: "", appUrl: `${c.env.APP_ORIGIN}/uptime?property=${property.id}` };
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
      subject: `[TEST] ${testTemplate ? renderEmailTemplate(testTemplate.subject, testVariables).rendered : `Claritude uptime alert · ${property.name}`}`,
      html: testTemplate ? renderEmailTemplate(testTemplate.html_body, testVariables).rendered : renderUptimeAlertEmail({
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
      provider: "Resend",
      provider_status: response.ok ? "accepted" : "rejected",
      provider_id: providerId,
      is_test: true,
      property_id: propertyId,
      template_id: testTemplate?.id || null,
      automation_key: "uptime_down",
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
    db.rpc("analytics_event_definition_counts", {
      p_property_id: propertyId,
      p_from: from,
    }),
    db
      .from("properties")
      .select("id,account_id,workspaces(accounts(entitlement))")
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
    counts.set(key, {
      count: Number(event.received || 0),
      last: event.last_received_at || null,
    });
  }
  const property = propertyResponse.data as any;
  let allowance;
  try { allowance = effectiveCustomEventAllowance(await effectiveEntitlements(c.env, property.account_id), definitions.length); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
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
    .select("id,account_id,workspace_id,workspaces(accounts(entitlement))")
    .eq("id", propertyId)
    .single();
  if (!property) return c.json({ error: "property_not_found" }, 404);
  if (!(await canManageWorkspace(db, c.get("userId"), property.workspace_id)))
    return c.json({ error: "property_manage_access_required" }, 403);
  const { count } = await db
    .from("event_definitions")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  let allowance;
  try { allowance = effectiveCustomEventAllowance(await effectiveEntitlements(c.env, property.account_id), count || 0); }
  catch { return c.json({ error: "effective_entitlements_unavailable" }, 503); }
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
  const body = await c.req.json<{
    enabled?: boolean;
    name?: string;
    eventType?: string;
    description?: string;
    matchSettings?: Record<string, unknown>;
  }>();
  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "enabled")) updates.enabled = Boolean(body.enabled);
  if (body.name !== undefined || body.eventType !== undefined || body.description !== undefined || body.matchSettings !== undefined) {
    const name = String(body.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 80);
    const eventType = ["click", "pageview", "form_success"].includes(String(body.eventType)) ? String(body.eventType) : "";
    const matchSettings = sanitizeEventMatchSettings(eventType, body.matchSettings);
    if (!name) return c.json({ error: "event_name_required" }, 400);
    if (!eventType) return c.json({ error: "unsupported_event_type" }, 400);
    if (!matchSettings) return c.json({ error: "valid_event_match_settings_required" }, 400);
    updates.name = name;
    updates.event_type = eventType;
    updates.description = String(body.description || "").trim().slice(0, 240) || null;
    updates.match_settings = matchSettings;
  }
  if (!Object.keys(updates).length) return c.json({ error: "event_update_required" }, 400);
  const { data, error } = await c
    .get("db")
    .from("event_definitions")
    .update(updates)
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

async function validateDelegatedNotificationScope(
  c: any,
  accountId?: string,
  propertyId?: string,
) {
  const delegation = c.get("delegation");
  if (!delegation) return true;
  if (accountId && accountId !== delegation.account_id) return false;
  if (!propertyId) return true;
  const { data: scopedProperty } = await admin(c.env)
    .from("properties")
    .select("workspaces(account_id)")
    .eq("id", propertyId)
    .maybeSingle();
  return (scopedProperty?.workspaces as any)?.account_id === delegation.account_id;
}

app.get("/api/notifications/summary", async (c) => {
  const accountId = c.req.query("accountId") || undefined;
  const propertyId = c.req.query("propertyId") || undefined;
  if (accountId && propertyId) return c.json({ error: "single_notification_scope_required" }, 400);
  if (!(await validateDelegatedNotificationScope(c, accountId, propertyId)))
    return c.json({ error: "delegation_scope_violation" }, 403);
  const db = c.get("db");
  const userId = c.get("userId");
  let countQuery = db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  let latestQuery = db.from("notifications").select("*").eq("user_id", userId).is("read_at", null);
  if (propertyId) {
    countQuery = countQuery.eq("property_id", propertyId);
    latestQuery = latestQuery.eq("property_id", propertyId);
  } else if (accountId) {
    countQuery = countQuery.eq("account_id", accountId);
    latestQuery = latestQuery.eq("account_id", accountId);
  }
  const [countResult, latestResult] = await Promise.all([
    countQuery,
    latestQuery.order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = countResult.error || latestResult.error;
  if (error) return c.json({ error: error.message }, 400);
  c.header("Cache-Control", "private, no-store");
  return c.json({ unread: countResult.count || 0, latest: latestResult.data || null });
});

app.get("/api/notifications", async (c) => {
  const accountId = c.req.query("accountId") || undefined;
  const propertyId = c.req.query("propertyId") || undefined;
  if (accountId && propertyId) return c.json({ error: "single_notification_scope_required" }, 400);
  if (!(await validateDelegatedNotificationScope(c, accountId, propertyId)))
    return c.json({ error: "delegation_scope_violation" }, 403);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(c.req.query("limit") || 100))));
  const offset = Math.min(10_000, Math.max(0, Math.floor(Number(c.req.query("offset") || 0))));
  const state = c.req.query("state") || "active";
  if (!["active", "archived"].includes(state)) return c.json({ error: "invalid_notification_state" }, 400);
  const allowedCategories = new Set(["monitoring", "monitor_incidents", "recoveries", "audits", "audit_issues", "analytics", "tracking_problems", "account"]);
  const categories = (c.req.query("categories") || "").split(",").filter((category) => allowedCategories.has(category));
  let query = c.get("db")
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", c.get("userId"));
  if (propertyId) query = query.eq("property_id", propertyId);
  else if (accountId) query = query.eq("account_id", accountId);
  query = state === "archived" ? query.not("read_at", "is", null) : query.is("read_at", null);
  if (categories.length) query = query.in("category", categories);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return c.json({ error: error.message }, 400);
  c.header("Cache-Control", "private, no-store");
  return c.json({ items: data || [], total: count || 0, offset, limit });
});

app.patch("/api/notifications/:id/read", async (c) => {
  let query = c.get("db")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"));
  const delegation = c.get("delegation");
  if (delegation) query = query.eq("account_id", delegation.account_id);
  const { data, error } = await query.select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

app.post("/api/notifications/read-all", async (c) => {
  const body: { propertyId?: string | null; accountId?: string | null; categories?: string[] | null } = await c.req
    .json<{ propertyId?: string | null; accountId?: string | null; categories?: string[] | null }>()
    .catch(() => ({}));
  if (body.propertyId && body.accountId)
    return c.json({ error: "single_notification_scope_required" }, 400);
  if (!(await validateDelegatedNotificationScope(c, body.accountId || undefined, body.propertyId || undefined)))
    return c.json({ error: "delegation_scope_violation" }, 403);
  let query = c.get("db")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", c.get("userId"))
    .is("read_at", null);
  if (body.propertyId) query = query.eq("property_id", body.propertyId);
  else if (body.accountId) query = query.eq("account_id", body.accountId);
  const allowedCategories = new Set(["monitoring", "monitor_incidents", "recoveries", "audits", "audit_issues", "analytics", "tracking_problems", "account"]);
  const categories = Array.isArray(body.categories) ? body.categories.filter((category) => allowedCategories.has(category)) : [];
  if (categories.length) query = query.in("category", categories);
  const { data, error } = await query.select("id");
  return error ? c.json({ error: error.message }, 400) : c.json({ updated: data?.length || 0 });
});

app.get("/api/properties/:id/uptime-status", async (c) => {
  const { data, error } = await c.get("db")
    .from("uptime_monitors")
    .select("id,enabled,last_status,last_response_ms,last_checked_at")
    .eq("property_id", c.req.param("id"))
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: "uptime_monitor_not_found" }, 404);
  c.header("Cache-Control", "private, no-store");
  return c.json(data);
});

app.get("/api/account/export", async (c) => {
  const db = c.get("db");
  const [profile, accounts, workspaces, properties, incidents, audits, analytics, analyticsTotals, analyticsDimensions, reports, schedules, activity] =
    await Promise.all([
      db.from("profiles").select("*").maybeSingle(),
      db.from("account_memberships").select("role,accounts(*)"),
      db.from("workspace_memberships").select("role,workspaces(*)"),
      db.from("properties").select("*,uptime_monitors(*),property_audit_pages(*)"),
      db.from("incidents").select("*"),
      db.from("audit_runs").select("*,audit_results(*)").limit(500),
      db.from("analytics_daily").select("*").limit(100000),
      db.from("analytics_compact_totals").select("*").limit(100000),
      db.from("analytics_compact_dimensions").select("*").limit(250000),
      db.from("saved_reports").select("*").limit(1000),
      db.from("report_schedules").select("*").limit(1000),
      db.from("activity_log").select("*").limit(5000),
    ]);
  const failure = [profile, accounts, workspaces, properties, incidents, audits, analytics, analyticsTotals, analyticsDimensions, reports, schedules, activity]
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
    analyticsCompactTotals: analyticsTotals.data,
    analyticsCompactDimensions: analyticsDimensions.data,
    savedReports: reports.data,
    reportSchedules: schedules.data,
    activity: activity.data,
  });
});

app.post("/api/account/deletion-request", async (c) => {
  const body = await c.req.json<{ accountId?: string; confirmation?: string; dataExportAcknowledged?: boolean }>().catch(() => ({} as any));
  const accountId = String(body.accountId || "");
  if (!accountId || body.dataExportAcknowledged !== true) return c.json({ error: "account_and_export_acknowledgement_required" }, 400);
  const service = admin(c.env);
  const [membership, account] = await Promise.all([
    service.from("account_memberships").select("role").eq("account_id", accountId).eq("user_id", c.get("userId")).maybeSingle(),
    service.from("accounts").select("id,name,access_state").eq("id", accountId).maybeSingle(),
  ]);
  if (membership.data?.role !== "owner") return c.json({ error: "account_owner_access_required" }, 403);
  if (!account.data) return c.json({ error: "account_not_found" }, 404);
  if (String(body.confirmation || "").trim() !== account.data.name) return c.json({ error: "account_name_confirmation_required" }, 400);
  const existing = await service.from("deletion_requests").select("id,state,created_at").eq("account_id", accountId).in("state", ["review_hold", "approved", "scheduled"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data) return c.json({ request: existing.data, reused: true });
  const [workspaces, properties, members] = await Promise.all([
    service.from("workspaces").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    service.from("properties").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    service.from("account_memberships").select("user_id", { count: "exact", head: true }).eq("account_id", accountId),
  ]);
  const dryRun = {
    generatedAt: new Date().toISOString(),
    requestedByUserId: c.get("userId"),
    account: { id: account.data.id, name: account.data.name, accessState: account.data.access_state },
    accountScopedResources: { workspaces: workspaces.count || 0, properties: properties.count || 0, memberships: members.count || 0 },
    safeguards: { dataExportAcknowledged: true, reviewRequired: true, immediateDeletion: false },
  };
  const request = await service.from("deletion_requests").insert({
    account_id: accountId,
    state: "review_hold",
    dry_run: dryRun,
    reason: "Account owner requested deletion through Account Settings",
    requested_by: null,
  }).select("id,state,created_at").single();
  if (request.error) return c.json({ error: "account_deletion_request_failed" }, 400);
  await recordActivity(c.env, c.get("userId"), "account.deletion_requested", undefined, { accountId, deletionRequestId: request.data.id });
  return c.json({ request: request.data }, 201);
});

app.get("/api/properties/:id/overview", async (c) => {
  const window = requestedWindow(c);
  if (!window) return c.json({ error: "invalid_date_range" }, 400);
  const previousWindow = analyticsPreviousPeriodRange(window.from, window.to);
  const startedAt = performance.now();
  const db = c.get("db");
  const [analyticsResult, previousAnalyticsResult, auditResult] = await Promise.all([
    db.rpc("analytics_property_overview", {
      p_property_id: c.req.param("id"),
      p_from: window.from,
      p_to: window.to,
      p_time_zone: window.timeZone,
    }),
    db.rpc("analytics_property_overview", {
      p_property_id: c.req.param("id"),
      p_from: previousWindow.from,
      p_to: previousWindow.to,
      p_time_zone: window.timeZone,
    }),
    db
      .from("audit_runs")
      .select("id,status,score,coverage,created_at,completed_at,registry_snapshot,user_facing_snapshot,audit_results(id,check_id,outcome,review_status)")
      .eq("property_id", c.req.param("id"))
      .in("status", ["completed", "partial"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const failure = analyticsResult.error || previousAnalyticsResult.error || auditResult.error;
  if (failure) {
    console.error("property overview query failed", failure.message);
    return c.json({ error: failure.message }, 400);
  }
  const latestAudit = auditResult.data as any;
  let audit = null;
  if (latestAudit) {
    const technicalSnapshot = Array.isArray(latestAudit.registry_snapshot)
      ? latestAudit.registry_snapshot as AuditRegistrySnapshot[]
      : [];
    const groupSnapshot = Array.isArray(latestAudit.user_facing_snapshot) && latestAudit.user_facing_snapshot.length
      ? latestAudit.user_facing_snapshot as UserFacingAuditGroupSnapshot[]
      : fallbackUserFacingSnapshot(technicalSnapshot);
    const groupedResults = deriveUserFacingAuditResults(
      groupSnapshot,
      Array.isArray(latestAudit.audit_results) ? latestAudit.audit_results : [],
    );
    const categories = ["SEO", "Accessibility", "Performance", "Security", "Technical", "AI & Crawler Readiness"];
    const categoryScores = Object.fromEntries(categories.map((category) => [
      category,
      scoreUserFacingAuditResults(groupedResults.filter((result) => result.category === category)),
    ]));
    audit = {
      id: latestAudit.id,
      status: latestAudit.status,
      score: latestAudit.score,
      coverage: latestAudit.coverage,
      created_at: latestAudit.created_at,
      completed_at: latestAudit.completed_at,
      category_scores: categoryScores,
    };
  }
  c.header("Server-Timing", `overview-db;dur=${(performance.now() - startedAt).toFixed(1)}`);
  c.header("Cache-Control", "private, max-age=15");
  const emptyAnalytics = (from: string, to: string) => ({
    from,
    to,
    timeZone: window.timeZone,
    pageviews: 0,
    keyEvents: 0,
    sessions: 0,
    series: [],
    pages: [],
    vitals: [],
    performanceByDevice: {},
  });
  const currentAnalytics = analyticsResult.data || emptyAnalytics(window.from, window.to);
  const previousAnalytics = previousAnalyticsResult.data || emptyAnalytics(previousWindow.from, previousWindow.to);
  return c.json({
    analytics: {
      ...currentAnalytics,
      previous: previousAnalytics,
    },
    audit,
  });
});

app.delete("/api/properties/:id/events/:eventId", async (c) => {
  const propertyId = c.req.param("id");
  const eventId = c.req.param("eventId");
  const { data, error } = await c.get("db").rpc("delete_event_definition_with_data", {
    p_property_id: propertyId,
    p_event_id: eventId,
  });
  if (error) {
    if (error.message.includes("property_manage_access_required"))
      return c.json({ error: "property_manage_access_required" }, 403);
    if (error.message.includes("event_definition_not_found"))
      return c.json({ error: "event_definition_not_found" }, 404);
    return c.json({ error: error.message }, 400);
  }
  await recordActivity(c.env, c.get("userId"), "property.event_deleted", propertyId, {
    eventId,
    deletedOccurrences: Number((data as any)?.deletedOccurrences || 0),
  });
  return c.json(data);
});

app.get("/api/properties/:id/analytics", async (c) => {
  const startedAt = performance.now();
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
  const overviewOnly = c.req.query("view") === "overview";
  const previousWindow = analyticsPreviousPeriodRange(window.from, window.to);
  const previousTo = previousWindow.to;
  const previousFrom = previousWindow.from;
  const useRollups = !hasAnalyticsFilters(filters);
  let currentResult: AnalyticsWindowData;
  let previousResult: AnalyticsWindowData | null = null;
  try {
    if (overviewOnly) {
      currentResult = await loadAnalyticsWindow(db, c.req.param("id"), window.from, window.to, useRollups);
    } else {
      [currentResult, previousResult] = await Promise.all([
        loadAnalyticsWindow(db, c.req.param("id"), window.from, window.to, useRollups),
        loadAnalyticsWindow(db, c.req.param("id"), previousFrom, previousTo, useRollups),
      ]);
    }
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "analytics_query_failed" }, 400);
  }
  if (hasUnsupportedHistoricalFilters(filters) && (historicalCompactRows(currentResult).totals.length || (previousResult && historicalCompactRows(previousResult).totals.length))) {
    return c.json({
      error: "historical_filter_requires_detailed_data",
      detail: "This filter can be combined freely within the latest 30 days. Older rollups retain exact page history but intentionally do not retain cross-dimension combinations.",
      detailedFrom: currentResult.detailedFrom,
    }, 422);
  }
  const events = [
    ...currentResult.events,
    ...currentResult.rollups.map(analyticsRollupAsEvent),
  ];
  const previousEvents = [
    ...(previousResult?.events || []),
    ...(previousResult?.rollups || []).map(analyticsRollupAsEvent),
  ];
  const filtered = filterAnalyticsEvents(events, filters);
  const filteredPrevious = filterAnalyticsEvents(previousEvents, filters);
  const filteredViews = filterAnalyticsViews(currentResult.views, filters);
  const filteredPreviousViews = filterAnalyticsViews(previousResult?.views || [], filters);
  const summary = mergeCompactAnalyticsSummary(
    buildAnalyticsSummary(
      filtered,
      window.days,
      window.from,
      window.to,
      window.timeZone,
      [],
      filteredViews,
      { includeVisitTimes: !overviewOnly },
    ),
    currentResult,
    filters,
  );
  const previous = previousResult
    ? mergeCompactAnalyticsSummary(
        buildAnalyticsSummary(
          filteredPrevious,
          window.days,
          previousFrom,
          previousTo,
          window.timeZone,
          [],
          filteredPreviousViews,
        ),
        previousResult,
        filters,
      )
    : undefined;
  let monthlyUsage: any = null;
  const propertyAccount = await db.from("properties").select("account_id").eq("id", c.req.param("id")).maybeSingle();
  if (propertyAccount.data?.account_id) {
    const service = admin(c.env);
    const effective = await effectiveEntitlements(c.env, propertyAccount.data.account_id).catch(() => null);
    const packageKey = String(effective?.packageKey || "free").toLowerCase().startsWith("pro") ? "pro" : String(effective?.packageKey || "free").toLowerCase();
    const periodStart = `${new Date().toISOString().slice(0, 7)}-01`;
    const [rule, usage] = await Promise.all([
      service.from("analytics_plan_rules").select("monthly_pageview_limit,grace_percent").eq("package_key", packageKey).maybeSingle(),
      service.from("account_analytics_monthly_usage").select("accepted_pageviews,rejected_pageviews,updated_at").eq("account_id", propertyAccount.data.account_id).eq("period_start", periodStart).maybeSingle(),
    ]);
    if (rule.data) {
      const limit = Number(rule.data.monthly_pageview_limit || 0);
      const hardLimit = Math.floor(limit * (1 + Number(rule.data.grace_percent || 0) / 100));
      const used = Number(usage.data?.accepted_pageviews || 0);
      monthlyUsage = { used, limit, hardLimit, rejected: Number(usage.data?.rejected_pageviews || 0), percent: limit ? used / limit * 100 : 0, collectionPaused: used >= hardLimit, periodStart, resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString(), updatedAt: usage.data?.updated_at || null };
    }
  }
  if (monthlyUsage?.collectionPaused && monthlyUsage.updatedAt) {
    const pausedDay = String(monthlyUsage.updatedAt).slice(0, 10);
    summary.series = (summary.series || []).map((point: any) => String(point.day).slice(0, 10) >= pausedDay
      ? { ...point, pageviews: null, events: null, dailyVisitors: null, collectionStatus: "not_collected_limit_reached" }
      : point);
  }
  const response = {
    ...summary,
    ...(previous ? { previous } : {}),
    // Filtering can reduce the returned set below the query ceiling. Preserve
    // whether the underlying property/date result hit that ceiling so the UI
    // never presents a partial result as complete.
    truncated: currentResult.truncated,
    filterOptions: buildAnalyticsFilterOptions(events),
    appliedFilters: filters,
    monthlyUsage,
  };
  const responseBytes = new TextEncoder().encode(JSON.stringify(response)).byteLength;
  c.header("Server-Timing", `analytics;dur=${(performance.now() - startedAt).toFixed(1)}`);
  c.header("X-Analytics-Source-Rows", String(currentResult.sourceRows || 0));
  c.header("X-Analytics-Aggregate-Rows", String((currentResult.eventRows || 0) + (currentResult.viewRows || 0)));
  c.header("X-Analytics-DB-Bytes", String(currentResult.dbResponseBytes || 0));
  c.header("X-Analytics-Response-Bytes", String(responseBytes));
  return c.json(response);
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
  const detailedFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recentFrom = new Date(Math.max(Date.parse(window.from), Date.parse(`${detailedFrom}T00:00:00.000Z`))).toISOString();
  const db = c.get("db");
  const [recentResult, compactResult] = await Promise.all([
    db.rpc("analytics_pages_page", {
      p_property_id: c.req.param("id"), p_from: recentFrom, p_to: window.to,
      p_offset: 0, p_limit: 5000,
      p_page_search: cleanAnalyticsFilter(c.req.query("page_search"), 120) || null,
      p_path_mode: pathMode, p_path_value: normalizedPath,
      p_device: cleanAnalyticsFilter(c.req.query("device"), 40) || null,
      p_source: cleanAnalyticsFilter(c.req.query("source"), 255) || null,
      p_country: cleanAnalyticsFilter(c.req.query("country"), 20) || null,
    }),
    db.rpc("analytics_compact_rollup_window", { p_property_id: c.req.param("id"), p_from: window.from, p_to: window.to }),
  ]);
  const { data, error } = recentResult;
  if (error) return c.json({ error: error.message }, 400);
  if (compactResult.error) return c.json({ error: compactResult.error.message }, 400);
  const compactPayload: any = compactResult.data || {};
  const compactKeys = new Set((compactPayload.totals || []).filter((row: any) => String(row.period_start) < detailedFrom).map((row: any) => `${row.grain}:${row.period_start}`));
  const historicalPages = (compactPayload.dimensions || []).filter((row: any) => row.dimension === "page" && compactKeys.has(`${row.grain}:${row.period_start}`));
  if (historicalPages.length && (c.req.query("device") || c.req.query("source") || c.req.query("country")))
    return c.json({ error: "historical_filter_requires_detailed_data", detail: "Device, source and country can be combined with page rows within the latest 30 days." }, 422);
  const recentRows = (data || []).map((row: any) => ({
    path: row.path,
    pageviews: Number(row.pageviews || 0),
    events: Number(row.events || 0),
    activeSeconds: row.average_active_seconds == null ? 0 : Number(row.average_active_seconds) * Number(row.pageviews || 0),
    activeViews: row.average_active_seconds == null ? 0 : Number(row.pageviews || 0),
  }));
  const pageSearch = cleanAnalyticsFilter(c.req.query("page_search"), 120)?.toLowerCase();
  const combined = new Map<string, any>();
  for (const row of [...recentRows, ...historicalPages.map((row: any) => ({ path: normalizeAnalyticsPath(row.value), pageviews: Number(row.pageviews || 0), events: Number(row.events || 0), activeSeconds: Number(row.active_seconds || 0), activeViews: Number(row.active_views || 0) }))]) {
    const path = normalizeAnalyticsPath(row.path);
    if (pageSearch && !path.toLowerCase().includes(pageSearch)) continue;
    if (normalizedPath && pathMode === "exact" && path !== normalizedPath) continue;
    if (normalizedPath && pathMode === "prefix" && !path.startsWith(normalizedPath)) continue;
    const current = combined.get(path) || { path, pageviews: 0, events: 0, activeSeconds: 0, activeViews: 0 };
    current.pageviews += row.pageviews; current.events += row.events; current.activeSeconds += row.activeSeconds; current.activeViews += row.activeViews;
    combined.set(path, current);
  }
  const allRows = [...combined.values()].map((row) => ({ path: row.path, pageviews: row.pageviews, events: row.events, averageActiveSeconds: row.activeViews ? row.activeSeconds / row.activeViews : null })).sort((a, b) => b.pageviews - a.pageviews);
  const total = allRows.length;
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
  return c.json({ rows, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), dataResolution: historicalPages.length ? "detailed_and_rollup" : "detailed", detailedFrom });
});

app.get("/api/properties/:id/ai-visibility", async (c) => {
  const startedAt = performance.now();
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
  };
  const db = c.get("db");
  const propertyId = c.req.param("id");
  const { data: property, error: propertyError } = await db
    .from("properties")
    .select("id,tracking_last_received_at")
    .eq("id", propertyId)
    .maybeSingle();
  if (propertyError) return c.json({ error: propertyError.message }, 400);
  if (!property) return c.json({ error: "property_not_found" }, 404);
  const previousWindow = analyticsPreviousPeriodRange(window.from, window.to);
  const useRollups = !hasAnalyticsFilters(filters);
  try {
    const [currentData, previousData, auditResult] = await Promise.all([
      loadAnalyticsWindow(db, propertyId, window.from, window.to, useRollups),
      loadAnalyticsWindow(db, propertyId, previousWindow.from, previousWindow.to, useRollups),
      db.from("audit_runs")
        .select("*,audit_results(*)")
        .eq("property_id", propertyId)
        .in("status", ["completed", "partial"])
        .order("completed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (auditResult.error) throw new Error(auditResult.error.message);
    const currentEvents = filterAnalyticsEvents([
      ...currentData.events,
      ...currentData.rollups.map(analyticsRollupAsEvent),
    ], filters);
    const previousEvents = filterAnalyticsEvents([
      ...previousData.events,
      ...previousData.rollups.map(analyticsRollupAsEvent),
    ], filters);
    const currentViews = filterAnalyticsViews(currentData.views, filters);
    const previousViews = filterAnalyticsViews(previousData.views, filters);
    const current = buildAiVisibilitySummary(
      [],
      currentViews,
      window.from,
      window.to,
      window.timeZone,
    );
    const previous = buildAiVisibilitySummary(
      [],
      previousViews,
      previousWindow.from,
      previousWindow.to,
      window.timeZone,
    );
    const response = {
      ...current,
      previous,
      insight: aiVisibilityInsight(current, previous),
      audit: buildAiAuditSummary(auditResult.data),
      trackingInstalled: Boolean(property.tracking_last_received_at),
      truncated: currentData.truncated || previousData.truncated,
      filterOptions: buildAnalyticsFilterOptions([
        ...currentEvents,
        ...currentData.views.map(analyticsViewAsEvent),
      ]),
      appliedFilters: filters,
    };
    const responseBytes = new TextEncoder().encode(JSON.stringify(response)).byteLength;
    c.header("Server-Timing", `ai-visibility;dur=${(performance.now() - startedAt).toFixed(1)}`);
    c.header("X-Analytics-Source-Rows", String(currentData.sourceRows || 0));
    c.header("X-Analytics-Aggregate-Rows", String((currentData.eventRows || 0) + (currentData.viewRows || 0)));
    c.header("X-Analytics-DB-Bytes", String(currentData.dbResponseBytes || 0));
    c.header("X-Analytics-Response-Bytes", String(responseBytes));
    return c.json(response);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "ai_visibility_query_failed" }, 400);
  }
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
  const { data: propertyState } = await db.from("properties").select("account_id,access_state").eq("id", run.property_id).maybeSingle();
  const access = propertyState ? await processingAccess(env, "new_audits", propertyState.account_id) : { allowed: false, error: "property_not_found" };
  if (!propertyState || !access.allowed || propertyState.access_state !== "active") {
    await Promise.all([
      db.from("audit_runs").update({ status: "failed", execution_stage: "failed", error: access.error || "property_processing_paused", completed_at: new Date().toISOString() }).eq("id", id),
      run.credit_reservation_id ? db.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: run.credit_reservation_id, p_target: "released", p_reason: "permission_revoked_before_execution" }) : Promise.resolve(),
      run.platform_lease_id ? db.rpc("release_processing_slot_internal", { p_lease_id: run.platform_lease_id }) : Promise.resolve(),
    ]);
    return;
  }
  if (run.credit_reservation_id)
    await db.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: run.credit_reservation_id, p_target: "consumed", p_reason: null });
  if (run.platform_lease_id)
    await db.from("processing_leases").update({ state: "running", expires_at: new Date(Date.now() + 12 * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", run.platform_lease_id).in("state", ["reserved", "running"]);
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
    const detailedOutcomeCounts = Object.fromEntries(["passed", "failed", "advisory", "not_applicable", "unable_to_test"].map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length]));
    const outcomeCounts = {
      automated: results.length,
      passed: detailedOutcomeCounts.passed,
      issues: detailedOutcomeCounts.failed + detailedOutcomeCounts.advisory,
      notApplicable: detailedOutcomeCounts.not_applicable,
      notTested: detailedOutcomeCounts.unable_to_test,
    };
    const categoryScores = Object.fromEntries(["SEO", "Accessibility", "Performance", "Security", "Technical", "AI & Crawler Readiness"].map((category) => [
      category,
      scoreUserFacingAuditResults(userFacingResults.filter((result) => result.category === category)),
    ]));
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
      checkOutcomeCounts: detailedOutcomeCounts,
      unableToTestCount: detailedOutcomeCounts.unable_to_test,
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
      categoryScores,
      outcomeCounts,
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
    if (run.credit_reservation_id && eligiblePlatformAuditFailure(message))
      await Promise.resolve(db.rpc("transition_audit_credit_reservation_internal", { p_reservation_id: run.credit_reservation_id, p_target: "restored", p_reason: message.slice(0, 500) })).catch(() => undefined);
    if (run.platform_lease_id)
      await Promise.resolve(db.rpc("release_processing_slot_internal", { p_lease_id: run.platform_lease_id })).catch(() => undefined);
  }
}

export function eligiblePlatformAuditFailure(message: string) {
  return /(worker|browser|queue|persist|timeout|timed out|internal|storage|database|continuation)/i.test(message);
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
  categoryScores?: Record<string, number | null>;
  outcomeCounts?: Record<string, number>;
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
    category_scores: payload.categoryScores || {},
    outcome_counts: payload.outcomeCounts || {},
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
  const { data: completedRun } = await db.from("audit_runs").select("platform_lease_id").eq("id", id).maybeSingle();
  if (completedRun?.platform_lease_id)
    await db.rpc("release_processing_slot_internal", { p_lease_id: completedRun.platform_lease_id });
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
  const { data: monitor, error: prepareError } = await db.rpc("prepare_uptime_check", {
    p_monitor_id: id,
  });
  if (prepareError) throw prepareError;
  if (!monitor?.run) return;
  const started = Date.now();
  let status: number | null = null,
    ok = false,
    failure: string | null = null;
  try {
    const r = await safeFetch(monitor.url, {
      method: "GET",
      headers: { "user-agent": "Claritude-Uptime/1.0" },
      signal: AbortSignal.timeout(monitor.timeoutMs),
    });
    status = r.status;
    ok =
      status >= monitor.expectedStatusMin &&
      status <= monitor.expectedStatusMax;
  } catch (e) {
    failure = errorMessage(e);
  }
  const checkedAt = new Date().toISOString();
  const { data: persisted, error: persistenceError } = await db.rpc("persist_uptime_check", {
    p_monitor_id: id,
    p_checked_at: checkedAt,
    p_success: ok,
    p_status_code: status,
    p_response_ms: Date.now() - started,
    p_error_code: failure,
  });
  if (persistenceError || !persisted?.ok) throw persistenceError || new Error(persisted?.error || "uptime_persistence_failed");
  if (persisted.transition && persisted.incident)
    await sendAlert(env, db, persisted.incident, persisted.transition);
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
  const accountId = (property?.workspaces as any)?.account_id;
  const { data: account } = accountId
    ? await db.from("accounts").select("billing_environment,is_test_account,test_notification_recipients").eq("id", accountId).maybeSingle()
    : { data: null };
  const isTest = account?.billing_environment === "test" || account?.is_test_account === true;
  const notificationAccess = await processingAccess(env, "uptime_notifications", accountId);
  if (!notificationAccess.allowed) {
    await db.from("platform_alerts").insert({ title: "Uptime customer notification suppressed", details: { incidentId: incident.id, kind, reason: notificationAccess.error, accountId } });
    return;
  }
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
  const { data: configuredRecipients } = await db
    .from("alert_recipients")
    .select("email")
    .eq("property_id", incident.property_id)
    .eq("enabled", true);
  const recipients = isTest
    ? (Array.isArray(account?.test_notification_recipients) ? account.test_notification_recipients : []).map((email: string) => ({ email }))
    : configuredRecipients;
  const templateKey = kind === "down" ? "uptime_down" : "uptime_recovered";
  const template = await publishedEmailTemplate(db, templateKey);
  const templateVariables = { propertyName: property?.name || "Property", propertyUrl: property?.url || "", incidentOpenedAt: incident.opened_at, incidentResolvedAt: incident.resolved_at || "", appUrl: `${env.APP_ORIGIN}/uptime?property=${property?.id || incident.property_id}` };
  for (const r of recipients || []) {
    const key = `${incident.id}:${kind}:${isTest ? "test" : "live"}:${r.email}`;
    const decision = await emailAutomationDecision(db, templateKey, r.email, templateKey);
    const { data: claimed } = await db.rpc("claim_notification", {
      p_key: key,
      p_kind: `uptime_${kind}`,
      p_recipient: r.email,
      p_payload: { ...incident, automationDecision: decision.reason || "allowed" },
    });
    if (!claimed) continue;
    if (!decision.allowed) {
      await db.from("notification_deliveries").update({ status: "skipped", provider: "none", provider_status: decision.reason, is_test: isTest, account_id: accountId, property_id: incident.property_id, template_id: template?.id || null, automation_key: templateKey, updated_at: new Date().toISOString() }).eq("dedupe_key", key);
      continue;
    }
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
        subject: `${isTest ? "[TEST] " : ""}${template
          ? renderEmailTemplate(template.subject, templateVariables).rendered
          : kind === "down"
            ? `Claritude downtime alert · ${property?.name || "Property"}`
            : `Claritude recovery notice · ${property?.name || "Property"}`}`,
        html: template
          ? renderEmailTemplate(template.html_body, templateVariables).rendered
          : renderUptimeAlertEmail({
          property: property || { id: incident.property_id, name: "Property", url: "" },
          incident,
          kind,
          appOrigin: env.APP_ORIGIN,
          test: isTest,
        }),
      }),
    });
    await db
      .from("notification_deliveries")
      .update({
        status: response.ok ? "sent" : "failed",
        provider: "Resend",
        provider_status: response.ok ? "accepted" : "rejected",
        provider_id: response.headers.get("x-message-id"),
        is_test: isTest,
        account_id: accountId,
        property_id: incident.property_id,
        template_id: template?.id || null,
        automation_key: templateKey,
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

async function processDueBillingChanges(env: Env, db: SupabaseClient) {
  const due = await db.from("billing_scheduled_changes").select("*").eq("state", "scheduled").lte("effective_at", new Date().toISOString()).order("effective_at").limit(50);
  for (const change of due.data || []) {
    const claimed = await db.from("billing_scheduled_changes").update({ state: "processing", updated_at: new Date().toISOString() }).eq("id", change.id).eq("state", "scheduled").select("id").maybeSingle();
    if (!claimed.data) continue;
    try {
      const prepared = await subscriptionChangeSelection(env, change.account_id, change.requested_change);
      if (prepared.billingEnvironment !== change.billing_environment || prepared.subscription.provider_subscription_id !== change.provider_subscription_id) throw new Error("scheduled_change_environment_or_subscription_mismatch");
      const updated = await prepared.stripe.subscriptions.update(change.provider_subscription_id, { items: prepared.items, proration_behavior: "none", metadata: { claritudeAccountId: change.account_id, billingEnvironment: prepared.billingEnvironment, packageVersionId: change.requested_change.packageVersionId, includedEditingSeats: String(prepared.includedEditingSeats) } }, { idempotencyKey: `scheduled-subscription-change:${change.billing_environment}:${change.operation_key}` });
      await projectStripeSubscription(env, updated, Math.floor(Date.now() / 1000));
      const response = { subscriptionId: updated.id, status: updated.status, effectiveAt: change.effective_at };
      await db.from("billing_scheduled_changes").update({ state: "completed", provider_response: response, updated_at: new Date().toISOString() }).eq("id", change.id);
      await db.from("billing_financial_operations").update({ provider_reference: updated.id, state: "completed", response, updated_at: new Date().toISOString() }).eq("billing_environment", change.billing_environment).eq("operation_type", "subscription_change").eq("operation_key", change.operation_key);
    } catch (error) {
      await db.from("billing_scheduled_changes").update({ state: "failed", error: errorMessage(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", change.id);
      await db.from("billing_financial_operations").update({ state: "failed", error: errorMessage(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("billing_environment", change.billing_environment).eq("operation_type", "subscription_change").eq("operation_key", change.operation_key);
    }
  }
}

async function processAnalyticsUsageWarnings(env: Env, db: SupabaseClient) {
  const pending = await db
    .from("analytics_usage_warnings")
    .select("*,accounts(name)")
    .eq("state", "pending")
    .order("created_at")
    .limit(50);
  if (pending.error) throw pending.error;
  for (const warning of pending.data || []) {
    const memberships = await db.from("account_memberships").select("user_id").eq("account_id", warning.account_id).in("role", ["owner", "member"]);
    if (memberships.error) continue;
    const percent = Math.min(100, Math.round(Number(warning.pageviews || 0) / Math.max(1, Number(warning.limit_pageviews || 1)) * 100));
    const title = warning.threshold === 101 ? "Monthly analytics hard cap reached" : warning.threshold >= 100 ? "Included monthly analytics limit reached" : `Monthly analytics usage is ${percent}%`;
    const message = warning.threshold === 101
      ? "Analytics collection has paused for the rest of this UTC month. Audits, uptime monitoring and other Claritude features continue normally."
      : warning.threshold >= 100
        ? `This account has used its ${Number(warning.limit_pageviews || 0).toLocaleString()} included pageviews this UTC month. Paid-plan grace is applied automatically before collection pauses.`
        : `This account has recorded ${Number(warning.pageviews || 0).toLocaleString()} of ${Number(warning.limit_pageviews || 0).toLocaleString()} included pageviews this UTC month.`;
    for (const membership of memberships.data || []) {
      const dedupeKey = `analytics-usage:${warning.account_id}:${warning.period_start}:${warning.threshold}:${membership.user_id}`;
      await db.from("notifications").upsert({ account_id: warning.account_id, user_id: membership.user_id, title, body: message, severity: warning.threshold >= 100 ? "warning" : "info", dedupe_key: dedupeKey }, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (!env.RESEND_API_KEY || !env.RESEND_FROM || warning.threshold < 80) continue;
      const authUser = await db.auth.admin.getUserById(membership.user_id);
      const recipient = authUser.data.user?.email;
      if (!recipient) continue;
      const emailKey = `${dedupeKey}:email`;
      const { data: claimed } = await db.rpc("claim_notification", { p_key: emailKey, p_kind: "analytics_usage", p_recipient: recipient, p_payload: { accountId: warning.account_id, threshold: warning.threshold, pageviews: warning.pageviews, limit: warning.limit_pageviews } });
      if (!claimed) continue;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "Idempotency-Key": emailKey },
        body: JSON.stringify({ from: env.RESEND_FROM, to: [recipient], subject: `Claritude · ${title}`, html: `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(env.APP_ORIGIN)}/analytics">Open analytics</a></p>` }),
      });
      const responseBody: any = await response.json().catch(() => ({}));
      await db.from("notification_deliveries").update({ status: response.ok ? "sent" : "failed", provider: "Resend", provider_status: response.ok ? "accepted" : "rejected", provider_id: responseBody.id || null, account_id: warning.account_id, error: response.ok ? null : String(responseBody.message || `HTTP ${response.status}`).slice(0, 1000), updated_at: new Date().toISOString() }).eq("dedupe_key", emailKey);
    }
    await db.from("analytics_usage_warnings").update({ state: "sent", attempted_at: new Date().toISOString(), error: null }).eq("account_id", warning.account_id).eq("period_start", warning.period_start).eq("threshold", warning.threshold).eq("state", "pending");
  }
}

async function scheduled(env: Env, cron: string) {
  const db = admin(env);
  if (cron === "*/5 * * * *") {
    const failedBilling = await db.from("billing_events").select("id").eq("processing_state", "failed").lte("next_attempt_at", new Date().toISOString()).lt("attempts", 10).limit(50);
    await Promise.all((failedBilling.data || []).map((event) => env.JOBS.send({ type: "billing-event", id: event.id })));
    await processDueBillingChanges(env, db);
    await processAnalyticsUsageWarnings(env, db);
    const access = await processingAccess(env, "uptime_checks");
    if (!access.allowed) {
      await db.from("operational_events").insert({ service: "uptime", metric: "scheduler_suppressed", value: 1, unit: "run", source: "application_measured", metadata: { reason: access.error } });
      return;
    }
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
    const aggregateDay = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const aggregateResult = await db.rpc("aggregate_analytics_day_v2", {
      p_day: aggregateDay,
    });
    if (aggregateResult.error) throw aggregateResult.error;
    const viewAggregateResult = await db.rpc("aggregate_analytics_view_states_day", {
      p_day: aggregateDay,
    });
    if (viewAggregateResult.error) throw viewAggregateResult.error;
    const compactDayResult = await db.rpc("aggregate_analytics_compact_day", { p_day: aggregateDay });
    if (compactDayResult.error) throw compactDayResult.error;
    const monthStart = `${aggregateDay.slice(0, 7)}-01`;
    const yearStart = `${aggregateDay.slice(0, 4)}-01-01`;
    const [compactMonthResult, compactYearResult] = await Promise.all([
      db.rpc("aggregate_analytics_compact_period", { p_grain: "month", p_period_start: monthStart }),
      db.rpc("aggregate_analytics_compact_period", { p_grain: "year", p_period_start: yearStart }),
    ]);
    if (compactMonthResult.error) throw compactMonthResult.error;
    if (compactYearResult.error) throw compactYearResult.error;
    const pruneResult = await db.rpc("prune_analytics_retention", { p_limit: 50000 });
    if (pruneResult.error) throw pruneResult.error;
    const storageResult = await db.rpc("refresh_analytics_storage_snapshots");
    if (storageResult.error) throw storageResult.error;
    await processAnalyticsUsageWarnings(env, db);
    await runDueReportSchedules(env, db);
    await expireComplimentaryPackageGrants(db);
    await expireFreeAccountAudits(db);
    await evaluateFreeAccountInactivity(env, db);
    await processDueBillingChanges(env, db);
    const customers = await db.from("billing_customers").select("account_id,billing_environment").not("provider_customer_id", "is", null).limit(1000);
    await Promise.all((customers.data || []).map((customer) => env.JOBS.send({ type: "billing-reconcile", id: customer.account_id })));
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = `${today}T00:00:00.000Z`;
    const dayEnd = `${today}T23:59:59.999Z`;
    for (const billingEnvironment of ["test", "live"] as BillingEnvironment[]) {
      const [subscriptions, invoices, payments, refunds, disputes, grants] = await Promise.all([
        db.from("billing_subscriptions").select("*,package_versions(package_key)").eq("billing_environment", billingEnvironment),
        db.from("billing_invoices").select("*").eq("billing_environment", billingEnvironment),
        db.from("billing_payments").select("*").eq("billing_environment", billingEnvironment),
        db.from("billing_refunds").select("*").eq("billing_environment", billingEnvironment),
        db.from("billing_disputes").select("*").eq("billing_environment", billingEnvironment),
        db.from("account_package_grants").select("account_id,accounts!inner(billing_environment)").eq("accounts.billing_environment", billingEnvironment).eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      ]);
      const provider = stripeContext(env, billingEnvironment);
      let availableByCurrency: Record<string, number> = {};
      let pendingByCurrency: Record<string, number> = {};
      if (provider.client) {
        const [balance, payouts] = await Promise.all([
          provider.client.balance.retrieve(),
          provider.client.payouts.list({ created: { gte: Math.floor(Date.parse(dayStart) / 1000), lte: Math.floor(Date.parse(dayEnd) / 1000) }, limit: 100 }),
        ]);
        availableByCurrency = Object.fromEntries(balance.available.map((item) => [item.currency, Number(item.amount || 0)]));
        pendingByCurrency = Object.fromEntries(balance.pending.map((item) => [item.currency, Number(item.amount || 0)]));
        if (payouts.data.length) await db.from("billing_payouts").upsert(payouts.data.map((payout) => ({ billing_environment: billingEnvironment, provider_payout_id: payout.id, status: payout.status, currency: payout.currency, amount_minor: payout.amount, arrival_at: stripeTimestamp(payout.arrival_date), provider_created_at: stripeTimestamp(payout.created), metadata: payout.metadata || {}, updated_at: new Date().toISOString() })), { onConflict: "billing_environment,provider_payout_id" });
      }
      const metrics = financeMetrics({ subscriptions: subscriptions.data || [], invoices: invoices.data || [], payments: payments.data || [], refunds: refunds.data || [], disputes: disputes.data || [] }, billingEnvironment);
      for (const metric of metrics) {
        const dailyPayments = (payments.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
        const dailyRefunds = (refunds.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
        const dailyInvoices = (invoices.data || []).filter((row: any) => row.currency === metric.currency && row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd);
        const currentSubscriptions = (subscriptions.data || []).filter((row: any) => row.currency === metric.currency && ["active", "trialing", "past_due"].includes(row.status));
        const packageRevenue = currentSubscriptions.reduce((result: Record<string, number>, row: any) => { const key = row.package_versions?.package_key || "unmapped"; result[key] = (result[key] || 0) + Number(row.mrr_minor || 0); return result; }, {});
        const intervalMix = currentSubscriptions.reduce((result: Record<string, number>, row: any) => { const key = row.interval || "unknown"; result[key] = (result[key] || 0) + 1; return result; }, {});
        const collectionsDayMinor = dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.amount_received_minor || 0), 0);
        const succeededRefunds = dailyRefunds.filter((row: any) => row.status === "succeeded").reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0);
        const pendingRefunds = dailyRefunds.filter((row: any) => ["pending", "requires_action"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0);
        const feesDayMinor = dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.fee_minor || 0), 0);
        const payouts = await db.from("billing_payouts").select("amount_minor").eq("billing_environment", billingEnvironment).eq("currency", metric.currency).gte("provider_created_at", dayStart).lte("provider_created_at", dayEnd);
        await db.from("billing_daily_finance").upsert({ day: today, currency: metric.currency, billing_environment: billingEnvironment, livemode: billingEnvironment === "live", mrr_minor: metric.mrrMinor, arr_minor: metric.arrMinor, invoiced_minor: dailyInvoices.reduce((sum: number, row: any) => sum + Number(row.total_minor || 0), 0), cash_collected_minor: collectionsDayMinor, refunds_minor: succeededRefunds, collections_day_minor: collectionsDayMinor, refunds_succeeded_day_minor: succeededRefunds, refunds_pending_day_minor: pendingRefunds, fees_day_minor: feesDayMinor, net_balance_day_minor: collectionsDayMinor - succeededRefunds - feesDayMinor, available_balance_minor: availableByCurrency[metric.currency] || 0, pending_balance_minor: pendingByCurrency[metric.currency] || 0, new_subscriptions: currentSubscriptions.filter((row: any) => row.provider_created_at >= dayStart && row.provider_created_at <= dayEnd).length, cancellations: (subscriptions.data || []).filter((row: any) => row.currency === metric.currency && row.cancelled_at >= dayStart && row.cancelled_at <= dayEnd).length, recovered_payments: dailyPayments.filter((row: any) => ["succeeded", "paid"].includes(row.status) && row.metadata?.recovered === true).length, payouts_day_minor: (payouts.data || []).reduce((sum: number, row: any) => sum + Number(row.amount_minor || 0), 0), package_revenue: packageRevenue, billing_interval_mix: intervalMix, failed_payments: dailyPayments.filter((row: any) => ["requires_payment_method", "canceled"].includes(row.status)).length, active_subscriptions: metric.activeSubscriptions, trialing_subscriptions: metric.trialingSubscriptions, past_due_subscriptions: metric.pastDueSubscriptions, complimentary_accounts: new Set((grants.data || []).map((grant) => grant.account_id)).size, calculated_at: new Date().toISOString() }, { onConflict: "day,currency,billing_environment" });
      }
    }
  }
}

async function expireComplimentaryPackageGrants(db: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: expired, error } = await db.from("account_package_grants")
    .select("id,account_id,package_versions(display_name)")
    .eq("status", "active").not("expires_at", "is", null).lte("expires_at", now).limit(500);
  if (error) {
    await db.from("platform_alerts").insert({ title: "Complimentary package expiry evaluation unavailable", details: { error: error.message } });
    return;
  }
  for (const grant of expired || []) {
    await db.from("account_package_grants").update({ status: "expired", revoked_at: now, revoked_reason: "Grant reached its configured expiry" }).eq("id", grant.id).eq("status", "active");
    await db.from("account_entitlement_overrides").update({ revoked_at: now }).eq("grant_id", grant.id).is("revoked_at", null);
    await db.from("platform_alerts").insert({ title: "Complimentary package grant expired", details: { accountId: grant.account_id, grantId: grant.id, package: (grant.package_versions as any)?.display_name || null, outcome: "Returned to underlying standard package; billing provider unchanged", reviewRequired: true } });
  }
}

async function expireFreeAccountAudits(db: SupabaseClient) {
  const setting = await db.from("platform_settings").select("value").eq("key", "retention_policy").maybeSingle();
  if (setting.error) throw setting.error;
  const policy = (setting.data?.value || {}) as Record<string, unknown>;
  const summaryDays = Number(policy.auditSummaryDays ?? policy.auditResultsDays);
  if (!Number.isInteger(summaryDays) || summaryDays < 1 || summaryDays > 3650)
    throw new Error("invalid_audit_summary_retention_policy");
  const summaryPrune = await db.rpc("prune_audit_summaries", {
    p_before: new Date(Date.now() - summaryDays * 864e5).toISOString(),
  });
  if (summaryPrune.error) throw summaryPrune.error;
  if (policy.freeAuditExpiryEnabled !== true) return;
  const days = Number(policy.freeAuditExpiryDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("invalid_free_audit_retention_policy");
  const accountsResult = await db.from("accounts").select("id").eq("entitlement", "free").limit(10_000);
  if (accountsResult.error) throw accountsResult.error;
  const accountIds = (accountsResult.data || []).map((account) => account.id);
  if (!accountIds.length) return;
  const now = new Date().toISOString();
  const [grants, assignments] = await Promise.all([
    db.from("account_package_grants").select("account_id").in("account_id", accountIds).eq("status", "active").lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`),
    db.from("account_package_assignments").select("account_id,package_versions(package_key)").in("account_id", accountIds).is("ends_at", null),
  ]);
  if (grants.error) throw grants.error;
  if (assignments.error) throw assignments.error;
  const paidOrGranted = new Set([
    ...(grants.data || []).map((grant) => grant.account_id),
    ...(assignments.data || []).filter((assignment: any) => assignment.package_versions?.package_key !== "free").map((assignment) => assignment.account_id),
  ]);
  const freeAccountIds = accountIds.filter((id) => !paidOrGranted.has(id));
  if (!freeAccountIds.length) return;
  const properties = await db.from("properties").select("id").in("account_id", freeAccountIds).limit(50_000);
  if (properties.error) throw properties.error;
  const propertyIds = (properties.data || []).map((property) => property.id);
  if (!propertyIds.length) return;
  const before = new Date(Date.now() - days * 864e5).toISOString();
  const expired = await db.rpc("expire_free_audit_details", {
    p_property_ids: propertyIds,
    p_before: before,
  });
  if (expired.error) throw expired.error;
}

export function meaningfulAccountActivity(action: string) {
  return !/^(audit\.completed|uptime\.|report\.generated|analytics\.|system\.)/.test(action);
}

export function inactivityLifecycleState(days: number, options: { exempt?: boolean; noticesReady?: boolean; analyticsReview?: boolean } = {}) {
  if (options.exempt) return "exempt";
  if (days < 60) return "active";
  if (days < 90) return "warning_60";
  if (days < 100) return "warning_90";
  if (!options.noticesReady || options.analyticsReview) return "review_hold";
  if (days < 121) return "frozen";
  return "deletion_eligible";
}

async function evaluateFreeAccountInactivity(env: Env, db: SupabaseClient) {
  const [accountsResult, outboundResult] = await Promise.all([
    db.from("accounts").select("id,created_at,entitlement_started_at").eq("entitlement", "free").limit(500),
    db.from("platform_settings").select("value").eq("key", "outbound_automation").maybeSingle(),
  ]);
  if (accountsResult.error || outboundResult.error || !outboundResult.data?.value) {
    await db.from("platform_alerts").insert({ title: "Free-account inactivity evaluation unavailable", details: { accountsError: accountsResult.error?.message, policyError: outboundResult.error?.message } });
    return;
  }
  const candidateAccounts = accountsResult.data || [];
  const activeGrantAccounts = candidateAccounts.length ? await db.from("account_package_grants").select("account_id").in("account_id", candidateAccounts.map((account) => account.id)).eq("status", "active").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`) : { data: [] };
  const grantedAccountIds = new Set((activeGrantAccounts.data || []).map((grant) => grant.account_id));
  const accounts = candidateAccounts.filter((account) => !grantedAccountIds.has(account.id));
  if (!accounts.length) return;
  const accountIds = accounts.map((account) => account.id);
  const [memberships, activity, currentStates, properties] = await Promise.all([
    db.from("account_memberships").select("account_id,user_id,role").in("account_id", accountIds).in("role", ["owner", "member"]),
    db.from("activity_log").select("account_id,actor_id,action,created_at").in("account_id", accountIds).not("actor_id", "is", null).order("created_at", { ascending: false }).limit(50_000),
    db.from("account_inactivity").select("*").in("account_id", accountIds),
    db.from("properties").select("id,account_id").in("account_id", accountIds).limit(10_000),
  ]);
  const propertyAccount = new Map((properties.data || []).map((property) => [property.id, property.account_id]));
  const recentAnalytics = propertyAccount.size ? await db.from("analytics_events").select("property_id").in("property_id", [...propertyAccount.keys()]).gte("received_at", new Date(Date.now() - 7 * 86400_000).toISOString()).limit(10_000) : { data: [] };
  const activeAnalyticsAccounts = new Set((recentAnalytics.data || []).map((event) => propertyAccount.get(event.property_id)).filter(Boolean));
  const automations = outboundResult.data.value as Record<string, unknown>;
  const noticesReady = automations.inactivityNoticesEnabled === true && Array.isArray(automations.safeTestRecipients) && automations.safeTestRecipients.length > 0;
  const now = Date.now();
  for (const account of accounts) {
    const editors = new Set((memberships.data || []).filter((item) => item.account_id === account.id).map((item) => item.user_id));
    const lastActivity = (activity.data || []).find((item) => item.account_id === account.id && item.actor_id && editors.has(item.actor_id) && meaningfulAccountActivity(item.action))?.created_at || account.entitlement_started_at || account.created_at;
    const days = Math.max(0, Math.floor((now - Date.parse(lastActivity)) / 86400_000));
    const previous = (currentStates.data || []).find((item) => item.account_id === account.id);
    const exempt = Boolean(previous?.exempt_until && Date.parse(previous.exempt_until) > now);
    const grace = previous?.grace_until && Date.parse(previous.grace_until) > now;
    const analyticsReview = activeAnalyticsAccounts.has(account.id) && days >= 100;
    const state = grace ? "active" : inactivityLifecycleState(days, { exempt, noticesReady, analyticsReview });
    const row = { account_id: account.id, free_since: previous?.free_since || account.entitlement_started_at || account.created_at, last_meaningful_activity_at: lastActivity, state, analytics_review_required: analyticsReview, notice_delivery_failed: days >= 100 && !noticesReady, updated_at: new Date().toISOString() };
    await db.from("account_inactivity").upsert(row, { onConflict: "account_id" });
    if (previous?.state !== state)
      await db.from("account_inactivity_events").insert({ account_id: account.id, event: "lifecycle_state_changed", effective_state: state, details: { previousState: previous?.state || null, inactiveDays: days, noticesReady, analyticsReview } });
  }
}

export function uptimeDueHorizon(now = Date.now()) {
  // Cron fires on the five-minute boundary, while a completed check records its
  // next due time a few seconds later. A bounded look-ahead prevents every
  // second tick being skipped without treating materially early monitors as due.
  return new Date(now + 60_000).toISOString();
}

async function runDueReportSchedules(env: Env, db: SupabaseClient) {
  const globalAccess = await processingAccess(env, "reports");
  if (!globalAccess.allowed) return;
  const now = new Date();
  const { data: schedules } = await db
    .from("report_schedules")
    .select("*,properties(id,name,canonical_host,account_id,access_state)")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .limit(100);
  for (const schedule of schedules || []) {
    const reportAccess = await processingAccess(env, "reports", schedule.properties?.account_id);
    if (!reportAccess.allowed || schedule.properties?.access_state !== "active") continue;
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
      const publishedTemplate = await publishedEmailTemplate(db, "scheduled_report");
      const reportVariables = { propertyName: schedule.properties?.name || "Property", reportUrl: `${env.APP_ORIGIN}/reports?property=${schedule.property_id}`, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd };
      if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
        lastError = "email_delivery_not_configured";
      } else {
        for (const recipient of schedule.recipients || []) {
          const key = `report:${schedule.id}:${snapshot.periodEnd}:${recipient}`;
          const decision = await emailAutomationDecision(db, "scheduled_report", recipient, "scheduled_report");
          const { data: claimed } = await db.rpc("claim_notification", {
            p_key: key,
            p_kind: "scheduled_report",
            p_recipient: recipient,
            p_payload: { scheduleId: schedule.id, propertyId: schedule.property_id, automationDecision: decision.reason || "allowed" },
          });
          if (!claimed) continue;
          if (!decision.allowed) {
            await db.from("notification_deliveries").update({ status: "skipped", provider: "none", provider_status: decision.reason, is_test: false, account_id: schedule.properties?.account_id || null, property_id: schedule.property_id, template_id: publishedTemplate?.id || null, automation_key: "scheduled_report", updated_at: new Date().toISOString() }).eq("dedupe_key", key);
            continue;
          }
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
              subject: publishedTemplate ? renderEmailTemplate(publishedTemplate.subject, reportVariables).rendered : `Claritude report · ${schedule.properties?.name || "Property"}`,
              html: publishedTemplate ? renderEmailTemplate(publishedTemplate.html_body, reportVariables).rendered : renderReportEmail(snapshot),
            }),
          });
          await db
            .from("notification_deliveries")
            .update({
              status: response.ok ? "sent" : "failed",
              provider: "Resend",
              provider_status: response.ok ? "accepted" : "rejected",
              provider_id: response.headers.get("x-message-id"),
              is_test: false,
              account_id: schedule.properties?.account_id || null,
              property_id: schedule.property_id,
              template_id: publishedTemplate?.id || null,
              automation_key: "scheduled_report",
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

function sanitizeViewState(
  event: any,
  propertyId: string,
  receivedAt: string,
  requestCountry = "",
  userAgent = "",
) {
  const meta = event?.meta && typeof event.meta === "object" ? event.meta : {};
  const viewId = String(meta.view_id || "").trim().slice(0, 200);
  const sessionId = String(meta.session || "").trim().slice(0, 200);
  const path = cleanPath(event?.path);
  if (!viewId || !path) return null;
  const keyEventCounts: Record<string, number> = {};
  if (meta.key_events && typeof meta.key_events === "object" && !Array.isArray(meta.key_events)) {
    for (const [rawKey, rawCount] of Object.entries(meta.key_events).slice(0, 50)) {
      const separator = rawKey.indexOf(":");
      if (separator < 1) continue;
      const type = rawKey.slice(0, separator);
      const name = rawKey.slice(separator + 1).trim().slice(0, 80);
      if (!name || !["click", "outbound", "form_success"].includes(type)) continue;
      const count = Math.max(0, Math.min(10000, Math.floor(Number(rawCount) || 0)));
      const typedName = `${type}:${name}`;
      keyEventCounts[typedName] = Math.max(keyEventCounts[typedName] || 0, count);
    }
  }
  const visibleSections = Array.isArray(meta.visible_sections)
    ? [...new Set(meta.visible_sections.map((value: unknown) => String(value || "").trim().slice(0, 80)).filter(Boolean))].slice(0, 50)
    : [];
  const vitals: Record<string, number> = {};
  if (meta.vitals && typeof meta.vitals === "object" && !Array.isArray(meta.vitals)) {
    for (const metric of ["LCP", "INP", "CLS"]) {
      const value = Number(meta.vitals[metric]);
      if (Number.isFinite(value)) vitals[metric] = Math.max(0, Math.min(600000, value));
    }
  }
  const text = (value: unknown, maximum: number) => String(value || "").trim().slice(0, maximum);
  return {
    property_id: propertyId,
    view_id: viewId,
    session_id: sessionId,
    occurred_at: validDate(meta.view_started_at) || validDate(event?.at) || receivedAt,
    checkpoint_sequence: Math.max(0, Math.min(1_000_000, Math.floor(Number(meta.checkpoint_sequence) || 0))),
    path,
    referrer_host: cleanHost(event?.referrer),
    source: text(event?.source || meta.acquisition_source, 200),
    device: ["desktop", "mobile", "tablet"].includes(event?.device) ? event.device : "",
    country_code: /^[A-Z]{2}$/.test(requestCountry) ? requestCountry : text(event?.country, 20),
    browser: text(meta.browser || browserFromUserAgent(userAgent), 80),
    screen: text(meta.screen, 40),
    tracker_version: text(meta.tracker_version, 40),
    acquisition_source: text(meta.acquisition_source, 200),
    original_referrer: text(meta.original_referrer, 200),
    landing_page: text(meta.landing_page, 500),
    utm_source: text(meta.utm_source, 200),
    utm_medium: text(meta.utm_medium, 200),
    utm_campaign: text(meta.utm_campaign, 200),
    utm_content: text(meta.utm_content, 200),
    utm_term: text(meta.utm_term, 200),
    active_seconds: Math.max(0, Math.min(600000, Number(meta.active_seconds) || 0)),
    max_scroll: Math.max(0, Math.min(100, Number(meta.max_scroll) || 0)),
    key_event_counts: keyEventCounts,
    visible_sections: visibleSections,
    vitals,
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
  compactTotals: any[];
  compactDimensions: any[];
  detailedFrom?: string;
  truncated: boolean;
  sourceRows?: number;
  eventRows?: number;
  viewRows?: number;
  dbResponseBytes?: number;
};

const utcDayStart = (value: number) => {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export function analyticsPreviousPeriodRange(from: string, to: string): AnalyticsRange {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs)
    throw new Error("invalid_analytics_window");
  const span = toMs - fromMs + 1;
  return {
    from: new Date(fromMs - span).toISOString(),
    to: new Date(fromMs - 1).toISOString(),
  };
}

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

const COMPACT_EVENT_COLUMNS = [
  "bucket_start", "event_type", "path", "name", "device", "source",
  "referrer_host", "country_code", "browser", "screen", "utm_source",
  "utm_medium", "utm_campaign", "tracker_version", "event_count",
  "value_sum", "values_json",
] as const;
const COMPACT_VIEW_COLUMNS = [
  "view_key", "occurred_at", "path", "device", "source", "referrer_host",
  "country_code", "browser", "screen", "utm_source", "utm_medium",
  "utm_campaign", "tracker_version", "session_id", "active_seconds",
  "max_scroll", "key_events", "javascript_errors", "visible_sections",
  "vitals", "key_event_counts",
] as const;

export function expandCompactAnalyticsRows(
  rows: unknown,
  columns: readonly string[],
) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
}

async function loadAnalyticsWindow(
  db: SupabaseClient,
  propertyId: string,
  from: string,
  to: string,
  useRollups: boolean,
): Promise<AnalyticsWindowData> {
  const [{ data, error }, compactResult] = await Promise.all([
    db.rpc("analytics_compact_window", {
      p_property_id: propertyId,
      p_from: from,
      p_to: to,
      p_use_rollups: useRollups,
    }),
    db.rpc("analytics_compact_rollup_window", {
      p_property_id: propertyId,
      p_from: from,
      p_to: to,
    }),
  ]);
  if (error) throw new Error(error.message);
  if (compactResult.error) throw new Error(compactResult.error.message);
  const payload = data && typeof data === "object" ? data as Record<string, any> : {};
  const compact = compactResult.data && typeof compactResult.data === "object" ? compactResult.data as Record<string, any> : {};
  const responseBytes = new TextEncoder().encode(JSON.stringify([payload, compact])).byteLength;
  const compactFormat = Number(payload.formatVersion || 1);
  const detailedFrom = typeof compact.detailedFrom === "string" ? compact.detailedFrom : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const eventRows = compactFormat >= 2
    ? expandCompactAnalyticsRows(payload.events, COMPACT_EVENT_COLUMNS)
    : Array.isArray(payload.events) ? payload.events : [];
  const viewRows = compactFormat >= 2
    ? expandCompactAnalyticsRows(payload.views, COMPACT_VIEW_COLUMNS)
    : Array.isArray(payload.views) ? payload.views : [];
  return {
    events: [],
    rollups: eventRows.filter((row: any) => String(row.bucket_start || row.occurred_at || "").slice(0, 10) >= detailedFrom),
    views: viewRows.filter((row: any) => String(row.occurred_at || row.day || "").slice(0, 10) >= detailedFrom),
    compactTotals: Array.isArray(compact.totals) ? compact.totals : [],
    compactDimensions: Array.isArray(compact.dimensions) ? compact.dimensions : [],
    detailedFrom,
    truncated: Boolean(payload.truncated),
    sourceRows: Number(payload.sourceRows || 0),
    eventRows: Number(payload.eventRows || 0),
    viewRows: Number(payload.viewRows || 0),
    dbResponseBytes: responseBytes,
  };
}

type AiVisitState = {
  id: string;
  startedAt: string;
  landingPath: string;
  platformId: string | null;
  activeSeconds: number;
  maxScroll: number;
  keyEvents: number;
  measured: boolean;
};

function aiVisitPlatform(observation: any) {
  return identifyAiPlatform({
    campaign: observation.metadata?.utm_source ?? observation.utm_source,
    referrer: observation.metadata?.original_referrer ?? observation.referrer_host,
    source: observation.metadata?.acquisition_source ?? observation.source,
  });
}

function aiCalendarDays(from: string, to: string, timeZone: string) {
  const first = dateKeyInTimeZone(from, timeZone);
  const last = dateKeyInTimeZone(to, timeZone);
  const values: string[] = [];
  for (let cursor = new Date(`${first}T00:00:00.000Z`), index = 0;
    cursor <= new Date(`${last}T00:00:00.000Z`) && index < 92;
    cursor = new Date(cursor.valueOf() + 864e5), index += 1)
    values.push(cursor.toISOString().slice(0, 10));
  return values;
}

export function buildAiVisibilitySummary(
  events: any[],
  historicalViews: any[],
  from: string,
  to: string,
  timeZone: string,
) {
  const visits = new Map<string, AiVisitState>();
  let observedPageviews = 0;
  let missingSessionPageviews = 0;
  const ensureVisit = (sessionId: string, startedAt: string, path: unknown, platformId: string | null, measured: boolean) => {
    const existing = visits.get(sessionId);
    const normalizedPath = normalizeAnalyticsPath(path);
    if (!existing) {
      visits.set(sessionId, {
        id: sessionId,
        startedAt,
        landingPath: normalizedPath,
        platformId,
        activeSeconds: 0,
        maxScroll: 0,
        keyEvents: 0,
        measured,
      });
      return visits.get(sessionId)!;
    }
    if (Date.parse(startedAt) < Date.parse(existing.startedAt)) {
      existing.startedAt = startedAt;
      existing.landingPath = normalizedPath;
    }
    existing.platformId ||= platformId;
    existing.measured ||= measured;
    return existing;
  };

  for (const view of historicalViews || []) {
    observedPageviews += 1;
    const sessionId = String(view.session_id || "").trim();
    if (!sessionId) {
      missingSessionPageviews += 1;
      continue;
    }
    const platform = aiVisitPlatform(view);
    const visit = ensureVisit(
      sessionId,
      String(view.occurred_at || `${view.day}T00:00:00.000Z`),
      view.path,
      platform?.id || null,
      true,
    );
    visit.activeSeconds += Number(view.active_seconds || 0);
    visit.maxScroll = Math.max(visit.maxScroll, Number(view.max_scroll || 0));
    visit.keyEvents += Number(view.key_events || 0);
  }

  const raw = [...(events || [])].sort((left, right) =>
    Date.parse(left.occurred_at || "") - Date.parse(right.occurred_at || ""),
  );
  for (const event of raw) {
    if (event.event_type !== "pageview") continue;
    observedPageviews += 1;
    const sessionId = String(event.metadata?.session || "").trim();
    if (!sessionId) {
      missingSessionPageviews += 1;
      continue;
    }
    const platform = aiVisitPlatform(event);
    ensureVisit(
      sessionId,
      String(event.occurred_at),
      event.metadata?.landing_page || event.path,
      platform?.id || null,
      SUPPORTED_TRACKER_VERSIONS.has(event.metadata?.tracker_version),
    );
  }
  for (const event of raw) {
    const sessionId = String(event.metadata?.session || "").trim();
    const visit = sessionId ? visits.get(sessionId) : undefined;
    if (!visit) continue;
    if (event.event_type === "active_time" && Number.isFinite(Number(event.value)))
      visit.activeSeconds += Number(event.value);
    if (event.event_type === "scroll" && Number.isFinite(Number(event.value)))
      visit.maxScroll = Math.max(visit.maxScroll, Number(event.value));
    if (ANALYTICS_KEY_EVENT_TYPES.has(event.event_type)) visit.keyEvents += 1;
  }

  const allVisits = [...visits.values()];
  const aiVisits = allVisits.filter((visit) => visit.platformId);
  const days = aiCalendarDays(from, to, timeZone);
  const series = new Map(days.map((day) => [day, 0]));
  const platformCounts = new Map<string, number>();
  const pageCounts = new Map<string, { visits: number; sources: Set<string> }>();
  for (const visit of aiVisits) {
    const day = dateKeyInTimeZone(visit.startedAt, timeZone);
    if (series.has(day)) series.set(day, (series.get(day) || 0) + 1);
    platformCounts.set(visit.platformId!, (platformCounts.get(visit.platformId!) || 0) + 1);
    const page = pageCounts.get(visit.landingPath) || { visits: 0, sources: new Set<string>() };
    page.visits += 1;
    page.sources.add(visit.platformId!);
    pageCounts.set(visit.landingPath, page);
  }
  const measuredEngagement = (values: AiVisitState[]) => {
    const eligible = values.filter((visit) => visit.measured);
    const engaged = eligible.filter((visit) =>
      visit.activeSeconds >= 10 || visit.maxScroll >= 50 || visit.keyEvents > 0,
    );
    return {
      eligibleVisits: eligible.length,
      engagementRate: eligible.length ? engaged.length / eligible.length * 100 : null,
    };
  };
  const platforms = AI_PLATFORMS.map((platform) => ({
    id: platform.id,
    name: platform.name,
    visits: platformCounts.get(platform.id) || 0,
    share: aiVisits.length ? (platformCounts.get(platform.id) || 0) / aiVisits.length * 100 : 0,
  })).filter((platform) => platform.visits).sort((left, right) => right.visits - left.visits || left.name.localeCompare(right.name));
  const pages = [...pageCounts].map(([path, value]) => ({
    path,
    title: null,
    visits: value.visits,
    sources: [...value.sources].sort(),
  })).sort((left, right) => right.visits - left.visits || left.path.localeCompare(right.path));
  const coverage = observedPageviews === 0
    ? "empty"
    : visits.size === 0
      ? "unavailable"
      : missingSessionPageviews > 0
        ? "partial"
        : "available";
  return {
    from,
    to,
    timeZone,
    coverage,
    observedPageviews,
    missingSessionPageviews,
    totalVisits: allVisits.length,
    aiVisits: aiVisits.length,
    aiSources: platforms.length,
    trafficShare: allVisits.length ? aiVisits.length / allVisits.length * 100 : null,
    landingPages: pages.length,
    series: days.map((day) => ({ day, visits: series.get(day) || 0 })),
    platforms,
    pages,
    engagement: {
      ai: measuredEngagement(aiVisits),
      other: measuredEngagement(allVisits.filter((visit) => !visit.platformId)),
      conversions: null,
      conversionRate: null,
      conversionStatus: "No conversion designation is configured for tracked events.",
    },
  };
}

export function aiVisibilityInsight(current: any, previous: any) {
  if (!current.aiVisits)
    return "No AI referral visits were recorded in this period. This does not indicate whether the site appeared in AI answers.";
  const leadingPage = current.pages?.[0];
  if (leadingPage) return `${leadingPage.path} received the most AI referral visits.`;
  const leadingPlatform = current.platforms?.[0];
  if (leadingPlatform && leadingPlatform.share >= 50)
    return `${leadingPlatform.name} accounted for ${Math.round(leadingPlatform.share)}% of AI referral visits.`;
  if (previous?.aiVisits > 0) {
    const change = Math.round((current.aiVisits - previous.aiVisits) / previous.aiVisits * 100);
    return `AI referral visits ${change >= 0 ? "increased" : "decreased"} by ${Math.abs(change)}% compared with the previous period.`;
  }
  return `${current.aiVisits} AI referral ${current.aiVisits === 1 ? "visit was" : "visits were"} recorded in this period.`;
}

function buildAiAuditSummary(run: any) {
  if (!run) return null;
  const technicalSnapshot = Array.isArray(run.registry_snapshot) ? run.registry_snapshot as AuditRegistrySnapshot[] : [];
  const groupSnapshot = Array.isArray(run.user_facing_snapshot) && run.user_facing_snapshot.length
    ? run.user_facing_snapshot as UserFacingAuditGroupSnapshot[]
    : fallbackUserFacingSnapshot(technicalSnapshot);
  const groups = deriveUserFacingAuditResults(groupSnapshot, run.audit_results || [])
    .filter((result) => result.category === "AI & Crawler Readiness");
  return {
    runId: run.id,
    pageId: run.audit_page_id,
    status: run.status,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    findings: groups.filter((result) => ["failed", "advisory"].includes(result.outcome)).length,
    groups,
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
  options: { includeVisitTimes?: boolean } = {},
) {
  const pageMap = new Map<string, { pageviews: number; events: number; activeSeconds: number; activeViews: number }>();
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
    sessionId: string;
    activeSeconds: number;
    maxScroll: number;
    keyEvents: number;
    visibleSections: Set<string>;
    vitals: Map<string, number>;
  }>();
  let pageviews = 0;
  let keyEvents = 0;
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
        const samples = Array.isArray(values)
          ? values.map(Number).filter(Number.isFinite)
          : Number.isFinite(Number(values)) ? [Number(values)] : [];
        if (!samples.length) continue;
        const metric = name.toUpperCase();
        viewVitals.set(metric, samples.at(-1)!);
        if (row.tracker_version === TRACKER_VERSION) {
          const allSamples = vitals.get(metric) || [];
          allSamples.push(...samples);
          vitals.set(metric, allSamples);
          const daily = vitalDays.get(metric) || new Map<string, number[]>();
          const dailySamples = daily.get(day) || [];
          dailySamples.push(...samples);
          daily.set(day, dailySamples);
          vitalDays.set(metric, daily);
          const device = String(row.device || "Unknown").toLocaleLowerCase();
          const deviceSamples = deviceVitals.get(device) || new Map<string, number[]>();
          const metricSamples = deviceSamples.get(metric) || [];
          metricSamples.push(...samples);
          deviceSamples.set(metric, metricSamples);
          deviceVitals.set(device, deviceSamples);
        }
      }
    }
    views.set(`${row.day}:${row.view_key}`, {
      path: normalizeAnalyticsPath(row.path),
      sessionId,
      activeSeconds: Number(row.active_seconds || 0),
      maxScroll: Number(row.max_scroll || 0),
      keyEvents: Number(row.key_events || 0),
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
    const page = pageMap.get(path) || { pageviews: 0, events: 0, activeSeconds: 0, activeViews: 0 };
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
          sessionId: String(event.metadata?.session || ""),
          activeSeconds: 0,
          maxScroll: 0,
          keyEvents: 0,
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
    cursor <= new Date(`${toDay}T00:00:00.000Z`) && index < 3660;
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
  const measuredSessions = new Map<string, { activeSeconds: number; maxScroll: number; keyEvents: number }>();
  for (const view of eligibleViews) {
    const page = pageMap.get(view.path);
    if (page) {
      page.activeSeconds += view.activeSeconds;
      page.activeViews += 1;
    }
    if (!view.sessionId) continue;
    const session = measuredSessions.get(view.sessionId) || { activeSeconds: 0, maxScroll: 0, keyEvents: 0 };
    session.activeSeconds += view.activeSeconds;
    session.maxScroll = Math.max(session.maxScroll, view.maxScroll);
    session.keyEvents += view.keyEvents;
    measuredSessions.set(view.sessionId, session);
  }
  const eligibleSessions = [...measuredSessions.values()];
  const engagedSessions = eligibleSessions.filter(
    (session) => session.activeSeconds >= 10 || session.maxScroll >= 50 || session.keyEvents > 0,
  );
  const activeSessionTimes = eligibleSessions.map((session) => session.activeSeconds);
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
  const visitTimes = options.includeVisitTimes === false
    ? []
    : buildVisitTimeHeatmap(events, historicalViews, timeZone);
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
      .map(([path, value]) => ({
        path,
        pageviews: value.pageviews,
        events: value.events,
        averageActiveSeconds: value.activeViews ? value.activeSeconds / value.activeViews : null,
      }))
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
      averageActiveSeconds: eligibleViews.length
        ? activeTimes.reduce((total, value) => total + value, 0) / eligibleViews.length
        : null,
      engagementRate: eligibleViews.length ? (engagedViews.length / eligibleViews.length) * 100 : null,
      eligibleSessions: eligibleSessions.length,
      engagedSessions: eligibleSessions.length ? engagedSessions.length : null,
      sessionEngagementRate: eligibleSessions.length
        ? (engagedSessions.length / eligibleSessions.length) * 100
        : null,
      bounceRate: eligibleSessions.length
        ? 100 - (engagedSessions.length / eligibleSessions.length) * 100
        : null,
      averageActiveSessionSeconds: eligibleSessions.length
        ? activeSessionTimes.reduce((total, value) => total + value, 0) / eligibleSessions.length
        : null,
      medianActiveSessionSeconds: eligibleSessions.length ? percentile(activeSessionTimes, 0.5) : null,
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

function analyticsViewAsEvent(view: any) {
  return {
    event_type: "pageview",
    path: view.path,
    referrer_host: view.referrer_host || null,
    source: view.source || null,
    device: view.device || null,
    country_code: view.country_code || null,
    metadata: {
      session: view.session_id || undefined,
      view_id: view.view_key || undefined,
      browser: view.browser || undefined,
      screen: view.screen || undefined,
      tracker_version: view.tracker_version || undefined,
      acquisition_source: view.source || undefined,
      original_referrer: view.referrer_host || undefined,
      utm_source: view.utm_source || undefined,
      utm_medium: view.utm_medium || undefined,
      utm_campaign: view.utm_campaign || undefined,
    },
    occurred_at: view.occurred_at,
  };
}

function filterAnalyticsViews(views: any[], filters: AnalyticsFilters) {
  return views.flatMap((view) => {
    if (!filterAnalyticsEvents([analyticsViewAsEvent(view)], filters).length) return [];
    const next = { ...view };
    if (filters.eventName) {
      const counts = view.key_event_counts && typeof view.key_event_counts === "object"
        ? view.key_event_counts
        : {};
      const requested = filters.eventName.toLocaleLowerCase();
      next.key_events = Object.entries(counts)
        .filter(([name]) => name.toLocaleLowerCase() === requested)
        .reduce((total, [, count]) => total + Number(count || 0), 0);
      // This matches the existing raw-event filter: selecting a named event
      // keeps pageviews and that event, while excluding unrelated engagement
      // signal rows from the scoped summary.
      next.active_seconds = 0;
      next.max_scroll = 0;
      next.javascript_errors = 0;
      next.visible_sections = [];
      next.vitals = {};
    } else if (filters.metric && next.vitals && typeof next.vitals === "object") {
      const requested = filters.metric.toLocaleUpperCase();
      next.vitals = next.vitals[requested] == null ? {} : { [requested]: next.vitals[requested] };
    }
    return [next];
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
  const aiPlatform = aiVisitPlatform(event);
  if (aiPlatform) return aiPlatform.name;
  const source = analyticsSource(event).toLocaleLowerCase();
  if (source === "direct" || source === "direct / unknown") return "Direct / unknown";
  if (source.includes("google")) return "Google";
  if (source.includes("linkedin")) return "LinkedIn";
  if (source.includes("instagram")) return "Instagram";
  return "Other referrals";
}

function analyticsSourceType(event: any) {
  const category = analyticsSourceCategory(event);
  if (AI_PLATFORMS.some((platform) => platform.name === category)) return "AI referral";
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
  if (e instanceof Error) return e.message.slice(0, 500);
  if (e && typeof e === "object") {
    const providerError = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const detail = [providerError.message, providerError.details, providerError.hint, providerError.code]
      .filter((value) => typeof value === "string" && value.length)
      .join(" · ");
    if (detail) return detail.slice(0, 500);
    try { return JSON.stringify(e).slice(0, 500); } catch { /* fall through */ }
  }
  return String(e || "unknown_error").slice(0, 500);
}

function historicalCompactRows(window: AnalyticsWindowData) {
  const cutoff = window.detailedFrom || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const totals = window.compactTotals.filter((row) => String(row.period_start || "") < cutoff);
  const keys = new Set(totals.map((row) => `${row.grain}:${row.period_start}`));
  const dimensions = window.compactDimensions.filter((row) => keys.has(`${row.grain}:${row.period_start}`));
  return { totals, dimensions, cutoff };
}

function hasUnsupportedHistoricalFilters(filters: AnalyticsFilters) {
  return Boolean(filters.device || filters.source || filters.country || filters.browser || filters.eventName || filters.sourceType || filters.utmSource || filters.utmMedium || filters.utmCampaign);
}

function compactPageMatches(value: string, filters: AnalyticsFilters) {
  const path = normalizeAnalyticsPath(value);
  const requested = filters.pathValue ? normalizeAnalyticsPath(filters.pathValue) : "";
  if (filters.pageSearch && !path.toLowerCase().includes(filters.pageSearch.toLowerCase())) return false;
  if (requested && filters.pathMode === "exact" && path !== requested) return false;
  if (requested && filters.pathMode === "prefix" && !path.startsWith(requested)) return false;
  return true;
}

function mergeCompactAnalyticsSummary(summary: any, window: AnalyticsWindowData, filters: AnalyticsFilters) {
  const historical = historicalCompactRows(window);
  if (!historical.totals.length) return { ...summary, dataResolution: "detailed", detailedFrom: historical.cutoff };
  const pageFiltered = Boolean(filters.pageSearch || filters.pathValue);
  const dimensions = historical.dimensions.filter((row) => !pageFiltered || row.dimension !== "page" || compactPageMatches(String(row.value || "/"), filters));
  const pageRows = dimensions.filter((row) => row.dimension === "page");
  const totals = pageFiltered
    ? [...new Map(pageRows.map((row) => [`${row.grain}:${row.period_start}`, { grain: row.grain, period_start: row.period_start }])).values()].map((period: any) => {
        const rows = pageRows.filter((row) => row.grain === period.grain && row.period_start === period.period_start);
        return { ...period, pageviews: rows.reduce((sum, row) => sum + Number(row.pageviews || 0), 0), events: rows.reduce((sum, row) => sum + Number(row.events || 0), 0), key_events: rows.reduce((sum, row) => sum + Number(row.events || 0), 0), sessions: 0, eligible_views: 0, engaged_views: 0, active_seconds: rows.reduce((sum, row) => sum + Number(row.active_seconds || 0), 0), scroll_25: 0, scroll_50: 0, scroll_75: 0, scroll_90: 0 };
      })
    : historical.totals;
  const sum = (key: string) => totals.reduce((total, row) => total + Number(row[key] || 0), 0);
  const mergeNamed = (current: any[], dimension: string, labelKey = "name") => {
    const map = new Map<string, any>();
    for (const row of current || []) map.set(String(row[labelKey]), { ...row });
    for (const row of dimensions.filter((item) => item.dimension === dimension)) {
      const key = String(row.value || "Unknown");
      const existing = map.get(key) || { [labelKey]: key, count: 0, pageviews: 0, events: 0 };
      existing.count = Number(existing.count || 0) + Number(row.pageviews || row.events || 0);
      existing.pageviews = Number(existing.pageviews || 0) + Number(row.pageviews || 0);
      existing.events = Number(existing.events || 0) + Number(row.events || 0);
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => Number(b.pageviews || b.count || 0) - Number(a.pageviews || a.count || 0));
  };
  const pageMap = new Map<string, any>((summary.pages || []).map((row: any) => [row.path, { ...row, _activeSeconds: Number(row.averageActiveSeconds || 0) * Number(row.pageviews || 0), _activeViews: row.averageActiveSeconds == null ? 0 : Number(row.pageviews || 0) }]));
  for (const row of pageRows) {
    const path = normalizeAnalyticsPath(row.value);
    const existing = pageMap.get(path) || { path, pageviews: 0, events: 0, averageActiveSeconds: null, _activeSeconds: 0, _activeViews: 0 };
    existing.pageviews += Number(row.pageviews || 0);
    existing.events += Number(row.events || 0);
    existing._activeSeconds += Number(row.active_seconds || 0);
    existing._activeViews += Number(row.active_views || 0);
    existing.averageActiveSeconds = existing._activeViews ? existing._activeSeconds / existing._activeViews : null;
    pageMap.set(path, existing);
  }
  const seriesMap = new Map<string, any>((summary.series || []).map((row: any) => [row.day, { ...row }]));
  for (const row of totals) {
    const key = String(row.period_start);
    const existing = seriesMap.get(key) || { day: key, pageviews: 0, events: 0, dailyVisitors: 0, grain: row.grain };
    existing.pageviews += Number(row.pageviews || 0);
    existing.events += Number(row.key_events || 0);
    existing.dailyVisitors += Number(row.sessions || 0);
    if (row.grain !== "day") existing.grain = row.grain;
    seriesMap.set(key, existing);
  }
  const eligibleViews = Number(summary.engagement?.eligiblePageviews || 0) + sum("eligible_views");
  const engagedViews = Number(summary.engagement?.engagedPageviews || 0) + sum("engaged_views");
  const activeSeconds = Number(summary.engagement?.averageActiveSeconds || 0) * Number(summary.engagement?.eligiblePageviews || 0) + sum("active_seconds");
  const scroll = [25, 50, 75, 90].map((depth) => ({ depth, pageviews: Number(summary.engagement?.scrollDepth?.find((row: any) => row.depth === depth)?.pageviews || 0) + sum(`scroll_${depth}`) }));
  return {
    ...summary,
    pageviews: Number(summary.pageviews || 0) + sum("pageviews"),
    events: Number(summary.events || 0) + sum("events"),
    keyEvents: Number(summary.keyEvents || 0) + sum("key_events"),
    sessions: Number(summary.sessions || 0) + sum("sessions"),
    pages: [...pageMap.values()].map(({ _activeSeconds, _activeViews, ...row }) => row).sort((a, b) => b.pageviews - a.pageviews),
    series: [...seriesMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))),
    sources: pageFiltered ? [] : mergeNamed(summary.sources, "source"),
    countries: pageFiltered ? [] : mergeNamed(summary.countries, "country"),
    devices: pageFiltered ? [] : mergeNamed(summary.devices, "device"),
    browsers: pageFiltered ? [] : mergeNamed(summary.browsers, "browser"),
    screens: pageFiltered ? [] : mergeNamed(summary.screens, "screen"),
    campaigns: pageFiltered ? [] : mergeNamed(summary.campaigns, "campaign"),
    eventBreakdown: pageFiltered ? [] : mergeNamed(summary.eventBreakdown, "event"),
    engagement: {
      ...summary.engagement,
      eligiblePageviews: eligibleViews,
      engagedPageviews: eligibleViews ? engagedViews : null,
      averageActiveSeconds: eligibleViews ? activeSeconds / eligibleViews : null,
      engagementRate: eligibleViews ? engagedViews / eligibleViews * 100 : null,
      scrollDepth: scroll,
      collectionStatus: pageFiltered ? "historical_page_totals_only" : "compact_rollup",
    },
    dataResolution: "detailed_and_rollup",
    detailedFrom: historical.cutoff,
    historicalGranularities: [...new Set(historical.totals.map((row) => row.grain))],
  };
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

function requestedWindow(c: any, defaultDays = 30, maximumDays = 3660) {
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

export function sanitizeEventMatchSettings(eventType: string, input?: Record<string, unknown>) {
  if (eventType === "click") {
    const attribute = String(input?.attribute || "").trim().toLowerCase();
    if (attribute && !/^data-claritude-event(?:-[2-9]\d*)?$/.test(attribute)) return null;
    return { method: "data_attribute", ...(attribute ? { attribute } : {}) };
  }
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
  if (input.ai_visibility && typeof input.ai_visibility === "object") {
    const details = input.ai_visibility as Record<string, unknown>;
    output.ai_visibility = {
      business_name: String(details.business_name || "").trim().slice(0, 120),
      industry: String(details.industry || "").toLocaleLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60),
      industry_custom: String(details.industry_custom || "").trim().slice(0, 120),
      location: String(details.location || "").trim().slice(0, 120),
      country: /^[A-Z]{2}$/.test(String(details.country || "").toUpperCase())
        ? String(details.country).toUpperCase()
        : "",
    };
  }
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
  } else if (typeof metadata.accountId === "string") {
    accountId = metadata.accountId;
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

export function escapeCsvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function applyAdminExportFilters(rows: Array<Record<string, any>>, filters: unknown) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return rows;
  const value = filters as Record<string, unknown>;
  const selectedIds = Array.isArray(value.selectedIds) ? new Set(value.selectedIds.slice(0, 1000).map(String)) : null;
  const accountId = typeof value.accountId === "string" ? value.accountId : null;
  const billingEnvironment = value.billingEnvironment === "test" || value.billingEnvironment === "live" ? value.billingEnvironment : "live";
  const query = typeof value.query === "string" ? value.query.trim().toLowerCase().slice(0, 120) : "";
  const rowEnvironment = (row: any) => row.billing_environment || row.accounts?.billing_environment || row.properties?.accounts?.billing_environment;
  return rows.filter((row) => (!selectedIds || selectedIds.has(String(row.id))) && (!accountId || row.id === accountId || row.account_id === accountId) && (!rowEnvironment(row) || rowEnvironment(row) === billingEnvironment) && (!query || Object.values(row).some((entry) => String(entry ?? "").toLowerCase().includes(query))));
}

function rowsToCsv(rows: Array<Record<string, unknown>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.map(escapeCsvCell).join(","), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))].join("\r\n");
}

async function runAdminExport(env: Env, id: string) {
  const db = admin(env);
  const { data: job } = await db.from("admin_export_jobs").select("*").eq("id", id).maybeSingle();
  if (!job || ["completed", "cancelled", "expired"].includes(job.state)) return;
  const { data: member } = await db.from("staff_members").select("role,status").eq("user_id", job.requested_by).maybeSingle();
  if (!member || member.status !== "active" || !staffRoleCan(member.role as StaffRole, "exports.write")) {
    await db.from("admin_export_jobs").update({ state: "cancelled", error: "staff_permission_revoked", completed_at: new Date().toISOString() }).eq("id", id);
    return;
  }
  await db.from("admin_export_jobs").update({ state: "running", progress: 5, error: null }).eq("id", id);
  try {
    let rows: Array<Record<string, unknown>> = [];
    if (job.scope === "accounts") {
      const result = await db.from("accounts").select("id,name,entitlement,access_state,tags,scheduled_deletion_at,billing_environment,is_test_account,created_at").limit(50_000);
      if (result.error) throw result.error;
      rows = result.data || [];
    } else if (job.scope === "properties") {
      const result = await db.from("properties").select("id,account_id,workspace_id,name,url,canonical_host,verification_status,access_state,tracking_last_received_at,created_at,accounts!inner(billing_environment)").limit(50_000);
      if (result.error) throw result.error;
      rows = result.data || [];
    } else if (job.scope === "audits") {
      const result = await db.from("audit_runs").select("id,property_id,page_url,status,score,coverage,duration_ms,error,created_at,completed_at,properties!inner(accounts!inner(billing_environment))").order("created_at", { ascending: false }).limit(50_000);
      if (result.error) throw result.error;
      rows = result.data || [];
    } else if (job.scope === "admin_activity") {
      const result = await db.from("admin_activity_log").select("id,actor_staff_id,represented_user_id,delegation_session_id,action,outcome,target_type,target_id,account_id,reason,metadata,correlation_id,created_at").order("created_at", { ascending: false }).limit(50_000);
      if (result.error) throw result.error;
      rows = result.data || [];
    } else if (job.scope === "users") {
      const result = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (result.error) throw result.error;
      const requestedEnvironment = job.filters?.billingEnvironment === "test" ? "test" : "live";
      const memberships = await db.from("memberships").select("user_id,accounts!inner(billing_environment)").eq("accounts.billing_environment", requestedEnvironment);
      if (memberships.error) throw memberships.error;
      const allowedUsers = new Set((memberships.data || []).map((membership: any) => membership.user_id));
      rows = result.data.users.filter((user) => allowedUsers.has(user.id)).map((user) => ({ id: user.id, email: user.email || "", email_confirmed_at: user.email_confirmed_at || null, last_sign_in_at: user.last_sign_in_at || null, created_at: user.created_at, billing_environment: requestedEnvironment }));
    } else {
      throw new Error("unsupported_export_scope");
    }
    rows = applyAdminExportFilters(rows, job.filters);
    await db.from("admin_export_jobs").update({ progress: 70, row_count: rows.length }).eq("id", id);
    const content = job.format === "json" ? JSON.stringify({ exportedAt: new Date().toISOString(), scope: job.scope, rows }) : rowsToCsv(rows);
    const objectKey = `${job.requested_by}/${job.id}.${job.format}`;
    const uploaded = await db.storage.from("admin-exports").upload(objectKey, content, { contentType: job.format === "json" ? "application/json" : "text/csv", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const completedAt = new Date().toISOString();
    await db.from("admin_export_jobs").update({ state: "completed", progress: 100, row_count: rows.length, object_key: objectKey, completed_at: completedAt, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }).eq("id", id);
    await recordAdminActivity(env, job.requested_by, "export.completed", "success", { targetType: "admin_export", targetId: job.id, metadata: { scope: job.scope, format: job.format, rowCount: rows.length } });
  } catch (error) {
    await db.from("admin_export_jobs").update({ state: "failed", error: errorMessage(error).slice(0, 1000) }).eq("id", id);
    throw error;
  }
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
    .select("id,notification_preferences")
    .in("id", members.map((member) => member.user_id));
  const allowedUsers = new Set(
    (profiles || [])
      .filter(
        (profile) =>
          profile.notification_preferences?.[notification.category] !== false,
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

export function trackerEventNames(element: any) {
  const values = Array.from(element?.attributes || [])
    .filter((attribute: any) => {
      const name = String(attribute?.name || "").toLowerCase();
      return name === "data-claritude-event" || name.startsWith("data-claritude-event-");
    })
    .flatMap((attribute: any) => String(attribute?.value || "").split(/[,;|\s]+/));
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const TRACKER_SOURCE = `(()=>{
  let s=document.currentScript;if(!s){const scripts=document.getElementsByTagName('script');for(let i=scripts.length-1;i>=0;i--){const candidate=scripts[i],src=candidate.getAttribute('src')||'';if(candidate.getAttribute('data-property')&&/(?:\\/c|\\/tracker)\\.js(?:[?#]|$)/.test(src)){s=candidate;break}}}
  const p=s&&s.getAttribute('data-property'),endpoint=s&&new URL('/collect',s.src).href,base=s&&new URL('/',s.src).href;
  if(!p||!endpoint||window.__claritude)return;window.__claritude=1;
  const uuid=()=>{try{return crypto.randomUUID()}catch(uuidError){const b=new Uint8Array(16);try{crypto.getRandomValues(b)}catch(randomError){for(let i=0;i<b.length;i++)b[i]=Math.floor(Math.random()*256)}b[6]=b[6]&15|64;b[8]=b[8]&63|128;return Array.prototype.map.call(b,(x,i)=>(i===4||i===6||i===8||i===10?'-':'')+x.toString(16).padStart(2,'0')).join('')}};
  let q=[],timer,retryTimer,stateTimer,retryDelay=1000,sending=false,lastUrl=location.href,view=uuid(),generation=0,active=0,lastCheckpointActive=0,lastActivity=Date.now(),maxScroll=0,checkpointSequence=0,pageStartedAt=new Date().toISOString(),dirty=true,vitalsReady=null,vitalState={},keyEventCounts={};
  const marks=new Set,visibleSections=new Set,observedSections=new WeakSet;
  const session=sessionStorage.getItem('_claritude_session')||uuid();
  sessionStorage.setItem('_claritude_session',session);
  const acquisition=(${trackerSessionAcquisition.toString()})(sessionStorage,session,location.href,document.referrer);
  const browser=/Edg\\//.test(navigator.userAgent)?'Edge':/OPR\\//.test(navigator.userAgent)?'Opera':/SamsungBrowser\\//.test(navigator.userAgent)?'Samsung Internet':/Firefox\\//.test(navigator.userAgent)?'Firefox':/Chrome\\//.test(navigator.userAgent)?'Chrome':/Safari\\//.test(navigator.userAgent)?'Safari':/MSIE|Trident/.test(navigator.userAgent)?'Internet Explorer':'Other';
  const common=()=>({session,view_id:view,browser,screen:innerWidth<768?'small':innerWidth<1280?'medium':'large',language:navigator.language||'',tracker_version:'${TRACKER_VERSION}',acquisition_source:acquisition.source,original_referrer:acquisition.referrer,landing_page:acquisition.landingPage,utm_source:acquisition.utmSource,utm_medium:acquisition.utmMedium,utm_campaign:acquisition.utmCampaign,utm_content:acquisition.utmContent,utm_term:acquisition.utmTerm});
  const retry=()=>{if(retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=0;send()},retryDelay);retryDelay=Math.min(retryDelay*2,30000)};
  const send=async()=>{if(sending||!q.length)return;sending=true;const batch=q.splice(0,20),body=JSON.stringify(batch);try{if(navigator.sendBeacon&&document.visibilityState==='hidden'){if(!navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'})))throw new Error('beacon-rejected')}else{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true});if(!response.ok)throw new Error('collect-'+response.status)}retryDelay=1000}catch(sendError){q=batch.concat(q).slice(0,200);retry()}finally{sending=false;if(q.length&&!retryTimer){clearTimeout(timer);timer=setTimeout(send,500)}}};
  const emit=(type,data={})=>{const supplied=data.meta&&typeof data.meta==='object'?data.meta:{},event_id=uuid(),baseMeta=common();q.push(Object.assign({},data,{type,property:p,path:location.pathname,source:data.source||acquisition.source,referrer:document.referrer,at:new Date().toISOString(),device:innerWidth<768?'mobile':innerWidth<1024?'tablet':'desktop',meta:Object.assign({event_id},baseMeta,supplied,baseMeta,{event_id})}));if(q.length>200)q=q.slice(-200);clearTimeout(timer);timer=setTimeout(send,5000)};
  const scheduleCheckpoint=()=>{dirty=true;if(!stateTimer)stateTimer=setTimeout(()=>{stateTimer=0;checkpoint()},2000)};
  const checkpoint=(force=false)=>{if(!force&&!dirty)return;checkpointSequence+=1;emit('view_state',{meta:{view_started_at:pageStartedAt,checkpoint_sequence:checkpointSequence,active_seconds:active,max_scroll:maxScroll,key_events:Object.assign({},keyEventCounts),visible_sections:Array.from(visibleSections),vitals:Object.assign({},vitalState)}});dirty=false;lastCheckpointActive=active};
  const recordKeyEvent=(type,name)=>{const key=type+':'+name;keyEventCounts[key]=(keyEventCounts[key]||0)+1;scheduleCheckpoint()};
  const eventNames=${trackerEventNames.toString()};
  addEventListener('click',e=>{lastActivity=Date.now();let node=e.target&&e.target.nodeType===1?e.target:e.target&&e.target.parentElement,names=[];while(node&&node!==document){names=eventNames(node);if(names.length)break;node=node.parentElement}for(const name of names){emit('click',{name});recordKeyEvent('click',name)}const link=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(link&&new URL(link.href,location.href).host!==location.host){const host=new URL(link.href).host;emit('outbound',{name:host});recordKeyEvent('outbound',host)}},{capture:true,passive:true});
  ['keydown','pointerdown','touchstart'].forEach(name=>addEventListener(name,()=>{lastActivity=Date.now()},{passive:true}));
  const checkScroll=()=>{const root=document.documentElement,height=Math.max(root.scrollHeight,document.body&&document.body.scrollHeight||0,1),n=Math.min(100,Math.round((scrollY+innerHeight)/height*100));if(n>maxScroll){maxScroll=n;dirty=true}[25,50,75,90].forEach(x=>{if(n>=x&&!marks.has(x)){marks.add(x);scheduleCheckpoint()}})};
  addEventListener('scroll',checkScroll,{passive:true});addEventListener('resize',checkScroll,{passive:true});
  const tick=setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus()&&Date.now()-lastActivity<30000){active+=1;dirty=true}if(active-lastCheckpointActive>=30)checkpoint()},1000);
  const sectionObserver='IntersectionObserver'in window?new IntersectionObserver(entries=>entries.forEach(entry=>{const name=entry.target.dataset.claritudeSection;if(entry.isIntersecting&&name&&!visibleSections.has(name)){visibleSections.add(name);scheduleCheckpoint()}}),{threshold:.5}):null;
  const observeSections=()=>{if(!sectionObserver)return;document.querySelectorAll('[data-claritude-section]').forEach(node=>{if(!observedSections.has(node)){observedSections.add(node);sectionObserver.observe(node)}})};
  const initVitals=()=>{if(!window.webVitals)return;const own=generation,record=metric=>{if(own===generation&&metric&&Number.isFinite(metric.value)){vitalState[metric.name]=metric.value;scheduleCheckpoint()}};try{webVitals.onLCP(record)}catch(lcpError){}try{webVitals.onINP(record)}catch(inpError){}try{webVitals.onCLS(record)}catch(clsError){}};
  const loadVitals=()=>vitalsReady||(vitalsReady=new Promise(resolve=>{if(window.webVitals){resolve();return}const script=document.createElement('script');script.src=new URL('/vendor/web-vitals.js',base).href;script.async=true;script.crossOrigin='anonymous';script.onload=resolve;script.onerror=resolve;document.head.appendChild(script)}));
  const page=()=>{emit('pageview',{source:acquisition.source});checkpoint(true);observeSections();requestAnimationFrame(checkScroll);loadVitals().then(initVitals)};page();
  const navigation=(forcedPath)=>{if(!forcedPath&&location.href===lastUrl)return;checkpoint(true);send();lastUrl=location.href;view=uuid();generation+=1;active=0;lastCheckpointActive=0;lastActivity=Date.now();maxScroll=0;checkpointSequence=0;pageStartedAt=new Date().toISOString();dirty=true;vitalState={};keyEventCounts={};marks.clear();visibleSections.clear();page()};
  new MutationObserver(()=>{navigation();observeSections();checkScroll()}).observe(document,{subtree:true,childList:true});
  ['pushState','replaceState'].forEach(k=>{const original=history[k];history[k]=function(){const result=original.apply(this,arguments);Promise.resolve().then(()=>navigation());return result}});
  addEventListener('popstate',()=>navigation());
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){checkpoint(true);send()}else lastActivity=Date.now()});
  addEventListener('pagehide',()=>{clearInterval(tick);clearTimeout(stateTimer);checkpoint(true);send()});
  window.claritude={version:'${TRACKER_VERSION}',event:(name,meta)=>{emit('click',{name,meta});recordKeyEvent('click',name)},formSuccess:(name,meta)=>{emit('form_success',{name,meta});recordKeyEvent('form_success',name)},pageview:details=>navigation(details&&details.path),flush:()=>{checkpoint(true);return send()}};
})();`;

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<Job>, env: Env) => {
    await Promise.all(batch.messages.map(async (message) => {
      try {
        if (message.body.type === "audit") await runAudit(env, message.body.id);
        else if (message.body.type === "audit-persist") await persistAuditContinuation(env, message.body.id, message.body.payload);
        else if (message.body.type === "admin-export") await runAdminExport(env, message.body.id);
        else if (message.body.type === "billing-event") await processBillingEvent(env, message.body.id);
        else if (message.body.type === "billing-reconcile") await reconcileBillingAccount(env, message.body.id, "scheduled");
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
