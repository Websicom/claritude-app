import { describe, expect, it } from "vitest";
import {
  analyticsPreviousPeriodRange,
  analyticsRollupPlan,
  auditOutcomeNotification,
  buildAnalyticsEventDetailSummary,
  buildAnalyticsOccurrenceContext,
  buildAnalyticsSummary,
  buildAiVisibilitySummary,
  aiVisibilityInsight,
  auditCheckHasExecutableLogic,
  canonicalPropertyHost,
  chunkAuditResults,
  compactAuditResult,
  customEventAllowance,
  customEventPlan,
  cleanPath,
  editableWorkspaceRole,
  encodeAuditContinuationPayload,
  decodeAuditContinuationPayload,
  expandCompactAnalyticsRows,
  filterAnalyticsEvents,
  isFreshAuditRun,
  inactivityLifecycleState,
  isPrivateHost,
  isProtectedAuditPagePath,
  normalizeAnalyticsPath,
  normalizePropertyRelations,
  meaningfulAccountActivity,
  TRACKER_SOURCE,
  trackerSessionAcquisition,
  uptimeDueHorizon,
  uptimeDailyStatus,
  uptimeCheckResponseSeries,
  uptimeResponseBucket,
  validAvatarBytes,
  validSafetyLimits,
  validPublicUrl,
  withAuditDeadline,
  closeBrowserWithDeadline,
  workspaceDeletionError,
  renderUptimeAlertEmail,
  resolveEffectiveEntitlements,
  validateComplimentaryGrantInput,
  packageLimitConflicts,
  schemaCompatibleSharedEvidenceRows,
  escapeCsvCell,
  parseAuthAssurance,
  staffPermissions,
  staffRoleCan,
  deriveFeatureState,
  deriveEmailAutomationDecision,
  renderEmailTemplate,
  validatePlatformSetting,
  normalizeAccountTags,
  applyAdminExportFilters,
  financeMetrics,
  calculateSubscriptionMrr,
  stripeKeyEnvironment,
} from "./index";
import { AUDIT_REGISTRY } from "../shared/audit-registry.generated";
import { AUDIT_EVALUATOR_KEYS } from "../shared/audit-evaluator-map.generated";

describe("worker evidence pipelines", () => {
  it("expands positional analytics rows without changing legacy object rows", () => {
    expect(expandCompactAnalyticsRows(
      [["2026-10-07T00:00:00Z", "pageview", "/"]],
      ["bucket_start", "event_type", "path"],
    )).toEqual([{ bucket_start: "2026-10-07T00:00:00Z", event_type: "pageview", path: "/" }]);
    const legacy = { event_type: "pageview", path: "/legacy/" };
    expect(expandCompactAnalyticsRows([legacy], ["event_type", "path"])).toEqual([legacy]);
  });

  it("deduplicates AI referral visits, keeps landing pages and excludes AI visits from the comparison group", () => {
    const events = [
      { event_type: "pageview", path: "/services/", occurred_at: "2026-10-01T10:00:00Z", source: "chatgpt.com", referrer_host: "chatgpt.com", metadata: { session: "ai-one", tracker_version: "2.1.5", landing_page: "/services/", acquisition_source: "chatgpt.com", original_referrer: "chatgpt.com" } },
      { event_type: "pageview", path: "/contact/", occurred_at: "2026-10-01T10:05:00Z", source: "chatgpt.com", referrer_host: "chatgpt.com", metadata: { session: "ai-one", tracker_version: "2.1.5", landing_page: "/services/", acquisition_source: "chatgpt.com", original_referrer: "chatgpt.com" } },
      { event_type: "active_time", path: "/services/", value: 12, occurred_at: "2026-10-01T10:00:12Z", metadata: { session: "ai-one" } },
      { event_type: "pageview", path: "/", occurred_at: "2026-10-01T11:00:00Z", source: "google.com", referrer_host: "google.com", metadata: { session: "other-one", tracker_version: "2.1.5", landing_page: "/", acquisition_source: "google.com", original_referrer: "google.com" } },
    ];
    const summary = buildAiVisibilitySummary(events, [], "2026-10-01T00:00:00Z", "2026-10-01T23:59:59Z", "Europe/London");
    expect(summary).toMatchObject({ totalVisits: 2, aiVisits: 1, aiSources: 1, trafficShare: 50, landingPages: 1, coverage: "available" });
    expect(summary.pages).toEqual([{ path: "/services/", title: null, visits: 1, sources: ["chatgpt"] }]);
    expect(summary.platforms[0]).toMatchObject({ id: "chatgpt", visits: 1, share: 100 });
    expect(summary.engagement.ai.engagementRate).toBe(100);
    expect(summary.engagement.other.engagementRate).toBe(0);
  });

  it("does not classify ordinary Google traffic as Gemini and reports missing visit identifiers", () => {
    const summary = buildAiVisibilitySummary([
      { event_type: "pageview", path: "/", occurred_at: "2026-10-01T10:00:00Z", source: "google.com", referrer_host: "google.com", metadata: { tracker_version: "2" } },
    ], [], "2026-10-01T00:00:00Z", "2026-10-01T23:59:59Z", "UTC");
    expect(summary.coverage).toBe("unavailable");
    expect(summary.aiVisits).toBe(0);
    expect(aiVisibilityInsight(summary, { aiVisits: 0 })).toContain("does not indicate");
  });
  it("keeps finance calculations currency-separated and excludes non-recurring cash movements from MRR", () => {
    expect(financeMetrics({
      subscriptions: [
        { status: "active", currency: "gbp", interval: "month", unit_amount_minor: 1200, quantity: 2, mrr_minor: 2000 },
        { status: "active", currency: "usd", interval: "year", unit_amount_minor: 12000, quantity: 1, discount_minor: 0 },
        { status: "canceled", currency: "gbp", interval: "month", unit_amount_minor: 9999, quantity: 1 },
      ],
      invoices: [{ currency: "gbp", total_minor: 2400 }],
      payments: [{ currency: "gbp", status: "succeeded", amount_received_minor: 2400 }],
      refunds: [{ currency: "gbp", status: "succeeded", amount_minor: 300 }],
      disputes: [{ currency: "gbp", status: "needs_response", amount_minor: 500 }],
    })).toEqual([
      expect.objectContaining({ currency: "gbp", mrrMinor: 2000, arrMinor: 24000, cashCollectedMinor: 2400, refundsMinor: 300, disputedMinor: 500 }),
      expect.objectContaining({ currency: "usd", mrrMinor: 1000, arrMinor: 12000 }),
    ]);
  });
  it("detects restricted and secret Stripe keys without crossing environments", () => {
    expect(stripeKeyEnvironment("sk_test_example")).toBe("test");
    expect(stripeKeyEnvironment("rk_test_example")).toBe("test");
    expect(stripeKeyEnvironment("sk_live_example")).toBe("live");
    expect(stripeKeyEnvironment("rk_live_example")).toBe("live");
    expect(stripeKeyEnvironment("pk_test_example")).toBeNull();
    expect(stripeKeyEnvironment("not-a-key")).toBeNull();
  });
  it("calculates MRR from every recurring item, annual intervals and recurring discounts", () => {
    const result = calculateSubscriptionMrr([
      { id: "si_base", quantity: 1, price: { unit_amount: 12000, recurring: { interval: "year" } } },
      { id: "si_seats", quantity: 3, price: { unit_amount: 200, recurring: { interval: "month" } } },
    ], [
      { id: "di_forever", start: 1, source: { coupon: { id: "co_20", duration: "forever", percent_off: 20 } } },
      { id: "di_once", start: 1, source: { coupon: { id: "co_once", duration: "once", amount_off: 500 } } },
    ], 100);
    expect(result.grossMrrMinor).toBe(1600);
    expect(result.recurringDiscountMinor).toBe(320);
    expect(result.mrrMinor).toBe(1280);
    expect(result.items).toHaveLength(2);
    expect(result.items.reduce((sum, item) => sum + item.monthlyNetMinor, 0)).toBe(1280);
    expect(calculateSubscriptionMrr(
      [{ id: "si_annual", quantity: 1, price: { unit_amount: 24000, recurring: { interval: "year" } } }],
      [{ id: "di_amount", source: { coupon: { duration: "forever", amount_off: 1200, currency: "gbp" } } }],
    ).mrrMinor).toBe(1900);
  });
  it("scopes finance by environment and counts only succeeded refunds", () => {
    const result = financeMetrics({
      subscriptions: [{ billing_environment: "test", status: "active", currency: "gbp", mrr_minor: 900 }, { billing_environment: "live", status: "active", currency: "gbp", mrr_minor: 5000 }],
      invoices: [], payments: [], disputes: [],
      refunds: [{ billing_environment: "test", currency: "gbp", status: "succeeded", amount_minor: 100 }, { billing_environment: "test", currency: "gbp", status: "pending", amount_minor: 200 }, { billing_environment: "live", currency: "gbp", status: "succeeded", amount_minor: 300 }],
    }, "test");
    expect(result[0]).toMatchObject({ currency: "gbp", mrrMinor: 900, refundsMinor: 100, pendingRefundsMinor: 200 });
  });
  it("normalises bounded account tags without accepting oversized metadata", () => {
    expect(normalizeAccountTags([" Priority ", "Priority", "needs   review"])).toEqual(["Priority", "needs review"]);
    expect(normalizeAccountTags("priority")).toBeNull();
    expect(normalizeAccountTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`))).toBeNull();
    expect(normalizeAccountTags(["x".repeat(41)])).toBeNull();
  });

  it("applies selected-row, account and query filters to admin exports", () => {
    const rows = [{ id: "a", account_id: "one", name: "Alpha", billing_environment: "live" }, { id: "b", account_id: "two", name: "Beta", billing_environment: "test" }];
    expect(applyAdminExportFilters(rows, { selectedIds: ["b"], billingEnvironment: "test" })).toEqual([rows[1]]);
    expect(applyAdminExportFilters(rows, { accountId: "one" })).toEqual([rows[0]]);
    expect(applyAdminExportFilters(rows, { query: "beta", billingEnvironment: "test" })).toEqual([rows[1]]);
    expect(applyAdminExportFilters(rows, { billingEnvironment: "live" })).toEqual([rows[0]]);
    expect(applyAdminExportFilters(rows, { billingEnvironment: "test" })).toEqual([rows[1]]);
  });
  it("derives configuration state separately from permission and running jobs", () => {
    expect(deriveFeatureState({ permitted: true, configured: false, enabled: false })).toMatchObject({ state: "awaiting_configuration", runningJobs: 0 });
    expect(deriveFeatureState({ permitted: true, configured: true, enabled: false })).toMatchObject({ state: "ready_to_activate" });
    expect(deriveFeatureState({ permitted: false, configured: true, enabled: true })).toMatchObject({ state: "paused" });
    expect(deriveFeatureState({ permitted: true, configured: true, enabled: true, runningJobs: 0 })).toMatchObject({ state: "enabled", reason: "Permitted and configured; no job is currently running" });
    expect(deriveFeatureState({ permitted: true, configured: true, enabled: true, dependencyAvailable: false, dependency: "Provider missing" })).toMatchObject({ state: "unavailable", reason: "Provider missing" });
  });

  it("validates templates and safety-sensitive platform settings", () => {
    expect(renderEmailTemplate("Hello {{name}}", { name: "<Adam>" })).toEqual({ rendered: "Hello &lt;Adam&gt;", missing: [] });
    expect(renderEmailTemplate("Hello {{name}} from {{team}}", { name: "Adam" }).missing).toEqual(["team"]);
    expect(validatePlatformSetting("inactivity_policy", { warningDays: [60, 90], freezeDay: 100, deletionEligibleDay: 121, automaticDeletionEnabled: false })).toBeNull();
    expect(validatePlatformSetting("inactivity_policy", { warningDays: [60, 90], freezeDay: 100, deletionEligibleDay: 121, automaticDeletionEnabled: true })).toBe("invalid_inactivity_policy");
    expect(validatePlatformSetting("provider_capabilities", {})).toBe("provider_capabilities_are_discovered_not_editable");
  });

  it("enforces automation activation, categories and suppressions at send time", () => {
    const active = { configured: true, enabled: true, enabledCategories: ["uptime_down", "report"], suppressionHandling: "enforce", suppressed: false };
    expect(deriveEmailAutomationDecision({ ...active, category: "uptime_down" })).toEqual({ allowed: true, reason: null });
    expect(deriveEmailAutomationDecision({ ...active, category: "scheduled_report" })).toEqual({ allowed: true, reason: null });
    expect(deriveEmailAutomationDecision({ ...active, enabled: false, category: "uptime_down" })).toMatchObject({ allowed: false, reason: "automation_paused" });
    expect(deriveEmailAutomationDecision({ ...active, suppressed: true, category: "uptime_down" })).toMatchObject({ allowed: false, reason: "recipient_suppressed" });
    expect(deriveEmailAutomationDecision({ ...active, category: "campaign" })).toMatchObject({ allowed: false, reason: "category_disabled" });
  });

  it("enforces the staff role permission boundary", () => {
    expect(staffRoleCan("owner", "staff.write")).toBe(true);
    expect(staffRoleCan("support", "delegation.write")).toBe(true);
    expect(staffRoleCan("support", "financials.write")).toBe(false);
    expect(staffRoleCan("finance", "financials.write")).toBe(true);
    expect(staffRoleCan("engineering", "operations.write")).toBe(true);
    expect(staffPermissions("owner")).toContain("settings.write");
  });

  it("neutralises spreadsheet formulas in CSV exports", () => {
    expect(escapeCsvCell("=HYPERLINK(\"https://bad.example\")")).toBe("\"'=HYPERLINK(\"\"https://bad.example\"\")\"");
    expect(escapeCsvCell("normal")).toBe("\"normal\"");
    expect(escapeCsvCell("  +SUM(1,2)")).toBe("\"'  +SUM(1,2)\"");
  });

  it("keeps free-account inactivity scoped to meaningful editor activity and review holds", () => {
    expect(meaningfulAccountActivity("property.settings_updated")).toBe(true);
    expect(meaningfulAccountActivity("audit.completed")).toBe(false);
    expect(meaningfulAccountActivity("uptime.checked_manually")).toBe(false);
    expect(inactivityLifecycleState(59)).toBe("active");
    expect(inactivityLifecycleState(60)).toBe("warning_60");
    expect(inactivityLifecycleState(90)).toBe("warning_90");
    expect(inactivityLifecycleState(100, { noticesReady: false })).toBe("review_hold");
    expect(inactivityLifecycleState(100, { noticesReady: true })).toBe("frozen");
    expect(inactivityLifecycleState(121, { noticesReady: true })).toBe("deletion_eligible");
    expect(inactivityLifecycleState(130, { noticesReady: true, analyticsReview: true })).toBe("review_hold");
    expect(inactivityLifecycleState(130, { exempt: true })).toBe("exempt");
  });

  it("rejects incomplete or unsafe processing ceilings", () => {
    const valid = { platformAuditStartsPerDay: 200, concurrentAudits: 5, auditWallTimeSeconds: 600, httpResponseBytes: 5_000_000, linksPerAudit: 5000, resourcesPerAudit: 5000, redirects: 5, queueRetries: 3, analyticsPayloadBytes: 262_144, analyticsEventsPerPropertyPerDay: 50_000, exportsPerAccountPerDay: 10 };
    expect(validSafetyLimits(valid)).toBe(true);
    expect(validSafetyLimits({ ...valid, concurrentAudits: 0 })).toBe(false);
    expect(validSafetyLimits({ ...valid, auditWallTimeSeconds: 3600 })).toBe(false);
    expect(validSafetyLimits({ platformAuditStartsPerDay: 200 })).toBe(false);
  });

  it("resolves package defaults and clamps account overrides to platform ceilings", () => {
    expect(resolveEffectiveEntitlements({ packageKey: "scale", version: 2, allowances: { propertiesPerAccount: 10, auditCreditsPerWeek: 50 }, hardCeilings: { propertiesPerAccount: 25 } }, [
      { key: "propertiesPerAccount", value: 100 },
      { key: "auditCreditsPerWeek", value: 80 },
    ])).toMatchObject({ packageKey: "scale", version: 2, values: { propertiesPerAccount: 25, auditCreditsPerWeek: 80 }, sources: { propertiesPerAccount: "account_override", auditCreditsPerWeek: "account_override" } });
  });

  it("validates permanent and temporary complimentary grants without billing side effects", () => {
    const permanent = validateComplimentaryGrantInput({
      packageVersionId: "12345678-1234-1234-1234-123456789abc",
      permanent: true,
      reason: "Long-term partner access",
      overrides: { propertiesPerAccount: "12", editingSeats: 4 },
    }, Date.parse("2026-10-06T09:00:00Z"));
    expect(permanent).toEqual({ value: {
      packageVersionId: "12345678-1234-1234-1234-123456789abc",
      permanent: true,
      expiresAt: null,
      expiryBehavior: "return_to_standard",
      reason: "Long-term partner access",
      overrides: { propertiesPerAccount: 12, editingSeats: 4 },
    } });
    expect(validateComplimentaryGrantInput({ packageVersionId: "12345678-1234-1234-1234-123456789abc", permanent: false, expiresAt: "2026-10-06T08:59:00Z", reason: "Temporary trial" }, Date.parse("2026-10-06T09:00:00Z"))).toMatchObject({ error: "grant_expiry_must_be_future" });
    expect(validateComplimentaryGrantInput({ packageVersionId: "12345678-1234-1234-1234-123456789abc", reason: "Unsafe override", overrides: { propertiesPerAccount: -1 } })).toMatchObject({ error: "override_must_be_non_negative_integer" });
  });

  it("previews deterministic excess-resource warnings", () => {
    expect(packageLimitConflicts({ propertiesPerAccount: 5, editingSeats: 2 }, { properties: 9, editingSeats: 3 })).toEqual([
      "4 properties exceed the effective allowance",
      "1 editing seats exceed the effective allowance",
    ]);
    expect(packageLimitConflicts({ propertiesPerAccount: 10 }, { properties: 9, editingSeats: 30 })).toEqual([]);
  });

  it("reads MFA assurance only from a validated session token payload", () => {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "none" })}.${encode({ aal: "aal2", session_id: "session-one" })}.signature`;
    expect(parseAuthAssurance(token)).toEqual({ aal: "aal2", sessionId: "session-one" });
    expect(parseAuthAssurance("malformed")).toEqual({ aal: "aal1", sessionId: null });
  });

  it("buckets uptime response medians by hour, day and month for the selected range", () => {
    expect(uptimeResponseBucket("2026-10-05T00:00:00.000Z", "2026-10-05T23:59:59.999Z")).toBe("hour");
    expect(uptimeResponseBucket("2026-10-01T00:00:00.000Z", "2026-10-05T23:59:59.999Z")).toBe("day");
    expect(uptimeResponseBucket("2026-01-01T00:00:00.000Z", "2026-10-05T23:59:59.999Z")).toBe("month");
  });

  it("retains every measured monitor response for the default day chart", () => {
    expect(uptimeCheckResponseSeries([
      { checked_at: "2026-10-06T09:00:00.000Z", response_ms: 210 },
      { checked_at: "2026-10-06T09:10:00.000Z", response_ms: 305 },
      { checked_at: "2026-10-06T09:20:00.000Z", response_ms: null },
    ])).toEqual([
      { label: "2026-10-06T09:00:00.000Z", value: 210, samples: 1 },
      { label: "2026-10-06T09:10:00.000Z", value: 305, samples: 1 },
    ]);
  });

  it("renders test alerts from the shared uptime template without implying delivery", () => {
    const html = renderUptimeAlertEmail({
      property: { id: "property-1", name: "Controlled property", url: "https://example.com" },
      incident: { opened_at: "2026-10-03T10:00:00Z", cause: "HTTP 500" },
      kind: "down",
      appOrigin: "https://app.claritude.io",
      test: true,
    });
    expect(html).toContain("TEST ALERT");
    expect(html).toContain("Controlled property");
    expect(html).toContain("https://example.com");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("/uptime?property=property-1");
    expect(html).toContain("did not create an incident");
  });

  it("emits a tracker script that browsers can parse", () => {
    expect(() => new Function(TRACKER_SOURCE)).not.toThrow();
    expect(TRACKER_SOURCE).toContain("/Chrome\\//.test");
    expect(TRACKER_SOURCE).toContain("_claritude_acquisition");
    expect(TRACKER_SOURCE).toContain("view_state");
    expect(TRACKER_SOURCE).toContain("active-lastCheckpointActive>=30");
    expect(TRACKER_SOURCE).toContain("batch=q.splice(0,20)");
    expect(TRACKER_SOURCE).toContain("timer=setTimeout(send,5000)");
    expect(TRACKER_SOURCE).toContain("visibilityState==='hidden'){checkpoint(true);send()");
    expect(TRACKER_SOURCE).toContain("pagehide',()=>{clearInterval(tick);clearTimeout(stateTimer);checkpoint(true);send()");
    expect(TRACKER_SOURCE).not.toContain("emit('active_time'");
    expect(TRACKER_SOURCE).not.toContain("emit('scroll'");
    expect(TRACKER_SOURCE).not.toContain("emit('visible_section'");
    expect(TRACKER_SOURCE).not.toContain("javascript_errors");
    expect(TRACKER_SOURCE).not.toContain("unhandledrejection");
    expect(TRACKER_SOURCE).not.toContain("document.cookie");
    expect(TRACKER_SOURCE).not.toContain("localStorage");
  });

  it.each([
    ["free", 2],
    ["essentials", 5],
    ["scale", 20],
    ["pro", null],
    ["pro_early_access", null],
  ])("maps the %s entitlement to its configured custom event limit", (entitlement, limit) => {
    expect(customEventAllowance(entitlement, 0).limit).toBe(limit);
  });

  it("blocks event definition creation at finite plan allowances and leaves Pro unlimited", () => {
    expect(customEventAllowance("free", 2)).toMatchObject({ plan: "Free", canCreate: false, remaining: 0 });
    expect(customEventAllowance("essentials", 5)).toMatchObject({ plan: "Essentials", canCreate: false, remaining: 0 });
    expect(customEventAllowance("scale", 20)).toMatchObject({ plan: "Scale", canCreate: false, remaining: 0 });
    expect(customEventAllowance("pro", 10_000)).toMatchObject({ plan: "Pro", canCreate: true, unlimited: true, limit: null });
    expect(customEventPlan("unknown-future-plan")).toBe("Free");
  });

  it("counts configured definitions independently from built-in analytics signals", () => {
    const configuredDefinitions = [
      { event_type: "click", name: "need-convincing-clicked" },
      { event_type: "form_success", name: "contact-success" },
    ];
    const builtInSignals = ["pageview", "scroll", "active_time", "web_vital"];
    const allowance = customEventAllowance("free", configuredDefinitions.length);
    expect(builtInSignals).toHaveLength(4);
    expect(allowance).toMatchObject({ used: 2, canCreate: false });
  });

  it("preserves first-page acquisition values through internal navigation in one browser session", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const first = trackerSessionAcquisition(
      storage,
      "session-one",
      "https://websi.com/?utm_source=google&utm_medium=cpc&utm_campaign=test&utm_content=hero&utm_term=agency",
      "https://www.google.com/search?q=websi",
    );
    const later = trackerSessionAcquisition(
      storage,
      "session-one",
      "https://websi.com/pricing/",
      "https://websi.com/",
    );
    expect(first).toMatchObject({
      source: "google",
      referrer: "www.google.com",
      landingPage: "/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "test",
      utmContent: "hero",
      utmTerm: "agency",
    });
    expect(later).toEqual(first);
  });

  it("starts fresh acquisition in a new browser session without persistent identity", () => {
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) || null,
      setItem: (key: string, value: string) => { storageValues.set(key, value); },
    };
    trackerSessionAcquisition(storage, "session-one", "https://websi.com/?utm_source=google", "");
    const nextSession = trackerSessionAcquisition(storage, "session-two", "https://websi.com/pricing/", "https://linkedin.com/feed/");
    expect(nextSession).toMatchObject({
      session: "session-two",
      source: "linkedin.com",
      referrer: "linkedin.com",
      landingPage: "/pricing/",
      utmSource: "",
    });
    expect([...storageValues.keys()]).toEqual(["_claritude_acquisition"]);
  });

  it("uses bounded audit result batches", () => {
    expect(chunkAuditResults(Array.from({ length: 131 }, (_, index) => index), 64))
      .toEqual([
        Array.from({ length: 64 }, (_, index) => index),
        Array.from({ length: 64 }, (_, index) => index + 64),
        [128, 129, 130],
      ]);
  });

  it("keeps new evidence summaries within the deployed shared-evidence schema", () => {
    const rows = schemaCompatibleSharedEvidenceRows([
      { evidence_type: "http", summary: { status: 200 }, byte_size: 10, collection_status: "complete", error: null },
      { evidence_type: "resources", summary: { retained: 2 }, byte_size: 20, collection_status: "complete", error: null },
      { evidence_type: "alternate_origins", summary: { probes: 3 }, byte_size: 30, collection_status: "complete", error: null },
      { evidence_type: "ai_resources", summary: { resources: 2 }, byte_size: 40, collection_status: "partial", error: "rate limited" },
    ]);
    expect(rows.map((row) => row.evidence_type)).toEqual(["http", "resources"]);
    expect(rows[0]).toMatchObject({ summary: { status: 200, alternateOrigins: { probes: 3 } }, byte_size: 40, collection_status: "complete" });
    expect(rows[1]).toMatchObject({ summary: { retained: 2, aiResources: { resources: 2 } }, byte_size: 60, collection_status: "partial", error: "rate limited" });
    expect(() => schemaCompatibleSharedEvidenceRows([{ evidence_type: "unknown" }])).toThrow(/unsupported_types/);
  });

  it("persists reasons inside evidence without writing an obsolete result column", () => {
    expect(compactAuditResult({
      check_id: "check-1",
      outcome: "unable_to_test",
      reason: "Rendered evidence was incomplete",
      evidence: { reason: "Rendered evidence was incomplete" },
      duration_ms: 1,
    })).toEqual({
      check_id: "check-1",
      outcome: "unable_to_test",
      evidence: { reason: "Rendered evidence was incomplete" },
      duration_ms: 1,
    });
  });

  it("round-trips a compressed audit persistence continuation within the queue ceiling", async () => {
    const source = {
      startedAt: 1_750_000_000_000,
      propertyId: "property-1",
      createdBy: "user-1",
      resultCount: 306,
      testedCount: 301,
      sharedEvidence: [{ evidence_type: "http", summary: { status: 200 } }],
      telemetry: { architectureVersion: "2.0.0", queueMessagesUsed: 2 },
      score: 78,
      coverage: 100,
      finalStatus: "completed" as const,
      totalChecks: 306,
    };
    const encoded = await encodeAuditContinuationPayload(source);
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(120_000);
    await expect(decodeAuditContinuationPayload(encoded)).resolves.toEqual(source);
  });

  it("fails a stalled audit operation at its hard deadline and runs cleanup", async () => {
    let cleanedUp = false;
    await expect(withAuditDeadline(
      new Promise<never>(() => undefined),
      5,
      "collector timed out",
      () => { cleanedUp = true; },
    )).rejects.toThrow("collector timed out");
    expect(cleanedUp).toBe(true);
  });

  it("does not let stalled BrowserLab cleanup block the audit", async () => {
    const startedAt = Date.now();
    await closeBrowserWithDeadline(() => new Promise<never>(() => undefined), 5);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it("expires audit runs on a stale heartbeat or the hard runtime deadline", () => {
    const now = Date.parse("2026-10-03T18:30:00Z");
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:27:00Z",
      heartbeat_at: "2026-10-03T18:29:00Z",
    }, now)).toBe(true);
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:27:00Z",
      heartbeat_at: "2026-10-03T18:21:59Z",
    }, now)).toBe(false);
    expect(isFreshAuditRun({
      created_at: "2026-10-03T18:19:59Z",
      heartbeat_at: "2026-10-03T18:29:59Z",
    }, now)).toBe(false);
  });

  it("normalizes property hosts consistently for duplicate protection", () => {
    expect(canonicalPropertyHost("WWW.EdgeTier.COM.")).toBe("edgetier.com");
    expect(canonicalPropertyHost("edgetier.com")).toBe("edgetier.com");
  });
  it("normalizes Supabase one-to-one monitor embeds for the dashboard", () => {
    expect(
      normalizePropertyRelations([
        { id: "with-monitor", uptime_monitors: { id: "monitor-1", last_status: "online" } },
        { id: "without-monitor", uptime_monitors: null },
      ]),
    ).toEqual([
      { id: "with-monitor", uptime_monitors: [{ id: "monitor-1", last_status: "online" }] },
      { id: "without-monitor", uptime_monitors: [] },
    ]);
  });

  it("aggregates measured analytics dimensions and engagement", () => {
    const summary = buildAnalyticsSummary(
      [
        {
          event_type: "pageview",
          path: "/",
          source: "Google",
          device: "desktop",
          country_code: "GB",
          metadata: { browser: "Chrome", screen: "large", session: "tab-1", view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:00Z",
        },
        {
          event_type: "scroll",
          path: "/",
          value: 75,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:10Z",
        },
        {
          event_type: "active_time",
          path: "/",
          value: 12,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:11Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "LCP",
          value: 2100,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:12Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "INP",
          value: 180,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:13Z",
        },
        {
          event_type: "web_vital",
          path: "/",
          name: "CLS",
          value: 0.08,
          metadata: { view_id: "view-1", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:00:14Z",
        },
        {
          event_type: "pageview",
          path: "/services",
          source: "Direct",
          device: "mobile",
          country_code: "US",
          metadata: { session: "tab-2", view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:00Z",
        },
        {
          event_type: "click",
          path: "/services/",
          name: "contact-click",
          device: "mobile",
          country_code: "US",
          metadata: { view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:05Z",
        },
        {
          event_type: "outbound",
          path: "https://example.com/services",
          name: "example.org",
          device: "mobile",
          country_code: "US",
          metadata: { view_id: "view-2", tracker_version: "2.1.0" },
          occurred_at: "2026-10-02T00:01:08Z",
        },
      ],
      30,
    );
    expect(summary.pageviews).toBe(2);
    expect(summary.events).toBe(9);
    expect(summary.keyEvents).toBe(2);
    expect(summary.pages.find((page) => page.path === "/")).toMatchObject({
      pageviews: 1,
      events: 0,
    });
    expect(summary.pages.find((page) => page.path === "/services/")).toMatchObject({
      pageviews: 1,
      events: 2,
    });
    expect(summary.sources[0]).toEqual({ name: "Google", pageviews: 1, events: 0 });
    expect(summary.countries).toContainEqual({ name: "GB", count: 1 });
    expect(summary.engagement.engagedPageviews).toBe(2);
    expect(summary.engagement.eligibleSessions).toBe(2);
    expect(summary.engagement.engagedSessions).toBe(2);
    expect(summary.engagement.bounceRate).toBe(0);
    expect(summary.engagement.averageActiveSessionSeconds).toBe(6);
    expect(summary.engagement.pageviewsWithKeyEvents).toBe(1);
    expect(summary.pages.find((page) => page.path === "/")?.averageActiveSeconds).toBe(12);
    expect(summary.engagement.scrollDepth.find((row) => row.depth === 75)?.pageviews).toBe(1);
    expect(summary.vitals).toContainEqual({ name: "LCP", value: 2100, samples: 1, percentile: 75 });
    expect(summary.vitals).toContainEqual({ name: "INP", value: 180, samples: 1, percentile: 75 });
    expect(summary.performance.minimumSamples).toBe(1);
    expect(summary.performance.goodExperiencesPercent).toBe(100);
    expect(summary.engagement.visitTimes.find((cell) => cell.weekday === 4 && cell.hour === 0)).toMatchObject({
      visitors: 2,
      visitorsComplete: true,
      pageCount: 2,
    });
  });

  it("derives session bounce and duration from active engagement rather than page count", () => {
    const summary = buildAnalyticsSummary([
      {
        event_type: "pageview",
        path: "/single/",
        metadata: { session: "engaged-single-page", view_id: "view-1", tracker_version: "2.1.0" },
        occurred_at: "2026-10-02T10:00:00Z",
      },
      {
        event_type: "active_time",
        path: "/single/",
        value: 14,
        metadata: { session: "engaged-single-page", view_id: "view-1", tracker_version: "2.1.0" },
        occurred_at: "2026-10-02T10:00:14Z",
      },
      {
        event_type: "pageview",
        path: "/first/",
        metadata: { session: "multi-page-bounce", view_id: "view-2", tracker_version: "2.1.0" },
        occurred_at: "2026-10-02T11:00:00Z",
      },
      {
        event_type: "pageview",
        path: "/second/",
        metadata: { session: "multi-page-bounce", view_id: "view-3", tracker_version: "2.1.0" },
        occurred_at: "2026-10-02T11:00:02Z",
      },
    ], 1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z", "UTC");

    expect(summary.sessions).toBe(2);
    expect(summary.engagement.eligibleSessions).toBe(2);
    expect(summary.engagement.engagedSessions).toBe(1);
    expect(summary.engagement.sessionEngagementRate).toBe(50);
    expect(summary.engagement.bounceRate).toBe(50);
    expect(summary.engagement.averageActiveSessionSeconds).toBe(7);
    expect(summary.engagement.medianActiveSessionSeconds).toBe(0);
  });

  it("maps pageview timestamps into property-local weekday/hour cells across raw and rolled views", () => {
    const summary = buildAnalyticsSummary(
      [
        { event_type: "pageview", path: "/pricing/", metadata: { session: "raw-session" }, occurred_at: "2026-10-04T23:30:00Z" },
        { event_type: "pageview", path: "/contact/", metadata: {}, occurred_at: "2026-10-04T23:45:00Z" },
      ],
      30,
      "2026-09-06T00:00:00Z",
      "2026-10-05T23:59:59Z",
      "Europe/London",
      [],
      [
        { day: "2026-10-05", occurred_at: "2026-10-05T00:15:00Z", session_id: "rolled-session", view_key: "rolled-view", path: "/" },
      ],
    );
    const mondayMidnight = summary.engagement.visitTimes.find((cell) => cell.weekday === 0 && cell.hour === 0);
    const mondayOneAm = summary.engagement.visitTimes.find((cell) => cell.weekday === 0 && cell.hour === 1);
    expect(mondayMidnight).toMatchObject({ visitors: 1, visitorsComplete: false, pageCount: 2 });
    expect(mondayOneAm).toMatchObject({ visitors: 1, visitorsComplete: true, pageCount: 1 });
  });

  it("can omit engagement heatmap processing for the lightweight property overview summary", () => {
    const summary = buildAnalyticsSummary(
      [{ event_type: "pageview", path: "/", metadata: { session: "session-1" }, occurred_at: "2026-10-05T10:00:00Z" }],
      30,
      "2026-09-06T00:00:00Z",
      "2026-10-05T23:59:59Z",
      "Europe/London",
      [],
      [],
      { includeVisitTimes: false },
    );
    expect(summary.pageviews).toBe(1);
    expect(summary.engagement.visitTimes).toEqual([]);
  });

  it("keeps prior compatible tracker observations available after a tracker upgrade", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "legacy", view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:00Z" },
      { event_type: "scroll", path: "/", value: 90, metadata: { view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:02Z" },
      { event_type: "active_time", path: "/", value: 12, metadata: { view_id: "legacy-view", tracker_version: "2.0.0" }, occurred_at: "2026-10-02T09:00:12Z" },
    ], 1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z", "UTC");
    expect(summary.engagement.eligiblePageviews).toBe(1);
    expect(summary.engagement.medianScrollDepth).toBe(90);
    expect(summary.engagement.medianActiveSeconds).toBe(12);
  });

  it("builds compact event drill-down summaries from raw and rolled observations", () => {
    const summary = buildAnalyticsEventDetailSummary([
      {
        event_type: "click",
        name: "Need Convincing Clicked",
        path: "/pricing/",
        source: "Google",
        device: "desktop",
        country_code: "GB",
        metadata: { browser: "Chrome" },
        occurred_at: "2026-10-01T09:00:00Z",
        _aggregateCount: 3,
      },
      {
        event_type: "click",
        name: "Need Convincing Clicked",
        path: "/contact/",
        source: "LinkedIn",
        device: "mobile",
        country_code: "US",
        metadata: { browser: "Safari", session: "anonymous-tab" },
        occurred_at: "2026-10-02T10:00:00Z",
      },
      { event_type: "click", name: "Other event", path: "/", occurred_at: "2026-10-02T11:00:00Z" },
    ], "Need Convincing Clicked", "Europe/London");
    expect(summary.totalCount).toBe(4);
    expect(summary.uniqueSessions).toBeNull();
    expect(summary.topPage).toEqual({ name: "/pricing/", count: 3 });
    expect(summary.topSource).toEqual({ name: "Google", count: 3 });
    expect(summary.series).toEqual([
      { day: "2026-10-01", count: 3 },
      { day: "2026-10-02", count: 1 },
    ]);
    expect(summary.aggregateCoverage).toBe("hybrid_rollups_and_raw");
  });

  it("counts anonymous sessions only when raw event session evidence is complete", () => {
    const summary = buildAnalyticsEventDetailSummary([
      { event_type: "click", name: "lead", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T10:00:00Z" },
      { event_type: "click", name: "lead", path: "/", metadata: { session: "two" }, occurred_at: "2026-10-02T10:01:00Z" },
      { event_type: "click", name: "lead", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T10:02:00Z" },
    ], "lead");
    expect(summary.totalCount).toBe(3);
    expect(summary.uniqueSessions).toBe(2);
    expect(summary.aggregateCoverage).toBe("raw");
  });

  it("derives occurrence context only from matching anonymous view and session events", () => {
    const pageview = {
      id: 1,
      event_type: "pageview",
      path: "/pricing/",
      source: "Google",
      referrer_host: "google.com",
      device: "mobile",
      country_code: "GB",
      metadata: { session: "tab-one", view_id: "view-one", browser: "Safari", screen: "small", language: "en-GB", utm_campaign: "spring" },
      occurred_at: "2026-10-02T10:00:00Z",
    };
    const occurrence = {
      id: 5,
      event_type: "click",
      name: "Need Convincing Clicked",
      path: "/pricing/",
      metadata: { session: "tab-one", view_id: "view-one" },
      occurred_at: "2026-10-02T10:00:20Z",
      received_at: "2026-10-02T10:00:21Z",
    };
    const viewEvents = [
      pageview,
      { id: 2, event_type: "active_time", path: "/pricing/", value: 12, metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:12Z" },
      { id: 3, event_type: "scroll", path: "/pricing/", value: 90, metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:15Z" },
      { id: 4, event_type: "visible_section", name: "pricing", path: "/pricing/", metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:16Z" },
      occurrence,
      { id: 6, event_type: "web_vital", name: "LCP", value: 2200, path: "/pricing/", metadata: { view_id: "view-one" }, occurred_at: "2026-10-02T10:00:25Z" },
    ];
    const sessionEvents = [
      ...viewEvents,
      { id: 7, event_type: "pageview", path: "/contact/", metadata: { session: "tab-one", view_id: "view-two" }, occurred_at: "2026-10-02T10:01:00Z" },
    ];
    const context = buildAnalyticsOccurrenceContext(occurrence, viewEvents, sessionEvents);
    expect(context.acquisition).toMatchObject({ source: "Google", referrer: "google.com", utmCampaign: "spring" });
    expect(context.visitor).toMatchObject({ country: "GB", device: "mobile", browser: "Safari", screen: "Small · under 768px" });
    expect(context.behaviour).toMatchObject({ activeSeconds: 12, maxScroll: 90, visibleSections: ["pricing"] });
    expect(context.behaviour.pageSequence).toEqual(["/pricing/", "/contact/"]);
    expect(context.webVitals).toEqual([{ name: "LCP", value: 2200 }]);
    expect(context.behaviour.journey.at(-1)).toEqual({ type: "event", label: "Need Convincing Clicked" });
  });

  it("keeps session acquisition separate from the page where the event occurred", () => {
    const acquisition = {
      session: "tab-one",
      acquisition_source: "google",
      original_referrer: "www.google.com",
      landing_page: "/",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "test",
    };
    const occurrence = {
      id: 3,
      event_type: "click",
      name: "need-convincing-clicked",
      path: "/pricing/",
      metadata: {
        ...acquisition,
        view_id: "view-two",
        acquisition_source: "",
        original_referrer: "",
        landing_page: "",
        utm_source: "",
        utm_medium: "",
        utm_campaign: "",
      },
      occurred_at: "2026-10-05T10:01:05Z",
    };
    const sessionEvents = [
      { id: 1, event_type: "pageview", path: "/", metadata: { ...acquisition, view_id: "view-one" }, occurred_at: "2026-10-05T10:00:00Z" },
      { id: 2, event_type: "pageview", path: "/pricing/", metadata: { ...acquisition, view_id: "view-two" }, occurred_at: "2026-10-05T10:01:00Z" },
      occurrence,
    ];
    const context = buildAnalyticsOccurrenceContext(occurrence, sessionEvents.slice(1), sessionEvents);
    expect(context.path).toBe("/pricing/");
    expect(context.acquisition).toMatchObject({
      source: "Google",
      sourceDetail: "google",
      referrer: "www.google.com",
      landingPage: "/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "test",
    });
  });

  it("does not invent occurrence context when anonymous correlation evidence is absent", () => {
    const context = buildAnalyticsOccurrenceContext({
      id: 9,
      event_type: "form_success",
      name: "lead",
      path: "/contact/",
      occurred_at: "2026-10-02T10:00:00Z",
      received_at: "2026-10-02T10:00:01Z",
      metadata: {},
    });
    expect(context.contextAvailability).toEqual({ view: false, session: false });
    expect(context.acquisition.landingPage).toBeNull();
    expect(context.behaviour).toMatchObject({ activeSeconds: 0, maxScroll: 0, visibleSections: [], relatedKeyEvents: [] });
    expect(context.webVitals).toEqual([]);
  });

  it("merges historical rollups with the same analytics result as raw events", () => {
    const raw = [
      { event_type: "pageview", path: "/", source: "Google", device: "desktop", country_code: "GB", metadata: { browser: "Chrome", screen: "large", session: "tab-1", view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:00Z" },
      { event_type: "scroll", path: "/", value: 75, metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:10Z" },
      { event_type: "web_vital", path: "/", name: "LCP", value: 2100, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:12Z" },
      { event_type: "web_vital", path: "/", name: "INP", value: 180, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:13Z" },
      { event_type: "web_vital", path: "/", name: "CLS", value: 0.08, device: "desktop", metadata: { view_id: "view-1", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:00:14Z" },
      { event_type: "pageview", path: "/services/", source: "Direct", device: "mobile", country_code: "US", metadata: { session: "tab-2", view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:00Z" },
      { event_type: "click", path: "/services/", name: "contact-click", device: "mobile", country_code: "US", metadata: { view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:05Z" },
      { event_type: "outbound", path: "/services/", name: "example.org", device: "mobile", country_code: "US", metadata: { view_id: "view-2", tracker_version: "2.1.0" }, occurred_at: "2026-10-02T00:01:08Z" },
    ];
    const rollups = raw.map((event) => ({
      event_type: event.event_type,
      path: event.path,
      name: event.name || "",
      device: event.device || "",
      source: event.source || "",
      country_code: event.country_code || "",
      browser: event.metadata.browser || "",
      screen: event.metadata.screen || "",
      tracker_version: event.metadata.tracker_version || "",
      bucket_start: "2026-10-02T00:00:00Z",
      event_count: 1,
      value_sum: event.value ?? null,
      values_json: event.event_type === "web_vital" ? [event.value] : [],
    }));
    const views = [
      { day: "2026-10-02", view_key: "view-1", occurred_at: "2026-10-02T00:00:00Z", path: "/", tracker_version: "2.1.0", session_id: "tab-1", active_seconds: 0, max_scroll: 75, key_events: 0, javascript_errors: 0, visible_sections: [], vitals: { LCP: [2100], INP: [180], CLS: [0.08] } },
      { day: "2026-10-02", view_key: "view-2", occurred_at: "2026-10-02T00:01:00Z", path: "/services/", tracker_version: "2.1.0", session_id: "tab-2", active_seconds: 0, max_scroll: 0, key_events: 2, javascript_errors: 0, visible_sections: [], vitals: {} },
    ];
    const args = [1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59.999Z", "UTC"] as const;
    expect(buildAnalyticsSummary([], ...args, rollups, views)).toEqual(
      buildAnalyticsSummary(raw, ...args),
    );
  });

  it("uses rollups only for complete UTC days and leaves boundary ranges raw", () => {
    const plan = analyticsRollupPlan(
      "2026-09-03T23:00:00.000Z",
      "2026-10-03T22:59:59.999Z",
      Date.parse("2026-10-03T20:00:00.000Z"),
    );
    expect(plan.rollupFrom).toBe("2026-09-04T00:00:00.000Z");
    expect(plan.rollupTo).toBe("2026-10-03T00:00:00.000Z");
    expect(plan.expectedDays).toHaveLength(29);
    expect(plan.rawRanges).toEqual([
      { from: "2026-09-03T23:00:00.000Z", to: "2026-09-03T23:59:59.999Z" },
      { from: "2026-10-03T00:00:00.000Z", to: "2026-10-03T22:59:59.999Z" },
    ]);
  });

  it("uses the immediately preceding equal-duration analytics window", () => {
    expect(analyticsPreviousPeriodRange(
      "2026-10-04T23:00:00.000Z",
      "2026-10-05T22:59:59.999Z",
    )).toEqual({
      from: "2026-10-03T23:00:00.000Z",
      to: "2026-10-04T22:59:59.999Z",
    });
  });

  it("produces desktop and mobile performance from the same analytics pass", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "web_vital", path: "/", name: "LCP", value: 2100, device: "desktop", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:00Z" },
      { event_type: "web_vital", path: "/", name: "LCP", value: 3400, device: "mobile", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:01Z" },
      { event_type: "web_vital", path: "/", name: "INP", value: 180, device: "desktop", metadata: { tracker_version: "2.1.4" }, occurred_at: "2026-10-02T09:00:02Z" },
    ], 1, "2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z", "UTC");
    expect(summary.performanceByDevice.desktop.vitals).toContainEqual({
      name: "LCP",
      value: 2100,
      samples: 1,
      percentile: 75,
    });
    expect(summary.performanceByDevice.mobile.vitals).toContainEqual({
      name: "LCP",
      value: 3400,
      samples: 1,
      percentile: 75,
    });
  });

  it("normalizes paths and combines analytics page filters", () => {
    const events = [
      { event_type: "pageview", path: "/work", device: "desktop", source: "Google", country_code: "GB" },
      { event_type: "pageview", path: "/work/case-study/", device: "mobile", source: "Google", country_code: "GB" },
      { event_type: "pageview", path: "/services/", device: "desktop", source: "Direct", country_code: "US" },
      { event_type: "pageview", path: "/ai/", device: "desktop", source: "ChatGPT", country_code: "GB" },
    ];
    expect(normalizeAnalyticsPath("https://example.com/work")).toBe("/work/");
    expect(
      filterAnalyticsEvents(events, {
        pathMode: "prefix",
        pathValue: "/work",
        device: "mobile",
        source: "Google",
        country: "GB",
      }),
    ).toEqual([events[1]]);
    expect(
      filterAnalyticsEvents(events, { pathMode: "exact", pathValue: "/work/" }),
    ).toEqual([events[0]]);
    expect(
      filterAnalyticsEvents(events, { pathMode: "prefix", pathValue: "/wor" }),
    ).toEqual([events[0], events[1]]);
    expect(filterAnalyticsEvents(events, { sourceType: "AI referral" })).toEqual([events[3]]);
  });

  it("keeps pageviews separate from key events and preserves fractional average daily visitors", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "one", view_id: "a", tracker_version: "2.1.0" }, occurred_at: "2026-09-01T09:00:00Z" },
      { event_type: "scroll", path: "/", value: 50, metadata: { view_id: "a", tracker_version: "2.1.0" }, occurred_at: "2026-09-01T09:00:05Z" },
      { event_type: "pageview", path: "/", metadata: { session: "two", view_id: "b", tracker_version: "2.1.0" }, occurred_at: "2026-09-02T09:00:00Z" },
      { event_type: "click", path: "/", name: "cta", metadata: { view_id: "b", tracker_version: "2.1.0" }, occurred_at: "2026-09-02T09:00:05Z" },
    ], 4, "2026-08-31T23:00:00Z", "2026-09-04T22:59:59.999Z", "Europe/London");
    expect(summary.pageviews).toBe(2);
    expect(summary.keyEvents).toBe(1);
    expect(summary.pages[0]).toMatchObject({ pageviews: 2, events: 1 });
    expect(summary.averageDailyVisitors).toBe(0.5);
    expect(summary.performance.minimumSamples).toBe(1);
  });

  it("fits a full audit into five bounded persistence requests", () => {
    const chunks = chunkAuditResults(Array.from({ length: 306 }, (_, index) => index), 64);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toHaveLength(64);
    expect(chunks.at(-1)).toHaveLength(50);
    expect(chunks.flat()).toHaveLength(306);
  });

  it("returns hourly points for a single local calendar day", () => {
    const summary = buildAnalyticsSummary([
      { event_type: "pageview", path: "/", metadata: { session: "one" }, occurred_at: "2026-10-02T09:15:00Z" },
    ], 1, "2026-10-01T23:00:00Z", "2026-10-02T22:59:59.999Z", "Europe/London");
    expect(summary.series).toHaveLength(24);
    expect(summary.series.reduce((total, point) => total + point.pageviews, 0)).toBe(1);
    expect(summary.series.every((point) => point.day.includes("T"))).toBe(true);
  });

  it("uses 23 and 25 hourly points across Europe/London DST transitions", () => {
    const springForward = buildAnalyticsSummary(
      [],
      1,
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T22:59:59.999Z",
      "Europe/London",
    );
    const fallBack = buildAnalyticsSummary(
      [],
      1,
      "2026-10-24T23:00:00.000Z",
      "2026-10-25T23:59:59.999Z",
      "Europe/London",
    );
    expect(springForward.series).toHaveLength(23);
    expect(fallBack.series).toHaveLength(25);
  });

  it("routes every active catalogue check through one explicit evaluator key", () => {
    const active = AUDIT_REGISTRY.filter((check) => check.lifecycle === "active");
    const implemented = active.filter((check) => auditCheckHasExecutableLogic(check.id));
    const gaps = active.filter((check) => !auditCheckHasExecutableLogic(check.id));
    expect(active).toHaveLength(306);
    expect(Object.keys(AUDIT_EVALUATOR_KEYS)).toHaveLength(306);
    expect(implemented).toHaveLength(306);
    expect(gaps).toEqual([]);
    expect(implemented.length + gaps.length).toBe(active.length);
    expect(gaps.every((check) => AUDIT_EVALUATOR_KEYS[check.id] === "unsupported")).toBe(true);
  });

  it("has no checks left on the unsupported evaluator route", () => {
    const unsupported = AUDIT_REGISTRY.filter((check) => AUDIT_EVALUATOR_KEYS[check.id] === "unsupported");
    expect(unsupported).toEqual([]);
  });

  it("rejects private, credentialed and non-HTTP audit targets", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fd00::1",
    ])
      expect(isPrivateHost(host)).toBe(true);
    expect(validPublicUrl("http://127.0.0.1/admin")).toBeNull();
    expect(validPublicUrl("https://user:secret@example.com/")).toBeNull();
    expect(validPublicUrl("file:///etc/passwd")).toBeNull();
    expect(validPublicUrl("https://example.com/path")?.hostname).toBe("example.com");
  });

  it("gives five-minute uptime cron ticks a bounded due horizon", () => {
    expect(uptimeDueHorizon(Date.parse("2026-10-02T12:25:00.000Z"))).toBe(
      "2026-10-02T12:26:00.000Z",
    );
  });

  it("distinguishes days before monitor setup from genuine missing coverage", () => {
    expect(uptimeDailyStatus({
      incidentCount: 0,
      total: 0,
      suppressed: 0,
      partial: false,
      dayEnd: Date.parse("2026-10-01T00:00:00.000Z"),
      monitorCreated: Date.parse("2026-10-02T22:07:44.000Z"),
    })).toBe("not_started");
    expect(uptimeDailyStatus({
      incidentCount: 0,
      total: 0,
      suppressed: 0,
      partial: false,
      dayEnd: Date.parse("2026-10-04T00:00:00.000Z"),
      monitorCreated: Date.parse("2026-10-02T22:07:44.000Z"),
    })).toBe("missing");
  });

  it("normalizes saved audit pages to property-relative paths", () => {
    expect(cleanPath("about/team")).toBe("/about/team/");
    expect(cleanPath("https://example.com/contact?source=test")).toBe("/contact/");
    expect(cleanPath("/")).toBe("/");
    expect(isProtectedAuditPagePath("/")).toBe(true);
    expect(isProtectedAuditPagePath("/about/")).toBe(false);
  });

  it("protects owner roles and destructive workspace invariants", () => {
    expect(editableWorkspaceRole("member")).toBe("member");
    expect(editableWorkspaceRole("viewer")).toBe("viewer");
    expect(editableWorkspaceRole("owner")).toBeNull();
    expect(workspaceDeletionError(1, 0)).toBe("account_requires_one_workspace");
    expect(workspaceDeletionError(2, 1)).toBe("workspace_must_be_empty_before_deletion");
    expect(workspaceDeletionError(2, 0)).toBeNull();
  });

  it("accepts avatar bytes only when their signature matches the declared image type", () => {
    expect(validAvatarBytes("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(validAvatarBytes("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(validAvatarBytes("image/gif", new TextEncoder().encode("GIF89a"))).toBe(true);
    expect(validAvatarBytes("image/webp", new TextEncoder().encode("RIFF0000WEBP"))).toBe(true);
    expect(validAvatarBytes("image/png", new TextEncoder().encode("<script>"))).toBe(false);
  });

  it("only creates audit notifications for failure or a score below 50", () => {
    expect(auditOutcomeNotification("completed", 92, 100)).toBeNull();
    expect(auditOutcomeNotification("partial", 64, 82)).toBeNull();
    expect(auditOutcomeNotification("completed", 49, 100)).toMatchObject({ title: "Audit score below 50", severity: "critical" });
    expect(auditOutcomeNotification("failed", null, 0, "browser unavailable")).toMatchObject({ title: "Audit failed", severity: "warning" });
  });
});
