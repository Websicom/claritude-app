import type { Session } from "@supabase/supabase-js";
import chromeLogo from "@browser-logos/chrome/chrome.svg";
import edgeLogo from "@browser-logos/edge/edge.svg";
import firefoxLogo from "@browser-logos/firefox/firefox.svg";
import internetExplorerLogo from "@browser-logos/internet-explorer_9-11/internet-explorer_9-11.svg";
import operaLogo from "@browser-logos/opera/opera.svg";
import safariLogo from "@browser-logos/safari/safari.svg";
import samsungInternetLogo from "@browser-logos/samsung-internet/samsung-internet.svg";
import "flag-icons/css/flag-icons.min.css";
import {
  Activity,
  BarChart3,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileChartColumn,
  Filter,
  Earth,
  Globe2,
  HelpCircle,
  Home,
  Info,
  LayoutGrid,
  Landmark,
  LogOut,
  Menu,
  MoreHorizontal,
  Monitor,
  OctagonAlert,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  Eye,
  Moon,
  SquareDashedMousePointer,
  Sun,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { apiRequest as api } from "./api";
import { supabase } from "./supabase";
import { estimateIncidentDowntime } from "../shared/uptime";
import { USER_FACING_AUDIT_GROUPS } from "../shared/audit-user-facing-registry.generated";

type Monitor = {
  id: string;
  enabled: boolean;
  interval_minutes: number;
  timeout_ms: number;
  failure_threshold: number;
  expected_status_min: number;
  expected_status_max: number;
  last_status: string;
  last_response_ms?: number;
  last_checked_at?: string;
};
type AuditRun = {
  id: string;
  status: string;
  audit_page_id?: string;
  score?: number;
  coverage?: number;
  page_url?: string;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
  execution_stage?: string;
  progress_completed?: number;
  progress_total?: number | null;
  heartbeat_at?: string;
  registry_snapshot?: Array<{ id: string }>;
  audit_results?: any[];
  user_facing_results?: any[];
  category_scores?: Record<string, number>;
  performance_metrics?: {
    desktop?: (string | number)[][];
    mobile?: (string | number)[][];
    scores?: { desktop?: number; mobile?: number };
    source?: string;
  };
  catalogue_summary?: {
    catalogueSize: number;
    implementedChecks: number;
    snapshotChecks: number;
    attemptedChecks: number;
    successfullyExecutedChecks: number;
    passedChecks: number;
    userFacingGroups?: number;
  };
};
type AuditPage = {
  id: string;
  property_id?: string;
  name: string;
  path: string;
};

type TrafficMetric = "Pageviews" | "Unique Visits" | "Events";

export function trafficSeriesKey(metric: TrafficMetric) {
  return metric === "Unique Visits" ? "dailyVisitors" : metric === "Events" ? "events" : "pageviews";
}

export function paginateResults<T>(values: T[], page: number, pageSize = 20) {
  const safePage = Math.max(1, page);
  return values.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function isPrimaryAuditPage(page: Pick<AuditPage, "path">) {
  return page.path === "/";
}

export function squareImageCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return {
    x: Math.max(0, (width - size) / 2),
    y: Math.max(0, (height - size) / 2),
    size,
  };
}

export async function prepareAvatarImage(file: File) {
  const image = await createImageBitmap(file);
  try {
    const crop = squareImageCrop(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize images");
    context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 256, 256);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("The selected image could not be compressed")),
        "image/webp",
        0.82,
      );
    });
  } finally {
    image.close();
  }
}
type Property = {
  id: string;
  workspace_id?: string;
  name: string;
  url: string;
  canonical_host: string;
  verification_status: string;
  tracking_id: string;
  tracking_last_received_at?: string;
  uptime_monitors?: Monitor[];
  audit_runs?: AuditRun[];
  settings?: Record<string, any>;
  demo?: DemoMetrics;
};

type WorkspacePropertyAccess = "workspace" | "shared";

export function sortWorkspaceProperties(properties: Property[]) {
  return [...properties].sort((left, right) => {
    const leftOffline = left.uptime_monitors?.[0]?.last_status === "offline" ? 0 : 1;
    const rightOffline = right.uptime_monitors?.[0]?.last_status === "offline" ? 0 : 1;
    return leftOffline - rightOffline || left.name.localeCompare(right.name, "en-GB", { sensitivity: "base" });
  });
}

export function workspaceKeyEventCount(summary: any) {
  return Number(summary?.keyEvents ?? summary?.events ?? 0);
}

export function propertyOnboardingChecks(property: Property) {
  const monitor = property.uptime_monitors?.[0];
  const completedAudit = property.audit_runs?.find((run) => ["completed", "partial"].includes(run.status));
  return [
    { complete: property.verification_status === "verified", label: "Property verified", detail: property.verification_status === "verified" ? "Verified" : "Verification required" },
    { complete: Boolean(monitor?.enabled && monitor.last_checked_at), label: "First uptime check completed", detail: monitor?.last_checked_at ? `Checked ${relative(monitor.last_checked_at)}` : "Awaiting first check" },
    { complete: Boolean(property.tracking_last_received_at), label: "Analytics receiving data", detail: property.tracking_last_received_at ? `Last event ${relative(property.tracking_last_received_at)}` : "Tracking script not detected" },
    { complete: Boolean(completedAudit), label: "First audit completed", detail: completedAudit ? `${cap(completedAudit.status)} · ${completedAudit.score ?? "—"} / 100` : "No completed audit yet" },
  ];
}

function PropertyFavicon({ property }: { property: Property }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = property.tracking_id?.startsWith("fixture_")
    ? property.id === "fixture-property" ? ["/assets/websi-mark.svg"] : []
    : propertyFaviconSources(property.url);

  useEffect(() => setSourceIndex(0), [property.id, property.url]);
  const source = sources[sourceIndex];
  if (!source) return <span aria-hidden="true">{property.name[0]?.toUpperCase()}</span>;
  return <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setSourceIndex((index) => index + 1)} />;
}

export function propertyFaviconSources(value: string) {
  try {
    const url = new URL(value);
    return [
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=64`,
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(url.hostname)}.ico`,
      new URL("/favicon.ico", url).href,
    ];
  } catch {
    return [];
  }
}

function profileAvatarUrl(profile: any) {
  const preferences = profile?.notification_preferences;
  if (preferences && Object.prototype.hasOwnProperty.call(preferences, "_avatar_url"))
    return preferences._avatar_url || "";
  return profile?.avatar_url || "";
}

function ProfileAvatar({ profile, name, className = "" }: { profile: any; name?: string; className?: string }) {
  const avatarUrl = profileAvatarUrl(profile);
  return (
    <span className={`avatar ${className}`.trim()}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : (name || profile?.full_name || "C")[0]}
    </span>
  );
}
type Bootstrap = {
  superadmin?: boolean;
  staff?: {
    role: "owner" | "support" | "finance" | "engineering";
    status: "active" | "suspended";
    displayName: string | null;
    permissions: string[];
    aal: "aal1" | "aal2";
  } | null;
  profile: any;
  accounts: any[];
  accountEntitlements?: Record<string, any>;
  workspaces: any[];
  properties: Property[];
  incidents: any[];
  notifications: any[];
  activity?: any[];
  propertyMemberships?: any[];
};
type WorkspaceOption = {
  id: string;
  name: string;
  account_id?: string;
  role: string;
};
type DemoMetrics = {
  pageviews: number;
  events: number;
  audit: number;
  performance: number;
  uptime: string;
  visitors?: number;
  status?: string;
};
type Notify = (message: string) => void;
let activeDisplayTimezone = "Europe/London";
let activeDateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" = "DD/MM/YYYY";

const FALLBACK_TIMEZONES = [
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Vancouver",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];

export function supportedTimezones() {
  try {
    const values = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    return values?.length ? ["UTC", ...values.filter((value) => value !== "UTC")] : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const zones = useMemo(() => supportedTimezones(), []);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {!zones.includes(value) && <option value={value}>{value}</option>}
      {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select>
  );
}
type AnalyticsPageFilters = {
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
type AnalyticsFilterOptions = {
  paths: string[];
  devices: string[];
  sources: string[];
  countries: string[];
  browsers: string[];
  eventNames: string[];
  metrics: string[];
  sourceTypes: string[];
  utmSources: string[];
  utmMediums: string[];
  utmCampaigns: string[];
};
type EventDefinition = {
  id?: string;
  name: string;
  event_type: "click" | "pageview" | "form_success";
  description?: string | null;
  match_settings?: { mode: "exact" | "prefix"; path: string } | null;
  enabled: boolean;
  received?: number;
};
type CustomEventAllowance = {
  plan: "Free" | "Essentials" | "Scale" | "Pro";
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  canCreate: boolean;
};
type EventDefinitionsResponse = {
  events: EventDefinition[];
  allowance: CustomEventAllowance;
};

export function customEventUsageText(allowance: CustomEventAllowance | null) {
  if (!allowance) return "Loading event allowance…";
  return allowance.unlimited
    ? `${allowance.used} events used · Unlimited on Pro`
    : `${allowance.used} of ${allowance.limit} events used`;
}

const SUPERADMIN_NAVIGATION = [
  { label: "Command centre", items: [{ id: "overview", label: "Overview" }] },
  { label: "Customers", items: [
    { id: "accounts", label: "Accounts" },
    { id: "users", label: "Users" },
    { id: "resources", label: "Workspaces & Properties" },
  ] },
  { label: "Commercial", items: [
    { id: "packages", label: "Packages & Rules" },
    { id: "financials", label: "Financials" },
    { id: "coupons", label: "Coupons & Promotions" },
  ] },
  { label: "Operations", items: [
    { id: "audits", label: "Audit Controls" },
    { id: "health", label: "Platform Health" },
    { id: "infrastructure", label: "Infrastructure & Usage" },
    { id: "email", label: "Email & Notifications" },
    { id: "alerts", label: "Alerts" },
    { id: "data", label: "Data & Exports" },
    { id: "administration", label: "Administration" },
  ] },
] as const;

const SUPERADMIN_TABS: Record<string, string[]> = {
  overview: ["Summary", "Customer activity", "Revenue", "Service health"],
  accounts: ["All accounts", "Needs attention", "Scheduled changes"],
  users: ["All users", "Invitations", "Access issues"],
  resources: ["Properties", "Workspaces", "Connection health"],
  packages: ["Packages", "Versions & Grandfathering", "Account overrides", "Subscription rules", "Free account inactivity"],
  financials: ["Overview", "Subscriptions", "Invoices & Payments", "Recovery", "Refunds & Credits", "Revenue analysis", "Reconciliation"],
  coupons: ["Codes", "Discounts", "Redemptions"],
  audits: ["Catalogue", "Configuration", "Check health", "Change history"],
  health: ["Services", "Jobs & Queues", "Errors", "Incidents", "Releases"],
  infrastructure: ["Overview", "Audits", "Workers & Queues", "Browser", "Database & Storage", "Account usage", "Operational controls", "Safety limits"],
  email: ["Overview", "Templates", "Automations", "Campaigns", "Delivery", "Preferences"],
  alerts: ["Active alerts", "Rules", "History", "Weekly digest"],
  data: ["Exports", "Retention", "Cleanup", "Backups & Recovery", "Deletion requests"],
  administration: ["Staff & Permissions", "Customer sessions", "Admin activity", "Settings"],
};

/**
 * Canonical Claritude product surface. Live and deterministic visual-test
 * modes render this same component tree; fixture mode only substitutes an
 * isolated data/action adapter and never reaches production mutation APIs.
 */
export function ClaritudeApplication({
  session,
  data,
  reload,
  fixture = false,
  onSignOut,
}: {
  session: Session | null;
  data: Bootstrap;
  reload: () => void | Promise<void>;
  fixture?: boolean;
  onSignOut: () => void;
}) {
  const loc = useLocation(),
    navigate = useNavigate();
  const [workspaceMenu, setWorkspaceMenu] = useState(false),
    [propertyMenu, setPropertyMenu] = useState(false),
    [userMenu, setUserMenu] = useState(false),
    [mobile, setMobile] = useState(false),
    [alertsSnoozedLocally, setAlertsSnoozedLocally] = useState(false),
    [toast, setToast] = useState(""),
    [addOpen, setAddOpen] = useState(false),
    [workspaceOpen, setWorkspaceOpen] = useState(false),
    [workspaceName, setWorkspaceName] = useState(""),
    [helpOpen, setHelpOpen] = useState(false),
    [appearance, setAppearance] = useState<"light" | "dark">(() =>
      typeof localStorage !== "undefined" && localStorage.getItem("claritude-appearance") === "dark" ? "dark" : "light",
    );
  const toastTimer = useRef<number | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [delegationBanner, setDelegationBanner] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem("claritude-delegation") || "null"); } catch { return null; }
  });
  const allProperties = data.properties;
  const requestedWorkspace = new URLSearchParams(loc.search).get("workspace");
  const requested = new URLSearchParams(loc.search).get("property");
  const platformContext = loc.pathname === "/superadmin";
  const property =
    allProperties.find((p) => p.id === requested) ||
    (!platformContext && loc.pathname !== "/" && loc.pathname !== "/notifications"
      ? allProperties[0]
      : undefined);
  activeDisplayTimezone = property?.settings?.timezone || data.profile?.timezone || "Europe/London";
  activeDateFormat = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(data.profile?.date_format)
    ? data.profile.date_format
    : "DD/MM/YYYY";
  const allWorkspaceMemberships = data.workspaces || [];
  const selectedWorkspaceMembership =
    allWorkspaceMemberships.find(
      (entry: any) => entry.workspaces?.id === requestedWorkspace,
    ) ||
    allWorkspaceMemberships.find(
      (entry: any) => entry.workspaces?.id === property?.workspace_id,
    ) ||
    allWorkspaceMemberships[0];
  const activeAccountId =
    selectedWorkspaceMembership?.workspaces?.account_id ||
    data.accounts?.[0]?.accounts?.id;
  const workspaceMemberships = allWorkspaceMemberships.filter(
    (entry: any) =>
      !activeAccountId ||
      !entry.workspaces?.account_id ||
      entry.workspaces.account_id === activeAccountId,
  );
  const workspace: any = selectedWorkspaceMembership?.workspaces || {
    name: "Websi workspace",
  };
  const currentWorkspaceMembership = workspaceMemberships.find(
    (entry: any) => entry.workspaces?.id === workspace?.id,
  );
  const canManageWorkspace = fixture || ["owner", "member"].includes(currentWorkspaceMembership?.role);
  const activeAccountMembership = data.accounts?.find(
    (entry: any) => entry.accounts?.id === activeAccountId,
  );
  const canManageAccount =
    fixture || ["owner", "member"].includes(activeAccountMembership?.role);
  const eligiblePropertyWorkspaces: WorkspaceOption[] = workspaceMemberships
    .filter((entry: any) => ["owner", "member"].includes(entry.role))
    .map((entry: any) => ({
      id: entry.workspaces.id,
      name: entry.workspaces.name,
      account_id: entry.workspaces.account_id,
      role: entry.role,
    }));
  const properties = workspace?.id
    ? allProperties.filter((item) => item.workspace_id === workspace.id)
    : allProperties;
  const workspaceContext =
    loc.pathname === "/" || (loc.pathname === "/notifications" && !property);
  const section = loc.pathname.split("/")[1] || "workspace";
  const notify: Notify = (message) => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      toastTimer.current = null;
    }, 2500);
  };
  useEffect(
    () => () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    const refreshDelegation = () => {
      try {
        const value = JSON.parse(localStorage.getItem("claritude-delegation") || "null");
        if (value?.expires_at && Date.parse(value.expires_at) <= Date.now()) {
          localStorage.removeItem("claritude-delegation");
          setDelegationBanner(null);
        } else setDelegationBanner(value);
      } catch { setDelegationBanner(null); }
    };
    window.addEventListener("claritude-delegation-change", refreshDelegation);
    const interval = window.setInterval(refreshDelegation, 30_000);
    return () => { window.removeEventListener("claritude-delegation-change", refreshDelegation); window.clearInterval(interval); };
  }, []);
  const href = (path: string, id = property?.id) =>
    `/${path}${id ? `?property=${id}` : ""}`;
  const scopedNotifications = property
    ? data.notifications.filter((notification: any) => notification.property_id === property.id)
    : data.notifications;
  const title = workspaceContext
    ? loc.pathname === "/" ? "Workspace Overview" : "Workspace Notifications"
    : platformContext
      ? "SuperAdmin"
    : section === "account"
      ? "Account settings"
      : section === "settings"
        ? "Property settings"
        : cap(section);
  const alertsSnoozed = alertsSnoozedLocally || Boolean(
    data.profile?.alerts_snoozed_until &&
    new Date(data.profile.alerts_snoozed_until).valueOf() > Date.now(),
  );
  const warning = platformContext || alertsSnoozed
    ? null
    : fixture
    ? {
        title: workspaceContext
          ? "North Commerce monitor alert"
          : "Five unresolved audit issues",
        detail: workspaceContext
          ? "HTTP 503 confirmed 6 minutes ago. The property is currently unavailable."
          : "Critical and warning checks remain unresolved since the latest scan.",
      }
    : property && property.verification_status !== "verified"
      ? {
          title: "Property verification is incomplete",
          detail:
            "Verify ownership to confirm installation and unlock trusted status.",
        }
      : property && !property.tracking_last_received_at
        ? {
            title: "Tracking script not installed",
            detail: "Install the tracking snippet or run the guided test.",
          }
        : scopedNotifications[0]
          ? {
              title: scopedNotifications[0].title,
              detail: scopedNotifications[0].body,
            }
          : null;
  const importantAlertCount = fixture
    ? 5
    : scopedNotifications.filter((notification: any) => !notification.read_at).length || (warning ? 1 : 0);
  function selectProperty(id?: string) {
    setPropertyMenu(false);
    navigate(
      id
        ? href("overview", id)
        : workspace?.id
          ? `/?workspace=${workspace.id}`
          : "/",
    );
  }
  useEffect(() => {
    if (!workspaceMenu && !propertyMenu && !userMenu) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorkspaceMenu(false);
      setPropertyMenu(false);
      setUserMenu(false);
    };
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest(".top-selector, .workspace-menu, .property-menu")) return;
      if (userMenuRef.current?.contains(target)) return;
      setWorkspaceMenu(false);
      setPropertyMenu(false);
      setUserMenu(false);
    };
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", dismissOutside);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismissOutside);
    };
  }, [workspaceMenu, propertyMenu, userMenu]);
  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    localStorage.setItem("claritude-appearance", appearance);
  }, [appearance]);
  async function snoozeAlerts() {
    setAlertsSnoozedLocally(true);
    if (!session) {
      notify("Alerts snoozed for this session");
      return;
    }
    try {
      await api(session, "/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          full_name: data.profile?.full_name,
          timezone: data.profile?.timezone,
          alerts_snoozed_until: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        }),
      });
      notify("Alerts snoozed for 24 hours");
      reload();
    } catch (error: any) {
      notify(`Alerts snoozed for this session. ${error.message}`);
    }
  }
  return (
    <div className="app reference-app">
      <header className="top">
        <button
          className="workspace top-selector"
          aria-label={mobile ? "Close navigation" : "Open navigation or select workspace"}
          aria-expanded={mobile || workspaceMenu}
          onClick={() => {
            if (window.matchMedia("(max-width: 760px)").matches) {
              setWorkspaceMenu(false);
              setMobile((value) => !value);
            } else {
              setPropertyMenu(false);
              setWorkspaceMenu((value) => !value);
            }
          }}
        >
          <Menu className="mobile-toggle" />
          <span className="workspace-identity">
            <img src="/assets/building-complex.svg" alt="" />
          </span>
          <b>{platformContext ? "Claritude platform" : fixture ? "Websi workspace" : workspace.name || "Shared properties"}</b>
          <span className="badge">{platformContext ? "SuperAdmin" : fixture ? "Scale" : "Pro"}</span>
          <img className="selector-chevrons" src="/assets/chevrons-up-down.svg" alt="" />
        </button>
        <button
          className="selector selector-button"
          aria-expanded={propertyMenu}
          disabled={platformContext}
          onClick={() => {
            if (platformContext) return;
            setMobile(false);
            setWorkspaceMenu(false);
            setPropertyMenu((v) => !v);
          }}
        >
          <span className="favicon">
            {property && !platformContext ? (
              <PropertyFavicon property={property} />
            ) : (
              <Globe2 />
            )}
          </span>
          <b>{platformContext ? "All accounts" : property ? property.name : "Your properties"}</b>
          <span className="spacer" />
          <img className="selector-chevrons" src="/assets/chevrons-up-down.svg" alt="" />
        </button>
        <div className="page-title">{title}</div>
        <div className="brand">
          <img className="brand-logo" src="/assets/claritude-logo.svg" alt="Claritude" />
          <img className="brand-mark" src="/assets/claritude-favicon.svg" alt="Claritude" />
        </div>
      </header>
      {workspaceMenu && (
        <WorkspaceMenu
          memberships={workspaceMemberships}
          properties={allProperties}
          active={workspace?.id}
          close={() => setWorkspaceMenu(false)}
          select={(id) => {
            setWorkspaceMenu(false);
            navigate(fixture ? "/" : `/?workspace=${id}`);
          }}
          add={canManageAccount ? () => {
            setWorkspaceMenu(false);
            setWorkspaceOpen(true);
          } : undefined}
        />
      )}
      {propertyMenu && (
        <PropertyMenu
          properties={properties}
          active={property?.id}
          select={selectProperty}
          add={eligiblePropertyWorkspaces.length ? () => {
            setPropertyMenu(false);
            setAddOpen(true);
          } : undefined}
        />
      )}
      <div className="layout">
        <aside
          className={mobile ? "open" : ""}
          onClickCapture={(event) => {
            if ((event.target as Element).closest("a")) setMobile(false);
          }}
        >
          <nav>
            <button
              className="mobile-workspace-link"
              onClick={() => {
                setMobile(false);
                setPropertyMenu(false);
                setWorkspaceMenu(true);
              }}
            >
              <LayoutGrid />
              Switch workspace
            </button>
            {platformContext ? (
              <>
                {SUPERADMIN_NAVIGATION.map((group) => (
                  <div className="superadmin-nav-group" key={group.label}>
                    <b>{group.label}</b>
                    {group.items.map((item) => (
                      <Link
                        className={(new URLSearchParams(loc.search).get("view") || "overview") === item.id ? "active" : ""}
                        to={`/superadmin${item.id === "overview" ? "" : `?view=${item.id}`}`}
                        key={item.id}
                      >
                        <ShieldAlert />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ))}
                <div className="superadmin-nav-group">
                  <b>Workspace</b>
                  <Link to="/"><Home />My workspace</Link>
                </div>
              </>
            ) : workspaceContext ? (
              <>
                <Link
                  className={section === "workspace" ? "active" : ""}
                  to="/"
                >
                  <Home />
                  Workspace Overview
                </Link>
                <Link
                  className={section === "notifications" ? "active" : ""}
                  to="/notifications"
                >
                  <Bell />
                  Workspace Notifications
                </Link>
              </>
            ) : (
              <>
                <Link
                  className={section === "overview" ? "active" : ""}
                  to={href("overview")}
                >
                  <Home />
                  Overview
                </Link>
                <Link
                  className={section === "uptime" ? "active" : ""}
                  to={href("uptime")}
                >
                  <Activity />
                  Uptime
                </Link>
                <Link
                  className={section === "analytics" ? "active" : ""}
                  to={href("analytics")}
                >
                  <BarChart3 />
                  Analytics
                </Link>
                <Link
                  className={section === "audit" ? "active" : ""}
                  to={href("audit")}
                >
                  <ClipboardCheck />
                  Audit
                </Link>
                <Link
                  className={section === "reports" ? "active" : ""}
                  to={href("reports")}
                >
                  <FileChartColumn />
                  Reports
                </Link>
              </>
            )}
          </nav>
          <div className="nav-bottom" ref={userMenuRef}>
            <nav>
              {!workspaceContext && property && canManageWorkspace && (
                <Link
                  className={section === "settings" ? "active" : ""}
                  to={href("settings")}
                >
                  <Settings />
                  Property Settings
                </Link>
              )}
              <button onClick={() => setHelpOpen(true)}>
                <HelpCircle />
                Help &amp; setup
              </button>
            </nav>
            {userMenu && (
              <div className="user-popover">
                <b className="user-popover-heading">Account</b>
                {data.superadmin && (
                  <Link to="/superadmin" onClick={() => setUserMenu(false)}>
                    <ShieldAlert /> SuperAdmin
                  </Link>
                )}
                <Link to={href("account")} onClick={() => setUserMenu(false)}>
                  <Settings /> Account settings
                </Link>
                <Link to="/account?accountTab=Billing%20%26%20plan" onClick={() => setUserMenu(false)}>
                  <Landmark /> Billing &amp; plan
                </Link>
                <b className="user-popover-heading">Appearance</b>
                <button className={appearance === "light" ? "selected" : ""} onClick={() => { setAppearance("light"); setUserMenu(false); }}>
                  <Sun /> Light mode
                </button>
                <button className={appearance === "dark" ? "selected" : ""} onClick={() => { setAppearance("dark"); setUserMenu(false); }}>
                  <Moon /> Dark mode
                </button>
                <b className="user-popover-heading">Other</b>
                <button onClick={() => { setUserMenu(false); setHelpOpen(true); }}>
                  <HelpCircle /> Help
                </button>
                <button onClick={onSignOut}>
                  <LogOut /> Logout
                </button>
              </div>
            )}
            <div className="user">
              <Link className="user-identity" to={href("account")}>
                <ProfileAvatar profile={data.profile} className="user-avatar" />
                <b>{data.profile?.full_name || "Claritude user"}</b>
              </Link>
              <span className="spacer" />
              <button
                className="iconbtn"
                aria-label="Account menu"
                onClick={() => setUserMenu((v) => !v)}
              >
                <MoreHorizontal />
              </button>
              <Link
                className="iconbtn notif-btn"
                aria-label="Notifications"
                to={property ? `/notifications?property=${property.id}` : "/notifications"}
              >
                <Bell />
                {(fixture
                  ? 5
                  : scopedNotifications.filter((notification: any) => !notification.read_at).length
                ) > 0 && (
                  <i className="notif-count">
                    {fixture
                      ? 5
                      : scopedNotifications.filter((notification: any) => !notification.read_at).length}
                  </i>
                )}
              </Link>
            </div>
          </div>
        </aside>
        <main onClick={() => setMobile(false)}>
          {delegationBanner && <div className="delegation-banner" role="status">
            <ShieldAlert />
            <span><b>SuperAdmin Viewing · {delegationBanner.accountName || delegationBanner.account_id}</b><small>Real staff actor retained · representing {delegationBanner.userEmail || delegationBanner.represented_user_id} as {delegationBanner.represented_role} · {delegationBanner.mode === "write" ? "Write enabled" : "Read-only"} · expires {fmtDate(delegationBanner.expires_at)}</small></span>
            <button className="btn" onClick={() => { localStorage.removeItem("claritude-delegation"); setDelegationBanner(null); window.location.assign("/superadmin?view=administration&tab=Customer+sessions"); }}>Back to SuperAdmin</button>
          </div>}
          {warning && (
            <>
              <div className="warning warning-desktop">
                <Link
                  className="important-alerts-link"
                  to={property ? `/notifications?property=${property.id}` : "/notifications"}
                >
                  <i className="dot" />
                  <b>{importantAlertCount} new important {importantAlertCount === 1 ? "alert" : "alerts"}</b>
                </Link>
                <span className="desktop-alert-title">{warning.title}</span>
                <button
                  className="iconbtn snooze-alerts"
                  onClick={snoozeAlerts}
                  aria-label="Snooze alerts for 24 hours"
                  title="Snooze alerts for 24 hours"
                >
                  <BellOff />
                </button>
              </div>
              <div className="warning warning-mobile-compact">
                <Link
                  className="important-alerts-link mobile-important-alerts-link"
                  to={property ? `/notifications?property=${property.id}` : "/notifications"}
                >
                  <i className="dot" />
                  <b>{importantAlertCount} new important {importantAlertCount === 1 ? "alert" : "alerts"}</b>
                </Link>
                <button
                  className="iconbtn mobile-snooze-alerts"
                  onClick={snoozeAlerts}
                  aria-label="Snooze alerts for 24 hours"
                  title="Snooze alerts for 24 hours"
                >
                  <BellOff />
                </button>
              </div>
            </>
          )}
          <Routes>
            <Route
              path="/"
              element={
                <WorkspaceOverview
                  session={session}
                  properties={properties}
                  data={data}
                  fixture={fixture}
                  canManage={canManageWorkspace}
                  openAdd={() => setAddOpen(true)}
                  notify={notify}
                />
              }
            />
            <Route
              path="/notifications"
              element={
                <Notifications
                  session={session}
                  data={data}
                  fixture={fixture}
                  reload={reload}
                  notify={notify}
                  properties={allProperties}
                  propertyId={property?.id}
                />
              }
            />
            <Route
              path="/overview"
              element={
                <PropertyOverview
                  key={property?.id || "no-property"}
                  session={session}
                  property={property}
                  fixture={fixture}
                  notify={notify}
                />
              }
            />
            <Route
              path="/uptime"
              element={
                <UptimeView
                  session={session}
                  property={property}
                  incidents={data.incidents}
                  fixture={fixture}
                  reload={reload}
                  notify={notify}
                />
              }
            />
            <Route
              path="/analytics"
              element={
                <AnalyticsView
                  session={session}
                  property={property}
                  fixture={fixture}
                  notify={notify}
                />
              }
            />
            <Route
              path="/audit"
              element={
                <AuditView
                  session={session}
                  property={property}
                  fixture={fixture}
                  notify={notify}
                />
              }
            />
            <Route
              path="/reports"
              element={
                <ReportsView
                  session={session}
                  property={property}
                  fixture={fixture}
                  notify={notify}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <PropertySettingsView
                  session={session}
                  property={property}
                  reload={reload}
                  notify={notify}
                />
              }
            />
            <Route
              path="/superadmin"
              element={
                data.superadmin && (session || fixture) ? (
                  <SuperAdminView session={session} fixture={fixture} staff={data.staff || null} />
                ) : (
                  <Page title="Access denied" showOptions={false}>
                    <Panel>
                      <Empty title="SuperAdmin access required" detail="This area is restricted to authorised platform administrators." />
                    </Panel>
                  </Page>
                )
              }
            />
            <Route
              path="/account"
              element={
                <AccountView
                  session={session}
                  data={data}
                  fixture={fixture}
                  reload={reload}
                  notify={notify}
                />
              }
            />
          </Routes>
        </main>
      </div>
      {addOpen && eligiblePropertyWorkspaces.length > 0 && (
        <AddPropertyDialog
          session={session}
          accountId={activeAccountId}
          workspaceId={
            eligiblePropertyWorkspaces.some((item) => item.id === workspace?.id)
              ? workspace.id
              : eligiblePropertyWorkspaces[0].id
          }
          workspaces={eligiblePropertyWorkspaces}
          close={() => setAddOpen(false)}
          done={async (created) => {
            setAddOpen(false);
            await reload();
            navigate(`/overview?property=${created.id}&workspace=${created.workspace_id}`);
            notify("Property added");
          }}
        />
      )}
      {workspaceOpen && canManageAccount && (
        <SimpleDialog
          title="Create workspace"
          close={() => setWorkspaceOpen(false)}
          action="Create workspace"
          onSave={async () => {
            if (!session || !workspaceName.trim()) return;
            const accountId = activeAccountId;
            if (!accountId) throw new Error("Account not available");
            const created = await api<{ workspaceId: string }>(session, "/api/workspaces", {
              method: "POST",
              body: JSON.stringify({ accountId, name: workspaceName }),
            });
            setWorkspaceOpen(false);
            setWorkspaceName("");
            await reload();
            navigate(`/?workspace=${created.workspaceId}`);
            notify("Workspace created");
          }}
        >
          <label className="field">
            Workspace name
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
          </label>
        </SimpleDialog>
      )}
      {helpOpen && (
        <HelpDialog close={() => setHelpOpen(false)} property={property} />
      )}{" "}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function filterWorkspaceMemberships(memberships: any[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return memberships;
  return memberships.filter((entry) =>
    String(entry.workspaces?.name || "").toLowerCase().includes(normalized),
  );
}

export function filterProperties(properties: Property[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return properties;
  return properties.filter((property) =>
    `${property.name} ${property.canonical_host}`
      .toLowerCase()
      .includes(normalized),
  );
}

function SelectorAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="selector-action" onClick={onClick}>
      <Plus />
      <span>{children}</span>
    </button>
  );
}

function WorkspaceMenu({
  memberships,
  properties,
  active,
  close,
  select,
  add,
}: {
  memberships: any[];
  properties: Property[];
  active?: string;
  close: () => void;
  select: (id: string) => void;
  add?: () => void;
}) {
  const [query, setQuery] = useState("");
  const rows = filterWorkspaceMemberships(memberships, query);
  return (
    <>
      <button className="menu-scrim" aria-label="Close menu" onClick={close} />
      <div className="menu selector-menu workspace-menu" role="menu">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find Workspace"
          placeholder="Find Workspace"
        />
        <div className="selector-list">
          {rows.map((entry: any) => {
            const candidate = entry.workspaces;
            const count = properties.filter(
              (property) => property.workspace_id === candidate.id,
            ).length;
            return (
              <button
                className="selector-option"
                key={candidate.id}
                onClick={() => select(candidate.id)}
              >
                <span className="workspace-row-icon">
                  <img src="/assets/building-complex.svg" alt="" />
                </span>
                <span>
                  <b>{candidate.name}</b>
                  <small>{count} {count === 1 ? "property" : "properties"}</small>
                </span>
                {candidate.id === active && <Check aria-label="Selected" />}
              </button>
            );
          })}
          {!rows.length && (
            <p className="selector-empty">No workspaces match your search.</p>
          )}
        </div>
        {add && (
          <>
            <div className="menu-divider" />
            <SelectorAction onClick={add}>Add workspace</SelectorAction>
          </>
        )}
      </div>
    </>
  );
}
function PropertyMenu({
  properties,
  active,
  select,
  add,
}: {
  properties: Property[];
  active?: string;
  select: (id?: string) => void;
  add?: () => void;
}) {
  const [q, setQ] = useState("");
  const rows = filterProperties(properties, q);
  return (
    <>
      <button
        className="menu-scrim"
        aria-label="Close menu"
        onClick={() => select(active)}
      />
      <div className="menu selector-menu property-menu" role="menu">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Properties"
          aria-label="Search Properties"
        />
        <button className="selector-option" onClick={() => select()}>
          <LayoutGrid />
          <span>
            <b>Your properties</b>
            <small>{properties.length} properties</small>
          </span>
          {!active && <Check />}
        </button>
        <div className="property-options">
          {rows.map((p) => (
            <button
              className="selector-option"
              key={p.id}
              onClick={() => select(p.id)}
            >
              <span className="favicon project-icon">
                <PropertyFavicon property={p} />
              </span>
              <span>
                <b>{p.name}</b>
                <small>{p.canonical_host}</small>
              </span>
              {p.uptime_monitors?.[0]?.last_status === "offline" ? (
                <i className="status-dot down" />
              ) : p.id === active ? (
                <Check />
              ) : null}
            </button>
          ))}
          {!rows.length && (
            <p className="selector-empty">No properties match your search.</p>
          )}
        </div>
        {add && (
          <>
            <div className="menu-divider" />
            <SelectorAction onClick={add}>Add property</SelectorAction>
          </>
        )}
      </div>
    </>
  );
}

function WorkspaceOverview({
  session,
  properties,
  data,
  fixture,
  canManage,
  openAdd,
  notify,
}: {
  session: Session | null;
  properties: Property[];
  data: Bootstrap;
  fixture: boolean;
  canManage: boolean;
  openAdd: () => void;
  notify: Notify;
}) {
  const workspaceLocation = useLocation();
  const livePeriod = periodQuery(workspaceLocation.search);
  const [tab, setTab] = useState("Properties"),
    [query, setQuery] = useState(""),
    [monitorFilter, setMonitorFilter] = useState("All"),
    [trackingFilter, setTrackingFilter] = useState("All"),
    [accessFilter, setAccessFilter] = useState<"All" | WorkspacePropertyAccess>("All"),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [filterOpen, setFilterOpen] = useState(false),
    [rowMenu, setRowMenu] = useState<string | null>(null),
    [measured, setMeasured] = useState<Record<string, any>>(() =>
      fixture
        ? Object.fromEntries(
            properties.map((property) => [
              property.id,
              {
                ...fixtureAnalytics(property),
                availability: Number.parseFloat(property.demo?.uptime || ""),
              },
            ]),
          )
        : {},
    );
  useEffect(() => {
    if (!filterOpen && !rowMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".filter-action-menu, .toolbar > .btn")) setFilterOpen(false);
      if (!target.closest(".row-action-wrap")) setRowMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFilterOpen(false); setRowMenu(null); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [filterOpen, rowMenu]);
  useEffect(() => {
    if (fixture || !session || !properties.length) return;
    let cancelled = false;
    Promise.all(
      properties.map(async (property) => {
        try {
          const monitor = property.uptime_monitors?.[0];
          const [summary, checks] = await Promise.all([
            api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&view=overview`),
            monitor
              ? api<any>(session, `/api/monitors/${monitor.id}/checks?${livePeriod}`)
              : Promise.resolve(null),
          ]);
          return [
            property.id,
            {
              ...summary,
              availability: checks?.summary?.availability ?? null,
              performanceScore: webVitalsScore(summary.vitals),
            },
          ] as const;
        } catch {
          return [property.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setMeasured(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [fixture, session, properties.map((property) => property.id).join(","), livePeriod]);
  const workspaceRoles = new Map(
    (data.workspaces || []).map((entry: any) => [entry.workspaces?.id, entry.role]),
  );
  const propertyAccess = (property: Property): WorkspacePropertyAccess =>
    workspaceRoles.get(property.workspace_id) === "viewer" ? "shared" : "workspace";
  const filtered = sortWorkspaceProperties(properties.filter(
    (p) =>
      (p.name + p.canonical_host).toLowerCase().includes(query.toLowerCase()) &&
      (monitorFilter === "All" || p.uptime_monitors?.[0]?.last_status === monitorFilter) &&
      (trackingFilter === "All" || (trackingFilter === "receiving" ? Boolean(p.tracking_last_received_at) : !p.tracking_last_received_at)) &&
      (accessFilter === "All" || propertyAccess(p) === accessFilter),
  ));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totals = properties.reduce(
    (a, p) => ({
      views: a.views + (measured[p.id]?.pageviews || 0),
      events: a.events + workspaceKeyEventCount(measured[p.id]),
    }),
    { views: 0, events: 0 },
  );
  const workspaceSeries = Array.from(
        Object.values(measured).reduce((days: Map<string, number>, summary: any) => {
          for (const point of summary?.series || [])
            days.set(point.day, (days.get(point.day) || 0) + Number(point.pageviews || 0));
          return days;
        }, new Map<string, number>()),
      ).map(([label, value]) => ({ label, value }));
  return (
    <Page
      title="Workspace Overview"
      status={<Period />}
      actions={
        <button className="primary" onClick={openAdd} disabled={!canManage}>
          <Plus />
          Add property
        </button>
      }
    >
      <Tabs
        labels={["Properties", "Traffic", "Incidents", "Reports", "Members"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Properties" ? (
        <div className="workspace-properties-layout">
          <Metrics
            values={[
              [
                "Properties",
                properties.length,
                "",
              ],
              [
                "Properties down",
                properties.filter(
                  (p) => p.uptime_monitors?.[0]?.last_status === "offline",
                ).length,
                fixture ? "North Commerce" : "",
              ],
              [
                "Pageviews",
                fmt(totals.views),
                fixture ? "↗ 12.8%" : "",
              ],
              [
                "Key events",
                fmt(totals.events),
                fixture ? "↗ 8.2%" : "",
              ],
            ]}
          />
          <Panel>
            <div className="toolbar">
              <button
                className="btn"
                onClick={() => setFilterOpen((value) => !value)}
              >
                <Filter />
                Add filter
              </button>
              {filterOpen && (
                <div className="action-menu filter-action-menu workspace-filter-menu">
                  <b>Monitor status</b>
                  {["All", "online", "offline", "paused", "pending"].map((value) => (
                    <button
                      key={value}
                      className={monitorFilter === value ? "selected" : ""}
                      onClick={() => { setMonitorFilter(value); setPage(1); setFilterOpen(false); }}
                    >
                      <Status value={value} />
                      {monitorFilter === value && <Check />}
                    </button>
                  ))}
                  <span className="menu-separator" />
                  <b>Tracking status</b>
                  {[["All", "All"], ["receiving", "Receiving data"], ["not_installed", "Not installed"]].map(([value, label]) => (
                    <button
                      key={value}
                      className={trackingFilter === value ? "selected" : ""}
                      onClick={() => { setTrackingFilter(value); setPage(1); setFilterOpen(false); }}
                    >
                      {label}
                      {trackingFilter === value && <Check />}
                    </button>
                  ))}
                  <span className="menu-separator" />
                  <b>Property access</b>
                  {[["All", "All access"], ["workspace", "Workspace properties"], ["shared", "Shared with me"]].map(([value, label]) => (
                    <button
                      key={value}
                      className={accessFilter === value ? "selected" : ""}
                      onClick={() => { setAccessFilter(value as "All" | WorkspacePropertyAccess); setPage(1); setFilterOpen(false); }}
                    >
                      {label}
                      {accessFilter === value && <Check />}
                    </button>
                  ))}
                </div>
              )}
              <div className="search">
                <Search />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search properties"
                />
              </div>
              {monitorFilter !== "All" && (
                <span className="filter-chip">
                  Monitor: {cap(monitorFilter)}{" "}
                  <button onClick={() => setMonitorFilter("All")}>
                    <X />
                  </button>
                </span>
              )}
              {trackingFilter !== "All" && (
                <span className="filter-chip">
                  Tracking: {trackingFilter === "receiving" ? "Receiving data" : "Not installed"}{" "}
                  <button onClick={() => setTrackingFilter("All")}><X /></button>
                </span>
              )}
              {accessFilter !== "All" && (
                <span className="filter-chip">
                  Access: {accessFilter === "workspace" ? "Workspace properties" : "Shared with me"}{" "}
                  <button onClick={() => setAccessFilter("All")}><X /></button>
                </span>
              )}
            </div>
            <DataTable
              headers={[
                "Property",
                "Monitor status",
                "Uptime",
                "Tracking status",
                "Pageviews",
                "Key events",
                "Audit",
                "Performance",
                "",
              ]}
              rows={shown.map((p) => [
                <Link
                  className="project-cell"
                  to={`/overview?property=${p.id}`}
                >
                  <span className="favicon project-icon">
                    <PropertyFavicon property={p} />
                  </span>
                  <span>
                    <b>{p.name}</b>
                    <small>{p.canonical_host}</small>
                  </span>
                </Link>,
                <Status
                  value={p.uptime_monitors?.[0]?.last_status || "pending"}
                />,
                measured[p.id]?.availability != null
                  ? formatPercentage(Number(measured[p.id].availability))
                  : "Pending",
                <TrackingStatus receiving={Boolean(p.tracking_last_received_at)} />,
                measured[p.id] ? fmt(measured[p.id].pageviews || 0) : "Pending",
                measured[p.id]
                  ? fmt(workspaceKeyEventCount(measured[p.id]))
                  : "Pending",
                p.audit_runs?.[0]?.score
                  ? `${p.audit_runs[0].score} / 100`
                  : "—",
                scoreState(
                  measured[p.id]?.performanceScore ??
                    webVitalsScore(measured[p.id]?.vitals),
                  "Awaiting field data",
                ),
                <span className="row-action-wrap">
                  <button
                    className="iconbtn"
                    aria-label={`${p.name} actions`}
                    aria-expanded={rowMenu === p.id}
                    onClick={() => setRowMenu(rowMenu === p.id ? null : p.id)}
                  >
                    <MoreHorizontal />
                  </button>
                  {rowMenu === p.id && (
                    <span className="action-menu row-action-menu">
                      <Link to={`/overview?property=${p.id}`}>Open overview</Link>
                      <Link to={`/audit?property=${p.id}`}>Run audit</Link>
                      <Link to={`/reports?property=${p.id}`}>Create report</Link>
                      <Link to={`/settings?property=${p.id}`}>Property settings</Link>
                      <button onClick={() => { setRowMenu(null); notify("Open Monitor settings to pause this property safely"); }}>Pause monitoring</button>
                    </span>
                  )}
                </span>,
              ])}
            />
            <div className="pagination-row">
              <span>
                Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–
                {Math.min(page * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="pagination pagination-controls">
                <button onClick={() => setPage(Math.max(1, page - 1))}>
                  <ChevronLeft />
                </button>
                {Array.from(
                  { length: Math.max(1, Math.ceil(filtered.length / pageSize)) },
                  (_, i) => (
                    <button
                      className={page === i + 1 ? "active" : ""}
                      onClick={() => setPage(i + 1)}
                      key={i}
                    >
                      {i + 1}
                    </button>
                  ),
                )}
                <button
                  onClick={() =>
                    setPage(Math.min(Math.max(1, Math.ceil(filtered.length / pageSize)), page + 1))
                  }
                >
                  <ChevronRight />
                </button>
              </div>
              <label className="pagination-size">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25, 50, 100].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
            </div>
          </Panel>
          <Panel
            title="Workspace traffic"
            actions={<ChartSwitch notify={notify} />}
          >
            <SeriesChart points={workspaceSeries} emptyTitle="No measured workspace traffic yet" />
          </Panel>
        </div>
      ) : tab === "Traffic" ? (
        <Panel
          title="Workspace traffic"
          actions={<ChartSwitch notify={notify} />}
        >
          <Metrics
            values={[
              [
                "Pageviews",
                fmt(totals.views),
                "Current period",
              ],
              [
                "Key events",
                fmt(totals.events),
                "Current period",
              ],
              [
                "Properties receiving",
                properties.filter((p) => p.tracking_last_received_at).length,
                "Active tracking",
              ],
              ["Period", "30 days", `${shortDate(new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10))} – ${shortDate(new Date().toISOString().slice(0, 10))}`],
            ]}
          />
          <SeriesChart points={workspaceSeries} emptyTitle="No measured workspace traffic yet" />
        </Panel>
      ) : tab === "Incidents" ? (
        <IncidentTable
          incidents={
            fixture
              ? [
                  {
                    property: "North Commerce",
                    opened_at: new Date().toISOString(),
                    cause: "HTTP 503",
                    resolved_at: null,
                  },
                  ...data.incidents,
                ]
              : data.incidents
          }
        />
      ) : tab === "Reports" ? (
        <Panel title="Workspace reports">
          <Empty
            title="No workspace reports saved"
            detail="Create property reports from the Reports section."
          />
        </Panel>
      ) : (
        <Panel title="Members">
          <DataTable
            headers={["Member", "Role", "Property access", "Status"]}
            rows={[
              [
                data.profile?.full_name || "Current user",
                "Account holder",
                "All properties",
                "Active",
              ],
            ]}
          />
        </Panel>
      )}
    </Page>
  );
}

function Notifications({
  session,
  data,
  fixture,
  reload,
  notify,
  properties,
  propertyId,
}: {
  session: Session | null;
  data: Bootstrap;
  fixture: boolean;
  reload: () => void;
  notify: Notify;
  properties: Property[];
  propertyId?: string;
}) {
  const notificationLocation = useLocation();
  const notificationNavigate = useNavigate();
  const [scope, setScope] = useState("All"),
    [status, setStatus] = useState("All statuses"),
    [selectedProperty, setSelectedProperty] = useState(propertyId || "");
  useEffect(() => setSelectedProperty(propertyId || ""), [propertyId]);
  const fixtureItems = fixture
    ? [
        { id: "f1", title: "Monitor alert", body: "North Commerce returned HTTP 503 and is currently unavailable.", category: "monitoring", created_at: new Date().toISOString(), read_at: null },
        { id: "f2", title: "Audit issues", body: "Five unresolved audit findings need review.", category: "audits", created_at: new Date().toISOString(), read_at: null },
      ]
    : [];
  const source = (fixture ? fixtureItems : data.notifications).filter((notification: any) =>
    !selectedProperty || notification.property_id === selectedProperty,
  );
  const items = source.filter((notification: any) => {
    const category = String(notification.category || "account").toLowerCase();
    const scopeMatch =
      scope === "All" ||
      (scope === "Unread" && !notification.read_at) ||
      (scope === "Monitoring" && ["monitoring", "monitor_incidents", "recoveries"].includes(category)) ||
      (scope === "Audits" && ["audits", "audit_issues"].includes(category)) ||
      (scope === "Analytics" && ["analytics", "tracking_problems"].includes(category)) ||
      (scope === "Account" && category === "account");
    const statusMatch =
      status === "All statuses" ||
      (status === "Unread" && !notification.read_at) ||
      (status === "Read" && Boolean(notification.read_at));
    return scopeMatch && statusMatch;
  });
  async function markRead(id: string) {
    if (!session) return;
    try {
      await api(session, `/api/notifications/${id}/read`, { method: "PATCH" });
      reload();
      notify("Notification marked as read");
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function markAllRead() {
    if (!session) return;
    try {
      const result = await api<{ updated: number }>(session, "/api/notifications/read-all", {
        method: "POST",
        body: JSON.stringify({ propertyId: selectedProperty || null }),
      });
      reload();
      notify(`${result.updated} notifications marked as read`);
    } catch (error: any) {
      notify(error.message);
    }
  }
  return (
    <Page
      title="Notifications"
      actions={
        <button
          className="btn"
          onClick={markAllRead}
          disabled={!session || !items.some((notification: any) => !notification.read_at)}
        >
          <Check />
          Mark all read
        </button>
      }
    >
      <Tabs
        labels={[
          "All",
          "Unread",
          "Monitoring",
          "Audits",
          "Analytics",
          "Account",
        ]}
        value={scope}
        onChange={setScope}
      />
      <Panel title="Notification centre">
        <div className="notification-filter-row">
          <Filter />
          <label>
            Property
            <select
              value={selectedProperty}
              onChange={(event) => {
                const nextProperty = event.target.value;
                setSelectedProperty(nextProperty);
                const next = new URLSearchParams(notificationLocation.search);
                if (nextProperty) next.set("property", nextProperty);
                else next.delete("property");
                notificationNavigate(`${notificationLocation.pathname}${next.size ? `?${next}` : ""}`);
              }}
            >
              <option value="">All properties</option>
              {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>All statuses</option>
              <option>Unread</option>
              <option>Read</option>
            </select>
          </label>
          <small className="subtle">{items.length} notifications</small>
        </div>
        {items.length ? (
          items.map((notification: any) => (
            <div className="notification-card" key={notification.id}>
              <CircleAlert />
              <span>
                <b>{notification.title}</b>
                <small>
                  {notification.body}{" "}
                  <i className="notification-property-tag">
                    {properties.find((item) => item.id === notification.property_id)?.name || cap(notification.category || "account")}
                  </i>
                </small>
                <small>{relative(notification.created_at)}</small>
              </span>
              <button
                className="btn"
                onClick={() => markRead(notification.id)}
                disabled={!session || Boolean(notification.read_at)}
              >
                {notification.read_at ? "Read" : "Mark read"}
              </button>
            </div>
          ))
        ) : (
          <Empty
            title="No notifications"
            detail="Monitoring, audit and account alerts appear here."
          />
        )}
      </Panel>
    </Page>
  );
}

function PropertyOverview({
  session,
  property,
  fixture,
  notify,
}: {
  session: Session | null;
  property?: Property;
  fixture: boolean;
  notify: Notify;
}) {
  const overviewLocation = useLocation();
  const navigate = useNavigate();
  const livePeriod = `${periodQuery(overviewLocation.search)}&time_zone=${encodeURIComponent(property?.settings?.timezone || "Europe/London")}`;
  const [tab, setTab] = useState("Overview"),
    [trafficMetric, setTrafficMetric] = useState<TrafficMetric>("Pageviews"),
    [analytics, setAnalytics] = useState<any>(null),
    [analyticsLoading, setAnalyticsLoading] = useState(!fixture),
    [latestAudit, setLatestAudit] = useState<AuditRun | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (session && property) {
      setAnalytics(null);
      setLatestAudit(null);
      setAnalyticsLoading(true);
      api<{ analytics: any; audit: AuditRun | null }>(
        session,
        `/api/properties/${property.id}/overview?${livePeriod}`,
        { signal: controller.signal },
      )
        .then((overview) => {
          setAnalytics(overview.analytics);
          setLatestAudit(overview.audit);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setAnalytics(null);
          setLatestAudit(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setAnalyticsLoading(false);
        });
    } else if (property && fixture) {
      const fixtureSummary = fixtureAnalytics(property);
      setAnalytics(fixtureSummary);
      setAnalyticsLoading(false);
      setLatestAudit(fixtureAudit(property));
    }
    return () => controller.abort();
  }, [property?.id, session, fixture, livePeriod]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Choose a property to open its overview."
      />
    );
  const monitor = property.uptime_monitors?.[0],
    audit = latestAudit || property.audit_runs?.[0],
    views = analytics?.pageviews || 0,
    sessions = fixture ? property.demo?.visitors || 0 : analytics?.sessions || 0,
    mobileScore = fixture
      ? analytics?.mobilePerformanceScore
      : webVitalsScore(analytics?.performanceByDevice?.mobile?.vitals),
    desktopScore = fixture
      ? analytics?.desktopPerformanceScore
      : webVitalsScore(analytics?.performanceByDevice?.desktop?.vitals),
    seoScore =
      audit?.category_scores?.SEO ??
      auditCategoryScore(audit?.user_facing_results || audit?.audit_results, ["SEO"]),
    vitalRows = (analytics?.vitals || []).map((vital: any) => {
      const value = formatVital(vital.name, vital.value);
      const target = performanceTargetLabel(vital.name);
      return [
        <MetricTerm key={`${vital.name}-term`} term={vital.name} />,
        value,
        <PerformanceTarget key={`${vital.name}-target`} metric={vital.name} value={value} target={target} />,
        fmt(vital.samples || 0),
      ];
    });
  const currentStatus = fixture ? property.demo?.status : monitor?.last_status;
  const analyticsHref = `/analytics?property=${property.id}&${livePeriod}`;
  const analyticsTabHref = (analyticsTab: string) => `${analyticsHref}&analyticsTab=${analyticsTab}`;
  const uptimeHref = `/uptime?property=${property.id}&${livePeriod}`;
  const overviewMetrics: ReactNode[][] = [
    [
      "Uptime",
      <Link className="metric-value-link" to={uptimeHref}>
        <span className={`property-uptime-status ${currentStatus === "online" ? "online" : currentStatus === "offline" ? "offline" : "pending"}`}>
          {currentStatus === "online" ? "Online" : currentStatus === "offline" ? "Offline" : cap(currentStatus || "Pending")}
        </span>
      </Link>,
      fixture
        ? "35 min estimated downtime"
        : monitor?.last_checked_at
          ? `Checked ${relative(monitor.last_checked_at)}`
          : "Awaiting first check",
    ],
    [
      "Pageviews",
      <Link className="metric-value-link" to={analyticsHref}>{analyticsLoading ? "—" : fmt(views)}</Link>,
      fixture ? "↑ 12.4%" : <MetricComparison current={analytics?.pageviews} previous={analytics?.previous?.pageviews} />,
    ],
    [
      "Sessions",
      <Link className="metric-value-link" to={analyticsHref}>{analyticsLoading ? "—" : fmt(sessions)}</Link>,
      fixture ? "Anonymous visits in this period" : <MetricComparison current={analytics?.sessions} previous={analytics?.previous?.sessions} />,
    ],
    [
      "Events",
      <Link className="metric-value-link" to={analyticsTabHref("Events")}>{analyticsLoading ? "—" : fmt(analytics?.keyEvents || 0)}</Link>,
      fixture ? "1.3% of pageviews" : <MetricComparison current={analytics?.keyEvents} previous={analytics?.previous?.keyEvents} />,
    ],
  ];
  return (
    <Page
      title="Property overview"
      status={tab === "Overview" ? <Period /> : undefined}
      showOptions={tab === "Overview"}
      relocateMobileControls={tab === "Overview"}
      actions={
        <Link className="primary" to={`/audit?property=${property.id}`}>
          <RefreshCw />
          Run audit
        </Link>
      }
    >
      {(mobilePageControls) => (
        <>
          <Tabs
            labels={["Overview", "Activity", "Setup"]}
            value={tab}
            onChange={(nextTab) => {
              if (nextTab === "Setup") navigate(`/settings?property=${property.id}&settingsTab=Tracking`);
              else setTab(nextTab);
            }}
          />
          {tab === "Overview" ? (
            <>
          <div className="property-overview-metrics-desktop">
            <Metrics values={overviewMetrics} />
          </div>
          <div className="grid">
            <div>
              <Panel
                title="Traffic"
                actions={<ChartSwitch notify={notify} events value={trafficMetric} onChange={setTrafficMetric} />}
              >
                {mobilePageControls}
                {analyticsLoading ? (
                  <div className="audit-results-loading" role="status">
                    <RefreshCw className="audit-spin" /> Loading {property.name} analytics
                  </div>
                ) : (
                  <SeriesChart
                    points={(analytics?.series || []).map((point: any) => ({
                      label: point.day,
                      value: point[trafficSeriesKey(trafficMetric)] || 0,
                    }))}
                    emptyTitle="No measured property traffic yet"
                    unit={trafficMetric === "Events" ? " events" : ""}
                    label={`${trafficMetric} by day`}
                  />
                )}
              </Panel>
              <div className="property-overview-metrics-mobile">
                <Metrics values={overviewMetrics} />
              </div>
              <Panel title={<Link className="panel-title-link" to={`/audit?property=${property.id}`}>Website health</Link>}>
                <div className="health-metrics">
                  <Metric
                    label="Overall"
                    value={audit?.score == null ? "—" : <>{audit.score}<small className="health-score-total"> /100</small></>}
                  />
                  <Metric label="Mobile" value={analyticsLoading ? "—" : propertyHealthScoreValue(mobileScore, "Awaiting field data")} />
                  <Metric label="Desktop" value={analyticsLoading ? "—" : propertyHealthScoreValue(desktopScore, "Awaiting field data")} />
                  <Metric label="SEO" value={propertyHealthScoreValue(seoScore, audit ? "Not implemented by this audit run" : "Awaiting audit")} />
                </div>
                <div className="settings-actions">
                  <Link className="btn" to={`/audit?property=${property.id}`}>
                    Review audit
                  </Link>
                  <Link
                    className="btn"
                    to={analyticsTabHref("Performance")}
                  >
                    View performance
                  </Link>
                </div>
              </Panel>
            </div>
            <div>
              <Panel title="Real-user performance">
                {analyticsLoading ? (
                  <div className="audit-results-loading" role="status">
                    <RefreshCw className="audit-spin" /> Loading performance data
                  </div>
                ) : vitalRows.length ? (
                  <>
                    <DataTable
                      headers={["Metric", "Result", "Target", "Samples"]}
                      rows={vitalRows}
                    />
                    <p className="subtle">Combined desktop and mobile 75th-percentile field measurements for the selected period.</p>
                  </>
                ) : (
                  <EmptyCompact
                    title="No Core Web Vitals samples"
                    detail="This is pending field data, not an estimated score."
                  />
                )}
              </Panel>
              <Panel title={<Link className="panel-title-link" to={analyticsTabHref("Pages")}>Top pages</Link>}>
                {analyticsLoading ? (
                  <div className="audit-results-loading" role="status">
                    <RefreshCw className="audit-spin" /> Loading top pages
                  </div>
                ) : analytics?.pages?.length ? (
                  <DataTable
                    className="property-top-pages-table"
                    headers={["Page", "Views"]}
                    rows={analytics.pages
                      .slice(0, 5)
                      .map((p: any) => [p.path, fmt(p.pageviews || 0)])}
                  />
                ) : (
                  <EmptyCompact
                    title="No page data yet"
                    detail="Install tracking to identify top pages."
                  />
                )}
                <Link className="btn property-top-pages-action" to={analyticsTabHref("Pages")}>
                  View all pages
                </Link>
              </Panel>
            </div>
          </div>
            </>
          ) : tab === "Activity" ? (
            <Panel title="Recent property activity">
              <ActivityList property={property} />
            </Panel>
          ) : null}
        </>
      )}
    </Page>
  );
}

function UptimeView({
  session,
  property,
  incidents,
  fixture,
  reload,
  notify,
}: {
  session: Session | null;
  property?: Property;
  incidents: any[];
  fixture: boolean;
  reload: () => void;
  notify: Notify;
}) {
  const uptimeLocation = useLocation();
  const reportTimeZone = property?.settings?.timezone || "Europe/London";
  const livePeriod = `${uptimePeriodQuery(uptimeLocation.search)}&time_zone=${encodeURIComponent(reportTimeZone)}`;
  const [tab, setTab] = useState("Overview"),
    [busy, setBusy] = useState(false),
    [maintenance, setMaintenance] = useState<any[]>([]),
    [dialog, setDialog] = useState(false),
    [maintenanceName, setMaintenanceName] = useState("Planned update"),
    [maintenanceStart, setMaintenanceStart] = useState(() => {
      const date = new Date(Date.now() + 24 * 60 * 60_000);
      return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    }),
    [maintenanceHours, setMaintenanceHours] = useState(1),
    [incidentData, setIncidentData] = useState<any[]>(incidents),
    [checkData, setCheckData] = useState<any>(null),
    [uptimeError, setUptimeError] = useState(""),
    [chartMenuOpen, setChartMenuOpen] = useState(false),
    [showPreviousChecks, setShowPreviousChecks] = useState(false);
  const loadMaintenance = () => {
    if (!session || !property?.uptime_monitors?.[0]) return Promise.resolve();
    return api<any[]>(
      session,
      `/api/monitors/${property.uptime_monitors[0].id}/maintenance`,
    ).then((rows) =>
      setMaintenance(
        rows.map((row) => [
          row.reason || "Planned maintenance",
          fmtDate(row.starts_at),
          property.settings?.timezone || "Europe/London",
          new Date(row.ends_at).valueOf() > Date.now() ? "Suppressed" : "Complete",
        ]),
      ),
    );
  };
  useEffect(() => {
    if (session && property?.uptime_monitors?.[0])
      Promise.all([
        api<any>(
          session,
          `/api/monitors/${property.uptime_monitors[0].id}/checks?${livePeriod}`,
        ),
        api<any[]>(session, `/api/properties/${property.id}/incidents?${livePeriod}`),
      ])
        .then(([checks, storedIncidents]) => {
          setCheckData(checks);
          setIncidentData(storedIncidents);
          setUptimeError("");
        })
        .catch((error: any) => {
          setCheckData(null);
          setIncidentData([]);
          setUptimeError(error.message || "Uptime data could not be loaded");
        });
    else if (fixture) {
      const fixtureStart = new Date("2026-09-01T09:00:00.000Z").valueOf();
      const checks = Array.from({ length: 60 }, (_, i) => ({
        checked_at: new Date(fixtureStart + i * 12 * 60 * 60_000).toISOString(),
        response_ms: 168 + ((i * 37) % 190),
        success: i !== 25,
        status_code: i === 25 ? 500 : 200,
      }));
      setCheckData({
        responseSeries: checks.map((check) => ({ label: check.checked_at, value: check.response_ms, samples: 1 })),
        responseBucket: "day",
        latestCheck: checks.at(-1),
        summary: { total: 60, successful: 59, availability: 99.92, averageResponseMs: 246, medianResponseMs: 231, highestResponseMs: 357 },
        previous: {
          responseSeries: checks.map((check) => ({ label: check.checked_at, value: Math.round(check.response_ms * 1.18), samples: 1 })),
          responseBucket: "day",
          summary: { availability: 99.9, averageResponseMs: 300, medianResponseMs: 284, highestResponseMs: 710 },
        },
        days: Array.from({ length: 30 }, (_, i) => {
          const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
          const incident = i === 13
            ? {
                id: "fixture-timeout",
                cause: "Timeout incident",
                opened_at: "2026-09-14T01:20:00.000Z",
                resolved_at: "2026-09-14T01:35:00.000Z",
                deliveries: [
                  { kind: "uptime_down", status: "sent" },
                  { kind: "uptime_recovered", status: "sent" },
                ],
              }
            : i === 25
              ? {
                  id: "fixture-http-500",
                  cause: "HTTP 500 incident",
                  opened_at: "2026-09-26T01:20:00.000Z",
                  resolved_at: "2026-09-26T01:40:00.000Z",
                  deliveries: [
                    { kind: "uptime_down", status: "sent" },
                    { kind: "uptime_recovered", status: "sent" },
                  ],
                }
              : null;
          return {
            day,
            total: 288,
            successful: incident ? 284 : 288,
            status: incident ? "incident" : "available",
            statusCode: incident ? 500 : 200,
            incidents: incident ? [incident] : [],
          };
        }),
        dailyScope: { timeZone: "Europe/London" },
      });
    }
  }, [property?.id, property?.uptime_monitors?.[0]?.last_checked_at, session, fixture, livePeriod]);
  useEffect(() => {
    void loadMaintenance().catch(() => setMaintenance([]));
  }, [property?.id, session]);
  if (!property)
    return (
      <Empty title="Select a property" detail="Uptime is property-specific." />
    );
  const monitor = property.uptime_monitors?.[0],
    relevant = fixture
      ? [
          {
            id: "i1",
            property_id: property.id,
            opened_at: new Date(Date.now() - 7 * 864e5).toISOString(),
            resolved_at: new Date(
              Date.now() - 7 * 864e5 + 1200000,
            ).toISOString(),
            cause: "HTTP 500",
          },
          {
            id: "i2",
            property_id: property.id,
            opened_at: new Date(Date.now() - 19 * 864e5).toISOString(),
            resolved_at: new Date(Date.now() - 19 * 864e5 + 900000).toISOString(),
            cause: "Timeout",
          },
        ]
      : incidentData.filter((incident: any) => incident.property_id === property.id);
  const selectedRangeStart = Date.parse(
    checkData?.range?.from || new Date(Date.now() - 29 * 864e5).toISOString(),
  );
  const selectedRangeEnd = Date.parse(checkData?.range?.to || new Date().toISOString());
  const resolvedIncidents = relevant.filter((incident) => {
    const resolvedAt = Date.parse(incident.resolved_at || "");
    return Number.isFinite(resolvedAt) && resolvedAt >= selectedRangeStart && resolvedAt <= selectedRangeEnd;
  });
  const incidentSummary = estimateIncidentDowntime(
    relevant,
    checkData?.range?.from || new Date(Date.now() - 29 * 864e5).toISOString(),
    checkData?.range?.to || new Date().toISOString(),
  );
  const latestCheck = checkData?.latestCheck;
  const availabilityDelta = metricDelta(
    checkData?.summary?.availability,
    checkData?.previous?.summary?.availability,
    "percentage points",
  );
  const responseDelta = metricDelta(
    checkData?.summary?.averageResponseMs,
    checkData?.previous?.summary?.averageResponseMs,
    "percent",
    true,
  );
  const observedStatus = latestCheck
    ? latestCheck.success ? "online" : "offline"
    : monitor?.last_status || "pending";
  async function check() {
    if (!monitor) return;
    setBusy(true);
    try {
      if (session)
        await api(session, `/api/monitors/${monitor.id}/check`, {
          method: "POST",
        });
      notify("Uptime check completed");
      if (session)
        setCheckData(
          await api(
            session,
            `/api/monitors/${monitor.id}/checks?${livePeriod}`,
          ),
        );
      if (session)
        setIncidentData(
          await api(session, `/api/properties/${property!.id}/incidents?${livePeriod}`),
        );
      reload();
    } catch (e: any) {
      notify(e.message);
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Uptime"
      status={
        <>
          <span className={`online-label ${observedStatus}`}>
            <i className={`status-dot ${observedStatus === "online" ? "online" : observedStatus === "offline" ? "down" : "paused"}`} />
            {observedStatus === "online" ? "Online" : observedStatus === "offline" ? "Offline" : cap(observedStatus)}
          </span>
          <Period defaultDays={1} />
        </>
      }
      actions={
        <button className="primary" onClick={check} disabled={busy || !monitor}>
          <RefreshCw />
          {busy ? "Checking…" : "Check now"}
        </button>
      }
    >
      <Tabs
        labels={["Overview", "Incidents", "Maintenance"]}
        value={tab}
        onChange={setTab}
      />
      {uptimeError && <div className="error-box">Uptime data failed to load: {uptimeError}</div>}
      {tab === "Overview" ? (
        <>
          <Metrics
            values={[
              [
                "Availability",
                fixture
                  ? "99.92%"
                  : checkData?.summary?.availability != null
                    ? formatPercentage(checkData.summary.availability)
                    : "—",
                availabilityDelta || "Selected period",
              ],
              [
                "Average response",
                checkData?.summary?.averageResponseMs != null
                  ? `${checkData.summary.averageResponseMs} ms`
                  : "—",
                responseDelta || "Successful checks",
              ],
              [
                "Resolved incidents",
                uptimeError ? "Unavailable" : resolvedIncidents.length,
                uptimeError ? "Request failed" : `${relevant.length - resolvedIncidents.length} ongoing in range`,
              ],
              [
                "Estimated downtime",
                uptimeError ? "Unavailable" : relevant.length ? formatDuration(incidentSummary.milliseconds) : checkData?.summary?.total ? "0 min" : "—",
                uptimeError
                  ? "Request failed"
                  : !checkData?.summary?.total
                    ? "No monitoring data in this range"
                    : relevant.length
                      ? "Estimated from monitoring observations; overlaps counted once"
                      : "No recorded incidents during monitored coverage",
              ],
            ]}
          />
          <Panel
            title="Response time"
            actions={
              <>
                <span className="response-statistics">
                  <span tabIndex={0} title="Middle successful, unsuppressed response in the selected range. Even-sized samples average the two middle values.">
                    Median <b>{checkData?.summary?.medianResponseMs ?? "—"} ms</b>
                  </span>
                  <span tabIndex={0} title="Highest successful, unsuppressed measured response in the selected range. Timeouts and missing values are excluded.">
                    Highest <b>{checkData?.summary?.highestResponseMs ?? "—"} ms</b>
                  </span>
                </span>
                <span className="chart-menu-wrap">
                  <button className="iconbtn" aria-label="Response chart options" aria-expanded={chartMenuOpen} onClick={() => setChartMenuOpen((value) => !value)}>
                    <MoreHorizontal />
                  </button>
                  {chartMenuOpen && (
                    <span className="action-menu chart-context-menu" role="menu">
                      <button onClick={() => { setShowPreviousChecks((value) => !value); setChartMenuOpen(false); }}>
                        {showPreviousChecks ? "Hide" : "Show"} previous period
                      </button>
                      <button onClick={() => {
                        downloadSeriesCsv(
                          checkData?.responseSeries || [],
                          "uptime-response-time.csv",
                          responseChartLabel(checkData?.responseBucket, true),
                        );
                        setChartMenuOpen(false);
                      }}>Download CSV</button>
                    </span>
                  )}
                </span>
              </>
            }
          >
            <SeriesChart
              points={checkData?.responseSeries || []}
              previousPoints={showPreviousChecks
                ? checkData?.previous?.responseSeries || []
                : []}
              unit="ms"
              label={responseChartLabel(checkData?.responseBucket)}
              timeZone={reportTimeZone}
              dateGranularity={checkData?.responseBucket}
              emptyTitle="No uptime checks recorded"
            />
          </Panel>
          <Panel
            title="30 day uptime"
            actions={
              <span>
                <i className="status-dot online" /> Available &nbsp;{" "}
                <i className="status-dot down" /> Days with incidents
              </span>
            }
          >
            <p className="daily-scope-note">Last 30 calendar days · {checkData?.dailyScope?.timeZone || reportTimeZone}</p>
            <DailyUptimeStrip days={checkData?.days || []} timeZone={checkData?.dailyScope?.timeZone || reportTimeZone} />
          </Panel>
          <div className="grid three">
            <Panel title="Latest check">
              <KeyValues
                rows={[
                  [
                    "Status",
                    <Status value={latestCheck?.success ? "online" : monitor?.last_status || "pending"} />,
                  ],
                  [
                    "Response",
                    latestCheck?.response_ms ?? monitor?.last_response_ms
                      ? `${latestCheck?.response_ms ?? monitor?.last_response_ms} ms`
                      : "—",
                  ],
                  ["HTTP response", latestCheck?.status_code ? `HTTP ${latestCheck.status_code}` : "Not recorded"],
                  ["HTTPS connection", property.url.startsWith("https://") ? "Valid at latest check" : "Not HTTPS"],
                  ["Certificate expiry", "Not monitored"],
                  [
                    "Checked",
                    latestCheck?.checked_at || monitor?.last_checked_at
                      ? relative(latestCheck?.checked_at || monitor!.last_checked_at!)
                      : "Awaiting first check",
                  ],
                  [
                    "Frequency",
                    monitor ? `Every ${monitor.interval_minutes} minutes` : "—",
                  ],
                ]}
              />
            </Panel>
            <Panel title="Recent incidents">
              <IncidentTable incidents={relevant.slice(0, 2)} compact />
              <button
                className="btn panel-action"
                onClick={() => setTab("Incidents")}
              >
                View incident details
              </button>
            </Panel>
            <Panel title="Monitor configuration">
              <KeyValues
                rows={[
                  ["Method", "GET"],
                  ["URL", property.url],
                  [
                    "Expected status",
                    `HTTP ${monitor?.expected_status_min || 200}–${monitor?.expected_status_max || 399}`,
                  ],
                  [
                    "Failure threshold",
                    `${monitor?.failure_threshold || 2} checks`,
                  ],
                  ["Alerts", property.settings?.alert_recipient_count ? `${property.settings.alert_recipient_count} recipients` : "Configured recipients"],
                  ["Execution", "Distributed queue worker"],
                ]}
              />
              <Link
                className="btn panel-action"
                to={`/settings?property=${property.id}&settingsTab=Uptime`}
              >
                Open settings
              </Link>
            </Panel>
          </div>
        </>
      ) : tab === "Incidents" ? (
        <IncidentTable incidents={relevant} propertyUrl={property.url} />
      ) : tab === "Maintenance" ? (
        <Panel
          title="Maintenance windows"
          actions={
            <button className="btn" onClick={() => setDialog(true)}>
              <Plus />
              Add window
            </button>
          }
        >
          {maintenance.length ? (
            <DataTable
              headers={["Name", "Start", "Timezone", "Alerts"]}
              rows={maintenance}
            />
          ) : (
            <Empty
              title="No maintenance windows"
              detail="Schedule planned work and suppress expected alerts."
            />
          )}
        </Panel>
      ) : null}{" "}
      {dialog && (
        <SimpleDialog
          title="Schedule maintenance"
          close={() => setDialog(false)}
          action="Save window"
          onSave={async () => {
            if (session && monitor) {
              await api(session, `/api/monitors/${monitor.id}/maintenance`, {
                method: "POST",
                body: JSON.stringify({
                  startsAt: new Date(maintenanceStart).toISOString(),
                  endsAt: new Date(
                    new Date(maintenanceStart).valueOf() + maintenanceHours * 60 * 60_000,
                  ).toISOString(),
                  reason: maintenanceName,
                }),
              });
            }
            await loadMaintenance();
            setDialog(false);
            notify("Maintenance window saved");
          }}
        >
          <label className="field">
            Name
            <input value={maintenanceName} onChange={(event) => setMaintenanceName(event.target.value)} />
          </label>
          <label className="field">
            Start
            <input
              type="datetime-local"
              value={maintenanceStart}
              onChange={(event) => setMaintenanceStart(event.target.value)}
            />
          </label>
          <label className="field">
            Timezone
            <select>
              <option>{property.settings?.timezone || "Europe/London"}</option>
            </select>
          </label>
          <label className="field">
            Duration
            <select value={maintenanceHours} onChange={(event) => setMaintenanceHours(Number(event.target.value))}>
              {[1, 2, 4, 8, 12, 24].map((hours) => (
                <option key={hours} value={hours}>{hours} hour{hours === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" defaultChecked /> Suppress alerts
          </label>
        </SimpleDialog>
      )}
    </Page>
  );
}

function AnalyticsView({
  session,
  property,
  fixture,
  notify,
}: {
  session: Session | null;
  property?: Property;
  fixture: boolean;
  notify: Notify;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tabs = ["Overview", "Pages", "Sources", "Events", "Audience", "Engagement", "Performance"];
  const requestedTab = params.get("analyticsTab");
  const tab = tabs.includes(requestedTab || "") ? requestedTab! : "Overview";
  const filters = analyticsPageFiltersFromParams(params);
  const detailPage = params.get("pagePath") || "";
  const detailSource = params.get("sourceDetail") || "";
  const detailEvent = params.get("eventDetail") || "";
  const countryListOpen = params.get("countryList") === "all";
  const listPage = Math.max(1, Number(params.get("listPage") || 1));
  const listPageSize = [20, 100, 200].includes(Number(params.get("pageSize")))
    ? Number(params.get("pageSize"))
    : 20;
  const effectiveFilters: AnalyticsPageFilters = detailPage
    ? { ...filters, pathMode: "exact", pathValue: detailPage }
    : detailSource
      ? { ...filters, source: detailSource }
      : filters;
  const filterQuery = analyticsPageFilterQuery(effectiveFilters);
  const livePeriod = `${periodQuery(location.search)}&time_zone=${encodeURIComponent(property?.settings?.timezone || "Europe/London")}`;
  const [baseData, setBaseData] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [chartMetric, setChartMetric] = useState<TrafficMetric>("Pageviews");
  const [chartMenuOpen, setChartMenuOpen] = useState(false);
  const [showPreviousTraffic, setShowPreviousTraffic] = useState(true);
  const [pageList, setPageList] = useState<{ rows: any[]; page: number; pageSize: number; total: number; pages: number } | null>(null);
  const [pageListError, setPageListError] = useState("");
  const [pageListLoading, setPageListLoading] = useState(false);
  const [engagementPage, setEngagementPage] = useState(1);
  const [rangeOpen, setRangeOpen] = useState(false);
  const defaultTo = params.get("to") || new Date().toISOString().slice(0, 10);
  const defaultFrom = params.get("from") || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const [rangeFrom, setRangeFrom] = useState(defaultFrom);
  const [rangeTo, setRangeTo] = useState(defaultTo);

  const changeTab = (nextTab: string) => {
    const next = new URLSearchParams(location.search);
    if (nextTab === "Overview") next.delete("analyticsTab");
    else next.set("analyticsTab", nextTab);
    for (const key of analyticsFilterParamKeys) next.delete(key);
    ["pagePath", "sourceDetail", "eventDetail", "countryList", "listPage", "pageSize"].forEach((key) => next.delete(key));
    navigate(`${location.pathname}?${next.toString()}`, { replace: true });
  };
  const changeFilters = (nextFilters: AnalyticsPageFilters) => {
    const next = new URLSearchParams(location.search);
    for (const key of analyticsFilterParamKeys) next.delete(key);
    writeAnalyticsFilters(next, nextFilters);
    next.delete("listPage");
    navigate(`${location.pathname}?${next.toString()}`, { replace: true });
  };
  const updateAnalyticsParams = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(location.search);
    Object.entries(changes).forEach(([key, value]) => value == null ? next.delete(key) : next.set(key, value));
    navigate(`${location.pathname}?${next.toString()}`, { replace });
  };

  useEffect(() => {
    let cancelled = false;
    if (session && property && filterQuery) {
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}`)
        .then((next) => !cancelled && setBaseData(next))
        .catch(() => !cancelled && setBaseData(null));
    } else if (fixture) setBaseData(analyticsFixtureSummary());
    else setBaseData(null);
    return () => { cancelled = true; };
  }, [filterQuery, fixture, livePeriod, property?.id, reloadToken, session]);

  useEffect(() => {
    if (!property) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    if (session) {
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}${filterQuery ? `&${filterQuery}` : ""}`)
        .then((next) => !cancelled && setData(next))
        .catch((reason) => !cancelled && setError(reason.message || "Analytics could not be loaded"))
        .finally(() => !cancelled && setLoading(false));
    } else if (fixture) {
      setData(filterAnalyticsFixture(filters));
      setLoading(false);
    } else {
      setError("Authentication is required to load analytics.");
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [filterQuery, fixture, livePeriod, property?.id, reloadToken, session]);

  useEffect(() => {
    if (tab !== "Pages" || detailPage || !property) return;
    let cancelled = false;
    setPageListLoading(true);
    setPageListError("");
    if (session) {
      api<any>(session, `/api/properties/${property.id}/analytics/pages?${livePeriod}&page=${listPage}&page_size=${listPageSize}${filterQuery ? `&${filterQuery}` : ""}`)
        .then((next) => !cancelled && setPageList(next))
        .catch((reason) => {
          if (!cancelled) {
            setPageList(null);
            setPageListError(reason.message || "Pages could not be loaded");
          }
        })
        .finally(() => !cancelled && setPageListLoading(false));
    } else if (fixture) {
      const all = filterAnalyticsFixture(filters).pages || [];
      const start = (listPage - 1) * listPageSize;
      setPageList({ rows: all.slice(start, start + listPageSize), page: listPage, pageSize: listPageSize, total: all.length, pages: Math.max(1, Math.ceil(all.length / listPageSize)) });
      setPageListLoading(false);
    }
    return () => { cancelled = true; };
  }, [detailPage, filterQuery, fixture, listPage, listPageSize, livePeriod, property?.id, reloadToken, session, tab]);

  useEffect(() => setEngagementPage(1), [filterQuery, property?.id]);

  if (!property) return <Empty title="Select a property" detail="Analytics is property-specific." />;

  const scoped = data || baseData || analyticsFixtureSummary();
  const analyticsTimeZone = scoped.timeZone || property?.settings?.timezone || "Europe/London";
  const options: AnalyticsFilterOptions = baseData?.filterOptions || scoped.filterOptions || emptyAnalyticsFilterOptions;
  const pages = (scoped.pages || []).map((page: any) => ({
    page: page.path,
    views: page.pageviews || 0,
    events: page.events || 0,
    activeTime: page.averageActiveSeconds,
  }));
  const config = analyticsFilterConfigs[tab];
  const engagement = scoped.engagement || {};
  const previousEngagement = scoped.previous?.engagement || {};
  const performance = scoped.performance || { vitals: scoped.vitals || [], series: {}, minimumSamples: 1 };
  const minimumSamples = performance.minimumSamples || 1;
  const vital = (name: string) => (performance.vitals || []).find((entry: any) => entry.name === name);
  const previousVital = (name: string) => (scoped.previous?.performance?.vitals || []).find((entry: any) => entry.name === name);
  const selectedPerformanceMetric = filters.metric || "LCP";
  const seriesKey = trafficSeriesKey(chartMetric);
  const chartPoints = (scoped.series || []).map((point: any) => ({ label: point.day, value: point[seriesKey] || 0 }));
  const previousChartPoints = (scoped.previous?.series || []).map((point: any) => ({ label: point.day, value: point[seriesKey] || 0 }));
  const performancePoints = (performance.series?.[selectedPerformanceMetric] || [])
    .filter((point: any) => point.value != null)
    .map((point: any) => ({ label: point.day, value: point.value }));
  const previousPerformancePoints = (scoped.previous?.performance?.series?.[selectedPerformanceMetric] || [])
    .filter((point: any) => point.value != null)
    .map((point: any) => ({ label: point.day, value: point.value }));
  const filtersToolbar = (
    <AnalyticsPageFilterToolbar
      filters={filters}
      options={options}
      onChange={changeFilters}
      title={config.title}
      categories={config.categories}
    />
  );
  const trackingSnippet = `<script defer src="${window.location.origin}/c.js" data-property="${property.tracking_id}"></script>`;
  const engagingPages = engagement.pages || [];
  const engagingPageCount = Math.max(1, Math.ceil(engagingPages.length / 20));
  const shownEngagingPages = paginateResults(engagingPages, engagementPage);

  return (
    <Page title="Analytics" status={<Period />}>
      {!property.tracking_last_received_at && (
        <div className="analytics-install-banner" role="status">
          <div>
            <b>Install tracking to start collecting analytics</b>
            <p>Add this script before the closing <code>&lt;/head&gt;</code> tag on every page. Analytics will begin populating after the first accepted pageview.</p>
          </div>
          <pre className="install-code">{trackingSnippet}</pre>
          <div className="settings-actions">
            <CopyButton text={trackingSnippet} label="Copy tracking code" successMessage="Tracking snippet copied" notify={notify} />
            <Link className="primary" to={`/settings?property=${property.id}&settingsTab=Tracking`}>Tracking setup guide</Link>
          </div>
        </div>
      )}
      <Tabs labels={tabs} value={tab} onChange={changeTab} />
      {loading ? (
        <Empty title="Loading analytics…" detail="Applying the selected property, dates and filters." />
      ) : error ? (
        <div className="analytics-state" role="alert">
          <Empty title="Analytics could not be loaded" detail={error} />
          <button className="btn" onClick={() => setReloadToken((value) => value + 1)}>Retry</button>
        </div>
      ) : countryListOpen ? (
        <CountryListDetail
          rows={scoped.countries || []}
          total={scoped.pageviews || 0}
          onBack={() => updateAnalyticsParams({ countryList: null })}
        />
      ) : tab === "Overview" ? (
        <>
          <Metrics values={[
            ["Pageviews", fmt(scoped.pageviews || 0), <MetricComparison current={scoped.pageviews} previous={scoped.previous?.pageviews} />],
            [<MetricTerm term="Sessions" />, fmt(scoped.sessions || 0), <MetricComparison current={scoped.sessions} previous={scoped.previous?.sessions} />],
            ["Tracked events", fmt(scoped.keyEvents || 0), <MetricComparison current={scoped.keyEvents} previous={scoped.previous?.keyEvents} />],
            [<MetricTerm term="Bounce rate" />, engagement.bounceRate == null ? "Unavailable" : `${engagement.bounceRate.toFixed(1)}%`, <MetricComparison current={engagement.bounceRate} previous={previousEngagement.bounceRate} direction="lower" />],
            [<MetricTerm term="Average active session duration" />, engagement.averageActiveSessionSeconds == null ? "Unavailable" : durationLabel(engagement.averageActiveSessionSeconds), <MetricComparison current={engagement.averageActiveSessionSeconds} previous={previousEngagement.averageActiveSessionSeconds} direction="higher" />],
          ]} />
          <Panel
            title="Traffic"
            actions={
              <>
                <span className="seg">
                  {(["Pageviews", "Unique Visits", "Events"] as TrafficMetric[]).map((metric) => (
                    <button className={chartMetric === metric ? "active" : ""} onClick={() => setChartMetric(metric)} key={metric}>{metric}</button>
                  ))}
                </span>
                <span className="chart-menu-wrap">
                  <button className="iconbtn" aria-label="Traffic chart options" aria-expanded={chartMenuOpen} onClick={() => setChartMenuOpen((value) => !value)}><MoreHorizontal /></button>
                  {chartMenuOpen && (
                    <span className="action-menu chart-context-menu" role="menu">
                      <button onClick={() => { setShowPreviousTraffic((value) => !value); setChartMenuOpen(false); }}>
                        {showPreviousTraffic ? "Hide" : "Show"} previous period
                      </button>
                      <button onClick={() => { setRangeFrom(defaultFrom); setRangeTo(defaultTo); setRangeOpen(true); setChartMenuOpen(false); }}>
                        <CalendarDays /> Change date range
                      </button>
                      <button onClick={() => {
                        downloadSeriesCsv(chartPoints, `analytics-${chartMetric.toLowerCase().replaceAll(" ", "-")}.csv`, chartMetric);
                        setChartMenuOpen(false);
                        notify("Analytics CSV downloaded");
                      }}>Download CSV</button>
                    </span>
                  )}
                </span>
              </>
            }
          >
            {filtersToolbar}
            <div className="chart-legend"><span>Current period</span>{showPreviousTraffic && <span className="previous">Previous period</span>}</div>
            <SeriesChart points={chartPoints} previousPoints={showPreviousTraffic ? previousChartPoints : []} emptyTitle="No measured traffic yet" unit={chartMetric === "Events" ? " events" : ""} label={`${chartMetric} by day`} timeZone={analyticsTimeZone} />
          </Panel>
          <div className="grid equal">
            <Panel title="Top pages"><AnalyticsTable pages={pages} property={property} groupedLimit={5} eventHeader="Key events" onDetail={(page) => updateAnalyticsParams({ analyticsTab: "Pages", pagePath: page })} /></Panel>
            <Panel title="Traffic sources"><AnalyticsSourceTable sources={scoped.sources || []} /></Panel>
          </div>
          <div className="grid analytics-overview-bottom">
            <Panel title="Key events"><AnalyticsValueTable headers={["Event", "Count", "%"]} rows={(scoped.eventBreakdown || []).slice(0, 5).map((row: any) => ({ label: eventLabel(row.name), value: row.count, secondary: scoped.keyEvents ? `${Math.round(row.count / scoped.keyEvents * 100)}%` : "0%" }))} /></Panel>
            <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Share"]} rows={shareRows(scoped.devices, scoped.pageviews, "device")} /></Panel>
            <CountriesPanel rows={scoped.countries || []} total={scoped.pageviews || 0} onOpen={() => updateAnalyticsParams({ countryList: "all" })} />
          </div>
        </>
      ) : tab === "Pages" && detailPage ? (
        <AnalyticsPageDetail
          data={scoped}
          page={detailPage}
          property={property}
          onBack={() => updateAnalyticsParams({ pagePath: null }, false)}
        />
      ) : tab === "Pages" ? (
        <>
        <Metrics values={[
          ["Pageviews", fmt(scoped.pageviews || 0), <MetricComparison current={scoped.pageviews} previous={scoped.previous?.pageviews} />],
          [<MetricTerm term="Sessions" />, fmt(scoped.sessions || 0), <MetricComparison current={scoped.sessions} previous={scoped.previous?.sessions} />],
          ["Average active page time", engagement.averageActiveSeconds == null ? "Unavailable" : durationLabel(engagement.averageActiveSeconds), <MetricComparison current={engagement.averageActiveSeconds} previous={previousEngagement.averageActiveSeconds} direction="higher" />],
          [<MetricTerm term="Bounce rate" />, engagement.bounceRate == null ? "Unavailable" : `${engagement.bounceRate.toFixed(1)}%`, <MetricComparison current={engagement.bounceRate} previous={previousEngagement.bounceRate} direction="lower" />],
        ]} />
        <Panel title="Pages">
          {filtersToolbar}
          {pageListLoading ? (
            <Empty title="Loading pages…" detail="Fetching this page of the complete, filtered result." />
          ) : pageListError ? (
            <div className="analytics-state" role="alert"><Empty title="Pages could not be loaded" detail={pageListError} /><button className="btn" onClick={() => setReloadToken((value) => value + 1)}>Retry</button></div>
          ) : pageList?.rows?.length ? (
            <>
              <AnalyticsTable
                pages={pageList.rows.map((row: any) => ({ page: row.path, views: row.pageviews, events: row.events, activeTime: row.averageActiveSeconds }))}
                property={property}
                showActiveTime
                onDetail={(page) => updateAnalyticsParams({ pagePath: page })}
              />
              <AnalyticsPagination
                page={pageList.page}
                pageSize={pageList.pageSize}
                total={pageList.total}
                pages={pageList.pages}
                onPage={(value) => updateAnalyticsParams({ listPage: String(value) })}
                onPageSize={(value) => updateAnalyticsParams({ pageSize: String(value), listPage: null })}
              />
            </>
          ) : (
            <div className="analytics-state">
              <Empty title={hasAnalyticsPageFilters(filters) ? "No matching page results" : "No pageviews in this period"} detail={hasAnalyticsPageFilters(filters) ? "No recorded pageviews or configured events match every active filter." : "A genuinely tracked pageview will appear here after it is received."} />
              {hasAnalyticsPageFilters(filters) && <button className="btn" onClick={() => changeFilters({})}>Clear all filters</button>}
            </div>
          )}
        </Panel>
        </>
      ) : tab === "Sources" && detailSource ? (
        <AnalyticsSourceDetail data={scoped} source={detailSource} property={property} onBack={() => updateAnalyticsParams({ sourceDetail: null })} />
      ) : tab === "Sources" ? (
        <>
        <Metrics values={[
          ["Pageviews", fmt(scoped.pageviews || 0), <MetricComparison current={scoped.pageviews} previous={scoped.previous?.pageviews} />],
          [<MetricTerm term="Sessions" />, fmt(scoped.sessions || 0), <MetricComparison current={scoped.sessions} previous={scoped.previous?.sessions} />],
          ["Tracked events", fmt(scoped.keyEvents || 0), <MetricComparison current={scoped.keyEvents} previous={scoped.previous?.keyEvents} />],
          [<MetricTerm term="Bounce rate" />, engagement.bounceRate == null ? "Unavailable" : `${engagement.bounceRate.toFixed(1)}%`, <MetricComparison current={engagement.bounceRate} previous={previousEngagement.bounceRate} direction="lower" />],
        ]} />
        <Panel title="Traffic sources">
          {filtersToolbar}
          <AnalyticsSourceTable sources={scoped.sources || []} onDetail={(source) => updateAnalyticsParams({ sourceDetail: source })} />
          <p className="subtle">Source categories are mutually exclusive and total {fmt((scoped.sources || []).reduce((sum: number, source: any) => sum + source.pageviews, 0))} pageviews.</p>
        </Panel>
        </>
      ) : tab === "Events" && detailEvent ? (
        <AnalyticsEventDetail
          session={session}
          property={property}
          fixture={fixture}
          eventName={detailEvent}
          livePeriod={livePeriod}
          filters={filters}
          options={options}
          onFilterChange={changeFilters}
          onBack={() => updateAnalyticsParams({ eventDetail: null })}
        />
      ) : tab === "Events" ? (
        <>
        <Metrics values={[
          ["Tracked events", fmt(scoped.keyEvents || 0), <MetricComparison current={scoped.keyEvents} previous={scoped.previous?.keyEvents} />],
          [<MetricTerm term="Sessions" />, fmt(scoped.sessions || 0), <MetricComparison current={scoped.sessions} previous={scoped.previous?.sessions} />],
          ["Pageviews", fmt(scoped.pageviews || 0), <MetricComparison current={scoped.pageviews} previous={scoped.previous?.pageviews} />],
          ["Engaged sessions", engagement.engagedSessions == null ? "Unavailable" : fmt(engagement.engagedSessions), <MetricComparison current={engagement.engagedSessions} previous={previousEngagement.engagedSessions} direction="higher" />],
        ]} />
        <EventsPanel
          session={session}
          property={property}
          fixture={fixture}
          notify={notify}
          data={scoped}
          filters={filters}
          options={options}
          onFilterChange={changeFilters}
          onOpenEvent={(eventName) => updateAnalyticsParams({ eventDetail: eventName })}
        />
        </>
      ) : tab === "Audience" ? (
        <>
          <Metrics values={[
            ["Pageviews", fmt(scoped.pageviews || 0), <MetricComparison current={scoped.pageviews} previous={scoped.previous?.pageviews} />],
            [<MetricTerm term="Sessions" />, fmt(scoped.sessions || 0), <MetricComparison current={scoped.sessions} previous={scoped.previous?.sessions} />],
            ["Countries", fmt((scoped.countries || []).length), <MetricComparison current={(scoped.countries || []).length} previous={(scoped.previous?.countries || []).length} />],
            ["Devices", fmt((scoped.devices || []).length), <MetricComparison current={(scoped.devices || []).length} previous={(scoped.previous?.devices || []).length} />],
          ]} />
          {filtersToolbar}
          <div className="grid equal">
            <Panel title="Browsers"><AnalyticsValueTable headers={["Browser", "Share"]} rows={shareRows(scoped.browsers, scoped.pageviews, "browser")} /></Panel>
            <CountriesPanel rows={scoped.countries || []} total={scoped.pageviews || 0} onOpen={() => updateAnalyticsParams({ countryList: "all" })} />
            <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Share"]} rows={shareRows(scoped.devices, scoped.pageviews, "device")} /></Panel>
            <Panel title="Screen categories"><AnalyticsValueTable headers={["Width", "Share"]} rows={shareRows(scoped.screens, scoped.pageviews)} /></Panel>
          </div>
        </>
      ) : tab === "Engagement" ? (
        <>
          <Metrics values={[
            [<MetricTerm term="Bounce rate" />, engagement.bounceRate == null ? "Unavailable" : `${engagement.bounceRate.toFixed(1)}%`, <MetricComparison current={engagement.bounceRate} previous={previousEngagement.bounceRate} direction="lower" />],
            ["Engaged sessions", engagement.engagedSessions == null ? "Unavailable" : fmt(engagement.engagedSessions), <MetricComparison current={engagement.engagedSessions} previous={previousEngagement.engagedSessions} direction="higher" />],
            [<MetricTerm term="Average active session duration" />, engagement.averageActiveSessionSeconds == null ? "Unavailable" : durationLabel(engagement.averageActiveSessionSeconds), <MetricComparison current={engagement.averageActiveSessionSeconds} previous={previousEngagement.averageActiveSessionSeconds} direction="higher" />],
            [<MetricTerm term="Median active session duration" />, engagement.medianActiveSessionSeconds == null ? "Unavailable" : durationLabel(engagement.medianActiveSessionSeconds), <MetricComparison current={engagement.medianActiveSessionSeconds} previous={previousEngagement.medianActiveSessionSeconds} direction="higher" />],
          ]} />
          {filtersToolbar}
          <div className="grid equal">
            <Panel title="Scroll depth"><AnalyticsValueTable headers={["Depth", "Pageviews"]} rows={(engagement.scrollDepth || []).map((row: any) => ({ label: `${row.depth}% reached`, value: row.pageviews }))} /></Panel>
            <Panel title="Most engaging pages">
              <AnalyticsValueTable className="engagement-url-table" headers={["Page", "Engaged views"]} rows={shownEngagingPages.map((row: any) => ({ label: row.path, value: row.engagedViews }))} />
              {engagingPages.length > 20 && <ResultsPagination page={engagementPage} total={engagingPages.length} label="pages" onPage={(page) => setEngagementPage(Math.min(engagingPageCount, page))} />}
            </Panel>
          </div>
          <Panel title="Visits by day and time">
            <VisitTimeHeatmap cells={engagement.visitTimes || []} timeZone={analyticsTimeZone} />
          </Panel>
          <Panel title="Additional aggregate insights">
            <KeyValues rows={[
              ["Session engagement rate", engagement.sessionEngagementRate == null ? "Unavailable" : `${engagement.sessionEngagementRate.toFixed(1)}%`],
              ["Engaged pageviews", engagement.engagedPageviews == null ? "Unavailable" : fmt(engagement.engagedPageviews)],
              ["Median scroll depth", engagement.medianScrollDepth == null ? "Unavailable" : `${Math.round(engagement.medianScrollDepth)}%`],
              ["JavaScript errors", engagement.collectionStatus === "available" ? fmt(engagement.javascriptErrors || 0) : "Unavailable"],
              ["Median active page time", engagement.medianActiveSeconds == null ? "Unavailable" : durationLabel(engagement.medianActiveSeconds)],
              ["Top visible section", engagement.visibleSections?.[0] ? `${eventLabel(engagement.visibleSections[0].name)} · ${fmt(engagement.visibleSections[0].count)} pageviews` : "Unavailable"],
            ]} />
            <p className="subtle">Aggregate signals use anonymous page-view identifiers and do not create person profiles.</p>
          </Panel>
        </>
      ) : (
        <>
          <Metrics values={[
            [<MetricTerm term="LCP" />, vitalMetricValue(vital("LCP"), minimumSamples), <MetricComparison current={Number(vital("LCP")?.samples || 0) >= minimumSamples ? vital("LCP")?.value : null} previous={Number(previousVital("LCP")?.samples || 0) >= minimumSamples ? previousVital("LCP")?.value : null} direction="lower" />],
            [<MetricTerm term="INP" />, vitalMetricValue(vital("INP"), minimumSamples), <MetricComparison current={Number(vital("INP")?.samples || 0) >= minimumSamples ? vital("INP")?.value : null} previous={Number(previousVital("INP")?.samples || 0) >= minimumSamples ? previousVital("INP")?.value : null} direction="lower" />],
            [<MetricTerm term="CLS" />, vitalMetricValue(vital("CLS"), minimumSamples), <MetricComparison current={Number(vital("CLS")?.samples || 0) >= minimumSamples ? vital("CLS")?.value : null} previous={Number(previousVital("CLS")?.samples || 0) >= minimumSamples ? previousVital("CLS")?.value : null} direction="lower" />],
            ["Good experiences", performance.goodExperiencesPercent == null || performance.eligibleGoodExperienceViews < minimumSamples ? "Unavailable" : `${Math.round(performance.goodExperiencesPercent)}%`, <MetricComparison current={performance.goodExperiencesPercent} previous={scoped.previous?.performance?.goodExperiencesPercent} direction="higher" />],
          ]} />
          <Panel className="analytics-performance-panel">
            {filtersToolbar}
            <p className="subtle">Metrics use the 75th percentile of every valid observation received in this period. Sample counts are shown because early, low-volume results are directional.</p>
            <p className="subtle">A good experience is a versioned pageview with all three field measurements: LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1. Historical observations from the replaced collector are not mixed into these figures.</p>
            <div className="chart-legend"><span>Current period</span><span className="previous">Previous period</span></div>
            <SeriesChart points={performancePoints} previousPoints={previousPerformancePoints} emptyTitle={`Insufficient ${selectedPerformanceMetric} samples`} unit={selectedPerformanceMetric === "CLS" ? "" : " ms"} label={`${selectedPerformanceMetric} p75 by day`} timeZone={analyticsTimeZone} />
          </Panel>
        </>
      )}
      {rangeOpen && (
        <AnalyticsDateRangeDialog
          from={rangeFrom}
          to={rangeTo}
          setFrom={setRangeFrom}
          setTo={setRangeTo}
          close={() => setRangeOpen(false)}
          apply={(from, to) => {
            updateAnalyticsParams({ from, to, listPage: null });
            setRangeOpen(false);
          }}
        />
      )}
    </Page>
  );
}


function AuditView({
  session,
  property,
  fixture,
  notify,
}: {
  session: Session | null;
  property?: Property;
  fixture: boolean;
  notify: Notify;
}) {
  const auditLocation = useLocation();
  const auditNavigate = useNavigate();
  const livePeriod = periodQuery(auditLocation.search);
  const auditParams = new URLSearchParams(auditLocation.search);
  const requestedTab = auditParams.get("auditTab");
  const requestedPageId = auditParams.get("auditPage");
  const [runs, setRuns] = useState<AuditRun[]>([]),
    [propertyRuns, setPropertyRuns] = useState<AuditRun[]>([]),
    [tab, setTab] = useState(
      ["Overview", "Checks", "Findings", "History", "Compare"].includes(requestedTab || "")
        ? requestedTab!
        : "Overview",
    ),
    [busy, setBusy] = useState(false),
    [completionRun, setCompletionRun] = useState<AuditRun | null>(null),
    [auditDataLoading, setAuditDataLoading] = useState(true),
    [auditFilters, setAuditFilters] = useState<AuditBrowseFilters>({}),
    [pageMenu, setPageMenu] = useState(false),
    [addPage, setAddPage] = useState(false),
    [pageToDelete, setPageToDelete] = useState<AuditPage | null>(null),
    [performanceMode, setPerformanceMode] = useState<"Lab audit" | "Real-user data">("Lab audit"),
    [realUserPerformance, setRealUserPerformance] = useState<any>(null),
    [implementationCoverage, setImplementationCoverage] = useState<number | null>(null),
    [auditPages, setAuditPages] = useState<AuditPage[]>([]),
    [selectedPage, setSelectedPage] = useState<AuditPage | null>(null),
    [pageName, setPageName] = useState(""),
    [pagePath, setPagePath] = useState("/"),
    [pageSaveState, setPageSaveState] = useState<"idle" | "saving" | "success">("idle"),
    [pageError, setPageError] = useState(""),
    [openCategories, setOpenCategories] = useState<Set<string>>(new Set()),
    [earlierRunId, setEarlierRunId] = useState(auditParams.get("auditEarlier") || ""),
    [laterRunId, setLaterRunId] = useState(auditParams.get("auditLater") || "");
  const requestSequence = useRef(0);
  const loadedAuditScope = useRef("");
  const completionTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (completionTimer.current != null) window.clearTimeout(completionTimer.current);
  }, []);
  function updateAuditLocation(changes: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    auditNavigate(`${auditLocation.pathname}?${next.toString()}`, { replace: true });
  }
  useEffect(() => {
    if (session && property) {
      api<any[]>(session, `/api/properties/${property.id}/audit-pages`)
        .then((pages) => {
          const next = [...pages].sort((left, right) => left.path === "/" ? -1 : right.path === "/" ? 1 : left.name.localeCompare(right.name));
          setAuditPages(next);
          const chosen = next.find((page) => page.id === requestedPageId) || next[0] || null;
          setSelectedPage(chosen);
          if (chosen && chosen.id !== requestedPageId) updateAuditLocation({ auditPage: chosen.id });
        })
        .catch(() => { setAuditPages([]); setSelectedPage(null); });
    } else if (fixture) {
      const pages = [
        { id: "fixture-homepage", name: "Homepage", path: "/" },
        { id: "fixture-about", name: "About", path: "/about/" },
        { id: "fixture-contact", name: "Contact", path: "/contact/" },
      ];
      const page = pages.find((candidate) => candidate.id === requestedPageId) || pages[0];
      setAuditPages(pages);
      setSelectedPage(page);
      if (page.id !== requestedPageId) updateAuditLocation({ auditPage: page.id });
      const analytics = fixtureAnalytics(property!);
      setRealUserPerformance({
        desktop: { from: "2026-09-01T00:00:00Z", to: "2026-09-30T23:59:59Z", performance: { vitals: analytics.desktopVitals, minimumSamples: 75, method: "p75" } },
        mobile: { from: "2026-09-01T00:00:00Z", to: "2026-09-30T23:59:59Z", performance: { vitals: analytics.mobileVitals, minimumSamples: 75, method: "p75" } },
      });
      setImplementationCoverage(100);
    }
  }, [property?.id, session, fixture]);
  useEffect(() => {
    if (!fixture || !property || !selectedPage) return;
    setRuns([
      fixtureAudit(property, selectedPage, false),
      fixtureAudit(property, selectedPage, true),
    ]);
    setAuditDataLoading(false);
  }, [fixture, property?.id, selectedPage?.id]);
  useEffect(() => {
    if (!session || !property || !selectedPage) return;
    const sequence = ++requestSequence.current;
    const scope = `${property.id}:${selectedPage.id}`;
    if (loadedAuditScope.current !== scope) {
      loadedAuditScope.current = scope;
      setRuns([]);
      setRealUserPerformance(null);
      setAuditDataLoading(true);
    }
    Promise.all([
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}`),
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&pathMode=exact&pathValue=${encodeURIComponent(selectedPage.path)}`),
      api<any>(session, `/api/properties/${property.id}/audit-coverage`),
    ])
      .then(([nextRuns, performance, coverageSummary]) => {
        if (requestSequence.current !== sequence) return;
        setPropertyRuns(nextRuns);
        setRuns(nextRuns.filter((run) => run.audit_page_id === selectedPage.id));
        setRealUserPerformance({
          desktop: {
            from: performance.from,
            to: performance.to,
            performance: performance.performanceByDevice?.desktop,
          },
          mobile: {
            from: performance.from,
            to: performance.to,
            performance: performance.performanceByDevice?.mobile,
          },
        });
        setImplementationCoverage(Number.isFinite(coverageSummary?.implementationCoverage) ? coverageSummary.implementationCoverage : null);
      })
      .catch(() => {
        if (requestSequence.current !== sequence) return;
        // Preserve the last completed result during a transient revalidation failure.
        // Active audits continue to poll independently below.
      })
      .finally(() => {
        if (requestSequence.current === sequence) setAuditDataLoading(false);
      });
  }, [property?.id, session, fixture, livePeriod, selectedPage?.id]);
  const latestCompletedCreatedAt = Date.parse(
    runs.find((run) => ["completed", "partial"].includes(run.status))?.created_at || "",
  );
  const isStalledActiveRun = (run: AuditRun) => {
    if (!["queued", "running"].includes(run.status)) return false;
    const heartbeat = Date.parse(run.heartbeat_at || run.created_at);
    const createdAt = Date.parse(run.created_at);
    return (Number.isFinite(heartbeat) && Date.now() - heartbeat > 2 * 60_000) ||
      (Number.isFinite(createdAt) && Date.now() - createdAt > 5 * 60_000);
  };
  const isCurrentActiveRun = (run: AuditRun) =>
    ["queued", "running"].includes(run.status) &&
    !isStalledActiveRun(run) &&
    (!Number.isFinite(latestCompletedCreatedAt) ||
      Date.parse(run.created_at) > latestCompletedCreatedAt);
  const isFreshActiveRun = (run: AuditRun) => ["queued", "running"].includes(run.status) && !isStalledActiveRun(run);
  const propertyActiveRun = propertyRuns.find(isFreshActiveRun);
  const activeRunId = propertyActiveRun?.id;
  useEffect(() => {
    if (!activeRunId || !session || !property || !selectedPage) return;
    const interval = window.setInterval(() => {
      const sequence = ++requestSequence.current;
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}`)
        .then((nextRuns) => {
          if (requestSequence.current !== sequence) return;
          setPropertyRuns(nextRuns);
          setRuns(nextRuns.filter((run) => run.audit_page_id === selectedPage.id));
          const finished = nextRuns.find((run) => run.id === activeRunId);
          if (finished && ["completed", "partial", "failed"].includes(finished.status)) {
            setBusy(false);
            if (["completed", "partial"].includes(finished.status)) {
              setCompletionRun(finished);
              if (completionTimer.current != null) window.clearTimeout(completionTimer.current);
              completionTimer.current = window.setTimeout(() => {
                setCompletionRun(null);
                completionTimer.current = null;
              }, 700);
            }
            notify(finished.status === "failed" ? "Audit failed" : "Audit results are ready");
          }
        })
        .catch(() => undefined);
    }, 1800);
    return () => window.clearInterval(interval);
  }, [activeRunId, session, property?.id, selectedPage?.id, livePeriod]);
  const latestRunId = runs.find((run) => ["completed", "partial"].includes(run.status))?.id;
  useEffect(() => {
    setOpenCategories(new Set());
    setAuditFilters({});
  }, [selectedPage?.id, latestRunId]);
  useEffect(() => {
    setCompletionRun(null);
    if (completionTimer.current != null) {
      window.clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
  }, [selectedPage?.id]);
  useEffect(() => {
    const comparable = runs.filter((run) => ["completed", "partial"].includes(run.status));
    if (comparable.length < 2) {
      setEarlierRunId("");
      setLaterRunId("");
      return;
    }
    const validEarlier = comparable.some((run) => run.id === earlierRunId);
    const validLater = comparable.some((run) => run.id === laterRunId);
    const same = earlierRunId && earlierRunId === laterRunId;
    const nextLater = validLater && !same ? laterRunId : comparable[0].id;
    const nextEarlier = validEarlier && earlierRunId !== nextLater ? earlierRunId : comparable.find((run) => run.id !== nextLater)!.id;
    if (nextEarlier !== earlierRunId) setEarlierRunId(nextEarlier);
    if (nextLater !== laterRunId) setLaterRunId(nextLater);
    if (nextEarlier !== earlierRunId || nextLater !== laterRunId)
      updateAuditLocation({ auditEarlier: nextEarlier, auditLater: nextLater });
  }, [selectedPage?.id, runs.map((run) => run.id).join("|")]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Audit results are property-specific."
      />
    );
  const activeRun = runs.find(isCurrentActiveRun),
    latest = runs.find((run) => ["completed", "partial"].includes(run.status)),
    results = latest?.user_facing_results || latest?.audit_results || [],
    completedCategoryCount = Object.values(auditRunCategoryScores(latest)).filter((score) => score != null).length,
    partial = Boolean(latest) && !isAuditRunComplete(latest),
    actionable = results.filter(isFixFirstAuditResult),
    filteredActionable = filterUserFacingAuditResults(actionable, auditFilters, { hideUnableByDefault: false }),
    countableActionable = filterUserFacingAuditResults(actionable, { ...auditFilters, types: [] }, { hideUnableByDefault: false });
  const resultCounts = {
    critical: countableActionable.filter((result: any) => auditSeverityGroup(result) === "critical").length,
    security: countableActionable.filter((result: any) => auditSeverityGroup(result) === "security").length,
    warning: countableActionable.filter((result: any) => auditSeverityGroup(result) === "warning").length,
  };
  async function run() {
    if (!selectedPage) return;
    setCompletionRun(null);
    if (completionTimer.current != null) window.clearTimeout(completionTimer.current);
    setBusy(true);
    try {
      if (session)
        await api(session, "/api/audits", {
          method: "POST",
          body: JSON.stringify({
            propertyId: property!.id,
            pageId: selectedPage.id,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
      notify("Audit queued");
      if (session) {
        const next = await api<AuditRun[]>(session, `/api/properties/${property!.id}/audits?${livePeriod}`);
        setPropertyRuns(next);
        setRuns(next.filter((candidate) => candidate.audit_page_id === selectedPage.id));
        setBusy(next.some(isFreshActiveRun));
      }
    } catch (e: any) {
      notify(e.message);
      setBusy(false);
    } finally {
      if (!session) setBusy(false);
    }
  }
  async function saveAuditPage() {
    setPageError("");
    setPageSaveState("saving");
    try {
      if (!session) throw new Error("Authentication required");
      const saved = await api<any>(session, `/api/properties/${property!.id}/audit-pages`, {
        method: "POST",
        body: JSON.stringify({ name: pageName, path: pagePath }),
      });
      const next = [
        ...auditPages,
        saved,
      ].sort((left, right) => left.path === "/" ? -1 : right.path === "/" ? 1 : left.name.localeCompare(right.name));
      setAuditPages(next);
      setSelectedPage(saved);
      updateAuditLocation({ auditPage: saved.id });
      setPageSaveState("success");
      setPageName("");
      setPagePath("/");
      notify("Page added to this audit selection");
      window.setTimeout(() => { setAddPage(false); setPageSaveState("idle"); }, 550);
    } catch (error: any) {
      const message = error.message === "audit_page_already_exists"
        ? "That page is already in this property."
        : error.message === "page_must_belong_to_property"
          ? `Enter a URL or path on ${property!.canonical_host}.`
          : error.message;
      setPageError(message);
      setPageSaveState("idle");
    }
  }
  async function deleteAuditPage(page: AuditPage) {
    try {
      if (session)
        await api(session, `/api/properties/${property!.id}/audit-pages/${page.id}`, {
          method: "DELETE",
        });
      const next = auditPages.filter((candidate) => candidate.id !== page.id);
      setAuditPages(next);
      if (selectedPage?.id === page.id) {
        const replacement = next[0] || null;
        setSelectedPage(replacement);
        updateAuditLocation({ auditPage: replacement?.id || null });
      }
      setPageToDelete(null);
      setPageMenu(false);
      notify("Audit page and its data deleted");
    } catch (error: any) {
      notify(error.message);
    }
  }
  function openFindingCategory(category: string) {
    setTab("Findings");
    const [topLevel, subcategory] = category.split("::");
    setAuditFilters({ category: topLevel, ...(subcategory ? { subcategory } : {}) });
    setOpenCategories(new Set([category]));
    updateAuditLocation({ auditTab: "Findings" });
  }
  const retryableRun = !activeRun
    ? runs.find((run) =>
        (run.status === "failed" || isStalledActiveRun(run)) &&
        (!latest || Date.parse(run.created_at) > Date.parse(latest.created_at)))
    : undefined;
  const fullyPersistedStaleRun = Boolean(
    retryableRun &&
    latest &&
    isStalledActiveRun(retryableRun) &&
    retryableRun.progress_total &&
    (retryableRun.progress_completed || 0) >= retryableRun.progress_total,
  );
  const failedRun = fullyPersistedStaleRun ? undefined : retryableRun;
  const progressRun = activeRun || failedRun || completionRun;
  return (
    <Page
      title="Audit"
      actions={
        <button className="primary" onClick={() => void run()} disabled={busy || Boolean(propertyActiveRun) || !selectedPage}>
          <RefreshCw className={busy || propertyActiveRun ? "audit-spin" : ""} />
          {propertyActiveRun?.status === "queued" ? "Queued" : propertyActiveRun?.status === "running" ? "Running" : busy ? "Queuing…" : "Run audit"}
        </button>
      }
    >
      <div className="audit-nav-row">
        <button className="audit-page-picker" onClick={() => setPageMenu((value) => !value)}>
          <Globe2 />
          <span><b>{selectedPage?.name || "Select a page"}</b></span>
          <ChevronDown />
        </button>
        {pageMenu && (
          <div className="action-menu audit-page-menu">
            {auditPages.map((page) => (
              <div className={`audit-page-option ${selectedPage?.id === page.id ? "selected" : ""}`} key={page.id}>
                <button
                  className="audit-page-select"
                  onClick={() => {
                    setAuditDataLoading(true);
                    setSelectedPage(page);
                    setPageMenu(false);
                    setAuditFilters({});
                    updateAuditLocation({ auditPage: page.id });
                  }}
                >
                  <Globe2 /> <span>{page.name}</span> {selectedPage?.id === page.id && <Check />}
                </button>
                {!isPrimaryAuditPage(page) && (
                  <button
                    className="audit-page-delete"
                    aria-label={`Delete ${page.name} and its audit data`}
                    title="Delete page"
                    onClick={() => setPageToDelete(page)}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
            <button onClick={() => { setPageMenu(false); setAddPage(true); }}><Plus /> Add page</button>
          </div>
        )}
        <button className="iconbtn" onClick={() => setAddPage(true)} aria-label="Add audit page">
          <Plus />
        </button>
        <Tabs
          labels={["Overview", "Checks", "Findings", "History", "Compare"]}
          value={tab}
          onChange={(nextTab) => { setTab(nextTab); setAuditFilters({}); updateAuditLocation({ auditTab: nextTab }); }}
        />
      </div>
      {pageToDelete && (
        <SimpleDialog
          title="Delete audit page"
          close={() => setPageToDelete(null)}
          action="Delete page"
          danger
          onSave={() => void deleteAuditPage(pageToDelete)}
        >
          <p>Delete <b>{pageToDelete.name}</b> from this audit and permanently remove all audit runs and findings saved for it?</p>
        </SimpleDialog>
      )}
      {progressRun && <AuditProgress run={progressRun} onRetry={() => void run()} />}
      {partial && (
        <div className="coverage-note partial">
          <b>Incomplete audit coverage</b>
          <span>
            {(latest?.coverage ?? 0) < 80
              ? `${latest?.coverage || 0}% of the selected checks produced evidence.`
              : `${completedCategoryCount} of ${auditCategories.length} approved score categories produced evidence.`}
            {" "}The recorded score is not presented as a complete site grade.
          </span>
        </div>
      )}
      {tab === "Overview" ? (
        <>
          <AuditScore run={latest} />
          <div className="grid">
            <div>
              <Panel title={`Fix these first · ${selectedPage?.name || "Selected page"}`}>
              {shouldShowAuditQuickFilters(resultCounts) && (
                <div className="audit-summary" aria-label="Finding severity filters">
                  {resultCounts.critical > 0 && <AuditQuickFilter kind="critical" count={resultCounts.critical} filters={auditFilters} onChange={setAuditFilters} />}
                  {resultCounts.security > 0 && <AuditQuickFilter kind="security" count={resultCounts.security} filters={auditFilters} onChange={setAuditFilters} />}
                  {resultCounts.warning > 0 && <AuditQuickFilter kind="warning" count={resultCounts.warning} filters={auditFilters} onChange={setAuditFilters} />}
                </div>
              )}
              <AuditFilterMenu
                results={actionable}
                filters={auditFilters}
                onChange={setAuditFilters}
                kinds={["critical", "security", "warning", "unable_to_test"]}
              />
              {auditDataLoading && !latest ? (
                <div className="audit-results-loading" role="status"><RefreshCw className="audit-spin" /> Loading your last audit</div>
              ) : (
                <AuditResults results={filteredActionable} filters={auditFilters} hideOutcome />
              )}
              </Panel>
              <div className="audit-run-meta">
                <p>{latest
                    ? `Latest completed result for ${selectedPage?.name}: ${fmtDate(latest.completed_at || latest.created_at)} · run ${latest.id.slice(0, 8)}`
                    : `${selectedPage?.name || "This page"} has not been audited yet.`}
                  {activeRun && latest ? " · Previous completed result remains visible while the new run is active." : ""}</p>
                <p>Audit coverage: {latest?.coverage != null ? `${latest.coverage}% of enabled checks produced evidence in this run.` : "--"}</p>
                <p>Implementation coverage: {implementationCoverage != null ? `${implementationCoverage}% of catalogue checks are implemented.` : "--"}</p>
              </div>
            </div>
            <div>
              <div className="audit-performance-toolbar">
                <div className="seg audit-performance-mode" role="group" aria-label="Performance data source">
                  {(["Lab audit", "Real-user data"] as const).map((mode) => (
                    <button key={mode} className={performanceMode === mode ? "active" : ""} onClick={() => setPerformanceMode(mode)}>{mode}</button>
                  ))}
                </div>
              </div>
              {performanceMode === "Lab audit" ? (
                <>
                  <Panel className="audit-performance-panel" title={<span className="performance-panel-title"><Monitor /> Desktop performance</span>}><PerformanceTable mobile={false} run={latest} /></Panel>
                  <Panel className="audit-performance-panel" title={<span className="performance-panel-title"><Smartphone /> Mobile performance</span>}><PerformanceTable mobile run={latest} /></Panel>
                </>
              ) : (
                <>
                  <Panel className="audit-performance-panel" title={<span className="performance-panel-title"><Monitor /> Desktop performance</span>}><RealUserPerformanceTable data={realUserPerformance} device="desktop" /></Panel>
                  <Panel className="audit-performance-panel" title={<span className="performance-panel-title"><Smartphone /> Mobile performance</span>}><RealUserPerformanceTable data={realUserPerformance} device="mobile" /></Panel>
                </>
              )}
              <div className="audit-performance-note">Lab uses load-based <MetricTerm term="TBT" />; real-user data uses <MetricTerm term="INP" />.</div>
              {latest && (
                <AuditAiFixPrompt
                  pageName={selectedPage?.name || "Selected page"}
                  pageUrl={latest.page_url || property.url}
                  runId={latest.id}
                  results={actionable}
                  notify={notify}
                />
              )}
            </div>
          </div>
        </>
      ) : tab === "Findings" ? (
        <AuditFindingsPanel
          pageName={selectedPage?.name || "Selected page"}
          results={results}
          filters={auditFilters}
          setFilters={setAuditFilters}
          openCategories={openCategories}
          setOpenCategories={setOpenCategories}
        />
      ) : tab === "Checks" ? (
        <AuditChecksPanel
          pageName={selectedPage?.name || "Selected page"}
          run={latest}
          results={results}
          onOpenCategory={openFindingCategory}
        />
      ) : tab === "History" ? (
        <div className="audit-tab-content"><Panel title="Audit history">
            <DataTable
              headers={["Started", "Page", "Status", "Score", "Coverage", "Duration"]}
              rows={runs.map((r) => [
                fmtDate(r.created_at),
                r.page_url || property.url,
                auditHistoryStatus(r.status),
                r.score ?? "—",
                r.coverage != null ? `${r.coverage}%` : "—",
                r.duration_ms ? `${r.duration_ms} ms` : "—",
              ])}
            />
          </Panel></div>
      ) : (
        <div className="audit-tab-content"><AuditComparePanel
            pageName={selectedPage?.name || "Selected page"}
            runs={runs}
            earlierRunId={earlierRunId}
            laterRunId={laterRunId}
            onEarlierChange={(id) => { setEarlierRunId(id); updateAuditLocation({ auditEarlier: id }); }}
            onLaterChange={(id) => { setLaterRunId(id); updateAuditLocation({ auditLater: id }); }}
          /></div>
      )}
      {addPage && (
        <Modal title="Add page to audit" close={() => setAddPage(false)}>
          <label className="field">Page name<input value={pageName} onChange={(event) => setPageName(event.target.value)} placeholder="About" autoFocus /></label>
          <label className="field">URL or path<input value={pagePath} onChange={(event) => setPagePath(event.target.value)} placeholder="/about/" /></label>
          <p className="subtle">Only pages on {property.canonical_host} can be added. Adding a page does not start an audit.</p>
          {pageError && <div className="error-note" role="alert">{pageError}</div>}
          {pageSaveState === "success" && <div className="notice" role="status">Page saved and selected.</div>}
          <div className="dialog-actions">
            <button className="btn" onClick={() => setAddPage(false)} disabled={pageSaveState === "saving"}>Cancel</button>
            <button className="primary" onClick={() => void saveAuditPage()} disabled={!pageName.trim() || !pagePath.trim() || pageSaveState === "saving"}>{pageSaveState === "saving" ? "Saving…" : "Add page"}</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function ReportsView({
  session,
  property,
  fixture,
  notify,
}: {
  session: Session | null;
  property?: Property;
  fixture: boolean;
  notify: Notify;
}) {
  const reportsLocation = useLocation();
  const livePeriod = periodQuery(reportsLocation.search);
  const [tab, setTab] = useState("Quick reports"),
    [preview, setPreview] = useState<any>(),
    [scheduleOpen, setScheduleOpen] = useState(false),
    [scheduleCadence, setScheduleCadence] = useState("monthly"),
    [scheduleRecipient, setScheduleRecipient] = useState("client@example.com"),
    [agencyName, setAgencyName] = useState(
      property?.settings?.report_branding?.agency_name || "",
    ),
    [accentColour, setAccentColour] = useState(
      property?.settings?.report_branding?.accent_colour || "#111111",
    ),
    [footerNote, setFooterNote] = useState(
      property?.settings?.report_branding?.footer_note || "",
    ),
    [savedReports, setSavedReports] = useState<any[]>([]),
    [schedules, setSchedules] = useState<any[]>(
      fixture
        ? [
            [
              "Monthly website health",
              "Monthly",
              "client@example.com",
              "Active",
            ],
          ]
        : [],
    );
  useEffect(() => {
    if (!session || !property || fixture) return;
    Promise.all([
      api<any[]>(session, `/api/properties/${property.id}/saved-reports`),
      api<any[]>(session, `/api/properties/${property.id}/report-schedules`),
    ])
      .then(([reports, storedSchedules]) => {
        setSavedReports(reports);
        setSchedules(storedSchedules);
      })
      .catch((error) => notify(error.message));
  }, [fixture, notify, property, session]);
  async function create(name: string) {
    if (!property) return;
    setPreview(
      session
        ? await api(session, `/api/properties/${property.id}/report?${livePeriod}`)
        : {
            property,
            period: "1 – 30 Sep 2026",
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            generatedAt: new Date().toISOString(),
            incidents: [],
            audits: [fixtureAudit(property)],
            analytics: fixtureAnalytics(property),
            recommendations: [
              "Resolve critical accessibility findings.",
              "Prioritise the hero image for mobile LCP.",
              "Review event trends next month.",
            ],
          },
    );
    notify(`${name} preview generated`);
  }
  async function saveReport() {
    if (!preview || !property) return;
    const report = session
      ? await api<any>(session, `/api/properties/${property.id}/saved-reports`, {
          method: "POST",
          body: JSON.stringify({
            name: `${property.name} ${preview.period || "website"} report`,
            periodStart: preview.periodStart,
            periodEnd: preview.periodEnd,
            dataSnapshot: preview,
          }),
        })
      : {
          id: crypto.randomUUID(),
          name: `${property.name} ${preview.period || "website"} report`,
          period_start: "2026-09-01",
          period_end: "2026-09-30",
          data_snapshot: preview,
          created_at: new Date().toISOString(),
        };
    setSavedReports((current) => [report, ...current]);
    notify("Report saved");
  }
  async function saveBranding() {
    if (!session || !property) return;
    try {
      await api(session, `/api/properties/${property.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: property.name,
          settings: {
            report_branding: {
              agency_name: agencyName,
              accent_colour: accentColour,
              footer_note: footerNote,
            },
          },
        }),
      });
      notify("Report branding saved");
    } catch (error: any) {
      notify(error.message);
    }
  }
  return (
    <Page
      title="Reports"
      status={<Period />}
      actions={
        <button
          className="primary"
          disabled={!property}
          onClick={() => create("Custom report")}
        >
          <Plus />
          Create report
        </button>
      }
    >
      <Tabs
        labels={["Quick reports", "Saved reports", "Schedules", "Branding"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Quick reports" ? (
        <div className="template-grid">
          {[
            "Monthly overview",
            "Uptime & incidents",
            "Audit & fixes",
            "Traffic & events",
            "Visitor performance",
            "Client summary",
          ].map((x, i) => (
            <Panel title={x} key={x}>
              <div className="report-thumb">
                <FileChartColumn />
              </div>
              <p className="subtle">
                {
                  [
                    "All key client metrics in one concise report.",
                    "Availability, checks and incident history.",
                    "Prioritised findings with evidence and fixes.",
                    "Traffic, pages, sources and configured events.",
                    "Core Web Vitals and browser samples.",
                    "Executive summary with agency commentary.",
                  ][i]
                }
              </p>
              <button className="btn" onClick={() => create(x)}>
                Use template
              </button>
            </Panel>
          ))}
        </div>
      ) : tab === "Saved reports" ? (
        <Panel title="Saved reports">
          {savedReports.length ? (
            <DataTable
              headers={["Report", "Property", "Period", "Generated", ""]}
              rows={savedReports.map((report) => [
                report.name,
                property?.canonical_host,
                report.period_start && report.period_end
                  ? `${report.period_start} – ${report.period_end}`
                  : report.data_snapshot?.period || "Last 30 days",
                fmtDate(report.created_at),
                <button
                  className="btn"
                  onClick={() => setPreview(report.data_snapshot)}
                >
                  View
                </button>,
              ])}
            />
          ) : (
            <Empty
              title="No saved reports"
              detail="Generate a quick report to create the first preview."
            />
          )}
        </Panel>
      ) : tab === "Schedules" ? (
        <Panel
          title="Report schedules"
          actions={
            <button className="btn" onClick={() => setScheduleOpen(true)}>
              <Plus />
              Add schedule
            </button>
          }
        >
          {schedules.length ? (
            <DataTable
              headers={["Template", "Frequency", "Recipient", "Next delivery", "Last result"]}
              rows={schedules.map((schedule) =>
                Array.isArray(schedule)
                  ? schedule
                  : [
                      "Monthly overview",
                      `${schedule.cadence?.[0]?.toUpperCase() || ""}${schedule.cadence?.slice(1) || ""}`,
                      schedule.recipients?.join(", "),
                      schedule.enabled ? fmtDate(schedule.next_run_at) : "Paused",
                      schedule.last_error
                        ? `Failed: ${schedule.last_error}`
                        : schedule.last_run_at
                          ? `${schedule.last_delivery_count} delivered · ${fmtDate(schedule.last_run_at)}`
                          : "Awaiting first run",
                    ],
              )}
            />
          ) : (
            <Empty
              title="No schedules"
              detail="Add a schedule for recurring client reports."
            />
          )}
        </Panel>
      ) : (
        <div className="grid equal">
          <Panel title="Report branding">
            <label className="field">
              Agency name
              <input value={agencyName} onChange={(event) => setAgencyName(event.target.value)} />
            </label>
            <label className="field">
              Accent colour
              <input type="color" value={accentColour} onChange={(event) => setAccentColour(event.target.value)} />
            </label>
            <label className="field">
              Footer note
              <input value={footerNote} onChange={(event) => setFooterNote(event.target.value)} />
            </label>
            <button
              className="primary"
              onClick={saveBranding}
            >
              Save branding
            </button>
          </Panel>
          <Panel title="Preview">
            <div className="brand-preview">
              <img src="/assets/claritude-logo.svg" />
              <h2>{property?.name || "Website"} performance report</h2>
              <p>1 – 30 Sep 2026</p>
              <hr />
              <b>{footerNote || (agencyName ? `Prepared by ${agencyName}` : "Claritude report")}</b>
            </div>
          </Panel>
        </div>
      )}
      {preview && (
        <ReportPreview
          report={preview}
          close={() => setPreview(undefined)}
          onSave={saveReport}
        />
      )}{" "}
      {scheduleOpen && (
        <SimpleDialog
          title="Add schedule"
          close={() => setScheduleOpen(false)}
          action="Add schedule"
          onSave={async () => {
            const schedule =
              session && property
                ? await api<any>(
                    session,
                    `/api/properties/${property.id}/report-schedules`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        cadence: scheduleCadence,
                        recipients: [scheduleRecipient],
                      }),
                    },
                  )
                : [
                    "Monthly overview",
                    `${scheduleCadence[0].toUpperCase()}${scheduleCadence.slice(1)}`,
                    scheduleRecipient,
                    "Active",
                  ];
            setSchedules((v) => [...v, schedule]);
            setScheduleOpen(false);
            notify("Schedule added");
          }}
        >
          <label className="field">
            Template
            <select>
              <option>Monthly overview</option>
              <option>Audit & fixes</option>
            </select>
          </label>
          <label className="field">
            Frequency
            <select
              value={scheduleCadence}
              onChange={(event) => setScheduleCadence(event.target.value)}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="field">
            Recipient
            <input
              type="email"
              value={scheduleRecipient}
              onChange={(event) => setScheduleRecipient(event.target.value)}
            />
          </label>
        </SimpleDialog>
      )}
    </Page>
  );
}

function PropertySettingsView({
  session,
  property,
  reload,
  notify,
}: {
  session: Session | null;
  property?: Property;
  reload: () => void;
  notify: Notify;
}) {
  const settingsLocation = useLocation();
  const settingsNavigate = useNavigate();
  const requestedSettingsTab = new URLSearchParams(settingsLocation.search).get("settingsTab");
  const settingsTabs = ["General", "Tracking", "Uptime", "Events", "Sharing", "Advanced"];
  const [tab, setTab] = useState(settingsTabs.includes(requestedSettingsTab || "") ? requestedSettingsTab! : "General"),
    [name, setName] = useState(property?.name || ""),
    [timezone, setTimezone] = useState(property?.settings?.timezone || "Europe/London"),
    [currency, setCurrency] = useState(property?.settings?.reporting_currency || "GBP"),
    [ipHandling, setIpHandling] = useState(
      property?.settings?.ip_address_handling || "discard_after_geolocation",
    ),
    [sensitiveParams, setSensitiveParams] = useState(
      (property?.settings?.sensitive_query_parameters || ["token", "email", "session"]).join(", "),
    ),
    [busy, setBusy] = useState(false),
    [viewerOpen, setViewerOpen] = useState(false),
    [viewerEmail, setViewerEmail] = useState(""),
    [viewers, setViewers] = useState<any[]>([]),
    [workspaceAccess, setWorkspaceAccess] = useState<any[]>([]),
    [viewerMenu, setViewerMenu] = useState<string | null>(null),
    [viewerToRemove, setViewerToRemove] = useState<any | null>(null),
    [deleteOpen, setDeleteOpen] = useState(false),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [resetOpen, setResetOpen] = useState(false),
    [resetConfirmation, setResetConfirmation] = useState(""),
    [trackingDiagnostics, setTrackingDiagnostics] = useState<any>(null);
  useEffect(() => {
    if (!session || !property) return;
    setName(property.name || "");
    setTimezone(property.settings?.timezone || "Europe/London");
    setCurrency(property.settings?.reporting_currency || "GBP");
    setIpHandling(property.settings?.ip_address_handling || "discard_after_geolocation");
    setSensitiveParams(
      (property.settings?.sensitive_query_parameters || ["token", "email", "session"]).join(", "),
    );
    api<any[]>(session, `/api/properties/${property.id}/viewers`)
      .then(setViewers)
      .catch(() => setViewers([]));
    api<any>(session, `/api/properties/${property.id}/tracking-diagnostics`)
      .then(setTrackingDiagnostics)
      .catch(() => setTrackingDiagnostics(null));
    api<any>(session, "/api/users")
      .then((result) => setWorkspaceAccess((result.workspaceMemberships || []).filter((membership: any) => membership.workspace_id === property.workspace_id).map((membership: any) => ({
        ...membership,
        source: "Workspace",
        user: result.users?.find((user: any) => user.id === membership.user_id),
      }))))
      .catch(() => setWorkspaceAccess([]));
  }, [property?.id, session]);
  useEffect(() => {
    if (requestedSettingsTab && settingsTabs.includes(requestedSettingsTab)) setTab(requestedSettingsTab);
  }, [requestedSettingsTab]);
  useEffect(() => {
    if (!viewerMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".viewer-row-menu")) setViewerMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setViewerMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [viewerMenu]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Property settings require a selected property."
      />
    );
  async function save() {
    setBusy(true);
    try {
      if (session)
        await api(session, `/api/properties/${property!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            settings: {
              timezone,
              reporting_currency: currency,
              ip_address_handling: ipHandling,
              analytics_cookies: "disabled",
              visitor_profiles: "anonymous",
              sensitive_query_parameters: sensitiveParams
                .split(",")
                .map((value: string) => value.trim())
                .filter(Boolean),
            },
          }),
        });
      notify("Property settings saved");
      reload();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const snippet = `<script defer src="${location.origin}/c.js" data-property="${property.tracking_id}"></script>`;
  return (
    <Page
      title="Property settings"
      status={<Status value={property.verification_status} />}
    >
      <Tabs
        labels={settingsTabs}
        value={tab}
        onChange={setTab}
      />
      {tab === "General" ? (
        <>
        <Panel title="General">
          <label className="field">
            Property name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Website URL
            <input value={property.url} readOnly className="readonly" />
          </label>
          <div className="form-two">
            <label className="field">
              Timezone
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </label>
            <label className="field">
              Reporting currency
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="GBP">GBP (£)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </label>
          </div>
          <div className="settings-actions right">
            <button
              className="primary"
              disabled={busy || !name}
              onClick={save}
            >
              Save general settings
            </button>
          </div>
        </Panel>
        <SetupPanel property={property} />
        </>
      ) : tab === "Tracking" ? (
        <>
          <Panel title="Install analytics code">
            <p className="settings-intro">Add the script to the site-wide <code>&lt;head&gt;</code> template so it loads once on every measured page. Claritude automatically detects common browser history navigation in single-page applications; call <code>claritude.pageview()</code> only when a router does not update browser history.</p>
            <pre className="install-code install-code-dark">{snippet}</pre>
            <CopyButton text={snippet} label="Copy snippet" successMessage="Tracking snippet copied" notify={notify} />
          </Panel>
          <Panel title="Tracking status">
            <KeyValues
              rows={[
                ["Status", <StatusPill tone={property.tracking_last_received_at ? "success" : "danger"}>{property.tracking_last_received_at ? "Online" : "Offline"}</StatusPill>],
                ["Public property ID", property.tracking_id],
                ["Allowed host", property.canonical_host],
                [
                  "Last event",
                  property.tracking_last_received_at
                    ? relative(property.tracking_last_received_at)
                    : "Never",
                ],
                ["Cookies", "None"],
                ["Persistent visitor IDs", "None"],
                ["Tracker served", trackingDiagnostics?.currentTrackerVersion || "Checking…"],
                ["Tracker last received", trackingDiagnostics?.receivedTrackerVersion || (property.tracking_last_received_at ? "Legacy tracker" : "Not received")],
                ["Update status", trackingDiagnostics?.updateRequired ? "Update required" : trackingDiagnostics?.receivedTrackerVersion ? "Current" : "Awaiting a versioned event"],
              ]}
            />
            <div className="settings-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (!session) return;
                  setBusy(true);
                  try {
                    const result = await api<any>(session, `/api/properties/${property.id}/verify`, { method: "POST" });
                    notify(result.verified ? "Tracking installation verified" : "Tracking identifier was not found on the public page");
                    reload();
                  } catch (error: any) {
                    notify(error.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw />
                Verify installation
              </button>
            </div>
            {trackingDiagnostics && (
              <div className="tracking-signal-grid">
                {Object.entries(trackingDiagnostics.signals || {}).map(([signal, count]) => (
                  <div key={signal}><small>{eventLabel(signal)}</small><b>{fmt(Number(count || 0))}</b><span>{Number(count || 0) ? "Received in latest sample" : "Not observed in latest sample"}</span></div>
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : tab === "Uptime" ? (
        <>
          <MonitorPanel
            session={session}
            monitor={property.uptime_monitors?.[0]}
            reload={reload}
            notify={notify}
          />
          <AlertPanel
            session={session}
            property={property}
            fixture={false}
            notify={notify}
          />
        </>
      ) : tab === "Events" ? (
        <EventsPanel
          session={session}
          property={property}
          fixture={false}
          notify={notify}
        />
      ) : tab === "Sharing" ? (
        <Panel title="Property access" actions={<button className="btn" onClick={() => setViewerOpen(true)}><Plus /> Invite user</button>}>
          <DataTable
            headers={[
              "User",
              "Access source",
              "Status",
              "Analytics",
              "Audit",
              "Uptime",
              "",
            ]}
            rows={[
              ["Account holder", "Account owner", <StatusPill tone="success">Active</StatusPill>, "Allowed", "Allowed", "Allowed", ""],
              ...workspaceAccess.map((access) => [
                access.user?.name || access.user?.email || "Workspace user",
                `${cap(access.role)} · inherited from workspace`,
                <StatusPill tone={access.user?.confirmedAt ? "success" : "neutral"}>{access.user?.confirmedAt ? "Active" : "Invited"}</StatusPill>,
                "Allowed",
                "Allowed",
                "Allowed",
                <span className="subtle">Managed in Account settings</span>,
              ]),
              ...viewers.map((viewer) => [
                viewer.name || viewer.email,
                "Direct property viewer",
                <StatusPill tone={viewer.confirmedAt ? "success" : "neutral"}>{viewer.confirmedAt ? "Active" : "Invited"}</StatusPill>,
                "View only",
                "View only",
                "View only",
                <span className="row-action-wrap viewer-row-menu"><button className="iconbtn" aria-label={`${viewer.name || viewer.email} actions`} onClick={() => setViewerMenu(viewerMenu === viewer.user_id ? null : viewer.user_id)}><MoreHorizontal /></button>{viewerMenu === viewer.user_id && <span className="action-menu row-action-menu"><button onClick={() => { setViewerMenu(null); setViewerToRemove(viewer); }}><Trash2 /> Remove access</button></span>}</span>,
              ]),
            ]}
          />
          <p className="subtle settings-footnote">Property invitations are view-only. Workspace access is inherited and managed from Account settings.</p>
        </Panel>
      ) : (
        <>
        <Panel title="Advanced actions">
          <AdvancedRow
            title="Property verification"
            detail="Check the public site for this property’s tracking identifier."
            action={
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = session
                      ? await api<any>(session, `/api/properties/${property.id}/verify`, { method: "POST" })
                      : { verified: true };
                    notify(result.verified ? "Property verified" : "Tracking identifier was not found on the public page");
                    reload();
                  } catch (error: any) {
                    notify(error.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw />
                Verify now
              </button>
            }
          />
          <AdvancedRow
            title="Export property data"
            detail="Download analytics, audits and configuration."
            action={<button className="btn" onClick={() => {
              if (!session) return;
              void api<any>(session, `/api/properties/${property.id}/export`).then((exported) => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
                const link = document.createElement("a");
                link.href = url;
                link.download = `${property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-claritude-export.json`;
                link.click();
                URL.revokeObjectURL(url);
                notify("Property export downloaded");
              }).catch((error) => notify(error.message));
            }}>Export data</button>}
          />
          <AdvancedRow
            danger
            title="Reset property"
            detail="Restore measured property data to its initial state."
            action={<button className="danger-solid" onClick={() => setResetOpen(true)}>Reset property</button>}
          />
          <AdvancedRow
            danger
            title="Delete property"
            detail="Permanently removes this property and future monitoring."
            action={
              <button className="danger-solid" onClick={() => setDeleteOpen(true)}>
                Delete property
              </button>
            }
          />
        </Panel>
        </>
      )}
      {viewerOpen && (
        <SimpleDialog
          title="Invite property viewer"
          close={() => setViewerOpen(false)}
          action="Create invitation"
          onSave={async () => {
            if (!session || !viewerEmail) return;
            try {
              const viewer = await api<any>(session, `/api/properties/${property.id}/viewers`, {
                method: "POST",
                body: JSON.stringify({ email: viewerEmail }),
              });
              setViewers((current) => [
                ...current.filter((item) => item.user_id !== viewer.user_id),
                viewer,
              ]);
              setViewerOpen(false);
              setViewerEmail("");
              notify(viewer.invitationSent ? "Viewer invited" : "Existing user granted access");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <label className="field">Email<input type="email" value={viewerEmail} onChange={(event) => setViewerEmail(event.target.value)} placeholder="client@example.com" /></label>
          <p className="subtle">Viewers receive read-only access to Analytics, Audit and Uptime for this property.</p>
        </SimpleDialog>
      )}
      {viewerToRemove && (
        <SimpleDialog
          title="Remove property viewer"
          close={() => setViewerToRemove(null)}
          action="Remove access"
          danger
          onSave={async () => {
            if (!session) return;
            try {
              await api(session, `/api/properties/${property.id}/viewers/${viewerToRemove.user_id}`, {
                method: "DELETE",
              });
              setViewers((current) => current.filter((item) => item.user_id !== viewerToRemove.user_id));
              setViewerToRemove(null);
              notify("Property viewer access removed");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p>Remove read-only access for <b>{viewerToRemove.name || viewerToRemove.email}</b>?</p>
        </SimpleDialog>
      )}
      {deleteOpen && (
        <SimpleDialog
          title="Delete property"
          close={() => { setDeleteOpen(false); setDeleteConfirmation(""); }}
          action="Delete property"
          danger
          disabled={deleteConfirmation !== property.name || busy}
          onSave={async () => {
            if (!session || deleteConfirmation !== property.name) return;
            setBusy(true);
            try {
              await api(session, `/api/properties/${property.id}`, { method: "DELETE" });
              setDeleteOpen(false);
              setDeleteConfirmation("");
              settingsNavigate("/");
              reload();
              notify("Property deleted");
            } catch (error: any) {
              notify(error.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>This permanently removes the property and its monitoring, analytics, audits and reports.</p>
          <label className="field">
            Type <b>{property.name}</b> to confirm
            <input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
          </label>
        </SimpleDialog>
      )}
      {resetOpen && (
        <SimpleDialog
          title="Reset property"
          close={() => { setResetOpen(false); setResetConfirmation(""); }}
          action="Reset property"
          danger
          disabled={resetConfirmation !== property.name || busy}
          onSave={async () => {
            if (!session || resetConfirmation !== property.name) return;
            setBusy(true);
            try {
              await api(session, `/api/properties/${property.id}/reset`, { method: "POST" });
              setResetOpen(false);
              setResetConfirmation("");
              reload();
              notify("Property data reset");
            } catch (error: any) {
              notify(error.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>This permanently removes analytics observations, uptime checks and incidents, audits, configured custom events, saved reports and property notifications.</p>
          <p className="subtle">The property, workspace/account membership, property viewers, monitor configuration, alert recipients and report schedules are retained.</p>
          <label className="field">Type <b>{property.name}</b> to confirm<input autoFocus value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} /></label>
        </SimpleDialog>
      )}
    </Page>
  );
}

type SuperAdminPayload = {
  stats: {
    accounts: number;
    workspaces: number;
    properties: number;
    users: number;
    activeMonitors: number;
    offlineMonitors: number;
    openIncidents: number;
    auditsToday: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    entitlement: string;
    effectivePackageKey?: string;
    effectivePackageName?: string;
    billingArrangement?: "standard" | "complimentary";
    created_at: string;
    workspaceCount: number;
    propertyCount: number;
    userCount: number;
    offlineCount: number;
  }>;
  workspaces: Array<{ id: string; account_id: string; name: string; created_at: string; propertyCount: number }>;
  properties: Array<{ id: string; accountId: string | null; workspace_id: string; name: string; canonical_host: string; verification_status: string; tracking_last_received_at: string | null; created_at: string; monitor: any }>;
  users: Array<{
    id: string;
    email: string;
    name: string;
    confirmedAt: string | null;
    lastSignInAt: string | null;
    createdAt: string;
    accountCount: number;
    accountIds?: string[];
  }>;
};

const fixtureSuperAdminPayload: SuperAdminPayload = {
  stats: { accounts: 4, workspaces: 7, properties: 12, users: 9, activeMonitors: 11, offlineMonitors: 1, openIncidents: 1, auditsToday: 6 },
  accounts: [
    { id: "websi", name: "Websi", entitlement: "pro_early_access", created_at: "2026-09-28T09:00:00Z", workspaceCount: 2, propertyCount: 4, userCount: 3, offlineCount: 0 },
    { id: "north", name: "North Commerce", entitlement: "scale", created_at: "2026-09-29T10:00:00Z", workspaceCount: 2, propertyCount: 3, userCount: 2, offlineCount: 1 },
    { id: "atlas", name: "Atlas Studio", entitlement: "essentials", created_at: "2026-10-01T11:00:00Z", workspaceCount: 2, propertyCount: 3, userCount: 2, offlineCount: 0 },
    { id: "cedar", name: "Cedar Finance", entitlement: "free", created_at: "2026-10-03T12:00:00Z", workspaceCount: 1, propertyCount: 2, userCount: 2, offlineCount: 0 },
  ],
  workspaces: [
    { id: "websi-main", account_id: "websi", name: "Websi workspace", created_at: "2026-09-28T09:00:00Z", propertyCount: 4 },
  ],
  properties: [
    { id: "websi-property", accountId: "websi", workspace_id: "websi-main", name: "Websi", canonical_host: "websi.com", verification_status: "verified", tracking_last_received_at: "2026-10-06T01:00:00Z", created_at: "2026-09-28T09:00:00Z", monitor: { enabled: true, last_status: "online" } },
  ],
  users: [
    { id: "admin", name: "Claritude Admin", email: "admin@claritude.io", confirmedAt: "2026-09-28T08:00:00Z", lastSignInAt: "2026-10-06T00:30:00Z", createdAt: "2026-09-28T08:00:00Z", accountCount: 1, accountIds: ["websi"] },
    { id: "adam", name: "Adam Jordan", email: "adam.jordan@websi.com", confirmedAt: "2026-10-01T08:00:00Z", lastSignInAt: "2026-10-05T18:15:00Z", createdAt: "2026-10-01T08:00:00Z", accountCount: 1, accountIds: ["websi"] },
  ],
};

function StaffMfaGate({ staff }: { staff: NonNullable<Bootstrap["staff"]> }) {
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.mfa.listFactors().then(async ({ data, error }) => {
      if (!active) return;
      if (error) return setMessage(error.message);
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Claritude ${staff.role}` });
      if (!active) return;
      if (enrolled.error) return setMessage(enrolled.error.message);
      setFactorId(enrolled.data.id);
      setQr(enrolled.data.totp.qr_code);
      setSecret(enrolled.data.totp.secret);
    });
    return () => { active = false; };
  }, [staff.role]);

  async function verify() {
    if (!factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMessage("");
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (result.error) {
      setMessage(result.error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.refreshSession();
    window.location.reload();
  }

  return (
    <Page title="SuperAdmin security check" showOptions={false} status={<span className="tag">{cap(staff.role)}</span>}>
      <Panel title={qr ? "Set up an authenticator" : "Enter your authenticator code"}>
        <div className="mfa-gate">
          <ShieldAlert />
          <div>
            <h2>Multi-factor authentication is required</h2>
            <p>Privileged platform data and controls remain locked until this session reaches AAL2.</p>
          </div>
          {qr && <img className="mfa-qr" src={qr} alt="Authenticator QR code" />}
          {secret && <p className="subtle">Can’t scan? Enter this key in your authenticator: <code>{secret}</code></p>}
          <label className="field">Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
          {message && <p className="form-error" role="alert">{message}</p>}
          <button className="btn primary" disabled={busy || !factorId || code.length !== 6} onClick={() => void verify()}>{busy ? "Verifying…" : "Unlock SuperAdmin"}</button>
          <p className="subtle">For recovery, another platform Owner can reset a lost factor from Staff &amp; Permissions. Owners should enrol a second factor after access is restored.</p>
        </div>
      </Panel>
    </Page>
  );
}

const fixturePlatformPayload: any = {
  environment: { name: "Fixture", commitSha: "fixture", refreshedAt: new Date().toISOString() },
  providers: { stripe: { configured: false, mode: "unconfigured", tax: "unconfigured" }, resend: { configured: true, from: "alerts@claritude.io" }, cloudflareTelemetry: "unavailable", supabaseBackups: "unverified" },
  settings: [
    { key: "inactivity_policy", value: { warningDays: [60, 90], freezeDay: 100, deletionEligibleDay: 121, automaticDeletionEnabled: false }, description: "Free-account inactivity lifecycle", source: "application", updated_at: new Date().toISOString() },
    { key: "outbound_automation", value: { campaignsEnabled: false, inactivityNoticesEnabled: false, weeklyDigestEnabled: false, safeTestRecipients: [] }, description: "Outbound activation safeguards", source: "application", updated_at: new Date().toISOString() },
    { key: "email_settings", value: { senderName: "Claritude", replyTo: "", enabledCategories: ["uptime_down", "uptime_recovered", "report"], suppressionHandling: "enforce", hourlySendLimit: 1000 }, description: "Sender identity and delivery rules", source: "application", updated_at: new Date().toISOString() },
    { key: "alert_digest", value: { enabled: false, recipients: [], schedule: "0 9 * * 1", timezone: "Europe/London", includedMetrics: ["active_alerts"] }, description: "Weekly operational digest", source: "application", updated_at: new Date().toISOString() },
    { key: "staff_sessions", value: { defaultMinutes: 30, maximumMinutes: 60, writeModeAllowed: true, requireReason: true }, description: "Scoped customer-session safeguards", source: "application", updated_at: new Date().toISOString() },
    { key: "retention_policy", value: { adminLogsDays: 730, usageLedgerDays: 2555, exportsDays: 7, evidenceDays: 90, analyticsRawDays: 90, uptimeChecksDays: 365, auditResultsDays: 730 }, description: "Retention and cleanup policy", source: "application", updated_at: new Date().toISOString() },
    { key: "safety_limits", value: { platformAuditStartsPerDay: 200, concurrentAudits: 5, auditWallTimeSeconds: 600, httpResponseBytes: 5000000, linksPerAudit: 5000, resourcesPerAudit: 5000, redirects: 5, queueRetries: 3, analyticsPayloadBytes: 262144, analyticsEventsPerPropertyPerDay: 50000, exportsPerAccountPerDay: 10 }, description: "Application safety ceilings", source: "application", updated_at: new Date().toISOString() },
  ], settingHistory: [], controls: [{ key: "new_audits", paused: false }, { key: "analytics_ingestion", paused: false }, { key: "uptime_checks", paused: false }, { key: "campaigns", paused: false }], featureStates: { campaigns: { state: "awaiting_configuration", reason: "Safe recipients are not configured", permitted: true, runningJobs: 0 }, weeklyDigest: { state: "awaiting_configuration", reason: "Recipients are not configured", permitted: true, runningJobs: 0 } }, alerts: [], alertRules: [{ id: "fixture-alert-rule", name: "Audit failure rate", metric: "audit.failure_rate", operator: "gte", threshold: 5, observation_minutes: 15, minimum_samples: 3, cooldown_minutes: 60, scope: {}, evaluation_state: "telemetry_unavailable", enabled: false }], alertHistory: [], alertCoverage: { enabledRuleCount: 0, lastEvaluationAt: null, evaluatorHealth: "no_rules" }, incidents: [],
  packages: [{ id: "12345678-1234-1234-1234-123456789abc", package_key: "pro_early_access", version: 1, display_name: "Pro early access", state: "published", allowances: { customEventsPerProperty: null }, features: { complimentaryEarlyAccess: true }, hard_ceilings: { propertiesPerAccount: 25 }, unresolved_values: ["futurePrice", "auditCreditsPerWeek"] }], grants: [], overrides: [], inactivity: [],
  audits: { technicalChecks: [], groups: [], today: { queued: 0, running: 0, completed: 6, partial: 0, failed: 0 }, source: "application_measured", period: "UTC day" },
  exports: [{ id: "fixture-export", scope: "accounts", format: "csv", state: "completed", progress: 100, row_count: 2, expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString() }], deletionRequests: [], email: { templates: [{ id: "fixture-template", template_key: "uptime_recovered", version: 1, subject: "{{propertyName}} has recovered", variables: ["propertyName", "propertyUrl"], state: "active", sending_path: "Worker uptime notification queue", provider_managed: false }], automations: [{ key: "uptime_recovered", trigger_key: "incident.resolved", template_key: "uptime_recovered", delay_minutes: 0, eligibility: { honourSuppressions: true }, enabled: true, sent_count: 4, skipped_count: 0, failed_count: 0 }], campaigns: [{ id: "fixture-campaign", name: "October product update", recipient_preview_count: 2, state: "draft", scheduled_at: null, result: {} }], deliveries: [{ id: "fixture-delivery", kind: "uptime_recovered", recipient: "test@example.com", status: "sent", provider: "Resend", provider_id: "fixture-provider-id", provider_status: "accepted", is_test: true, automation_key: "uptime_recovered", created_at: new Date().toISOString() }] },
  billing: { configured: false, customers: [], events: [], promotions: [], calculations: { mrr: "Unavailable until Stripe is configured and reconciled", arr: "Unavailable until Stripe is configured and reconciled", cashCollected: "Unavailable until Stripe is configured and reconciled", currencyPolicy: "Currencies remain separate" } },
};

function SuperAdminView({ session, fixture = false, staff }: { session: Session | null; fixture?: boolean; staff: Bootstrap["staff"] }) {
  if (!fixture && staff && staff.aal !== "aal2") return <StaffMfaGate staff={staff} />;
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const navigationItems = SUPERADMIN_NAVIGATION.flatMap((group) => [...group.items]) as Array<{ id: string; label: string }>;
  const view = navigationItems.some((item) => item.id === params.get("view")) ? params.get("view")! : "overview";
  const tabs = SUPERADMIN_TABS[view] || [];
  const activeTab = tabs.includes(params.get("tab") || "") ? params.get("tab")! : tabs[0];
  const accountId = params.get("account");
  const pageTitle = navigationItems.find((item) => item.id === view)?.label || "Overview";
  const [payload, setPayload] = useState<SuperAdminPayload | null>(fixture ? fixtureSuperAdminPayload : null);
  const [platform, setPlatform] = useState<any>(fixture ? fixturePlatformPayload : null);
  const [staffData, setStaffData] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [accountDetail, setAccountDetail] = useState<any>(null);

  async function load() {
    if (fixture || !session) {
      setPayload(fixtureSuperAdminPayload);
      setPlatform(fixturePlatformPayload);
      setStaffData({ members: [{ user_id: "admin", display_name: "Claritude Admin", email: "admin@claritude.io", role: "owner", status: "active", mfaFactorCount: 2, lastSignInAt: new Date().toISOString() }], invitations: [] });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [nextPayload, nextPlatform] = await Promise.all([
        api<SuperAdminPayload>(session, "/api/superadmin/bootstrap"),
        api<any>(session, "/api/superadmin/platform"),
      ]);
      setPayload(nextPayload);
      setPlatform(nextPlatform);
      const [staffResult, activityResult, delegationResult] = await Promise.all([
        api<any>(session, "/api/superadmin/staff").catch(() => null),
        api<any>(session, "/api/superadmin/activity?limit=100").catch(() => null),
        api<any>(session, "/api/superadmin/delegations").catch(() => null),
      ]);
      setStaffData(staffResult);
      setActivity(activityResult?.activity || []);
      setDelegations(delegationResult?.sessions || []);
    } catch (reason: any) {
      setError(reason.message || "SuperAdmin command centre could not be loaded");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [session?.access_token, fixture]);
  useEffect(() => {
    if (view !== "accounts" || !accountId) { setAccountDetail(null); return; }
    if (fixture) {
      const account = fixtureSuperAdminPayload.accounts.find((item) => item.id === accountId);
      setAccountDetail(account ? { account, workspaces: fixtureSuperAdminPayload.workspaces.filter((item) => item.account_id === accountId), properties: fixtureSuperAdminPayload.properties.filter((item) => item.accountId === accountId), memberships: [], assignments: [], grants: [], overrides: [], activity: [], usage: [], effectiveEntitlements: { packageKey: account.entitlement, version: 1, arrangement: "complimentary", values: { customEventsPerProperty: null }, sources: {}, hardCeilings: { propertiesPerAccount: 25 }, unresolvedValues: [] } } : null);
      return;
    }
    if (!session) return;
    setBusy(true);
    api<any>(session, `/api/superadmin/accounts/${accountId}`).then(setAccountDetail).catch((reason) => setError(reason.message)).finally(() => setBusy(false));
  }, [view, accountId, session?.access_token, fixture]);
  useEffect(() => {
    if (fixture || !session || query.trim().length < 2) { setSearchResults([]); return; }
    const timer = window.setTimeout(() => {
      void api<any>(session, `/api/superadmin/search?q=${encodeURIComponent(query.trim())}`).then((result) => setSearchResults(result.results || [])).catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, session?.access_token, fixture]);

  function selectTab(tab: string) {
    const next = new URLSearchParams(location.search);
    if (tab === tabs[0]) next.delete("tab"); else next.set("tab", tab);
    navigate(`/superadmin?${next.toString()}`, { replace: true });
  }

  async function toggleControl(control: any) {
    if (!session || fixture) return;
    const reason = window.prompt(`Reason to ${control.paused ? "resume" : "pause"} ${control.key.replaceAll("_", " ")}:`);
    if (!reason) return;
    await api(session, `/api/superadmin/emergency-controls/${control.key}`, { method: "PATCH", body: JSON.stringify({ paused: !control.paused, reason }) });
    await load();
  }

  async function queueExport(scope: string, format: "csv" | "json") {
    if (!session || fixture) return;
    const reason = window.prompt(`Reason for exporting ${scope}:`);
    if (!reason) return;
    await api(session, "/api/superadmin/exports", { method: "POST", body: JSON.stringify({ scope, format, reason, filters: {} }) });
    await load();
  }

  const normalizedQuery = query.trim().toLowerCase();
  const accounts = (payload?.accounts || []).filter((account) => !normalizedQuery || `${account.name} ${account.effectivePackageName || account.entitlement}`.toLowerCase().includes(normalizedQuery));
  const users = (payload?.users || []).filter((user) => !normalizedQuery || `${user.name} ${user.email}`.toLowerCase().includes(normalizedQuery));
  const properties = (payload?.properties || []).filter((property) => !normalizedQuery || `${property.name} ${property.canonical_host}`.toLowerCase().includes(normalizedQuery));
  const workspaces = (payload?.workspaces || []).filter((workspace) => !normalizedQuery || workspace.name.toLowerCase().includes(normalizedQuery));

  let content: ReactNode = null;
  if (view === "overview") content = <>
    <Metrics values={[["Accounts", payload?.stats.accounts || 0, "Customer accounts"], ["Users", payload?.stats.users || 0, "Auth identities"], ["Properties", payload?.stats.properties || 0, "Managed websites"], ["Audits today", payload?.stats.auditsToday || 0, "Application measured · UTC"]]} />
    <Metrics values={[["Active monitors", payload?.stats.activeMonitors || 0, "Application measured"], ["Offline monitors", payload?.stats.offlineMonitors || 0, "Confirmed down"], ["Open incidents", payload?.stats.openIncidents || 0, "Customer incidents"], ["Platform alerts", platform?.alerts?.filter((item: any) => item.state === "active").length || 0, "Unresolved"]]} />
    {activeTab === "Revenue" ? <Panel title="Revenue"><UnavailableState title="Financial reporting is not configured" detail={platform?.billing?.calculations?.mrr || "Stripe credentials and reconciled billing state are required."} /></Panel> : null}
    {activeTab === "Customer activity" ? <Panel title="Recently created accounts"><DataTable headers={["Account", "Package", "Arrangement", "Users", "Properties", "Created"]} rows={accounts.slice(0, 20).map((account) => [account.name, account.effectivePackageName || cap(account.entitlement.replaceAll("_", " ")), cap(account.billingArrangement || "standard"), account.userCount, account.propertyCount, fmtDate(account.created_at)])} /></Panel> : null}
    {activeTab === "Service health" ? <PlatformServices platform={platform} payload={payload} /> : null}
    {activeTab === "Summary" ? <><PlatformServices platform={platform} payload={payload} /><Panel title="Needs attention"><DataTable headers={["Account", "Offline properties", "Package", "Action"]} rows={accounts.filter((account) => account.offlineCount).map((account) => [account.name, account.offlineCount, cap(account.entitlement), <Link to={`/superadmin?view=accounts&account=${account.id}`}>Open account</Link>])} /></Panel></> : null}
  </>;
  else if (view === "accounts") content = accountId && accountDetail ? <SuperAdminAccountDetail detail={accountDetail} packages={platform?.packages || []} session={session} fixture={fixture} canWrite={Boolean(staff?.permissions.includes("packages.write"))} refresh={async () => { if (!session || fixture) return; setAccountDetail(await api<any>(session, `/api/superadmin/accounts/${accountId}`)); await load(); }} /> : <Panel title={activeTab} actions={<button className="btn" onClick={() => void queueExport("accounts", "csv")}>Export CSV</button>}><DataTable headers={["Account", "Package", "Arrangement", "Users", "Workspaces", "Properties", "Health", "Created"]} rows={accounts.filter((account) => activeTab !== "Needs attention" || account.offlineCount > 0).map((account) => [<Link to={`/superadmin?view=accounts&account=${account.id}`}><b>{account.name}</b></Link>, account.effectivePackageName || cap(account.entitlement.replaceAll("_", " ")), account.billingArrangement === "complimentary" ? <StatusPill tone="success">Complimentary</StatusPill> : "Standard", account.userCount, account.workspaceCount, account.propertyCount, account.offlineCount ? <StatusPill tone="danger">{account.offlineCount} offline</StatusPill> : <StatusPill tone="success">Healthy</StatusPill>, fmtDate(account.created_at)])} /></Panel>;
  else if (view === "users") content = activeTab === "Invitations" ? <Panel title="Staff and customer invitations"><DataTable headers={["Email", "Role", "Expires", "Status"]} rows={(staffData?.invitations || []).map((invite: any) => [invite.email, cap(invite.role), fmtDate(invite.expires_at), invite.accepted_at ? "Accepted" : invite.revoked_at ? "Revoked" : "Pending"])} /></Panel> : <Panel title={activeTab} actions={<button className="btn" onClick={() => void queueExport("users", "csv")}>Export CSV</button>}><DataTable headers={["User", "Email", "Accounts", "Customer session", "Email status", "Last sign-in", "Created"]} rows={users.filter((user) => activeTab !== "Access issues" || !user.confirmedAt).map((user) => [<b>{user.name || "Claritude user"}</b>, user.email, user.accountCount, user.accountIds?.[0] ? <Link to={`/superadmin?view=administration&tab=Customer+sessions&account=${user.accountIds[0]}`}>View as customer</Link> : "No account membership", user.confirmedAt ? <StatusPill tone="success">Confirmed</StatusPill> : <StatusPill tone="neutral">Pending</StatusPill>, user.lastSignInAt ? fmtDate(user.lastSignInAt) : "Never", fmtDate(user.createdAt)])} /></Panel>;
  else if (view === "resources") content = activeTab === "Workspaces" ? <Panel title="Workspaces"><DataTable headers={["Workspace", "Account", "Properties", "Created"]} rows={workspaces.map((workspace) => [workspace.name, payload?.accounts.find((account) => account.id === workspace.account_id)?.name || workspace.account_id, workspace.propertyCount, fmtDate(workspace.created_at)])} /></Panel> : <Panel title={activeTab}><DataTable headers={["Property", "Domain", "Workspace", "Connection", "Monitor", "Last analytics"]} rows={properties.filter((property) => activeTab !== "Connection health" || property.verification_status !== "verified" || !property.tracking_last_received_at).map((property) => [property.name, property.canonical_host, payload?.workspaces.find((workspace) => workspace.id === property.workspace_id)?.name || property.workspace_id, property.verification_status, property.monitor?.last_status || "Not configured", property.tracking_last_received_at ? fmtDate(property.tracking_last_received_at) : "No data"])} /></Panel>;
  else if (view === "packages") content = activeTab === "Free account inactivity" ? <Panel title="Free account inactivity"><p className="subtle">Policy: warning day 60, reminder day 90, reversible freeze day 100, deletion eligibility day 121. Accounts with a current complimentary non-Free grant are excluded. Automatic irreversible deletion is disabled.</p><DataTable headers={["Account", "State", "Last meaningful activity", "Review hold", "Updated"]} rows={(platform?.inactivity || []).map((item: any) => [payload?.accounts.find((account) => account.id === item.account_id)?.name || item.account_id, item.state, item.last_meaningful_activity_at ? fmtDate(item.last_meaningful_activity_at) : "Not recorded", item.analytics_review_required || item.notice_delivery_failed ? "Required" : "No", fmtDate(item.updated_at)])} /></Panel> : activeTab === "Account overrides" ? <><Panel title="Complimentary package grants"><DataTable headers={["Account", "Package", "Status", "Starts", "Expires", "Reason"]} rows={(platform?.grants || []).map((item: any) => [<Link to={`/superadmin?view=accounts&account=${item.account_id}`}>{payload?.accounts.find((account) => account.id === item.account_id)?.name || item.account_id}</Link>, item.package_versions?.display_name || item.package_version_id, cap(item.status), fmtDate(item.starts_at), item.expires_at ? fmtDate(item.expires_at) : "Never", item.reason])} /></Panel><Panel title="Allocation overrides"><DataTable headers={["Account", "Key", "Value", "Source", "Starts", "Expires", "Reason"]} rows={(platform?.overrides || []).map((item: any) => [payload?.accounts.find((account) => account.id === item.account_id)?.name || item.account_id, item.key, JSON.stringify(item.value), item.grant_id ? "Complimentary grant" : "Manual", fmtDate(item.starts_at), item.expires_at ? fmtDate(item.expires_at) : "No expiry", item.reason])} /></Panel></> : activeTab === "Subscription rules" ? <Panel title="Subscription rules"><p>Complimentary grants are resolved before the underlying standard assignment.</p><p className="subtle">Granting or revoking complimentary access never creates, changes or cancels a Stripe subscription. Temporary grants return to the underlying standard package on expiry. Package and allocation changes preserve all customer data.</p></Panel> : <Panel title={activeTab}><DataTable headers={["Package", "Version", "State", "Allowances", "Features", "Unresolved commercial values", "Effective"]} rows={(platform?.packages || []).map((item: any) => [item.display_name, item.version, item.state, JSON.stringify(item.allowances || {}), JSON.stringify(item.features || {}), item.unresolved_values?.join(", ") || "None", item.effective_at ? fmtDate(item.effective_at) : "Draft"])} /></Panel>;
  else if (view === "financials") content = <Panel title={activeTab}>{!platform?.billing?.configured ? <UnavailableState title="Stripe billing is unconfigured" detail="No server-side Stripe key, webhook secret, product catalogue or reconciled billing state is available. Complimentary and beta access remains unchanged; no paid subscriptions are fabricated." /> : <DataTable headers={["Provider event", "Type", "State", "Provider time"]} rows={(platform.billing.events || []).map((event: any) => [event.provider_event_id, event.event_type, event.processing_state, fmtDate(event.provider_created_at)])} />}<p className="subtle">Currencies remain separate unless a labelled conversion is explicitly configured. Credits, cash refunds, recurring revenue and cash collection are reported independently.</p></Panel>;
  else if (view === "coupons") content = <Panel title={activeTab}>{!platform?.billing?.configured && <UnavailableState title="Promotion synchronisation unavailable" detail="Stripe sandbox credentials and product/price configuration are required before promotion codes can be enabled." />}<DataTable headers={["Code", "Discount", "Duration", "Packages", "Expires", "Enabled"]} rows={(platform?.billing?.promotions || []).map((item: any) => [item.code || "Provider generated", item.discount_type === "percentage" ? `${item.percentage}%` : `${item.fixed_amount_minor} ${item.currency}`, item.duration_type === "billing_periods" ? `${item.duration_count} billing periods` : item.duration_type, item.eligible_packages?.join(", ") || "All configured", item.expires_at ? fmtDate(item.expires_at) : "No expiry", item.enabled ? "Yes" : "No"])} /></Panel>;
  else if (view === "audits") content = activeTab === "Check health" ? <Panel title="Audit check health"><Metrics values={[["Technical checks", platform?.audits?.technicalChecks?.length || 0, "Repository-owned execution"], ["Customer groups", platform?.audits?.groups?.length || 0, "Presentation groups"], ["Failed today", platform?.audits?.today?.failed || 0, "Application measured"], ["Partial today", platform?.audits?.today?.partial || 0, "Application measured"]]} /></Panel> : <Panel title={activeTab}><p className="subtle">Executable logic remains in the repository. Database controls can change validated availability and supported configuration only.</p><DataTable headers={["Check", "Category", "Subcategory", "Severity", "Lifecycle", "Config version"]} rows={(platform?.audits?.technicalChecks || []).filter((item: any) => !normalizedQuery || `${item.id} ${item.title} ${item.primary_category}`.toLowerCase().includes(normalizedQuery)).slice(0, 250).map((item: any) => [item.title, item.primary_category, item.subcategory, item.severity, item.lifecycle, item.configuration_version])} /></Panel>;
  else if (view === "health") content = activeTab === "Incidents" ? <Panel title="Platform incidents"><DataTable headers={["Incident", "State", "Services", "Opened", "Resolved"]} rows={(platform?.incidents || []).map((item: any) => [item.title, item.state, item.affected_services?.join(", "), fmtDate(item.opened_at), item.resolved_at ? fmtDate(item.resolved_at) : "Open"])} /></Panel> : <PlatformServices platform={platform} payload={payload} />;
  else if (view === "infrastructure") content = <InfrastructureDesk activeTab={activeTab} platform={platform} payload={payload} fixture={fixture} canWrite={Boolean(staff?.permissions.includes("operations.write"))} toggleControl={toggleControl} session={session} refresh={load} />;
  else if (view === "email") content = <EmailControlDesk activeTab={activeTab} platform={platform} session={session} fixture={fixture} refresh={load} />;
  else if (view === "alerts") content = <AlertsControlDesk activeTab={activeTab} platform={platform} session={session} fixture={fixture} refresh={load} />;
  else if (view === "data") content = activeTab === "Exports" ? <ExportControlDesk jobs={platform?.exports || []} session={session} fixture={fixture} refresh={load} /> : activeTab === "Backups & Recovery" ? <Panel title="Backups & recovery"><UnavailableState title="Provider backup status is unverified" detail="Account exports are not labelled as backups. Supabase backup/PITR capability and a tested restoration runbook require provider access." /></Panel> : activeTab === "Retention" ? <SettingsControlDesk platform={platform} session={session} fixture={fixture} refresh={load} onlyKey="retention_policy" /> : <Panel title={activeTab}><pre className="json-preview">{JSON.stringify(platform?.deletionRequests || [], null, 2)}</pre><p className="subtle">Cleanup and deletion are preview/review workflows. Irreversible automatic production deletion is disabled.</p></Panel>;
  else if (view === "administration") content = activeTab === "Staff & Permissions" ? <StaffPermissionsDesk staffData={staffData} session={session} fixture={fixture} refresh={load} /> : activeTab === "Customer sessions" ? <CustomerSessionsPanel session={session} fixture={fixture} payload={payload} sessions={delegations} refresh={load} /> : activeTab === "Admin activity" ? <AdminActivityDesk activity={activity} /> : <SettingsControlDesk platform={platform} session={session} fixture={fixture} refresh={load} />;

  return <Page title={pageTitle} showOptions={false} status={<span className="tag">{platform?.environment?.name || "Platform"} · {staff ? cap(staff.role) : "Owner"}</span>} actions={<button className="btn" onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? "audit-spin" : ""} />Refresh</button>}>
    <div className="superadmin-globalbar">
      <label className="search superadmin-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts, users, domains, workspaces, invoices or audit IDs" aria-label="Global SuperAdmin search" /></label>
      <span><StatusPill tone={payload?.stats.offlineMonitors ? "danger" : "success"}>{payload?.stats.offlineMonitors ? `${payload.stats.offlineMonitors} offline` : "Services healthy"}</StatusPill></span>
      <span>{platform?.alerts?.filter((item: any) => item.state === "active").length || 0} unresolved alerts</span>
      {searchResults.length > 0 && <div className="superadmin-search-results">{searchResults.map((item) => <Link key={`${item.type}:${item.id}`} to={item.href} onClick={() => { setQuery(""); setSearchResults([]); }}><small>{cap(item.type.replaceAll("_", " "))}</small><b>{item.label}</b></Link>)}</div>}
    </div>
    {tabs.length > 0 && <Tabs labels={tabs} value={activeTab} onChange={selectTab} />}
    {error ? <Panel><div className="analytics-state" role="alert"><Empty title="SuperAdmin command centre could not be loaded" detail={error} /><button className="btn" onClick={() => void load()}>Retry</button></div></Panel> : !payload || !platform ? <Panel><Empty title="Loading SuperAdmin command centre…" detail="Collecting real platform data and capability status." /></Panel> : content}
  </Page>;
}

function featureStatePill(state: string) {
  const label = cap(String(state || "unknown").replaceAll("_", " "));
  return <StatusPill tone={state === "enabled" ? "success" : state === "paused" || state === "unavailable" ? "danger" : "neutral"}>{label}</StatusPill>;
}

function InfrastructureDesk({ activeTab, platform, payload, fixture, canWrite, toggleControl, session, refresh }: any) {
  if (activeTab === "Operational controls") return <Panel title="Authoritative operational controls"><p className="subtle">A control permits new work; it does not mean a job is running. Pausing stops new work at each execution entry point. Queued and running work retain their recorded state and are not silently discarded.</p><DataTable headers={["Capability", "Permission", "Effective feature state", "Jobs running", "Reason", "Changed", "Action"]} rows={(platform?.controls || []).map((item: any) => { const derived = item.key === "campaigns" ? platform?.featureStates?.campaigns : null; return [cap(item.key.replaceAll("_", " ")), item.paused ? "Paused" : "Permitted", derived ? featureStatePill(derived.state) : "Controlled at execution entry", derived?.runningJobs || 0, derived?.reason || item.reason || "—", item.changed_at ? fmtDate(item.changed_at) : "Default", <button className="btn" disabled={fixture || !canWrite} onClick={() => void toggleControl(item)}>{item.paused ? "Resume" : "Pause"}</button>]; })} /></Panel>;
  if (activeTab === "Safety limits") return <><Panel title="Configured ceilings"><SettingsControlDesk platform={platform} session={session} fixture={fixture} refresh={refresh} onlyKey="safety_limits" embedded /></Panel></>;
  return <Panel title={activeTab}><Metrics values={[["Queued audits", platform?.audits?.today?.queued || 0, "Application measured · UTC day"], ["Running audits", platform?.audits?.today?.running || 0, "Application measured"], ["Failed audits", platform?.audits?.today?.failed || 0, "Application measured"], ["Browser/provider telemetry", "Unavailable", "Provider access not configured"]]} /><p className="subtle">Every metric identifies its source and period. CPU, memory, exact cost and provider queue backlog are not estimated.</p>{activeTab === "Overview" && <p><Link to="/superadmin?view=infrastructure&tab=Operational+controls">Open authoritative operational controls</Link></p>}</Panel>;
}

const EMAIL_LABELS: Record<string, string> = { registration: "Registration", confirmation: "Email confirmation", password_reset: "Password reset", uptime_down: "Uptime down", uptime_recovered: "Uptime recovered", scheduled_report: "Scheduled report", report: "Report", billing: "Billing", inactivity: "Inactivity notice", campaign: "Campaign", staff_digest: "Staff digest", weekly_digest: "Weekly digest" };
function emailLabel(kind: string) { return EMAIL_LABELS[kind] || cap(String(kind || "Email").replaceAll("_", " ")); }

function EmailControlDesk({ activeTab, platform, session, fixture, refresh }: any) {
  const deliveries = platform?.email?.deliveries || [];
  const templates = platform?.email?.templates || [];
  const automations = platform?.email?.automations || [];
  const campaigns = platform?.email?.campaigns || [];
  const suppressions = platform?.email?.suppressions || [];
  const [message, setMessage] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignAccountFilter, setCampaignAccountFilter] = useState("");
  const [deliveryKind, setDeliveryKind] = useState("all");
  const [deliveryClass, setDeliveryClass] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [templateKey, setTemplateKey] = useState("uptime_down");
  const [templateSubject, setTemplateSubject] = useState("{{propertyName}} is offline");
  const [templateHtml, setTemplateHtml] = useState("<p>{{propertyName}} appears to be offline.</p><p>{{propertyUrl}}</p>");
  const [templateReason, setTemplateReason] = useState("");
  const [templatePreview, setTemplatePreview] = useState<any>(null);
  const [suppressionEmail, setSuppressionEmail] = useState("");
  const [suppressionCategory, setSuppressionCategory] = useState("all");
  const [suppressionReason, setSuppressionReason] = useState("");
  const filteredDeliveries = deliveries.filter((item: any) => (deliveryKind === "all" || item.kind === deliveryKind) && (deliveryClass === "all" || (deliveryClass === "test" ? item.is_test === true : deliveryClass === "production" ? item.is_test === false : item.is_test == null)) && (!dateFrom || Date.parse(item.created_at) >= Date.parse(`${dateFrom}T00:00:00`)) && (!dateTo || Date.parse(item.created_at) <= Date.parse(`${dateTo}T23:59:59.999`)));
  const mutate = async (url: string, options: any) => { if (!session || fixture) return; setMessage(""); try { await api(session, url, options); setMessage("Saved. Refresh confirmed the effective state."); await refresh(); } catch (error: any) { setMessage(error.message); } };
  if (activeTab === "Overview") {
    const production = filteredDeliveries.filter((item: any) => item.is_test === false).length;
    const tests = filteredDeliveries.filter((item: any) => item.is_test === true).length;
    const unknown = filteredDeliveries.filter((item: any) => item.is_test == null).length;
    return <><Panel title="Activity period"><div className="button-row"><label className="field">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div></Panel><Metrics values={[["Recorded activity", filteredDeliveries.length, "Application delivery ledger"], ["Production", production, "Explicit metadata"], ["Tests", tests, "Explicit metadata"], ["Historical classification unknown", unknown, "Not guessed"]]} /><Panel title="Sending-path coverage and trend"><DataTable headers={["Category", "Recorded in period", "Coverage"]} rows={Object.entries(EMAIL_LABELS).map(([key, label]) => [label, filteredDeliveries.filter((item: any) => item.kind === key || (key === "report" && item.kind === "scheduled_report")).length, ["confirmation", "password_reset", "registration"].includes(key) ? "Provider-managed Supabase Auth; delivery evidence is not imported" : "Claritude notification delivery ledger"])} /><p className="subtle">The period comparison updates from recorded delivery activity. Accepted by a provider is not treated as delivered; Resend webhooks are required for delivered, bounced and complained evidence.</p></Panel></>;
  }
  if (activeTab === "Templates") return <>
    <Panel title="Create template version">
      <div className="settings-grid">
        <label className="field">Template key<input value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} /></label>
        <label className="field">Subject<input value={templateSubject} onChange={(event) => setTemplateSubject(event.target.value)} /></label>
        <label className="field settings-span-2">HTML body<textarea rows={6} value={templateHtml} onChange={(event) => setTemplateHtml(event.target.value)} /></label>
        <label className="field settings-span-2">Change reason<input value={templateReason} onChange={(event) => setTemplateReason(event.target.value)} /></label>
      </div>
      <div className="button-row">
        <button className="btn" onClick={async () => {
          const variables = { propertyName: "Example property", propertyUrl: "https://example.com", reportUrl: "https://app.claritude.io/reports" };
          if (!session || fixture) {
            setTemplatePreview({ subject: templateSubject.replace("{{propertyName}}", "Example property"), html: templateHtml.replace("{{propertyName}}", "Example property").replace("{{propertyUrl}}", "https://example.com"), missing: [] });
            return;
          }
          const result = await api<any>(session, "/api/superadmin/email/templates/preview", { method: "POST", body: JSON.stringify({ subject: templateSubject, htmlBody: templateHtml, variables }) });
          setTemplatePreview(result.preview);
        }}>Validate and preview</button>
        <button className="primary" disabled={fixture || templateReason.trim().length < 3 || !templatePreview?.missing || templatePreview.missing.length > 0} onClick={() => void mutate("/api/superadmin/email/templates", { method: "POST", body: JSON.stringify({ templateKey, subject: templateSubject, htmlBody: templateHtml, reason: templateReason }) })}>Save draft version</button>
      </div>
      {templatePreview && <div className="analytics-state">
        <h3>{templatePreview.subject}</h3>
        <iframe title="Email template preview" sandbox="" srcDoc={templatePreview.html} style={{ width: "100%", minHeight: 180, border: "1px solid var(--border)", borderRadius: 8, background: "white" }} />
        {templatePreview.missing?.length ? <p className="form-error">Missing tags: {templatePreview.missing.join(", ")}</p> : <p className="subtle">All dynamic tags resolved.</p>}
      </div>}
    </Panel>
    <Panel title="Versioned templates">
      <DataTable headers={["Template", "Version", "Subject", "Tags", "Path", "State", "Action"]} rows={templates.map((item: any) => [emailLabel(item.template_key), item.version, item.subject, item.variables?.map((tag: string) => `{{${tag}}}`).join(", ") || "None", item.sending_path || "Unknown", item.provider_managed ? "Provider managed" : cap(item.state), item.provider_managed ? "Edit in Supabase Auth" : item.state === "draft" ? <button className="btn" onClick={() => { const reason = window.prompt("Publishing reason:"); if (reason) void mutate(`/api/superadmin/email/templates/${item.id}/publish`, { method: "POST", body: JSON.stringify({ reason }) }); }}>Publish</button> : "Published"])} />
      <p className="subtle">Publishing retires the previous active version. Subsequent uptime and scheduled-report sends resolve the published version and record its template ID. Provider-managed authentication templates remain explicitly identified.</p>
      {message && <p role="status">{message}</p>}
    </Panel>
  </>;
  if (activeTab === "Automations") return <Panel title="Automations"><DataTable headers={["Automation", "Trigger", "Template", "Delay", "Eligibility", "Status", "Sent / skipped / failed", "Actions"]} rows={automations.map((item: any) => [emailLabel(item.key), item.trigger_key || "Not recorded", emailLabel(item.template_key), `${item.delay_minutes || 0} min`, JSON.stringify(item.eligibility || {}), item.enabled ? <StatusPill tone="success">Enabled</StatusPill> : <StatusPill tone="neutral">Paused</StatusPill>, `${item.sent_count || 0} / ${item.skipped_count || 0} / ${item.failed_count || 0}`, <span className="button-row"><button className="btn" onClick={() => { const reason = window.prompt(`${item.enabled ? "Pause" : "Resume"} reason:`); if (reason) void mutate(`/api/superadmin/email/automations/${item.key}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled, reason }) }); }}>{item.enabled ? "Pause" : "Resume"}</button><button className="btn" onClick={() => { const recipient = window.prompt("Controlled test recipient:"); if (recipient) void mutate(`/api/superadmin/email/automations/${item.key}/simulate`, { method: "POST", body: JSON.stringify({ recipient, eventId: "control-desk" }) }); }}>Simulate twice safely</button></span>])} />{message && <p role="status">{message}</p>}</Panel>;
  if (activeTab === "Campaigns") return <>
    <Panel title="Campaign configuration">
      <p>Effective state: {featureStatePill(platform?.featureStates?.campaigns?.state)} · {platform?.featureStates?.campaigns?.reason}</p>
      <div className="settings-grid">
        <label className="field">Draft name<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label>
        <label className="field">Account filter (optional)<input value={campaignAccountFilter} onChange={(event) => setCampaignAccountFilter(event.target.value)} placeholder="Account ID" /></label>
      </div>
      <button className="btn" disabled={campaignName.trim().length < 3} onClick={() => void mutate("/api/superadmin/email/campaigns", { method: "POST", body: JSON.stringify({ name: campaignName, segment: campaignAccountFilter ? { accountId: campaignAccountFilter } : {} }) })}>Create draft and preview recipients</button>
      <p className="subtle">Creation is draft-only. Customer sending is not activated. Eligibility, preferences and suppressions are rechecked when execution is deliberately enabled.</p>
    </Panel>
    <Panel title="Campaigns">
      <DataTable headers={["Campaign", "Recipients preview", "State", "Scheduled", "Results", "Actions"]} rows={campaigns.map((item: any) => [item.name, item.recipient_preview_count ?? "Not calculated", cap(item.state), item.scheduled_at ? fmtDate(item.scheduled_at) : "—", JSON.stringify(item.result || {}), <span className="button-row">
        <button className="btn" onClick={() => void mutate(`/api/superadmin/email/campaigns/${item.id}/duplicate`, { method: "POST" })}>Duplicate</button>
        <button className="btn" onClick={() => { const recipient = window.prompt("Controlled test recipient:"); if (recipient) void mutate(`/api/superadmin/email/campaigns/${item.id}/simulate`, { method: "POST", body: JSON.stringify({ recipient, eventId: "control-desk" }) }); }}>Simulate safely</button>
        {item.state === "draft" && <button className="btn" onClick={() => { const scheduledAt = window.prompt("Schedule time (ISO 8601):", new Date(Date.now() + 3600000).toISOString()); if (scheduledAt) void mutate(`/api/superadmin/email/campaigns/${item.id}`, { method: "PATCH", body: JSON.stringify({ action: "schedule", scheduledAt }) }); }}>Schedule</button>}
        {!["completed", "cancelled"].includes(item.state) && <button className="btn" onClick={() => void mutate(`/api/superadmin/email/campaigns/${item.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) })}>Cancel</button>}
      </span>])} />
      {message && <p role="status">{message}</p>}
    </Panel>
  </>;
  if (activeTab === "Delivery") return <Panel title="Delivery evidence"><div className="button-row"><select value={deliveryKind} onChange={(event) => { setDeliveryKind(event.target.value); setDeliveryPage(1); }}><option value="all">All types</option>{[...new Set(deliveries.map((item: any) => item.kind))].map((kind: any) => <option key={kind} value={kind}>{emailLabel(kind)}</option>)}</select><select value={deliveryClass} onChange={(event) => { setDeliveryClass(event.target.value); setDeliveryPage(1); }}><option value="all">All classifications</option><option value="production">Production</option><option value="test">Test</option><option value="unknown">Historical unknown</option></select><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div><DataTable headers={["Type", "Recipient", "Classification", "Claritude state", "Provider", "Provider message ID", "Provider evidence", "Related record", "Created"]} rows={filteredDeliveries.slice((deliveryPage - 1) * 50, deliveryPage * 50).map((item: any) => [emailLabel(item.kind), item.recipient, item.is_test === true ? "Test" : item.is_test === false ? "Production" : "Unknown (historical)", cap(item.status), item.provider || (item.provider_id ? "Resend" : "—"), item.provider_id || "—", item.provider_status || (item.status === "sent" ? "Accepted only" : "—"), item.campaign_id || item.automation_key || item.property_id || item.account_id || "—", fmtDate(item.created_at)])} /><div className="button-row"><button className="btn" disabled={deliveryPage === 1} onClick={() => setDeliveryPage((page) => page - 1)}>Previous</button><span>Page {deliveryPage} · {filteredDeliveries.length} records</span><button className="btn" disabled={deliveryPage * 50 >= filteredDeliveries.length} onClick={() => setDeliveryPage((page) => page + 1)}>Next</button></div><p className="subtle">Technical event keys and payload metadata remain available in record details; labels here are human-readable.</p></Panel>;
  return <>
    <SettingsControlDesk platform={platform} session={session} fixture={fixture} refresh={refresh} keys={["email_settings", "outbound_automation"]} />
    <Panel title="Active suppression list">
      <div className="settings-grid">
        <label className="field">Recipient<input type="email" value={suppressionEmail} onChange={(event) => setSuppressionEmail(event.target.value)} /></label>
        <label className="field">Category<select value={suppressionCategory} onChange={(event) => setSuppressionCategory(event.target.value)}><option value="all">All outbound email</option>{Object.entries(EMAIL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field settings-span-2">Reason<input value={suppressionReason} onChange={(event) => setSuppressionReason(event.target.value)} /></label>
      </div>
      <button className="btn" disabled={fixture || !/^\S+@\S+\.\S+$/.test(suppressionEmail) || suppressionReason.trim().length < 3} onClick={() => void mutate("/api/superadmin/email/suppressions", { method: "POST", body: JSON.stringify({ recipient: suppressionEmail, category: suppressionCategory, reason: suppressionReason }) })}>Add suppression</button>
      <DataTable headers={["Recipient", "Category", "Reason", "Source", "Added", "Action"]} rows={suppressions.map((item: any) => [item.recipient, item.category === "all" ? "All outbound email" : emailLabel(item.category), item.reason, cap(item.source), fmtDate(item.created_at), <button className="btn" onClick={() => { const reason = window.prompt("Reason to lift suppression:"); if (reason) void mutate(`/api/superadmin/email/suppressions/${item.id}`, { method: "DELETE", body: JSON.stringify({ reason }) }); }}>Lift</button>])} />
      <p className="subtle">Customer preferences remain separate. This platform-level list is rechecked immediately before supported application sends.</p>
      {message && <p role="status">{message}</p>}
    </Panel>
  </>;
}

function ExportControlDesk({ jobs, session, fixture, refresh }: any) {
  const [scope, setScope] = useState("accounts"); const [format, setFormat] = useState("csv"); const [reason, setReason] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { if (!jobs.some((item: any) => ["queued", "running"].includes(item.state))) return; const timer = window.setInterval(() => void refresh(), 3000); return () => window.clearInterval(timer); }, [jobs.map((item: any) => `${item.id}:${item.state}:${item.progress}`).join("|"), refresh]);
  async function request() { if (!session || fixture) return; try { await api(session, "/api/superadmin/exports", { method: "POST", body: JSON.stringify({ scope, format, reason, filters: {} }) }); setMessage("Export queued."); setReason(""); await refresh(); } catch (error: any) { setMessage(error.message); } }
  async function download(item: any) { if (!session) return; const result = await api<any>(session, `/api/superadmin/exports/${item.id}/download`); window.open(result.url, "_blank", "noopener,noreferrer"); setMessage(`Download link issued for 60 seconds; file retention ends ${fmtDate(item.expires_at)}.`); }
  async function retry(item: any) { if (!session) return; const why = window.prompt("Retry reason:"); if (!why) return; await api(session, `/api/superadmin/exports/${item.id}/retry`, { method: "POST", body: JSON.stringify({ reason: why }) }); await refresh(); }
  return <><Panel title="Request export"><div className="settings-grid"><label className="field">Dataset<select value={scope} onChange={(event) => setScope(event.target.value)}>{["accounts", "users", "properties", "audits", "admin_activity"].map((item) => <option key={item} value={item}>{cap(item.replaceAll("_", " "))}</option>)}</select></label><label className="field">Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="csv">CSV</option><option value="json">JSON</option></select></label><label className="field settings-span-2">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><button className="primary" disabled={fixture || reason.trim().length < 3} onClick={() => void request()}>Request export</button>{message && <p role="status">{message}</p>}</Panel><Panel title="Permission-checked exports"><DataTable headers={["Dataset", "Format", "State", "Progress", "Rows", "File retained until", "Download link", "Failure", "Actions"]} rows={jobs.map((item: any) => [cap(item.scope.replaceAll("_", " ")), item.format.toUpperCase(), cap(item.state), `${item.progress}%`, item.row_count ?? "—", item.expires_at ? fmtDate(item.expires_at) : "Not created", item.state === "completed" && Date.parse(item.expires_at) > Date.now() ? "Issued on demand for 60 seconds" : "Unavailable", item.error || "—", <span className="button-row">{item.state === "completed" && Date.parse(item.expires_at) > Date.now() && <button className="btn" onClick={() => void download(item)}>Download</button>}{["failed", "expired", "cancelled"].includes(item.state) && <button className="btn" onClick={() => void retry(item)}>Retry</button>}</span>])} /><p className="subtle">Authorization is rechecked when the 60-second download URL is issued. File retention expiry is shown separately.</p></Panel></>;
}

function AlertsControlDesk({ activeTab, platform, session, fixture, refresh }: any) {
  const coverage = platform?.alertCoverage || {};
  const [message, setMessage] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleMetric, setRuleMetric] = useState("audit.failure_rate");
  const [ruleThreshold, setRuleThreshold] = useState("5");
  async function act(item: any, action: string) { if (!session || fixture) return; const reason = window.prompt(`${cap(action)} reason:`); if (!reason) return; const snoozedUntil = action === "snooze" ? new Date(Date.now() + 86400000).toISOString() : undefined; await api(session, `/api/superadmin/alerts/${item.id}`, { method: "PATCH", body: JSON.stringify({ action, reason, snoozedUntil }) }); await refresh(); }
  async function createRule() {
    if (!session || fixture) return;
    try {
      await api(session, "/api/superadmin/alert-rules", { method: "POST", body: JSON.stringify({ name: ruleName, metric: ruleMetric, operator: "gte", threshold: Number(ruleThreshold), observationMinutes: 15, minimumSamples: 1, cooldownMinutes: 60, scope: {} }) });
      setRuleName("");
      setMessage("Alert rule created in paused state.");
      await refresh();
    } catch (error: any) { setMessage(error.message); }
  }
  async function toggleRule(item: any) {
    if (!session || fixture) return;
    const reason = window.prompt(`${item.enabled ? "Pause" : "Enable"} rule reason:`);
    if (!reason) return;
    try {
      await api(session, `/api/superadmin/alert-rules/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled, reason }) });
      setMessage(`Rule ${item.enabled ? "paused" : "enabled"}.`);
      await refresh();
    } catch (error: any) { setMessage(error.message); }
  }
  if (activeTab === "Rules") return <>
    <Metrics values={[["Enabled rules", coverage.enabledRuleCount || 0, "Configured evaluation rules"], ["Evaluator", cap(String(coverage.evaluatorHealth || "unknown").replaceAll("_", " ")), coverage.lastEvaluationAt ? `Last ${fmtDate(coverage.lastEvaluationAt)}` : "No evaluation recorded"]]} />
    <Panel title="Create alert rule">
      <div className="settings-grid">
        <label className="field">Rule name<input value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>
        <label className="field">Metric<input value={ruleMetric} onChange={(event) => setRuleMetric(event.target.value)} /></label>
        <label className="field">Threshold<input type="number" value={ruleThreshold} onChange={(event) => setRuleThreshold(event.target.value)} /></label>
      </div>
      <button className="primary" disabled={fixture || ruleName.trim().length < 3 || !Number.isFinite(Number(ruleThreshold))} onClick={() => void createRule()}>Create paused rule</button>
      <p className="subtle">New rules are paused so operators can review the metric, scope, observation window and threshold before evaluation begins.</p>
    </Panel>
    <Panel title="Alert rules">
      <DataTable headers={["Rule", "Metric", "Threshold", "Window", "Minimum samples", "Cooldown", "Scope", "Evaluation", "State", "Action"]} rows={(platform?.alertRules || []).map((item: any) => [item.name, item.metric, `${item.operator} ${item.threshold}`, `${item.observation_minutes} min`, item.minimum_samples, `${item.cooldown_minutes} min`, JSON.stringify(item.scope || {}), cap(item.evaluation_state.replaceAll("_", " ")), item.enabled ? "Enabled" : "Paused", <button className="btn" onClick={() => void toggleRule(item)}>{item.enabled ? "Pause" : "Enable"}</button>])} />
      <button className="btn" disabled={fixture} onClick={async () => { if (!session) return; const result = await api<any>(session, "/api/superadmin/alerts/evaluate", { method: "POST" }); setMessage(`Evaluated ${result.rules.length} rules without sending a digest.`); await refresh(); }}>Evaluate now</button>
      {message && <p role="status">{message}</p>}
    </Panel>
  </>;
  if (activeTab === "History") return <Panel title="Resolution history"><DataTable headers={["Alert", "Event", "Reason", "Actor", "Time"]} rows={(platform?.alertHistory || []).map((item: any) => [item.alert_id, cap(item.event), item.reason || "—", item.actor_staff_id || "System", fmtDate(item.created_at)])} /></Panel>;
  if (activeTab === "Weekly digest") return <><p>Effective state: {featureStatePill(platform?.featureStates?.weeklyDigest?.state)} · {platform?.featureStates?.weeklyDigest?.reason}</p><SettingsControlDesk platform={platform} session={session} fixture={fixture} refresh={refresh} onlyKey="alert_digest" /><Panel title="Digest preview"><Metrics values={[["Active alerts", (platform?.alerts || []).filter((item: any) => item.state === "active").length, "Included when configured"], ["Enabled rules", coverage.enabledRuleCount || 0, "Coverage summary"], ["Evaluator", cap(String(coverage.evaluatorHealth || "unknown").replaceAll("_", " ")), "No email sent by preview"]]} /><p className="subtle">Preview only. Recipients, schedule, timezone and included metrics are saved in the digest configuration above; this action does not contact the provider.</p></Panel></>;
  return <><Metrics values={[["Active alerts", (platform?.alerts || []).filter((item: any) => item.state === "active").length, coverage.enabledRuleCount ? "Rules enabled" : "No enabled rules"], ["Evaluator health", cap(String(coverage.evaluatorHealth || "unknown").replaceAll("_", " ")), coverage.lastEvaluationAt ? fmtDate(coverage.lastEvaluationAt) : "Evaluation has not started"]]} /><Panel title="Active alerts"><DataTable headers={["Alert", "State", "Evidence", "Created", "Actions"]} rows={(platform?.alerts || []).filter((item: any) => item.state !== "resolved").map((item: any) => [item.title, cap(item.state), JSON.stringify(item.details || {}), fmtDate(item.created_at), <span className="button-row"><button className="btn" onClick={() => void act(item, "acknowledge")}>Acknowledge</button><button className="btn" onClick={() => void act(item, "snooze")}>Snooze 24h</button><button className="btn" onClick={() => void act(item, "resolve")}>Resolve</button></span>])} /></Panel></>;
}

function SettingsControlDesk({ platform, session, fixture, refresh, onlyKey, keys, embedded = false }: any) {
  const selected = (platform?.settings || []).filter((item: any) => onlyKey ? item.key === onlyKey : keys ? keys.includes(item.key) : item.key !== "provider_capabilities");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(selected.map((item: any) => [item.key, JSON.stringify(item.value, null, 2)])));
  const [message, setMessage] = useState("");
  const inactivityPreview = Object.entries((platform?.inactivity || []).reduce((counts: Record<string, number>, item: any) => ({ ...counts, [item.state || "not_evaluated"]: (counts[item.state || "not_evaluated"] || 0) + 1 }), {} as Record<string, number>));
  useEffect(() => setDrafts(Object.fromEntries(selected.map((item: any) => [item.key, JSON.stringify(item.value, null, 2)]))), [selected.map((item: any) => `${item.key}:${item.updated_at}`).join("|")]);
  async function save(item: any) { if (!session || fixture) return; const reason = window.prompt(`Reason for changing ${item.key}:`); if (!reason) return; try { const value = JSON.parse(drafts[item.key]); await api(session, `/api/superadmin/settings/${item.key}`, { method: "PATCH", body: JSON.stringify({ value, reason }) }); setMessage(`${item.key} saved and reloaded.`); await refresh(); } catch (error: any) { setMessage(error.message); } }
  const body = <>
    {selected.map((item: any) => <div className="settings-editor" key={item.key}>
      <h3>{cap(item.key.replaceAll("_", " "))}</h3>
      <p className="subtle">{item.description} · Scope: platform · Effective {fmtDate(item.updated_at)}</p>
      <textarea rows={Math.min(14, Math.max(5, (drafts[item.key] || "").split("\n").length))} value={drafts[item.key] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))} />
      <div className="button-row"><button className="btn" disabled={fixture} onClick={() => void save(item)}>Validate and save</button></div>
      {item.key === "inactivity_policy" && <div className="analytics-state">
        <p className="subtle">60-day reminder → 90-day reminder → day-100 freeze/final notice → 21-day grace → deletion eligibility. Automatic deletion remains disabled.</p>
        <strong>Affected-account preview</strong>
        <p>{inactivityPreview.length ? inactivityPreview.map(([state, count]) => `${cap(state.replaceAll("_", " "))}: ${count}`).join(" · ") : "No accounts currently have a recorded inactivity lifecycle state."}</p>
      </div>}
    </div>)}
    {!onlyKey && <Panel title="Change history"><DataTable headers={["Setting", "Reason", "Changed by", "Effective"]} rows={(platform?.settingHistory || []).map((item: any) => [item.setting_key, item.reason, item.changed_by || "System", fmtDate(item.changed_at)])} /></Panel>}
    {message && <p role="status">{message}</p>}
  </>;
  return embedded ? body : <Panel title="Platform settings">{body}<UnavailableState title="Provider capabilities are read-only" detail="Capability states are verified from integrations and cannot be changed by editing a description." /></Panel>;
}

function StaffPermissionsDesk({ staffData, session, fixture, refresh }: any) {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("support"); const [reason, setReason] = useState(""); const [message, setMessage] = useState("");
  async function invite() { if (!session || fixture) return; try { await api(session, "/api/superadmin/staff/invitations", { method: "POST", body: JSON.stringify({ email, role, reason }) }); setMessage("Invitation recorded and delivery attempted."); setEmail(""); setReason(""); await refresh(); } catch (error: any) { setMessage(error.message); } }
  async function change(item: any, patch: any) { if (!session || fixture) return; const why = window.prompt("Reason for this staff change:"); if (!why) return; await api(session, `/api/superadmin/staff/${item.user_id}`, { method: "PATCH", body: JSON.stringify({ ...patch, reason: why }) }); await refresh(); }
  async function revokeInvitation(item: any) { if (!session || fixture) return; const why = window.prompt("Reason to revoke this invitation:"); if (!why) return; await api(session, `/api/superadmin/staff/invitations/${item.id}`, { method: "DELETE", body: JSON.stringify({ reason: why }) }); setMessage("Invitation revoked."); await refresh(); }
  return <>
    <Panel title="Invite staff"><div className="settings-grid"><label className="field">Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field">Role<select value={role} onChange={(event) => setRole(event.target.value)}>{["support", "finance", "engineering", "owner"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="field settings-span-2">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><button className="primary" disabled={fixture || !email || reason.trim().length < 3} onClick={() => void invite()}>Invite staff member</button>{message && <p role="status">{message}</p>}</Panel>
    <Panel title="Pending invitations"><DataTable headers={["Email", "Role", "Reason", "Expires", "Action"]} rows={(staffData?.invitations || []).filter((item: any) => !item.accepted_at && !item.revoked_at).map((item: any) => [item.email, cap(item.role), item.reason, fmtDate(item.expires_at), <button className="btn" onClick={() => void revokeInvitation(item)}>Revoke</button>])} /></Panel>
    <Panel title="Staff & permissions"><DataTable headers={["Staff member", "Email", "Role", "Status", "MFA assurance", "Last sign-in", "Actions"]} rows={(staffData?.members || []).map((item: any) => [item.display_name || "Staff member", item.email, cap(item.role), cap(item.status), item.mfaError ? "Unavailable" : item.mfaFactorCount > 0 ? `${item.mfaFactorCount} enrolled factor(s); AAL2 enforced on every SuperAdmin request` : "No enrolled factor; SuperAdmin access blocked at AAL1", item.lastSignInAt ? fmtDate(item.lastSignInAt) : "Never", <span className="button-row"><button className="btn" onClick={() => void change(item, { role: item.role === "support" ? "engineering" : "support" })}>Edit role</button><button className="btn" onClick={() => void change(item, { status: item.status === "active" ? "suspended" : "active" })}>{item.status === "active" ? "Suspend" : "Restore"}</button></span>])} /><p className="subtle">The database protects the last active Owner. Role permissions are enforced server-side, and privileged requests require AAL2.</p></Panel>
  </>;
}

function AdminActivityDesk({ activity }: { activity: any[] }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = activity.filter((item: any) => {
    const haystack = [item.action, item.targetName, item.target_type, item.target_id, item.actorName, item.actorEmail, item.actor_staff_id].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (outcome === "all" || item.outcome === outcome) && (!from || Date.parse(item.created_at) >= Date.parse(`${from}T00:00:00`)) && (!to || Date.parse(item.created_at) <= Date.parse(`${to}T23:59:59.999`));
  });
  return <Panel title="Immutable administrative activity">
    <div className="button-row">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Actor, action or target" aria-label="Actor, action or target" />
      <select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Outcome"><option value="all">All outcomes</option>{[...new Set(activity.map((item: any) => item.outcome))].map((item: any) => <option key={item} value={item}>{cap(item)}</option>)}</select>
      <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
      <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
    </div>
    <DataTable headers={["Action", "Outcome", "Readable target", "Technical ID", "Reason", "Actor", "Correlation", "Details", "Time"]} rows={filtered.map((item: any) => [cap(item.action.replaceAll(".", " ").replaceAll("_", " ")), cap(item.outcome), item.targetName || cap(String(item.target_type || "Unknown").replaceAll("_", " ")), item.target_id || "—", item.reason || "—", item.actorName || item.actorEmail || item.actor_staff_id || "System", item.correlation_id, item.previous_values || item.new_values ? <details><summary>Before / after</summary><pre className="json-preview">{JSON.stringify({ before: item.previous_values || null, after: item.new_values || null }, null, 2)}</pre></details> : "—", fmtDate(item.created_at)])} />
    <p className="subtle">Exports omit authentication secrets and provider payloads. Historical IDs and recorded values remain immutable when a target is later removed.</p>
  </Panel>;
}

function SuperAdminAccountDetail({ detail, packages, session, fixture, canWrite, refresh }: { detail: any; packages: any[]; session: Session | null; fixture: boolean; canWrite: boolean; refresh: () => Promise<void> }) {
  const labels = ["Overview", "Workspaces & Properties", "Users & Permissions", "Package & Billing", "Usage", "Communications", "Activity", "Data & Access"];
  const [tab, setTab] = useState("Overview");
  const activeGrant = (detail.grants || []).find((item: any) => item.status === "active" && (!item.expires_at || Date.parse(item.expires_at) > Date.now()));
  const standardAssignment = (detail.assignments || []).find((item: any) => !item.ends_at);
  const [arrangement, setArrangement] = useState(activeGrant ? "complimentary" : "standard");
  const [packageVersionId, setPackageVersionId] = useState(activeGrant?.package_version_id || standardAssignment?.package_version_id || packages.find((item) => item.state === "published")?.id || "");
  const [permanent, setPermanent] = useState(!activeGrant?.expires_at);
  const [expiresAt, setExpiresAt] = useState(activeGrant?.expires_at ? new Date(activeGrant.expires_at).toISOString().slice(0, 16) : "");
  const [reason, setReason] = useState(activeGrant?.reason || "");
  const [properties, setProperties] = useState("");
  const [editingSeats, setEditingSeats] = useState("");
  const [auditCredits, setAuditCredits] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const effective = detail.effectiveEntitlements;
  const publishedPackages = packages.filter((item) => item.state === "published");

  function requestBody() {
    return {
      packageVersionId,
      permanent,
      expiresAt: permanent || !expiresAt ? null : new Date(expiresAt).toISOString(),
      reason,
      overrides: { propertiesPerAccount: properties, editingSeats, auditCreditsPerWeek: auditCredits },
    };
  }

  async function previewChange() {
    if (!session || fixture || arrangement !== "complimentary") return;
    setBusy(true); setMessage("");
    try { setPreview((await api<any>(session, `/api/superadmin/accounts/${detail.account.id}/package-preview`, { method: "POST", body: JSON.stringify(requestBody()) })).preview); }
    catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function saveChange() {
    if (!session || fixture) return;
    setBusy(true); setMessage("");
    try {
      if (arrangement === "standard") {
        await api(session, `/api/superadmin/accounts/${detail.account.id}/package`, { method: "DELETE", body: JSON.stringify({ reason }) });
        setMessage("Complimentary access revoked. The underlying standard package is effective; Stripe was not changed.");
      } else {
        await api(session, `/api/superadmin/accounts/${detail.account.id}/package`, { method: "PUT", body: JSON.stringify(requestBody()) });
        setMessage("Complimentary package saved. No Stripe charge or subscription change was made.");
      }
      setPreview(null);
      await refresh();
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  const packageName = activeGrant?.package_versions?.display_name || standardAssignment?.package_versions?.display_name || cap(effective?.packageKey?.replaceAll("_", " ") || detail.account.entitlement);
  return <>
    <div className="button-row"><Link className="btn" to="/superadmin?view=accounts">← All accounts</Link><span><b>{detail.account.name}</b> · {packageName} · <StatusPill tone={activeGrant ? "success" : "neutral"}>{activeGrant ? "Complimentary" : "Standard"}</StatusPill></span></div>
    <Tabs labels={labels} value={tab} onChange={setTab} />
    {tab === "Overview" ? <><Metrics values={[["Workspaces", detail.workspaces.length, "Account resources"], ["Properties", detail.properties.length, "Preserved on package changes"], ["Users", new Set(detail.memberships.map((item: any) => item.user_id)).size, "Account identities"], ["Access", cap(detail.account.access_state || "active"), "Account state"]]} /><Panel title="Effective access"><p><b>{packageName}</b> · {activeGrant ? "Complimentary" : `Standard billing state: ${standardAssignment?.billing_state || "unconfigured"}`}</p><p className="subtle">Package changes do not delete workspaces, properties, reports, audits or analytics history.</p></Panel></> : null}
    {tab === "Workspaces & Properties" ? <Panel title="Workspaces & properties"><DataTable headers={["Property", "Domain", "Workspace", "State"]} rows={detail.properties.map((property: any) => [property.name, property.canonical_host, detail.workspaces.find((workspace: any) => workspace.id === property.workspace_id)?.name || property.workspace_id, property.access_state])} /></Panel> : null}
    {tab === "Users & Permissions" ? <Panel title="Users & permissions"><DataTable headers={["User ID", "Role", "Created"]} rows={detail.memberships.map((item: any) => [item.user_id, cap(item.role), fmtDate(item.created_at)])} /></Panel> : null}
    {tab === "Package & Billing" ? <>
      <Panel title="Current package & billing"><Metrics values={[["Effective package", packageName, activeGrant ? "Complimentary grant" : "Standard assignment"], ["Billing arrangement", activeGrant ? "Complimentary" : "Standard", activeGrant ? "No payment required" : cap(standardAssignment?.billing_state || "unconfigured")], ["Grant expiry", activeGrant?.expires_at ? fmtDate(activeGrant.expires_at) : activeGrant ? "Never" : "Not applicable", activeGrant?.expiry_behavior === "return_to_standard" ? "Returns to standard package" : ""], ["Stripe", standardAssignment?.billing_state || "Unconfigured", "Unaffected by complimentary access"]]} />
        {activeGrant?.expires_at && <UnavailableState title="Temporary complimentary access" detail={`This grant ends ${fmtDate(activeGrant.expires_at)}. The account will return to its underlying standard package without an automatic charge.`} />}
      </Panel>
      <Panel title="Edit package access">
        <div className="settings-grid">
          <label className="field">Billing arrangement<select value={arrangement} onChange={(event) => { setArrangement(event.target.value); setPreview(null); }}><option value="complimentary">Complimentary</option><option value="standard">Standard (underlying billing)</option></select></label>
          <label className="field">Package<select value={packageVersionId} disabled={arrangement === "standard"} onChange={(event) => { setPackageVersionId(event.target.value); setPreview(null); }}>{publishedPackages.map((item) => <option key={item.id} value={item.id}>{item.display_name} · v{item.version}</option>)}</select></label>
          {arrangement === "complimentary" && <label className="field">Duration<select value={permanent ? "permanent" : "temporary"} onChange={(event) => setPermanent(event.target.value === "permanent")}><option value="permanent">Permanent</option><option value="temporary">Temporary</option></select></label>}
          {arrangement === "complimentary" && !permanent && <label className="field">Expires<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>}
          <label className="field settings-span-2">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the immutable admin audit log" /></label>
        </div>
        {arrangement === "complimentary" ? <>
          <h3>Optional allocation overrides</h3>
          <div className="settings-grid"><label className="field">Properties<input inputMode="numeric" value={properties} onChange={(event) => setProperties(event.target.value)} placeholder="Package default" /></label><label className="field">Editing seats<input inputMode="numeric" value={editingSeats} onChange={(event) => setEditingSeats(event.target.value)} placeholder="Package default" /></label><label className="field">Audit credits / week<input inputMode="numeric" value={auditCredits} onChange={(event) => setAuditCredits(event.target.value)} placeholder="Package default" /></label></div>
          <p className="subtle">Blank values inherit the package. Overrides cannot exceed platform safety ceilings. Temporary grants return to the underlying standard package at expiry; they never start a charge.</p>
          <div className="button-row"><button className="btn" disabled={busy || !canWrite} onClick={() => void previewChange()}>Preview effective access</button><button className="primary" disabled={busy || !canWrite || !preview} onClick={() => void saveChange()}>Save complimentary access</button></div>
        </> : <><p className="subtle">Selecting Standard removes only the complimentary overlay. It does not create, alter or cancel a Stripe subscription.</p><button className="danger-solid" disabled={busy || !canWrite || !activeGrant || reason.trim().length < 3} onClick={() => void saveChange()}>Return to standard package</button></>}
        {preview && <div className="analytics-state"><h3>Preview</h3><p><b>{preview.proposed.displayName}</b> · Complimentary · {preview.permanent ? "Permanent" : `Until ${fmtDate(preview.expiresAt)}`}</p><p>{preview.expiryOutcome}</p><DataTable headers={["Entitlement", "Effective value", "Source"]} rows={Object.entries(preview.proposed.values || {}).map(([key, value]) => [cap(key.replace(/([A-Z])/g, " $1")), value === null ? "Unlimited" : JSON.stringify(value), preview.proposed.sources?.[key] || "Package"])} />{preview.conflicts?.length ? <UnavailableState title="Existing use exceeds the proposed allowance" detail={preview.conflicts.join("; ")} /> : <p className="subtle">No existing property or editing-seat conflicts detected.</p>}</div>}
        {message && <p className="subtle" role="status">{message}</p>}
      </Panel>
      <Panel title="Grant history"><DataTable headers={["Package", "Arrangement", "Status", "Starts", "Expires", "Reason"]} rows={(detail.grants || []).map((item: any) => [item.package_versions?.display_name || item.package_version_id, "Complimentary", cap(item.status), fmtDate(item.starts_at), item.expires_at ? fmtDate(item.expires_at) : "Never", item.reason])} /></Panel>
    </> : null}
    {tab === "Usage" ? <Panel title="Usage"><DataTable headers={["Period", "Metric", "Included", "Consumed", "Reserved"]} rows={(detail.usage || []).map((item: any) => [`${fmtDate(item.period_start)} – ${fmtDate(item.period_end)}`, item.metric, item.included ?? "—", item.consumed, item.reserved])} /></Panel> : null}
    {tab === "Communications" ? <Panel title="Communications"><DataTable headers={["Channel", "Subject", "State", "Created"]} rows={(detail.messages || []).map((item: any) => [item.channel, item.subject || item.kind, item.state, fmtDate(item.created_at)])} /></Panel> : null}
    {tab === "Activity" ? <Panel title="Account activity"><DataTable headers={["Action", "Actor", "Time"]} rows={(detail.activity || []).map((item: any) => [item.action, item.actor_id || "System", fmtDate(item.created_at)])} /></Panel> : null}
    {tab === "Data & Access" ? <Panel title="Data & access"><p>Account state: <b>{cap(detail.account.access_state || "active")}</b></p><p><Link className="btn" to={`/superadmin?view=administration&tab=Customer+sessions&account=${detail.account.id}`}>View as this customer</Link></p><p className="subtle">Package changes preserve customer data. Data export and deletion remain separate permission-checked workflows.</p></Panel> : null}
  </>;
}

function UnavailableState({ title, detail }: { title: string; detail: string }) {
  return <div className="superadmin-unavailable"><ShieldAlert /><span><b>{title}</b><small>{detail}</small></span></div>;
}

function PlatformServices({ platform, payload }: { platform: any; payload: SuperAdminPayload | null }) {
  return <Panel title="Service health"><DataTable headers={["Service", "State", "Source", "Period / refreshed"]} rows={[
    ["Claritude Worker", <StatusPill tone="success">Available</StatusPill>, "Application health", platform?.environment?.refreshedAt ? fmtDate(platform.environment.refreshedAt) : "Now"],
    ["Audit processing", (platform?.audits?.today?.failed || 0) > 0 ? <StatusPill tone="danger">Failures recorded</StatusPill> : <StatusPill tone="success">Operational</StatusPill>, "Application measured", "UTC day"],
    ["Uptime monitoring", (payload?.stats.offlineMonitors || 0) > 0 ? <StatusPill tone="danger">Customer incidents</StatusPill> : <StatusPill tone="success">Operational</StatusPill>, "Application measured", "Current monitor state"],
    ["Resend", platform?.providers?.resend?.configured ? "Configured" : "Unavailable", "Configuration", "Current deployment"],
    ["Stripe", platform?.providers?.stripe?.configured ? platform.providers.stripe.mode : "Unconfigured", "Configuration", "Current deployment"],
    ["Cloudflare detailed telemetry", "Unavailable", "Provider access not configured", "—"],
    ["Supabase backups", "Unverified", "Provider capability not read", "—"],
  ]} /></Panel>;
}

function CustomerSessionsPanel({ session, fixture, payload, sessions, refresh }: { session: Session | null; fixture: boolean; payload: SuperAdminPayload | null; sessions: any[]; refresh: () => Promise<void> }) {
  const contextualAccount = new URLSearchParams(useLocation().search).get("account") || "";
  const [accountId, setAccountId] = useState(contextualAccount || payload?.accounts?.[0]?.id || "");
  const [accountSearch, setAccountSearch] = useState("");
  const [memberships, setMemberships] = useState<any[]>([]);
  const [userId, setUserId] = useState("");
  const [mode, setMode] = useState<"read" | "write">("read");
  const [duration, setDuration] = useState(30);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!session || fixture || !accountId) { setMemberships([]); return; }
    void api<any>(session, `/api/superadmin/accounts/${accountId}`).then((result) => {
      setMemberships(result.memberships || []);
      setUserId((current) => (result.memberships || []).some((item: any) => item.user_id === current) ? current : result.memberships?.[0]?.user_id || "");
    }).catch((error) => setMessage(error.message));
  }, [session?.access_token, accountId, fixture]);
  const user = payload?.users.find((item) => item.id === userId);
  async function start() {
    if (!session || !accountId || !userId || reason.trim().length < 3) return;
    setMessage("");
    try {
      const result = await api<any>(session, "/api/superadmin/delegations", { method: "POST", body: JSON.stringify({ accountId, representedUserId: userId, mode, durationMinutes: duration, reason }) });
      const banner = { ...result.session, accountName: payload?.accounts.find((item) => item.id === accountId)?.name, userEmail: user?.email };
      localStorage.setItem("claritude-delegation", JSON.stringify(banner));
      window.dispatchEvent(new Event("claritude-delegation-change"));
      setPreview(await api(session, `/api/superadmin/delegations/${result.session.id}/bootstrap`));
      setReason("");
      await refresh();
      window.location.assign("/");
    } catch (error: any) { setMessage(error.message); }
  }
  async function revoke(item: any) {
    if (!session) return;
    await api(session, `/api/superadmin/delegations/${item.id}`, { method: "DELETE" });
    const current = JSON.parse(localStorage.getItem("claritude-delegation") || "null");
    if (current?.id === item.id) { localStorage.removeItem("claritude-delegation"); window.dispatchEvent(new Event("claritude-delegation-change")); setPreview(null); }
    await refresh();
  }
  return <>
    <Panel title="Start customer session">
      <p className="subtle">Scoped to one account and represented user. Read-only is the default; write mode requires explicit activation and a reason. Sessions expire after at most 60 minutes and are rechecked on every request.</p>
      <div className="form-grid delegation-form">
        <label className="field">Search accounts<input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Account name" /></label>
        <label className="field">Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{(payload?.accounts || []).filter((account) => !accountSearch || account.name.toLowerCase().includes(accountSearch.toLowerCase())).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
        <label className="field">Represented user<select value={userId} onChange={(event) => setUserId(event.target.value)}>{memberships.map((membership) => <option value={membership.user_id} key={membership.user_id}>{payload?.users.find((item) => item.id === membership.user_id)?.email || membership.user_id} · {membership.role}</option>)}</select></label>
        <label className="field">Mode<select value={mode} onChange={(event) => setMode(event.target.value as "read" | "write")}><option value="read">Read-only</option><option value="write">Write enabled</option></select></label>
        <label className="field">Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label>
      </div>
      <label className="field">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why customer access is required" /></label>
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="btn primary" disabled={fixture || !userId || reason.trim().length < 3} onClick={() => void start()}>Start scoped session</button>
    </Panel>
    {preview && <Panel title={`Customer preview · ${preview.account?.name || "Account"}`}><DataTable headers={["Workspace", "Properties"]} rows={(preview.workspaces || []).map((workspace: any) => [workspace.name, (preview.properties || []).filter((property: any) => property.workspace_id === workspace.id).length])} /><p className="subtle">Sensitive finance, ownership and destructive actions remain outside delegation and require their dedicated privileged workflows.</p></Panel>}
    <Panel title="Recent customer sessions"><DataTable headers={["Account", "Represented user", "Mode", "Reason", "Expires", "State", "Action"]} rows={sessions.map((item) => [payload?.accounts.find((account) => account.id === item.account_id)?.name || item.account_id, payload?.users.find((candidate) => candidate.id === item.represented_user_id)?.email || item.represented_user_id, item.mode, item.reason, fmtDate(item.expires_at), item.revoked_at ? "Revoked" : Date.parse(item.expires_at) < Date.now() ? "Expired" : "Active", !item.revoked_at && Date.parse(item.expires_at) > Date.now() ? <button className="btn" onClick={() => void revoke(item)}>Exit</button> : "—"])} /></Panel>
  </>;
}

function AccountView({
  session,
  data,
  fixture,
  reload,
  notify,
}: {
  session: Session | null;
  data: Bootstrap;
  fixture: boolean;
  reload: () => void;
  notify: Notify;
}) {
  const accountLocation = useLocation();
  const requestedAccountTab = new URLSearchParams(accountLocation.search).get("accountTab");
  const [tab, setTab] = useState(requestedAccountTab || "Profile"),
    [name, setName] = useState(data.profile?.full_name || ""),
    [avatarBusy, setAvatarBusy] = useState(false),
    [timezone, setTimezone] = useState(
      data.profile?.timezone || "Europe/London",
    ),
    [dateFormat, setDateFormat] = useState(data.profile?.date_format || "DD/MM/YYYY"),
    [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, string>>(() =>
      Object.fromEntries(data.workspaces.map((entry: any) => [entry.workspaces?.id, entry.workspaces?.name || ""])),
    ),
    [usersData, setUsersData] = useState<any>(null),
    [usersError, setUsersError] = useState(""),
    [inviteOpen, setInviteOpen] = useState(false),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<"member" | "viewer">("member"),
    [inviteWorkspaceId, setInviteWorkspaceId] = useState<string>(data.workspaces?.[0]?.workspaces?.id || ""),
    [memberToEdit, setMemberToEdit] = useState<any | null>(null),
    [memberRole, setMemberRole] = useState<"member" | "viewer">("member"),
    [memberToRemove, setMemberToRemove] = useState<any | null>(null),
    [workspaceToEdit, setWorkspaceToEdit] = useState<any | null>(null),
    [propertyToMove, setPropertyToMove] = useState<Property | null>(null),
    [propertyMoveWorkspaceId, setPropertyMoveWorkspaceId] = useState(""),
    [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null),
    [propertyDeleteConfirmation, setPropertyDeleteConfirmation] = useState(""),
    [workspaceToDelete, setWorkspaceToDelete] = useState<any | null>(null),
    [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("");
  const role = data.accounts?.[0]?.role || data.workspaces?.[0]?.role || "viewer";
  const tabs = role === "viewer"
    ? ["Profile", "Notification preferences", "Security"]
    : [
        "Profile",
        "Workspace",
        "Properties",
        "Billing & plan",
        "Users",
        "Notification preferences",
        "Activity logs",
        "Security",
        "Data & privacy",
      ];
  useEffect(() => {
    if (!session || role === "viewer") return;
    setUsersError("");
    api(session, "/api/users")
      .then(setUsersData)
      .catch((error) => {
        setUsersData(null);
        setUsersError(error instanceof Error ? error.message : "Workspace users could not be loaded");
      });
  }, [session, data.workspaces.length, role]);
  useEffect(() => {
    setWorkspaceDrafts(
      Object.fromEntries(data.workspaces.map((entry: any) => [entry.workspaces?.id, entry.workspaces?.name || ""])),
    );
    setInviteWorkspaceId((current) =>
      data.workspaces.some((entry: any) => entry.workspaces?.id === current)
        ? current
        : data.workspaces?.[0]?.workspaces?.id || "",
    );
  }, [data.workspaces]);
  useEffect(() => {
    if (requestedAccountTab && tabs.includes(requestedAccountTab)) setTab(requestedAccountTab);
  }, [requestedAccountTab, tabs.join("|")]);
  async function save() {
    try {
      if (session)
        await api(session, "/api/profile", {
          method: "PATCH",
          body: JSON.stringify({ full_name: name, timezone, date_format: dateFormat }),
        });
      notify("Profile saved");
      reload();
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function uploadAvatar(file?: File) {
    if (!file || !session) return;
    if (!file.type.startsWith("image/")) return notify("Choose an image file");
    if (file.size > 10 * 1024 * 1024) return notify("Avatar source images must be 10 MB or smaller");
    setAvatarBusy(true);
    try {
      const avatar = await prepareAvatarImage(file);
      await api(session, "/api/profile/avatar", {
        method: "PUT",
        headers: { "content-type": avatar.type },
        body: avatar,
      });
      notify("Profile image updated");
      reload();
    } catch (error: any) {
      notify(error.message);
    } finally {
      setAvatarBusy(false);
    }
  }
  async function deleteAvatar() {
    if (!session) return;
    setAvatarBusy(true);
    try {
      await api(session, "/api/profile/avatar", { method: "DELETE" });
      notify("Profile image removed");
      reload();
    } catch (error: any) {
      notify(error.message);
    } finally {
      setAvatarBusy(false);
    }
  }
  async function refreshUsers() {
    if (!session) return;
    setUsersError("");
    try {
      setUsersData(await api(session, "/api/users"));
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Workspace users could not be loaded");
    }
  }
  async function saveWorkspace(workspaceId: string) {
    const workspaceName = workspaceDrafts[workspaceId]?.trim();
    if (!session || !workspaceId || !workspaceName) return;
    try {
      await api(session, `/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: workspaceName }),
      });
      notify("Workspace settings saved");
      reload();
    } catch (error: any) {
      notify(error.message);
    }
  }
  return (
    <Page
      title="Account settings"
      status={<span className="tag">Account holder</span>}
    >
      <Tabs labels={tabs} value={tab} onChange={setTab} />
      {tab === "Profile" ? (
        <Panel title="Personal profile">
          <div className="profile-identity">
            <ProfileAvatar profile={data.profile} name={name} className="profile-avatar" />
            <span>
              <h2>{name || "Claritude user"}</h2>
              <small>Personal profile</small>
            </span>
            <span className="profile-avatar-actions">
              <label className="btn avatar-upload-button">
                <Upload /> {avatarBusy ? "Uploading…" : "Upload image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={avatarBusy}
                  onChange={(event) => {
                    void uploadAvatar(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {profileAvatarUrl(data.profile) && (
                <button className="btn" disabled={avatarBusy} onClick={() => void deleteAvatar()}>
                  <Trash2 /> Remove
                </button>
              )}
            </span>
          </div>
          <label className="field">
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Email
            <input
              value={session?.user.email || "fixture@claritude.local"}
              readOnly
            />
          </label>
          <label className="field">
            Timezone
            <TimezoneSelect value={timezone} onChange={setTimezone} />
          </label>
          <label className="field">
            Date format
            <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </label>
          <button className="primary" onClick={save}>
            Save profile
          </button>
        </Panel>
      ) : tab === "Workspace" ? (
        <Panel title="Workspace">
          <DataTable
            headers={["Workspace", "Properties", "Access", ""]}
            rows={data.workspaces.map((entry: any) => {
              const workspace = entry.workspaces;
              const propertyCount = data.properties.filter((property) => property.workspace_id === workspace?.id).length;
              const canEditWorkspace = entry.role === "owner" || entry.role === "member";
              return [
                <b>{workspace?.name || "Workspace"}</b>,
                propertyCount,
                cap(entry.role),
                <div className="row-actions">
                  {canEditWorkspace && <button className="btn" onClick={() => setWorkspaceToEdit(workspace)}>Edit</button>}
                  {entry.role === "owner" && (
                    <button
                      className="danger-solid"
                      disabled={propertyCount > 0 || data.workspaces.length <= 1}
                      title={propertyCount > 0 ? "Delete the workspace’s properties first" : data.workspaces.length <= 1 ? "An account must retain one workspace" : "Delete workspace"}
                      onClick={() => setWorkspaceToDelete(workspace)}
                    >
                      Delete
                    </button>
                  )}
                </div>,
              ];
            })}
          />
          <p className="subtle">A workspace must be empty before it can be deleted, and every account must retain at least one workspace.</p>
        </Panel>
      ) : tab === "Properties" ? (
        <Panel title="Properties across your workspaces">
          <DataTable
            headers={["Property", "Workspace", "Viewers", "Editing/admin users", "Tracking", "Uptime", ""]}
            rows={data.properties.filter((property) => data.workspaces.some((entry: any) => entry.workspaces?.id === property.workspace_id && ["owner", "member"].includes(entry.role))).map((property) => {
              const workspace = data.workspaces.find((entry: any) => entry.workspaces?.id === property.workspace_id)?.workspaces;
              const viewerCount = (data.propertyMemberships || []).filter((membership: any) => membership.property_id === property.id).length;
              const editorCount = (usersData?.workspaceMemberships || []).filter((membership: any) => membership.workspace_id === property.workspace_id && membership.role !== "viewer").length;
              const monitor = property.uptime_monitors?.[0];
              return [
                <Link className="project-cell" to={`/overview?property=${property.id}`}><span className="favicon project-icon"><PropertyFavicon property={property} /></span><span><b>{property.name}</b><small>{property.canonical_host}</small></span></Link>,
                workspace?.name || "Workspace",
                viewerCount,
                editorCount,
                <StatusPill tone={property.tracking_last_received_at ? "success" : "danger"}>{property.tracking_last_received_at ? "Receiving data" : "Not installed"}</StatusPill>,
                <StatusPill tone={monitor?.enabled === false ? "neutral" : monitor?.last_status === "offline" ? "danger" : "success"}>{monitor?.enabled === false ? "Paused" : monitor ? "Monitoring" : "Not monitoring"}</StatusPill>,
                <div className="row-actions"><Link className="btn" to={`/settings?property=${property.id}`}>Edit</Link><button className="btn" onClick={() => { setPropertyToMove(property); setPropertyMoveWorkspaceId(property.workspace_id || ""); }}>Move</button><button className="danger-solid" onClick={() => setPropertyToDelete(property)}>Delete</button></div>,
              ];
            })}
          />
        </Panel>
      ) : tab === "Billing & plan" ? (
        <Billing fixture={fixture} notify={notify} data={data} session={session} />
      ) : tab === "Users" ? (
        <Panel
          title="Workspace users"
          actions={
            <button
              className="btn"
              onClick={() => setInviteOpen(true)}
            >
              <Plus />
              Invite user
            </button>
          }
        >
          {usersError ? (
            <div className="analytics-state" role="alert">
              <Empty title="Workspace users could not be loaded" detail={usersError} />
              <button className="btn" onClick={() => void refreshUsers()}>Retry</button>
            </div>
          ) : usersData ? (
            <DataTable
              headers={[
                "User",
                "Seat",
                "Access level",
                "Workspace",
                "Status",
                "",
              ]}
              rows={(usersData.workspaceMemberships || []).map((membership: any) => {
                const user = usersData.users?.find((item: any) => item.id === membership.user_id);
                const workspace = usersData.workspaces?.find((item: any) => item.id === membership.workspace_id);
                const protectedOwner = membership.role === "owner";
                const context = { membership, user, workspace };
                return [
                  user?.name || user?.email || membership.user_id,
                  membership.role === "viewer" ? "Free viewer" : "Editing user",
                  cap(membership.role),
                  workspace?.name || "Workspace",
                  user?.confirmedAt ? "Active" : "Invited",
                  protectedOwner ? (
                    <span className="subtle">Owner protected</span>
                  ) : (
                    <div className="row-actions">
                      <button className="btn" onClick={() => { setMemberToEdit(context); setMemberRole(membership.role === "viewer" ? "viewer" : "member"); }}>Edit</button>
                      <button className="danger-solid" onClick={() => setMemberToRemove(context)}>Remove</button>
                    </div>
                  ),
                ];
              })}
            />
          ) : (
            <Empty title="Loading workspace users…" detail="Checking workspace access." />
          )}
        </Panel>
      ) : tab === "Notification preferences" ? (
        <Preferences session={session} profile={data.profile} reload={reload} notify={notify} />
      ) : tab === "Activity logs" ? (
        <Panel title="Account activity logs">
          <DataTable
            headers={["Time", "Actor", "Action", "Target", "Result"]}
            rows={(data.activity || []).map((entry: any) => [
              fmtDate(entry.created_at),
              entry.actor_id === session?.user.id ? data.profile?.full_name || "Current user" : "Workspace member",
              entry.action.replaceAll(".", " "),
              entry.property_id || entry.metadata?.workspaceId || "Account",
              "Success",
            ])}
          />
        </Panel>
      ) : tab === "Security" ? (
        <div className="grid equal">
          <Panel title="Password">
            <p>Use the secure recovery flow to change your password.</p>
            <Link className="primary" to="/auth/forgot">
              Request reset link
            </Link>
          </Panel>
          <Panel title="Sessions">
            <KeyValues
              rows={[
                ["This browser", "Current authenticated session"],
                ["Last active", "Now"],
              ]}
            />
            <p className="subtle">Other-session management is not exposed by the current authentication provider configuration.</p>
          </Panel>
        </div>
      ) : (
        <Panel title="Data & privacy">
          <AdvancedRow
            title="Analytics privacy"
            detail="Claritude does not use cookies or persistent visitor identifiers."
            action={<span className="tag">Privacy-first</span>}
          />
          <AdvancedRow
            title="Export account data"
            detail="Prepare a machine-readable export of workspace data."
            action={
              <button
                className="btn"
                onClick={() => {
                  if (!session) return;
                  void api<any>(session, "/api/account/export")
                    .then((exported) => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "claritude-account-export.json";
                      link.click();
                      URL.revokeObjectURL(url);
                      notify("Account export downloaded");
                    })
                    .catch((error) => notify(error.message));
                }}
              >
                Export JSON
              </button>
            }
          />
          <AdvancedRow
            danger
            title="Delete account"
            detail="Contact support for destructive account operations."
            action={
              <button className="danger-solid" disabled>
                Delete account
              </button>
            }
          />
        </Panel>
      )}
      {workspaceToEdit && (
        <SimpleDialog
          title="Edit workspace"
          close={() => setWorkspaceToEdit(null)}
          action="Save"
          disabled={!workspaceDrafts[workspaceToEdit.id]?.trim()}
          onSave={async () => {
            await saveWorkspace(workspaceToEdit.id);
            setWorkspaceToEdit(null);
          }}
        >
          <label className="field">Workspace name<input autoFocus value={workspaceDrafts[workspaceToEdit.id] || ""} onChange={(event) => setWorkspaceDrafts((current) => ({ ...current, [workspaceToEdit.id]: event.target.value }))} /></label>
        </SimpleDialog>
      )}
      {propertyToMove && (
        <SimpleDialog
          title="Change assigned workspace"
          close={() => setPropertyToMove(null)}
          action="Move property"
          disabled={!propertyMoveWorkspaceId || propertyMoveWorkspaceId === propertyToMove.workspace_id}
          onSave={async () => {
            if (!session) return;
            try {
              await api(session, `/api/properties/${propertyToMove.id}`, { method: "PATCH", body: JSON.stringify({ name: propertyToMove.name, workspace_id: propertyMoveWorkspaceId }) });
              setPropertyToMove(null);
              reload();
              notify("Property moved to its new workspace");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p>Move <b>{propertyToMove.name}</b> to another workspace in this account.</p>
          <label className="field">Workspace<select value={propertyMoveWorkspaceId} onChange={(event) => setPropertyMoveWorkspaceId(event.target.value)}>{data.workspaces.filter((entry: any) => ["owner", "member"].includes(entry.role)).map((entry: any) => <option key={entry.workspaces?.id} value={entry.workspaces?.id}>{entry.workspaces?.name}</option>)}</select></label>
        </SimpleDialog>
      )}
      {propertyToDelete && (
        <SimpleDialog
          title="Delete property"
          close={() => { setPropertyToDelete(null); setPropertyDeleteConfirmation(""); }}
          action="Delete property"
          danger
          disabled={propertyDeleteConfirmation !== propertyToDelete.name}
          onSave={async () => {
            if (!session || propertyDeleteConfirmation !== propertyToDelete.name) return;
            try {
              await api(session, `/api/properties/${propertyToDelete.id}`, { method: "DELETE" });
              setPropertyToDelete(null);
              setPropertyDeleteConfirmation("");
              reload();
              notify("Property deleted");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p>This permanently removes the property and its monitoring, analytics, audits and reports.</p>
          <label className="field">Type <b>{propertyToDelete.name}</b> to confirm<input autoFocus value={propertyDeleteConfirmation} onChange={(event) => setPropertyDeleteConfirmation(event.target.value)} /></label>
        </SimpleDialog>
      )}
      {inviteOpen && (
        <SimpleDialog
          title="Invite workspace user"
          close={() => setInviteOpen(false)}
          action="Send invitation"
          onSave={async () => {
            if (!session || !inviteWorkspaceId || !inviteEmail) return;
            try {
              const invited = await api<any>(session, `/api/workspaces/${inviteWorkspaceId}/members`, {
                method: "POST",
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
              });
              setInviteOpen(false);
              setInviteEmail("");
              await refreshUsers();
              notify(invited.invitationSent ? "Invitation sent" : "Existing user granted access");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <label className="field">Email<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label className="field">Workspace<select value={inviteWorkspaceId} onChange={(event) => setInviteWorkspaceId(event.target.value)}>{data.workspaces.map((entry: any) => <option key={entry.workspaces?.id} value={entry.workspaces?.id}>{entry.workspaces?.name || "Workspace"}</option>)}</select></label>
          <label className="field">Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "member" | "viewer")}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
        </SimpleDialog>
      )}
      {memberToEdit && (
        <SimpleDialog
          title="Edit workspace user"
          close={() => setMemberToEdit(null)}
          action="Save access"
          onSave={async () => {
            if (!session) return;
            try {
              await api(session, `/api/workspaces/${memberToEdit.membership.workspace_id}/members/${memberToEdit.membership.user_id}`, {
                method: "PATCH",
                body: JSON.stringify({ role: memberRole }),
              });
              setMemberToEdit(null);
              await refreshUsers();
              notify("Workspace user access updated");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p><b>{memberToEdit.user?.name || memberToEdit.user?.email || "Workspace user"}</b> · {memberToEdit.workspace?.name || "Workspace"}</p>
          <label className="field">Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as "member" | "viewer")}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
          <p className="subtle">This changes workspace access only. The user controls their own name and email.</p>
        </SimpleDialog>
      )}
      {memberToRemove && (
        <SimpleDialog
          title="Remove workspace user"
          close={() => setMemberToRemove(null)}
          action="Remove access"
          danger
          onSave={async () => {
            if (!session) return;
            try {
              await api(session, `/api/workspaces/${memberToRemove.membership.workspace_id}/members/${memberToRemove.membership.user_id}`, {
                method: "DELETE",
              });
              setMemberToRemove(null);
              await refreshUsers();
              notify("Workspace access removed");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p>Remove <b>{memberToRemove.user?.name || memberToRemove.user?.email || "this user"}</b> from <b>{memberToRemove.workspace?.name || "this workspace"}</b>?</p>
          <p className="subtle">This revokes workspace access but does not delete the person’s authentication account.</p>
        </SimpleDialog>
      )}
      {workspaceToDelete && (
        <SimpleDialog
          title="Delete workspace"
          close={() => { setWorkspaceToDelete(null); setWorkspaceDeleteConfirmation(""); }}
          action="Delete workspace"
          danger
          disabled={workspaceDeleteConfirmation !== workspaceToDelete.name}
          onSave={async () => {
            if (!session || workspaceDeleteConfirmation !== workspaceToDelete.name) return;
            try {
              await api(session, `/api/workspaces/${workspaceToDelete.id}`, { method: "DELETE" });
              setWorkspaceToDelete(null);
              setWorkspaceDeleteConfirmation("");
              reload();
              notify("Workspace deleted");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <p>The workspace must be empty. This operation cannot be undone.</p>
          <label className="field">Type <b>{workspaceToDelete.name}</b> to confirm<input autoFocus value={workspaceDeleteConfirmation} onChange={(event) => setWorkspaceDeleteConfirmation(event.target.value)} /></label>
        </SimpleDialog>
      )}
    </Page>
  );
}

function Billing({ fixture, notify, data, session }: { fixture: boolean; notify: Notify; data: Bootstrap; session: Session | null }) {
  const [annual, setAnnual] = useState(true);
  const [eventUsage, setEventUsage] = useState<{ used: number; limit: number | null } | null>(fixture ? { used: 2, limit: 20 } : null);
  const accountId = data.accounts?.[0]?.accounts?.id;
  const effective = accountId ? data.accountEntitlements?.[accountId] : null;
  const entitlement = String(effective?.packageKey || data.accounts?.[0]?.accounts?.entitlement || (fixture ? "Scale" : "Pro"));
  const plan = /essentials/i.test(entitlement) ? "Essentials" : /scale/i.test(entitlement) ? "Scale" : /pro/i.test(entitlement) ? "Pro" : "Free";
  const complimentary = effective?.arrangement === "complimentary" || (!effective && /early.?access/i.test(entitlement));
  useEffect(() => {
    if (!session || !data.properties.length) return;
    let cancelled = false;
    Promise.all(data.properties.map((property) => api<EventDefinitionsResponse | EventDefinition[]>(session, `/api/properties/${property.id}/events`).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        let used = 0;
        let limit: number | null = 0;
        for (const result of results) {
          if (!result) continue;
          if (Array.isArray(result)) used += result.length;
          else {
            used += result.allowance.used;
            if (result.allowance.limit == null) limit = null;
            else if (limit != null) limit += result.allowance.limit;
          }
        }
        setEventUsage({ used, limit });
      });
    return () => { cancelled = true; };
  }, [session, data.properties.map((property) => property.id).join("|")]);
  const auditCount = data.properties.reduce((total, property) => total + (property.audit_runs || []).filter((run) => new Date(run.created_at).getMonth() === new Date().getMonth() && new Date(run.created_at).getFullYear() === new Date().getFullYear()).length, 0);
  const viewerCount = (data.propertyMemberships || []).length;
  return (
    <>
      <div className="grid equal">
        <Panel title="Subscription">
          <StatusPill tone="success">{complimentary ? "Complimentary" : "Active"}</StatusPill>
          <div className="price">{plan}</div>
          <p className="subtle">{complimentary ? `This package is complimentary${effective?.grant?.expires_at ? ` until ${fmtDate(effective.grant.expires_at)}` : " with no expiry"}. No payment is required and no Stripe subscription is changed.` : "This is the effective standard package. Billing state is shown only when reconciled from Stripe."}</p>
          <button className="btn" disabled title="Stripe plan changes are not connected">Change plan</button>{" "}
          <button className="btn" disabled title="Stripe billing management is not connected">Manage billing</button>
        </Panel>
        <Panel title="Current usage">
          <div className="usage-list">
            <UsageBar label="Properties" used={data.properties.length} />
            <UsageBar label="Workspaces" used={data.workspaces.length} />
            <UsageBar label="Custom events" used={eventUsage?.used ?? 0} limit={eventUsage?.limit} loading={!eventUsage} />
            <UsageBar label="Audits this month" used={auditCount} />
            <UsageBar label="Property viewers" used={viewerCount} />
          </div>
          <p className="subtle">Only limits currently exposed by the entitlement service are shown as allowances. Infrastructure safety ceilings are deliberately not presented as commercial plan limits.</p>
        </Panel>
      </div>
      <div className="grid equal">
        <Panel title="Payment method"><EmptyCompact title="No payment method available" detail="Stripe billing is not connected." /><button className="btn" disabled>Update</button><p className="subtle">No cancellation or downgrade is scheduled.</p></Panel>
        <Panel title="Invoice history"><EmptyCompact title="No invoice history available" detail="Invoices will appear after Stripe billing is connected." /></Panel>
      </div>
      <Panel title="Choose a plan" actions={<span className="seg"><button className={annual ? "active" : ""} onClick={() => setAnnual(true)}>Annual</button><button className={!annual ? "active" : ""} onClick={() => setAnnual(false)}>Monthly</button></span>}>
        <div className="plans">
          {["Free", "Essentials", "Scale", "Pro"].map((candidate) => <div className={`plan ${candidate === plan ? "current" : ""}`} key={candidate}><h2>{candidate}</h2><div className="price">Pricing unavailable</div><p>{candidate === "Pro" ? "Unlimited configured custom events per property, subject to platform safety limits." : `${candidate === "Free" ? 2 : candidate === "Essentials" ? 5 : 20} configured custom events per property.`}</p><button className="btn" disabled>{candidate === plan ? "Current plan" : candidate === "Free" ? "Downgrade" : "Upgrade"}</button></div>)}
        </div>
        <p className="subtle">Downgrading requires excess properties and paid users to be removed before renewal. The pricing toggle does not change the active annual subscription.</p>
      </Panel>
    </>
  );
}

function UsageBar({ label, used, limit, loading = false }: { label: string; used: number; limit?: number | null; loading?: boolean }) {
  const percentage = limit && limit > 0 ? Math.min(100, used / limit * 100) : 0;
  return <div className="usage-item"><span><b>{label}</b><small>{loading ? "Loading…" : `${fmt(used)} / ${limit == null ? "Current allowance not published" : fmt(limit)}`}</small></span>{limit != null && <span className="usage-track"><i style={{ width: `${percentage}%` }} /></span>}</div>;
}

function AddPropertyDialog({
  session,
  accountId,
  workspaceId,
  workspaces,
  close,
  done,
}: {
  session: Session | null;
  accountId?: string;
  workspaceId: string;
  workspaces: WorkspaceOption[];
  close: () => void;
  done: (property: Property) => void | Promise<void>;
}) {
  const [name, setName] = useState(""),
    [url, setUrl] = useState("https://"),
    [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!accountId || !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setError("Choose a workspace where you can add properties.");
      return;
    }
    setBusy(true);
    try {
      if (!session) throw new Error("authentication_required");
      const created = await api<Property>(session, "/api/properties", {
          method: "POST",
          body: JSON.stringify({
            accountId,
            workspaceId: selectedWorkspaceId,
            name,
            url,
          }),
        });
      await done(created);
    } catch (reason: any) {
      const messages: Record<string, string> = {
        authentication_required: "Your session has expired. Sign in again and retry.",
        workspace_access_denied: "You do not have permission to add properties to that workspace.",
        property_limit_reached: "This account has reached its property limit.",
        property_name_required: "Enter a property name.",
        public_http_url_required: "Enter a valid public http or https domain.",
        property_already_exists: "A property for this domain already exists in that workspace.",
      };
      setError(
        messages[reason?.message] ||
          "We couldn't add the property. Your details have been kept so you can try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add property" close={close}>
      <form onSubmit={submit}>
        <label className="field">
          Property name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Domain
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Workspace
          <select
            value={selectedWorkspaceId}
            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option value={workspace.id} key={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="notice danger">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Adding property…" : "Add property"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function HelpDialog({
  close,
  property,
}: {
  close: () => void;
  property?: Property;
}) {
  return (
    <Modal title="Help & setup" close={close}>
      <label className="field">
        Search help
        <input placeholder="Search help" />
      </label>
      <div className="help-links">
        <Link
          to={property ? `/overview?property=${property.id}` : "/"}
          onClick={close}
        >
          <b>Onboarding setup</b>
          <small>
            Add a property, monitoring, analytics and the first audit.
          </small>
        </Link>
        <Link
          to={property ? `/settings?property=${property.id}` : "/"}
          onClick={close}
        >
          <b>Tracking configuration</b>
          <small>Installation, testing and troubleshooting.</small>
        </Link>
        <Link
          to={property ? `/uptime?property=${property.id}` : "/"}
          onClick={close}
        >
          <b>Uptime settings</b>
          <small>Intervals, thresholds and execution details.</small>
        </Link>
        <Link
          to={property ? `/audit?property=${property.id}` : "/"}
          onClick={close}
        >
          <b>Audit findings</b>
          <small>Evidence, fixes and re-tests.</small>
        </Link>
      </div>
    </Modal>
  );
}
function SimpleDialog({
  title,
  close,
  action,
  onSave,
  children,
  danger = false,
  disabled = false,
}: {
  title: string;
  close: () => void;
  action: string;
  onSave: () => void | Promise<void>;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Modal title={title} close={close}>
      {children}
      <div className="dialog-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className={danger ? "danger-solid" : "primary"} onClick={onSave} disabled={disabled}>
          {action}
        </button>
      </div>
    </Modal>
  );
}
function ReportPreview({
  report,
  close,
  onSave,
}: {
  report: any;
  close: () => void;
  onSave: () => void | Promise<void>;
}) {
  const reportMetrics = {
    incidents: String(report.incidents?.length || 0),
    pageviews: fmt(report.analytics?.pageviews || 0),
    keyEvents: fmt(report.analytics?.keyEvents || 0),
    audit:
      report.audits?.[0]?.score != null
        ? `${report.audits[0].score} / 100`
        : "Awaiting audit",
  };
  function exportCsv() {
    const rows = [
      ["Metric", "Value"],
      ["Incidents", reportMetrics.incidents],
      ["Pageviews", reportMetrics.pageviews],
      ["Key events", reportMetrics.keyEvents],
      ["Audit", reportMetrics.audit],
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${value}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal title={`${report.property.name} · ${report.period}`} close={close}>
      <div className="report-preview">
        <Metrics
          values={[
            ["Incidents", reportMetrics.incidents],
            ["Pageviews", reportMetrics.pageviews],
            ["Key events", reportMetrics.keyEvents],
            ["Audit", reportMetrics.audit],
          ]}
        />
        <h2>Traffic</h2>
        <SeriesChart
          points={(report.analytics?.series || []).map((point: any) => ({
            label: point.day,
            value: point.pageviews,
          }))}
          emptyTitle="No measured traffic in this report period"
        />
        <h2>Recommendations</h2>
        {report.recommendations?.length ? (
          <ol>
            {report.recommendations.map((recommendation: string) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ol>
        ) : (
          <p className="subtle">
            Recommendations are derived from the recorded audit and incident detail;
            open those sections for the current evidence and fixes.
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onSave}>
            Save report
          </button>
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Page({
  title,
  status,
  actions,
  showOptions = true,
  relocateMobileControls = false,
  children,
}: {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  showOptions?: boolean;
  relocateMobileControls?: boolean;
  children: ReactNode | ((mobileControls: ReactNode) => ReactNode);
}) {
  const pageLocation = useLocation(),
    pageNavigate = useNavigate();
  const pageParams = new URLSearchParams(pageLocation.search);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const periodFromRef = useRef<HTMLInputElement>(null);
  const periodToRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false),
    [periodOpen, setPeriodOpen] = useState(false),
    [compact, setCompact] = useState(false),
    [periodFrom, setPeriodFrom] = useState(pageParams.get("from") || defaultFrom),
    [periodTo, setPeriodTo] = useState(pageParams.get("to") || defaultTo);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".page-options")) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  function exportVisibleTable() {
    const table = document.querySelector("main table");
    if (!table) return;
    const csv = Array.from(table.querySelectorAll("tr"))
      .map((row) =>
        Array.from(row.querySelectorAll("th,td"))
          .map((cell) => `"${(cell.textContent || "").trim().replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setMenu(false);
  }
  const renderPageOptions = (className: string) => (
    <div className={`page-options ${className}`}>
      <button
        className="iconbtn"
        aria-label="Page options"
        aria-expanded={menu}
        onClick={() => setMenu((value) => !value)}
      >
        <MoreHorizontal />
      </button>
      {menu && (
        <div className="action-menu page-action-menu">
          {status && (
            <button onClick={() => { setPeriodOpen(true); setMenu(false); }}>
              <CalendarDays /> Date range
            </button>
          )}
          <button disabled title="Comparison is available in Audit history and will be added to analytics after period snapshots are enabled">
            <BarChart3 /> Compare to previous
          </button>
          <button onClick={exportVisibleTable}>
            <ExternalLink /> Export visible table (CSV)
          </button>
          <button onClick={() => { window.print(); setMenu(false); }}>
            <FileChartColumn /> Print / save as PDF
          </button>
          <button onClick={() => { setCompact((value) => !value); setMenu(false); }}>
            <Settings /> {compact ? "Comfortable display" : "Compact display"}
          </button>
        </div>
      )}
    </div>
  );
  const mobileControls = (
    <div className="property-traffic-mobile-controls">
      <span className="property-traffic-period">{status}</span>
      {showOptions && renderPageOptions("page-options-mobile")}
    </div>
  );
  const controlsRelocated = relocateMobileControls && typeof children === "function";
  return (
    <div className={`content ${compact ? "compact-content" : ""}`}>
      <div className={`title-row ${controlsRelocated ? "title-row-relocated" : ""}`}>
        <h1>{title}</h1>
        <span className={controlsRelocated ? "page-status page-status-relocated" : "page-status"}>{status}</span>
        <span className="spacer" />
        {actions}
        {showOptions && renderPageOptions(controlsRelocated ? "page-options-desktop page-options-relocated" : "page-options-desktop")}
      </div>
      {typeof children === "function" ? children(mobileControls) : children}
      {periodOpen && (
        <Modal title="Date range" close={() => setPeriodOpen(false)}>
          <div className="form-two">
            <label className="field">From<input ref={periodFromRef} type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} /></label>
            <label className="field">To<input ref={periodToRef} type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} /></label>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setPeriodOpen(false)}>Cancel</button>
            <button
              className="primary"
              disabled={!periodFrom || !periodTo || new Date(periodFrom) > new Date(periodTo)}
              onClick={() => {
                const next = new URLSearchParams(pageLocation.search);
                next.set("from", periodFromRef.current?.value || periodFrom);
                next.set("to", periodToRef.current?.value || periodTo);
                pageNavigate(`${pageLocation.pathname}?${next.toString()}`);
                setPeriodOpen(false);
              }}
            >Apply range</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Period({ defaultDays = 30 }: { defaultDays?: number } = {}) {
  const periodLocation = useLocation();
  const params = new URLSearchParams(periodLocation.search);
  const to = params.get("to") || new Date().toISOString().slice(0, 10);
  const from = params.get("from") || new Date(Date.now() - Math.max(0, defaultDays - 1) * 864e5).toISOString().slice(0, 10);
  return (
    <span className="period-chip">
      <CalendarDays />
      {periodLabel(from, to)}
    </span>
  );
}

function AnalyticsDateRangeDialog({ from, to, setFrom, setTo, close, apply }: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  close: () => void;
  apply: (from: string, to: string) => void;
}) {
  const today = new Date();
  const dateValue = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const preset = (days: number) => {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - Math.max(0, days - 1));
    setFrom(dateValue(start));
    setTo(dateValue(end));
  };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return (
    <Modal title="Analytics date range" close={close}>
      <div className="analytics-range-presets" aria-label="Date range presets">
        <button className="btn" onClick={() => preset(1)}>Today</button>
        <button className="btn" onClick={() => preset(7)}>Last 7 days</button>
        <button className="btn" onClick={() => preset(30)}>Last 30 days</button>
        <button className="btn" onClick={() => preset(90)}>Last 90 days</button>
      </div>
      <div className="form-two">
        <label className="field">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <p className="subtle">The end date includes the complete calendar day. A single-day range switches charts to hourly points.</p>
      <div className="dialog-actions"><button className="btn" onClick={close}>Cancel</button><button className="primary" disabled={!valid} onClick={() => apply(from, to)}>Apply range</button></div>
    </Modal>
  );
}

function periodQuery(search: string) {
  const params = new URLSearchParams(search);
  const from = params.get("from");
  const to = params.get("to");
  return from && to
    ? new URLSearchParams({ from, to }).toString()
    : "days=30";
}
function Tabs({
  labels,
  value,
  onChange,
}: {
  labels: string[];
  value: string;
  onChange: (x: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {labels.map((x) => (
        <button
          role="tab"
          aria-selected={value === x}
          className={value === x ? "active" : ""}
          onClick={() => onChange(x)}
          key={x}
        >
          {x}
        </button>
      ))}
    </div>
  );
}
function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <div className="panel-head">
          <h2>{title}</h2>
          <span className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
function Metrics({ values }: { values: ReactNode[][] }) {
  return (
    <div className={`metrics metrics-${values.length}`}>
      {values.map((v, i) => (
        <div className="metric" key={i}>
          <small>{v[0]}</small>
          <b className={isPendingDataText(v[1]) ? "pending-data-text" : ""}>{v[1]}</b>
          {v[2] ? <span>{v[2]}</span> : null}
        </div>
      ))}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <small>{label}</small>
      <b className={isPendingDataText(value) ? "pending-data-text" : ""}>{value}</b>
    </div>
  );
}
function DataTable({
  headers,
  rows,
  className,
  headerHelp,
}: {
  headers: string[];
  rows: ReactNode[][];
  className?: string;
  headerHelp?: Partial<Record<number, ReactNode>>;
}) {
  const sorted = useSortableRows(rows, (row, column) => sortableValue(row[column]));
  return (
    <div className="table-wrap">
      <table className={className}>
        <thead>
          <tr>
            {headers.map((h, column) => (
              <SortableHeader key={h} label={h} column={column} sort={sorted.sort} onSort={sorted.onSort} help={headerHelp?.[column]} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td className={isPendingDataText(x) ? "pending-data-text" : ""} key={j}>{x}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function uptimePeriodQuery(search: string) {
  const params = new URLSearchParams(search);
  const from = params.get("from");
  const to = params.get("to");
  return from && to
    ? new URLSearchParams({ from, to }).toString()
    : "days=1&response_mode=checks";
}

export function responseChartLabel(bucket?: string, csv = false) {
  const label = bucket === "check"
    ? "Response time by monitor check"
    : `Median response time by ${bucket || "period"}`;
  return csv ? `${label} (ms)` : label;
}

type AnalyticsComparisonDirection = "higher" | "lower" | "neutral";

export function analyticsComparisonModel(
  current: number | null | undefined,
  previous: number | null | undefined,
  direction: AnalyticsComparisonDirection = "higher",
) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { text: "-- vs previous period", tone: "neutral" as const };
  }
  if (Number(previous) === 0) {
    if (Number(current) === 0)
      return { text: "→ 0% vs previous period", tone: "neutral" as const };
    const increased = Number(current) > 0;
    const favourable = direction === "higher" ? increased : direction === "lower" ? !increased : null;
    return {
      text: `${increased ? "↑" : "↓"} from 0 vs previous period`,
      tone: favourable == null ? "neutral" as const : favourable ? "favourable" as const : "unfavourable" as const,
    };
  }
  const change = ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100;
  if (!Number.isFinite(change)) return { text: "-- vs previous period", tone: "neutral" as const };
  if (Math.abs(change) < 0.05) return { text: "→ 0% vs previous period", tone: "neutral" as const };
  const increased = change > 0;
  const favourable = direction === "higher" ? increased : direction === "lower" ? !increased : null;
  const rounded = Math.abs(change) >= 10 ? Math.abs(change).toFixed(0) : Math.abs(change).toFixed(1);
  return {
    text: `${increased ? "↑" : "↓"} ${rounded}% vs previous period`,
    tone: favourable == null ? "neutral" as const : favourable ? "favourable" as const : "unfavourable" as const,
  };
}

function MetricComparison({ current, previous, direction = "higher" }: {
  current: number | null | undefined;
  previous: number | null | undefined;
  direction?: AnalyticsComparisonDirection;
}) {
  const comparison = analyticsComparisonModel(current, previous, direction);
  return <span className={`metric-comparison ${comparison.tone}`}>{comparison.text}</span>;
}

function isPendingDataText(value: ReactNode) {
  return typeof value === "string" && /^(Awaiting field data|Awaiting audit|Not implemented (?:by this audit run|in this run))$/i.test(value);
}

type TableSort = { column: number; direction: "asc" | "desc" } | null;
function sortableValue(value: ReactNode): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[%,$£€\s]/g, ""));
    return Number.isFinite(numeric) && /\d/.test(value) ? numeric : value.toLocaleLowerCase();
  }
  if (Array.isArray(value)) return value.map(sortableValue).join(" ");
  if (value && typeof value === "object" && "props" in value)
    return sortableValue((value as any).props?.children);
  return String(value ?? "").toLocaleLowerCase();
}
function compareTableValues(left: string | number, right: string | number) {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "en-GB", { numeric: true, sensitivity: "base" });
}
function useSortableRows<T>(rows: T[], value: (row: T, column: number) => string | number) {
  const [sort, setSort] = useState<TableSort>(null);
  const sortedRows = !sort ? rows : rows.map((row, index) => ({ row, index })).sort((left, right) => {
      const result = compareTableValues(value(left.row, sort.column), value(right.row, sort.column));
      return (result || left.index - right.index) * (sort.direction === "asc" ? 1 : -1);
    }).map(({ row }) => row);
  const onSort = (column: number) => setSort((current) => current?.column === column
    ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
    : { column, direction: "asc" });
  return { rows: sortedRows, sort, onSort };
}
function SortableHeader({ label, column, sort, onSort, help }: { label: string; column: number; sort: TableSort; onSort: (column: number) => void; help?: ReactNode }) {
  return (
    <th aria-sort={sort?.column === column ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <span className="table-header-content"><button className="table-sort-button" onClick={() => onSort(column)}>{label}</button>{help}</span>
    </th>
  );
}
function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div>
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}
function Status({ value }: { value: string }) {
  const v = value.toLowerCase();
  return (
    <span className="status-label">
      <i
        className={`status-dot ${["online", "verified", "active"].includes(v) ? "online" : v === "offline" ? "down" : "paused"}`}
      />
      {cap(value)}
    </span>
  );
}

function TrackingStatus({ receiving }: { receiving: boolean }) {
  return (
    <span className="status-label">
      <i className={`status-dot ${receiving ? "online" : "down"}`} />
      {receiving ? "Receiving data" : "Not installed"}
    </span>
  );
}

function StatusPill({ tone, children }: { tone: "success" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`status-pill ${tone}`}><i />{children}</span>;
}

function CopyButton({
  text,
  label,
  successMessage,
  notify,
  className = "btn",
}: {
  text: string;
  label: string;
  successMessage: string;
  notify: Notify;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
      setCopied(false);
      window.requestAnimationFrame(() => setCopied(true));
      resetTimer.current = window.setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, 1800);
      notify(successMessage);
    } catch {
      notify("Clipboard access was unavailable. Try copying again from a secure browser context.");
    }
  };
  return (
    <button type="button" className={`${className} copy-action ${copied ? "copied" : ""}`.trim()} onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </button>
  );
}
function ChartSwitch({
  notify,
  events = false,
  value,
  onChange,
}: {
  notify: Notify;
  events?: boolean;
  value?: TrafficMetric;
  onChange?: (metric: TrafficMetric) => void;
}) {
  const [localValue, setLocalValue] = useState<TrafficMetric>("Pageviews");
  const selected = value || localValue;
  return (
    <span className="seg">
      {(["Pageviews", "Unique Visits", ...(events ? ["Events"] : [])] as TrafficMetric[]).map(
        (x) => (
          <button
            className={selected === x ? "active" : ""}
            onClick={() => {
              setLocalValue(x);
              onChange?.(x);
              notify(`${x} chart selected`);
            }}
            key={x}
          >
            {x}
          </button>
        ),
      )}
    </span>
  );
}
function SeriesChart({
  points,
  previousPoints = [],
  emptyTitle,
  unit = "",
  label = "Measured time series",
  timeZone,
  dateGranularity,
}: {
  points: { label: string; value: number }[];
  previousPoints?: { label: string; value: number }[];
  emptyTitle: string;
  unit?: string;
  label?: string;
  timeZone?: string;
  dateGranularity?: "check" | "hour" | "day" | "month";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(825);
  useEffect(() => {
    if (!wrapper.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(280, Math.round(entry.contentRect.width));
      setMeasuredWidth((current) => current === nextWidth ? current : nextWidth);
    });
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [points.length]);
  if (!points.length)
    return (
      <Empty
        title={emptyTitle}
        detail="This chart populates as measured data is received."
      />
    );
  const width = measuredWidth,
    height = 190,
    plotLeft = 48,
    plotRight = width - 8,
    plotTop = 14,
    plotBottom = height - 28,
    max = Math.max(1, ...points.map((x) => Number(x.value) || 0), ...previousPoints.map((x) => Number(x.value) || 0)),
    coords = points.map((point, i) => ({
      ...point,
      x: points.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + (i / (points.length - 1)) * (plotRight - plotLeft),
      y: plotBottom - ((Number(point.value) || 0) / max) * (plotBottom - plotTop),
    })),
    previousCoords = previousPoints.map((point, i) => ({
      ...point,
      x: previousPoints.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + (i / (previousPoints.length - 1)) * (plotRight - plotLeft),
      y: plotBottom - ((Number(point.value) || 0) / max) * (plotBottom - plotTop),
    })),
    polyline = coords.map((x) => `${x.x},${x.y}`).join(" "),
    previousPolyline = previousCoords.map((x) => `${x.x},${x.y}`).join(" "),
    ticks = [max, max * 2 / 3, max / 3, 0],
    xLabelIndexes = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  return (
    <div className="live-chart-wrap" ref={wrapper} onMouseLeave={() => setHover(null)}>
      <svg
        className="chart live-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label={label}
      >
        {ticks.map((tick, index) => {
          const y = plotTop + index * (plotBottom - plotTop) / 3;
          return <line key={index} className="chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />;
        })}
        <polygon
          className="series-fill"
          points={`${plotLeft},${plotBottom} ${polyline} ${plotRight},${plotBottom}`}
        />
        {previousPolyline && <polyline className="compare" points={previousPolyline} />}
        <polyline className="series" points={polyline} />
        {coords.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <rect
              className="chart-hit"
              x={Math.max(plotLeft, point.x - (plotRight - plotLeft) / Math.max(points.length, 2) / 2)}
              y="0"
              width={(plotRight - plotLeft) / Math.max(points.length, 2)}
              height={height}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              tabIndex={0}
              aria-label={`${point.label}: ${formatChartTooltip(point.value, unit)}`}
            />
            {hover === index && (
              <>
                <line className="chart-cursor" x1={point.x} x2={point.x} y1="12" y2={height - 12} />
                <circle className="chart-dot" cx={point.x} cy={point.y} r="4" />
              </>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-y-axis" aria-hidden="true">
        {ticks.map((tick, index) => <span key={index} style={{ top: `${(index / 3) * 100}%` }}>{formatChartAxis(tick, unit)}</span>)}
      </div>
      <div className="chart-x-axis" aria-hidden="true">
        {xLabelIndexes.map((index, position) => coords[index] && (
          <span
            key={index}
            style={{
              left: `${(coords[index].x / width) * 100}%`,
              transform: position === 0
                ? "none"
                : position === xLabelIndexes.length - 1
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
            }}
          >
            {chartDateLabel(coords[index].label, timeZone, dateGranularity)}
          </span>
        ))}
      </div>
      {hover != null && (
        <div
          className="chart-tooltip"
          style={{ left: `${Math.min(86, Math.max(4, (coords[hover].x / width) * 100))}%` }}
        >
          <b>{chartDateLabel(coords[hover].label, timeZone, dateGranularity)}</b>
          <small>{formatChartTooltip(coords[hover].value, unit)}</small>
          {previousCoords[hover] && <small>Previous: {formatChartTooltip(previousCoords[hover].value, unit)}</small>}
        </div>
      )}
    </div>
  );
}

type VisitTimeCell = {
  weekday: number;
  hour: number;
  visitors: number | null;
  visitorsComplete: boolean;
  pageCount: number;
};

function VisitTimeHeatmap({ cells, timeZone }: { cells: VisitTimeCell[]; timeZone: string }) {
  const [tooltip, setTooltip] = useState<{ cell: VisitTimeCell; x: number; y: number } | null>(null);
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const cellMap = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const maxPageCount = Math.max(0, ...cells.map((cell) => cell.pageCount));
  const activate = (cell: VisitTimeCell, target: HTMLElement) => {
    const bounds = target.getBoundingClientRect();
    const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
    setTooltip({
      cell,
      x: Math.min(viewportWidth - 130, Math.max(130, bounds.left + bounds.width / 2)),
      y: Math.max(100, bounds.top - 8),
    });
  };
  const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const heatStyle = (pageCount: number) => {
    const density = maxPageCount ? pageCount / maxPageCount : 0;
    return { backgroundColor: density ? `rgba(0, 169, 110, ${0.16 + density * 0.74})` : "#fff" };
  };
  const selected = tooltip?.cell;
  const visitorValue = selected?.visitors == null
    ? "Unavailable"
    : selected.visitorsComplete
      ? fmt(selected.visitors)
      : `At least ${fmt(selected.visitors)}`;
  return (
    <div className="visit-time-heatmap-wrap" onMouseLeave={() => setTooltip(null)}>
      <p className="subtle">Visitor activity in {timeZone}. Darker squares indicate busier periods.</p>
      <div className="visit-time-heatmap-scroll">
        <div className="visit-time-heatmap" role="grid" aria-label={`Visitor activity by weekday and hour in ${timeZone}`}>
          <span className="visit-time-corner" aria-hidden="true" />
          {Array.from({ length: 24 }, (_, hour) => <span className="visit-time-hour" role="columnheader" key={hour}>{hourLabel(hour)}</span>)}
          {weekdays.flatMap((weekday, weekdayIndex) => {
            const row: ReactNode[] = [<span className="visit-time-day" role="rowheader" key={`${weekday}-label`}>{weekday}</span>];
            for (let hour = 0; hour < 24; hour += 1) {
              const cell = cellMap.get(`${weekdayIndex}:${hour}`) || { weekday: weekdayIndex, hour, visitors: 0, visitorsComplete: true, pageCount: 0 };
              row.push(
                <button
                  type="button"
                  className="visit-time-cell"
                  style={heatStyle(cell.pageCount)}
                  aria-label={`${weekday}, ${hourLabel(hour)}: ${cell.pageCount} pageviews`}
                  aria-expanded={tooltip?.cell.weekday === weekdayIndex && tooltip?.cell.hour === hour}
                  onMouseEnter={(event) => activate(cell, event.currentTarget)}
                  onFocus={(event) => activate(cell, event.currentTarget)}
                  onClick={(event) => {
                    if (tooltip?.cell.weekday === weekdayIndex && tooltip?.cell.hour === hour) setTooltip(null);
                    else activate(cell, event.currentTarget);
                  }}
                  key={`${weekday}-${hour}`}
                />,
              );
            }
            return row;
          })}
        </div>
      </div>
      {selected && tooltip && (
        <div className="chart-tooltip visit-time-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <b>{weekdays[selected.weekday]} · {hourLabel(selected.hour)} – {hourLabel((selected.hour + 1) % 24)}</b>
          <small>Visitor count: {visitorValue}</small>
          <small>Page count: {fmt(selected.pageCount)}</small>
        </div>
      )}
    </div>
  );
}

function DailyUptimeStrip({ days, timeZone }: { days: any[]; timeZone: string }) {
  const [active, setActive] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const values = days.length === 30
    ? days
    : Array.from({ length: 30 }, (_, index) => ({ day: String(index + 1), status: "missing", total: 0, successful: 0, incidents: [] }));
  useEffect(() => {
    if (active == null) return;
    const dismiss = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setActive(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [active]);
  const selected = active == null ? null : values[active];
  return (
    <div className="daily-uptime-wrap" ref={wrapper} onMouseLeave={() => setActive(null)}>
      <div className="checkstrip" role="list" aria-label="Daily uptime for the last 30 calendar days">
        {values.map((day: any, index: number) => (
          <button
            key={`${day.day}-${index}`}
            type="button"
            className={day.status || "missing"}
            aria-label={`${day.day}: ${dailyStatusLabel(day)}`}
            aria-expanded={active === index}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => setActive((current) => current === index ? null : index)}
          />
        ))}
      </div>
      {selected && (
        <div
          className="daily-uptime-tooltip"
          role="tooltip"
          style={{ "--tooltip-x": `${((active! + 0.5) / values.length) * 100}%` } as CSSProperties}
        >
          <b>{formatDailyDate(selected.day, timeZone)}</b>
          {selected.status === "available" && <span>Available · {selected.statusCode ? `HTTP ${selected.statusCode}` : "Successful response"}</span>}
          {selected.status === "partial" && <span>Partially monitored · {selected.successful}/{selected.total} successful observations</span>}
          {selected.status === "missing" && <span>No monitoring evidence</span>}
          {selected.status === "suppressed" && <span>Checks suppressed by maintenance</span>}
          {selected.status === "incident" && !selected.incidents?.length && <span>Confirmed downtime recorded</span>}
          {selected.total > 0 && selected.status !== "partial" && <small>{selected.successful}/{selected.total} observed checks available</small>}
          {(selected.incidents || []).map((incident: any) => (
            <span className="daily-incident-detail" key={incident.id}>
              <b>{incident.cause || "Monitor incident"}</b>
              <span>{formatUptimeTimestamp(incident.opened_at, timeZone)}</span>
              <span>
                {formatDuration((incident.resolved_at ? Date.parse(incident.resolved_at) : Date.now()) - Date.parse(incident.opened_at))}
                {incident.resolved_at ? " · Resolved" : " · Ongoing"}
              </span>
              {incident.resolved_at && <span>Recovered {formatUptimeTimestamp(incident.resolved_at, timeZone)}</span>}
              {deliveryEvidence(incident, "uptime_down")}
              {deliveryEvidence(incident, "uptime_recovered")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function dailyStatusLabel(day: any) {
  if (day.status === "incident") return "confirmed downtime";
  if (day.status === "available") return `available${day.statusCode ? `, HTTP ${day.statusCode}` : ""}`;
  if (day.status === "partial") return "partial monitoring coverage";
  if (day.status === "suppressed") return "monitoring suppressed for maintenance";
  return "no monitoring evidence";
}

function deliveryEvidence(incident: any, kind: string) {
  const deliveries = (incident.deliveries || []).filter((delivery: any) => delivery.kind === kind);
  if (!deliveries.length) return null;
  const label = kind === "uptime_down" ? "Downtime" : "Recovery";
  const submitted = deliveries.filter((delivery: any) => delivery.status === "sent").length;
  const failed = deliveries.filter((delivery: any) => delivery.status === "failed").length;
  return <small>{label} notification: {submitted ? `${submitted} submitted to email provider` : "not submitted"}{failed ? ` · ${failed} failed` : ""}</small>;
}

function formatDailyDate(value: string, timeZone: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(date);
}

function formatUptimeTimestamp(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <Globe2 />
      <b>{title}</b>
      <small>{detail}</small>
    </div>
  );
}
function EmptyCompact({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-compact">
      <b>{title}</b>
      <small>{detail}</small>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  const titleId = useId();
  closeRef.current = close;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const animationFrame = window.requestAnimationFrame(() => {
      const preferred = dialog?.querySelector<HTMLElement>("[autofocus]");
      const first = preferred || dialog?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="panel-head">
          <h2 id={titleId}>{title}</h2>
          <span className="spacer" />
          <button
            className="iconbtn"
            onClick={close}
            aria-label="Close dialog"
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function IncidentTable({ incidents, compact = false, propertyUrl }: { incidents: any[]; compact?: boolean; propertyUrl?: string }) {
  const content = incidents.length ? (
    <DataTable
      headers={compact ? ["Date & time", "Type", "Duration", "Status"] : ["Property", "Opened", "Cause", "Duration", "Status"]}
      rows={incidents.map((incident) => {
        const values = [
          fmtDate(incident.opened_at),
          incident.cause || "Check failed",
          incident.resolved_at
            ? formatDuration(new Date(incident.resolved_at).valueOf() - new Date(incident.opened_at).valueOf())
            : formatDuration(Date.now() - new Date(incident.opened_at).valueOf()),
          incident.resolved_at ? "Resolved" : "Open",
        ];
        return compact ? values : [incident.property_url || propertyUrl || incident.property || "Property unavailable", ...values];
      })}
    />
  ) : (
    <EmptyCompact
      title="No incidents recorded"
      detail="Confirmed failures and recoveries appear here."
    />
  );
  return compact ? content : <Panel title="Incident history">{content}</Panel>;
}
function AlertPanel({
  session,
  property,
  fixture,
  notify,
}: {
  session: Session | null;
  property: Property;
  fixture: boolean;
  notify: Notify;
}) {
  const [email, setEmail] = useState(""),
    [saving, setSaving] = useState(false),
    [testOpen, setTestOpen] = useState(false),
    [testEmail, setTestEmail] = useState(""),
    [testing, setTesting] = useState(false),
    [testState, setTestState] = useState("");
  const [recipients, setRecipients] = useState<any[]>(
    fixture ? [{ email: "alerts@websi.co.uk", enabled: true }] : [],
  );
  const loadRecipients = () => session
    ? api<any[]>(session, `/api/properties/${property.id}/alert-recipients`).then(setRecipients)
    : Promise.resolve();
  useEffect(() => {
    void loadRecipients().catch(() => setRecipients([]));
  }, [session, property.id]);
  async function addRecipient() {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      notify("Enter a valid email address");
      return;
    }
    setSaving(true);
    try {
      session
        ? await api<any>(
            session,
            `/api/properties/${property.id}/alert-recipients`,
            { method: "POST", body: JSON.stringify({ email: normalized }) },
          )
        : { email: normalized, enabled: true };
      await loadRecipients();
      setEmail("");
      notify("Alert recipient saved");
    } catch (error: any) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  async function toggleRecipient(recipient: any) {
    if (!session || !recipient.id) return;
    try {
      await api(session, `/api/properties/${property.id}/alert-recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !recipient.enabled }),
      });
      await loadRecipients();
      notify(`Alert recipient ${recipient.enabled ? "disabled" : "enabled"}`);
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function removeRecipient(recipient: any) {
    try {
      if (!session || !recipient.id) throw new Error("This recipient cannot be removed here");
      await api(session, `/api/properties/${property.id}/alert-recipients/${recipient.id}`, {
        method: "DELETE",
      });
      setRecipients((current) => current.filter((item) => item.id !== recipient.id));
      notify("Alert recipient removed");
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function sendTestAlert() {
    const normalized = testEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setTestState("Enter a valid email address.");
      return;
    }
    if (!session) return;
    setTesting(true);
    setTestState("Submitting to the email provider…");
    try {
      const result = await api<{ submitted: boolean; delivered: boolean; providerId?: string }>(
        session,
        `/api/properties/${property.id}/test-alert`,
        { method: "POST", body: JSON.stringify({ email: normalized }) },
      );
      setTestState(result.submitted
        ? "Submitted to the email provider. Delivery is not confirmed until provider delivery evidence is available."
        : "The provider did not accept this test alert.");
    } catch (error: any) {
      setTestState(error.message || "The test alert could not be sent.");
    } finally {
      setTesting(false);
    }
  }
  return (
    <>
    <div className="grid equal">
      <Panel title="Recipients">
        <DataTable
          headers={["Email", "Down", "Recovery", ""]}
          rows={recipients.map((recipient) => [
            recipient.email,
            recipient.enabled ? "On" : "Off",
            recipient.enabled ? "On" : "Off",
            <span className="row-actions">
              <button className="btn" onClick={() => void toggleRecipient(recipient)}>
                {recipient.enabled ? "Disable" : "Enable"}
              </button>
              <button className="btn" onClick={() => void removeRecipient(recipient)}>Remove</button>
            </span>,
          ])}
        />
        <div className="inline-form">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alerts@example.com"
          />
          <button className="btn" onClick={addRecipient} disabled={!email || saving}>
            <Plus />
            {saving ? "Saving…" : "Add recipient"}
          </button>
        </div>
      </Panel>
      <Panel title="Alert policy">
        <KeyValues
          rows={[
            ["Confirmation threshold", "2 failed checks"],
            ["Recovery alerts", "Enabled"],
            ["Deduplication", "One alert per incident"],
            ["Email delivery", "Resend"],
          ]}
        />
        <button
          className="btn test-alert-button"
          onClick={() => { setTestOpen(true); setTestState(""); setTestEmail(""); }}
        >
          Send test alert
        </button>
      </Panel>
    </div>
    {testOpen && (
      <Modal title="Send test alert" close={() => !testing && setTestOpen(false)}>
        <p className="subtle">Send a sample uptime incident alert for <b>{property.name}</b>. This will not create an incident, change uptime statistics or save the address as a recipient.</p>
        <label className="field">
          Email address
          <input
            type="email"
            autoFocus
            value={testEmail}
            onChange={(event) => { setTestEmail(event.target.value); setTestState(""); }}
            placeholder="you@example.com"
          />
        </label>
        {testState && <p className={testState.startsWith("Submitted") ? "success-note" : "error-note"}>{testState}</p>}
        <div className="dialog-actions">
          <button className="btn" disabled={testing} onClick={() => setTestOpen(false)}>Cancel</button>
          <button className="primary" disabled={testing || !testEmail.trim() || !session} onClick={() => void sendTestAlert()}>
            {testing ? "Sending…" : "Send test alert"}
          </button>
        </div>
      </Modal>
    )}
    </>
  );
}
function MonitorPanel({
  session,
  monitor,
  reload,
  notify,
}: {
  session: Session | null;
  monitor?: Monitor;
  reload: () => void;
  notify: Notify;
}) {
  const [interval, setInterval] = useState(monitor?.interval_minutes || 10),
    [threshold, setThreshold] = useState(monitor?.failure_threshold || 2);
  async function save(enabled = monitor?.enabled !== false) {
    if (!monitor) return;
    try {
      if (session)
        await api(session, `/api/monitors/${monitor.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            enabled,
            interval_minutes: interval,
            timeout_ms: monitor.timeout_ms || 10000,
            expected_status_min: monitor.expected_status_min || 200,
            expected_status_max: monitor.expected_status_max || 399,
            failure_threshold: threshold,
          }),
        });
      notify("Monitor settings saved");
      reload();
    } catch (e: any) {
      notify(e.message);
    }
  }
  return (
    <Panel title="Monitor settings">
      <KeyValues rows={[["Status", <StatusPill tone={monitor?.enabled === false ? "neutral" : monitor?.last_status === "offline" ? "danger" : "success"}>{monitor?.enabled === false ? "Paused" : monitor ? "Monitoring" : "Not monitoring"}</StatusPill>]]} />
      <div className="form-two">
        <label className="field">
          Check interval
          <select
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          >
            {[5, 10, 15, 30, 60].map((x) => (
              <option key={x} value={x}>
                {x} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Confirm after
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((x) => (
              <option key={x} value={x}>Confirm after {x} downtime {x === 1 ? "event" : "events"}</option>
            ))}
          </select>
        </label>
      </div>
      <KeyValues
        rows={[
          ["Timeout", `${(monitor?.timeout_ms || 10000) / 1000} seconds`],
          ["Method", "GET"],
          [
            "Expected response",
            `HTTP ${monitor?.expected_status_min || 200}–${monitor?.expected_status_max || 399}`,
          ],
          ["Execution", "Distributed queue worker"],
        ]}
      />
      <div className="settings-actions">
        <button className="primary" onClick={() => save(true)}>
          Save settings
        </button>
        <button
          className="btn danger"
          onClick={() => save(monitor?.enabled === false)}
        >
          {monitor?.enabled === false ? (
            <>
              <Activity />
              Resume monitoring
            </>
          ) : (
            <>
              <Pause />
              Pause monitoring
            </>
          )}
        </button>
      </div>
    </Panel>
  );
}
function AnalyticsPageFilterToolbar({
  filters,
  options,
  onChange,
  title = "Pages",
  categories = ["Exact path / prefix", "Device", "Source", "Country"],
}: {
  filters: AnalyticsPageFilters;
  options: AnalyticsFilterOptions;
  onChange: (filters: AnalyticsPageFilters) => void;
  title?: string;
  categories?: string[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [pageDraft, setPageDraft] = useState(filters.pageSearch || "");
  const [pathDraft, setPathDraft] = useState(filters.pathValue || "");
  const [pathMode, setPathMode] = useState<"exact" | "prefix">(
    filters.pathMode || "exact",
  );
  useEffect(() => {
    setPageDraft(filters.pageSearch || "");
    setPathDraft(filters.pathValue || "");
    setPathMode(filters.pathMode || "exact");
  }, [filters.pageSearch, filters.pathMode, filters.pathValue]);
  useEffect(() => {
    if (category && !categories.includes(category)) setCategory(null);
  }, [categories.join("|"), category]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const categoryKey = category ? analyticsFilterKey(category) : null;
  const categoryOptions = category ? analyticsFilterValues(category, options) : [];
  const visibleOptions = categoryOptions.filter((value) =>
    `${value} ${category === "Country" ? countryLabel(value) : ""}`
      .toLocaleLowerCase()
      .includes(menuSearch.toLocaleLowerCase()),
  );
  const applyText = (kind: "page" | "path") => {
    if (kind === "page") {
      const value = pageDraft.trim();
      onChange({ ...filters, pageSearch: value || undefined });
    } else {
      const value = normalisePagePath(pathDraft);
      onChange({
        ...filters,
        pathMode: value ? pathMode : undefined,
        pathValue: value || undefined,
      });
    }
    setOpen(false);
  };
  const chips: { key: keyof AnalyticsPageFilters; label: string }[] = [];
  if (filters.pageSearch) chips.push({ key: "pageSearch", label: `Page contains: ${filters.pageSearch}` });
  if (filters.pathValue)
    chips.push({
      key: "pathValue",
      label: `${filters.pathMode === "prefix" ? "Path prefix" : "Exact path"}: ${filters.pathValue}`,
    });
  if (filters.device) chips.push({ key: "device", label: `Device: ${cap(filters.device)}` });
  if (filters.source) chips.push({ key: "source", label: `Source: ${filters.source}` });
  if (filters.country)
    chips.push({ key: "country", label: `Country: ${countryLabel(filters.country)}` });
  if (filters.browser) chips.push({ key: "browser", label: `Browser: ${filters.browser}` });
  if (filters.eventName) chips.push({ key: "eventName", label: `Event: ${eventLabel(filters.eventName)}` });
  if (filters.metric) chips.push({ key: "metric", label: `Metric: ${filters.metric}` });
  if (filters.sourceType) chips.push({ key: "sourceType", label: `Source type: ${filters.sourceType}` });
  if (filters.utmSource) chips.push({ key: "utmSource", label: `UTM source: ${filters.utmSource}` });
  if (filters.utmMedium) chips.push({ key: "utmMedium", label: `UTM medium: ${filters.utmMedium}` });
  if (filters.utmCampaign) chips.push({ key: "utmCampaign", label: `UTM campaign: ${filters.utmCampaign}` });
  const remove = (key: keyof AnalyticsPageFilters) => {
    const next = { ...filters };
    delete next[key];
    if (key === "pathValue") delete next.pathMode;
    onChange(next);
  };
  const selectedValue = categoryKey ? filters[categoryKey] : undefined;
  const setDimensionValue = (value: string) => {
    if (!categoryKey) return;
    const next = { ...filters, [categoryKey]: selectedValue === value ? undefined : value };
    if (categoryKey === "pathValue") next.pathMode = selectedValue === value ? undefined : "exact";
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="toolbar section-filters analytics-filter-row">
      <div className="analytics-filter-wrap" ref={menuRef}>
        <button
          className="btn"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => {
            if (!value) {
              setCategory(null);
              setMenuSearch("");
            }
            return !value;
          })}
        >
          <Filter /> Add filter
        </button>
        {open && (
          <div className="action-menu analytics-filter-menu" role="menu">
            <b className="analytics-filter-title">Filter {title}</b>
            <label className="analytics-menu-search">
              <Search />
              <input
                aria-label={title === "Pages" ? "Search pages" : "Search filter values"}
                value={title === "Pages" ? pageDraft : menuSearch}
                placeholder={title === "Pages" ? "Search pages…" : "Search values…"}
                onChange={(event) => title === "Pages" ? setPageDraft(event.target.value) : setMenuSearch(event.target.value)}
                onKeyDown={(event) => title === "Pages" && event.key === "Enter" && applyText("page")}
              />
            </label>
            {title === "Pages" && pageDraft !== (filters.pageSearch || "") && <button className="filter-search-apply" onClick={() => applyText("page")}>Apply page search</button>}
            <div className={`two-col-menu ${category ? "has-selection" : ""}`}>
              <div className="menu-col" aria-label="Filter categories">
                {categories.map((value) => (
                  <button
                    className={category === value ? "selected" : ""}
                    onClick={() => setCategory(value)}
                    key={value}
                  >
                    {value}<span className="spacer" /><ChevronRight />
                  </button>
                ))}
              </div>
              {category && <div className="menu-col analytics-filter-choices">
                <button className="analytics-filter-back" onClick={() => setCategory(null)}><ChevronLeft /> Filter categories</button>
                <b>{category}</b>
                {category !== "Exact path / prefix" && <label className="analytics-menu-search analytics-choice-search"><Search /><input aria-label={`Search ${category} values`} value={menuSearch} placeholder="Search values…" onChange={(event) => setMenuSearch(event.target.value)} /></label>}
                {category === "Exact path / prefix" ? (
                  <>
                    <span className="seg analytics-path-mode">
                      <button className={pathMode === "exact" ? "active" : ""} onClick={() => setPathMode("exact")}>Exact</button>
                      <button className={pathMode === "prefix" ? "active" : ""} onClick={() => setPathMode("prefix")}>Prefix</button>
                    </span>
                    <input
                      aria-label="Path value"
                      value={pathDraft}
                      placeholder="/services/"
                      list="analytics-path-options"
                      onChange={(event) => setPathDraft(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && applyText("path")}
                    />
                    <datalist id="analytics-path-options">
                      {options.paths.map((path) => <option value={path} key={path} />)}
                    </datalist>
                    <button className="filter-apply" onClick={() => applyText("path")}>Apply path filter</button>
                  </>
                ) : visibleOptions.length ? (
                  visibleOptions.map((value) => (
                    <button onClick={() => setDimensionValue(value)} key={value}>
                      {analyticsFilterValueLabel(category, value)}
                      {selectedValue === value && <><span className="spacer" /><Check /></>}
                    </button>
                  ))
                ) : (
                  <small className="subtle analytics-no-values">No collected values for this period.</small>
                )}
              </div>}
            </div>
            {hasAnalyticsPageFilters(filters) && (
              <>
                <div className="menu-divider" />
                <button onClick={() => { onChange({}); setOpen(false); }}>Clear all filters</button>
              </>
            )}
          </div>
        )}
      </div>
      {chips.map((chip) => (
        <span className="filter-chip" key={chip.key}>
          {chip.label}
          <button aria-label={`Remove ${chip.label} filter`} onClick={() => remove(chip.key)}>
            <X />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button className="text-link" onClick={() => onChange({})}>Clear all</button>
      )}
    </div>
  );
}

function AnalyticsTable({
  pages,
  property,
  groupedLimit,
  eventHeader = "Events",
  showActiveTime = false,
  onDetail,
}: {
  pages: any[];
  property: Property;
  groupedLimit?: number;
  eventHeader?: string;
  showActiveTime?: boolean;
  onDetail?: (page: string) => void;
}) {
  const [groupOpen, setGroupOpen] = useState(false);
  const groupedPages = groupedLimit == null ? [] : pages.slice(groupedLimit);
  const visiblePages = groupedLimit == null ? pages : pages.slice(0, groupedLimit);
  const rows = groupedPages.length
    ? [
        ...visiblePages,
        {
          page: "Other grouped pages",
          views: groupedPages.reduce((sum, page) => sum + page.views, 0),
          events: groupedPages.reduce((sum, page) => sum + page.events, 0),
          grouped: true,
        },
      ]
    : visiblePages;
  const max = Math.max(1, ...rows.map((page) => page.views));
  const headers = showActiveTime ? ["Page", "Pageviews", eventHeader, "Avg. active time"] : ["Page", "Pageviews", eventHeader];
  const sorted = useSortableRows(rows, (row, column) => {
    if (column === 0) return row.page;
    if (column === 1) return row.views;
    if (column === 2) return row.events;
    return Number(row.activeTime ?? -1);
  });
  return (
    <>
      <div className="table-wrap">
        <table className={`bar-table analytics-pages-table${showActiveTime ? " has-active-time" : ""}`}>
          <thead>
            <tr>{headers.map((label, column) => <SortableHeader key={label} label={label} column={column} sort={sorted.sort} onSort={sorted.onSort} />)}</tr>
          </thead>
          <tbody>
            {sorted.rows.map((page) => (
              <tr key={page.page}>
                <InCellBar value={page.views} max={max}>
                  {page.grouped ? (
                    <button className="table-detail-link" onClick={() => setGroupOpen(true)}>
                      Other grouped pages
                    </button>
                  ) : (
                    <span className="page-link-cell">
                      {onDetail ? (
                        <button className="table-detail-link" onClick={() => onDetail(page.page)}>{page.page}</button>
                      ) : <b>{page.page}</b>}
                      <a
                        className="page-open-link"
                        href={new URL(page.page, property.url).href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${page.page} on ${property.canonical_host}`}
                        title="Open live page"
                      >
                        <ExternalLink />
                      </a>
                    </span>
                  )}
                </InCellBar>
                <td>{fmt(page.views)}</td>
                <td>{fmt(page.events)}</td>
                {showActiveTime && <td>{page.activeTime == null ? "Unavailable" : pageActiveTimeLabel(Number(page.activeTime))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groupOpen && (
        <Modal title="Other grouped pages" close={() => setGroupOpen(false)}>
          <p>Lower-volume pages are grouped here instead of being replaced with a fictional row.</p>
          <DataTable
            headers={showActiveTime ? ["Page", "Pageviews", "Events", "Avg. active time"] : ["Page", "Pageviews", "Events"]}
            rows={groupedPages.map((page) => [page.page, fmt(page.views), fmt(page.events), ...(showActiveTime ? [page.activeTime == null ? "Unavailable" : pageActiveTimeLabel(Number(page.activeTime))] : [])])}
          />
          <div className="dialog-actions">
            <button className="btn" onClick={() => setGroupOpen(false)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
function AnalyticsSourceTable({ sources, onDetail }: { sources: any[]; onDetail?: (source: string) => void }) {
  const sorted = useSortableRows(sources, (source, column) => column === 0 ? source.name : column === 1 ? Number(source.pageviews || source.count || 0) : Number(source.events || 0));
  if (!sources.length)
    return <Empty title="No measured sources" detail="Source categories appear after pageviews are received." />;
  const max = Math.max(1, ...sources.map((source) => Number(source.pageviews || source.count || 0)));
  return (
    <div className="table-wrap">
      <table className="bar-table analytics-three-column-table">
        <thead><tr>{["Source / referrer", "Pageviews", "Events"].map((label, column) => <SortableHeader key={label} label={label} column={column} sort={sorted.sort} onSort={sorted.onSort} />)}</tr></thead>
        <tbody>
          {sorted.rows.map((source) => {
            const pageviews = Number(source.pageviews || source.count || 0);
            return (
              <tr key={source.name}>
                <InCellBar value={pageviews} max={max}>
                  <span className="dimension-label"><DimensionMark kind="source" value={source.name} />{onDetail ? <button className="table-detail-link" onClick={() => onDetail(source.name)}>{source.name}</button> : <b>{source.name}</b>}</span>
                </InCellBar>
                <td>{fmt(pageviews)}</td>
                <td>{fmt(Number(source.events || 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsPagination({ page, pageSize, total, pages, onPage, onPageSize, label = "pages" }: {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
}) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="pagination-row analytics-pagination" aria-label={`${label} table pagination`}>
      <span>{fmt(first)}–{fmt(last)} of {fmt(total)} {label}</span>
      <label>Rows<select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[20, 100, 200].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function ResultsPagination({ page, total, label, onPage }: {
  page: number;
  total: number;
  label: string;
  onPage: (page: number) => void;
}) {
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="pagination-row analytics-pagination" aria-label={`${label} pagination`}>
      <span>{fmt(first)}–{fmt(last)} of {fmt(total)} {label}</span>
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function AnalyticsPageDetail({ data, page, property, onBack }: { data: any; page: string; property: Property; onBack: () => void }) {
  const pageRow = (data.pages || []).find((row: any) => row.path === normalisePagePath(page)) || data.pages?.[0];
  return (
    <>
      <div className="analytics-detail-heading">
        <button className="btn" onClick={onBack}><ChevronLeft /> All pages</button>
        <h2>{page}</h2>
        <a className="btn" href={new URL(page, property.url).href} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open live page</a>
      </div>
      <Metrics values={[
        ["Pageviews", fmt(pageRow?.pageviews || data.pageviews || 0), <MetricComparison current={pageRow?.pageviews ?? data.pageviews} previous={data.previous?.pageviews} />],
        ["Key events", fmt(pageRow?.events || data.keyEvents || 0), <MetricComparison current={pageRow?.events ?? data.keyEvents} previous={data.previous?.keyEvents} />],
        ["Engaged pageviews", data.engagement?.engagedPageviews == null ? "Unavailable" : fmt(data.engagement.engagedPageviews), <MetricComparison current={data.engagement?.engagedPageviews} previous={data.previous?.engagement?.engagedPageviews} direction="higher" />],
        ["Average active page time", data.engagement?.averageActiveSeconds == null ? "Unavailable" : durationLabel(data.engagement.averageActiveSeconds), <MetricComparison current={data.engagement?.averageActiveSeconds} previous={data.previous?.engagement?.averageActiveSeconds} direction="higher" />],
      ]} />
      <Panel title="Page traffic"><SeriesChart points={(data.series || []).map((point: any) => ({ label: point.day, value: point.pageviews || 0 }))} previousPoints={(data.previous?.series || []).map((point: any) => ({ label: point.day, value: point.pageviews || 0 }))} emptyTitle="No pageviews for this page" label={`Pageviews for ${page}`} timeZone={data.timeZone || property.settings?.timezone} /></Panel>
      <div className="grid equal">
        <Panel title="Sources"><AnalyticsSourceTable sources={data.sources || []} /></Panel>
        <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Pageviews"]} rows={(data.devices || []).map((row: any) => ({ label: row.name, value: row.count, iconKind: "device", iconValue: row.name }))} /></Panel>
        <Panel title="Countries"><AnalyticsValueTable headers={["Country", "Pageviews"]} rows={(data.countries || []).map((row: any) => ({ label: countryLabel(row.name), value: row.count, iconKind: "country", iconValue: row.name }))} /></Panel>
        <Panel title="Key events"><AnalyticsValueTable headers={["Event", "Count"]} rows={(data.eventBreakdown || []).map((row: any) => ({ label: eventLabel(row.name), value: row.count }))} /></Panel>
      </div>
    </>
  );
}

function AnalyticsSourceDetail({ data, source, property, onBack }: { data: any; source: string; property: Property; onBack: () => void }) {
  const pages = (data.pages || []).map((row: any) => ({ page: row.path, views: row.pageviews || 0, events: row.events || 0 }));
  return (
    <>
      <div className="analytics-detail-heading"><button className="btn" onClick={onBack}><ChevronLeft /> All sources</button><DimensionMark kind="source" value={source} /><h2>{source}</h2></div>
      <Metrics values={[
        ["Pageviews", fmt(data.pageviews || 0), <MetricComparison current={data.pageviews} previous={data.previous?.pageviews} />],
        ["Key events", fmt(data.keyEvents || 0), <MetricComparison current={data.keyEvents} previous={data.previous?.keyEvents} />],
        [<MetricTerm term="Sessions" />, fmt(data.sessions || 0), <MetricComparison current={data.sessions} previous={data.previous?.sessions} />],
        [<MetricTerm term="Bounce rate" />, data.engagement?.bounceRate == null ? "Unavailable" : `${data.engagement.bounceRate.toFixed(1)}%`, <MetricComparison current={data.engagement?.bounceRate} previous={data.previous?.engagement?.bounceRate} direction="lower" />],
      ]} />
      <Panel title="Source traffic"><SeriesChart points={(data.series || []).map((point: any) => ({ label: point.day, value: point.pageviews || 0 }))} previousPoints={(data.previous?.series || []).map((point: any) => ({ label: point.day, value: point.pageviews || 0 }))} emptyTitle="No traffic for this source" label={`Pageviews from ${source}`} timeZone={data.timeZone || property.settings?.timezone} /></Panel>
      <div className="grid equal">
        <Panel title="Landing and visited pages"><AnalyticsTable pages={pages} property={property} /></Panel>
        <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Pageviews"]} rows={(data.devices || []).map((row: any) => ({ label: row.name, value: row.count, iconKind: "device", iconValue: row.name }))} /></Panel>
        <Panel title="Countries"><AnalyticsValueTable headers={["Country", "Pageviews"]} rows={(data.countries || []).map((row: any) => ({ label: countryLabel(row.name), value: row.count, iconKind: "country", iconValue: row.name }))} /></Panel>
      </div>
    </>
  );
}

function AnalyticsValueTable({
  headers,
  rows,
  className = "",
}: {
  headers: string[];
  rows: { label: ReactNode; value: number; secondary?: ReactNode; iconKind?: string; iconValue?: string; onClick?: () => void }[];
  className?: string;
}) {
  const sorted = useSortableRows(rows, (row, column) => column === 0 ? sortableValue(row.label) : column === 1 ? row.value : sortableValue(row.secondary));
  if (!rows.length)
    return <Empty title="No measured data" detail="This breakdown will populate after compatible events are received." />;
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return (
    <div className="table-wrap">
      <table className={`bar-table analytics-value-table ${headers.length === 3 ? "analytics-three-column-table" : ""} ${className}`.trim()}>
        <thead><tr>{headers.map((header, column) => <SortableHeader key={header} label={header} column={column} sort={sorted.sort} onSort={sorted.onSort} />)}</tr></thead>
        <tbody>
          {sorted.rows.map((row, index) => (
            <tr key={`${String(row.label)}-${index}`} className={row.onClick ? "clickable-table-row" : undefined} onClick={row.onClick}>
              <InCellBar value={row.value} max={max}>
                <span className="dimension-label">
                  {row.iconKind && <DimensionMark kind={row.iconKind} value={row.iconValue || String(row.label)} />}
                  {row.onClick
                    ? <button className="table-detail-link" onClick={(event) => { event.stopPropagation(); row.onClick?.(); }}>{row.label}</button>
                    : <b>{row.label}</b>}
                </span>
              </InCellBar>
              <td>{headers.length === 2 && row.secondary != null ? row.secondary : fmt(row.value)}</td>
              {headers.length === 3 && <td>{row.secondary}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountriesPanel({ rows, total, onOpen }: { rows: any[]; total: number; onOpen: () => void }) {
  const ordered = [...rows].sort((left, right) => Number(right.count || 0) - Number(left.count || 0));
  const top = ordered.slice(0, 10);
  return (
    <Panel title="Countries">
      <AnalyticsValueTable headers={["Country", "Visitors"]} rows={shareRows(top, total, "country")} />
      {ordered.length > 10 && <button className="btn countries-more" onClick={onOpen}>Other countries</button>}
    </Panel>
  );
}

function CountryListDetail({ rows, total, onBack }: { rows: any[]; total: number; onBack: () => void }) {
  const ordered = [...rows].sort((left, right) => Number(right.count || 0) - Number(left.count || 0));
  const max = Math.max(1, ...ordered.map((row) => Number(row.count || 0)));
  return (
    <>
      <div className="analytics-detail-heading"><button className="btn" onClick={onBack}><ChevronLeft /> Analytics overview</button><h2>All countries</h2></div>
      <Panel title="Visitors by country">
        <div className="country-bar-chart" role="img" aria-label="Visitor distribution by country">
          {ordered.map((row) => (
            <div className="country-bar-row" key={row.name}>
              <span><DimensionMark kind="country" value={row.name} /><CountryName code={row.name} /></span>
              <i style={{ width: `${Math.max(2, Number(row.count || 0) / max * 100)}%` }} />
              <b>{fmt(Number(row.count || 0))}</b>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Full country list"><AnalyticsValueTable headers={["Country", "Visitors"]} rows={shareRows(ordered, total, "country")} /></Panel>
    </>
  );
}

function InCellBar({
  value,
  max,
  children,
}: {
  value: number;
  max: number;
  children: ReactNode;
}) {
  const width = Math.max(4, (Math.max(0, Number(value) || 0) / Math.max(1, max)) * 92);
  return (
    <td className="bar-cell">
      <span className="bar-bg" aria-hidden="true" style={{ width: `${width}%` }} />
      {children}
    </td>
  );
}

function DimensionMark({ kind, value }: { kind: string; value: string }) {
  const clean = value.toLocaleLowerCase();
  if (kind === "device") {
    const Icon = clean.includes("mobile") ? Smartphone : clean.includes("tablet") ? Tablet : Monitor;
    return <span className="dimension-mark neutral"><Icon /></span>;
  }
  if (kind === "country") {
    const code = clean === "uk" ? "gb" : clean;
    return /^[a-z]{2}$/.test(code) ? <span className={`dimension-flag fi fi-${code}`} aria-hidden="true" /> : <span className="dimension-mark neutral"><Earth /></span>;
  }
  if (kind === "browser") {
    const logos: Record<string, string> = {
      chrome: chromeLogo,
      edge: edgeLogo,
      firefox: firefoxLogo,
      opera: operaLogo,
      safari: safariLogo,
      "samsung internet": samsungInternetLogo,
      "internet explorer": internetExplorerLogo,
    };
    return logos[clean]
      ? <span className="dimension-mark browser"><img src={logos[clean]} alt="" /></span>
      : <span className="dimension-mark neutral"><Globe2 /></span>;
  }
  const sourceIcon = sourceIconPath(clean);
  return <span className="dimension-mark source" aria-hidden="true"><img src={sourceIcon} alt="" /></span>;
}

function sourceIconPath(value: string) {
  const source = value.toLocaleLowerCase();
  if (/direct|unknown|other|unassigned|none/.test(source)) return "/assets/globe.svg";
  const matchers: [RegExp, string][] = [
    [/google(?!.*gemini)/, "google"], [/bing/, "bing"], [/yahoo/, "yahoo"], [/duckduckgo|duck duck go/, "duckduckgo"],
    [/ecosia/, "ecosia"], [/brave/, "brave"], [/baidu/, "baidu"], [/yandex/, "yandex"], [/facebook|fb\b/, "facebook"],
    [/instagram/, "instagram"], [/linkedin/, "linkedin"], [/youtube/, "youtube"], [/tiktok|tik tok/, "tiktok"],
    [/twitter|(^|\s)x($|\s)/, "x"], [/pinterest/, "pinterest"], [/reddit/, "reddit"], [/threads/, "threads"],
    [/snapchat/, "snapchat"], [/bluesky/, "bluesky"], [/quora/, "quora"], [/whatsapp/, "whatsapp"],
    [/telegram/, "telegram"], [/discord/, "discord"], [/chatgpt|openai/, "chatgpt"], [/perplexity/, "perplexity"],
    [/gemini/, "gemini"], [/copilot/, "copilot"], [/claude|anthropic/, "claude"], [/email|newsletter|mail/, "email"],
  ];
  const match = matchers.find(([pattern]) => pattern.test(source));
  return match ? `/assets/source-icons/${match[1]}.svg` : "/assets/globe.svg";
}

function AnalyticsEventDetail({
  session,
  property,
  fixture,
  eventName,
  livePeriod,
  filters,
  options,
  onFilterChange,
  onBack,
}: {
  session: Session | null;
  property: Property;
  fixture: boolean;
  eventName: string;
  livePeriod: string;
  filters: AnalyticsPageFilters;
  options: AnalyticsFilterOptions;
  onFilterChange: (filters: AnalyticsPageFilters) => void;
  onBack: () => void;
}) {
  const tabs = ["Overview", "Occurrences", "Pages", "Sources", "Devices", "Countries"];
  const [tab, setTab] = useState("Overview");
  const [summary, setSummary] = useState<any>(null);
  const [occurrences, setOccurrences] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [occurrencesLoading, setOccurrencesLoading] = useState(true);
  const [occurrencesError, setOccurrencesError] = useState("");
  const [occurrencePage, setOccurrencePage] = useState(1);
  const [occurrencePageSize, setOccurrencePageSize] = useState(20);
  const [selectedOccurrence, setSelectedOccurrence] = useState<string | null>(null);
  const [occurrenceDetail, setOccurrenceDetail] = useState<any>(null);
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const filterQuery = analyticsPageFilterQuery(filters);
  const encodedEventName = encodeURIComponent(eventName);

  useEffect(() => {
    setOccurrencePage(1);
    setSelectedOccurrence(null);
    setOccurrenceDetail(null);
  }, [eventName, filterQuery, property.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    if (fixture) {
      const next = analyticsEventDetailFixture(eventName);
      setSummary(next.summary);
      setLoading(false);
      return () => { cancelled = true; };
    }
    if (!session) {
      setError("Authentication is required to load this event.");
      setLoading(false);
      return () => { cancelled = true; };
    }
    const suffix = filterQuery ? `&${filterQuery}` : "";
    api<any>(session, `/api/properties/${property.id}/analytics/events/${encodedEventName}?${livePeriod}${suffix}`)
      .then((nextSummary) => !cancelled && setSummary(nextSummary))
      .catch((reason) => !cancelled && setError(reason.message || "Event detail could not be loaded"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [encodedEventName, eventName, filterQuery, fixture, livePeriod, property.id, session]);

  useEffect(() => {
    let cancelled = false;
    setOccurrencesLoading(true);
    setOccurrencesError("");
    if (fixture) {
      const next = analyticsEventDetailFixture(eventName);
      const start = (occurrencePage - 1) * occurrencePageSize;
      setOccurrences({
        ...next.occurrences,
        rows: next.occurrences.rows.slice(start, start + occurrencePageSize),
        page: occurrencePage,
        pageSize: occurrencePageSize,
      });
      setOccurrencesLoading(false);
      return () => { cancelled = true; };
    }
    if (!session) {
      setOccurrencesError("Authentication is required to load occurrences.");
      setOccurrencesLoading(false);
      return () => { cancelled = true; };
    }
    const suffix = filterQuery ? `&${filterQuery}` : "";
    api<any>(session, `/api/properties/${property.id}/analytics/events/${encodedEventName}/occurrences?${livePeriod}&page=${occurrencePage}&page_size=${occurrencePageSize}${suffix}`)
      .then((next) => !cancelled && setOccurrences(next))
      .catch((reason) => !cancelled && setOccurrencesError(reason.message || "Occurrences could not be loaded"))
      .finally(() => !cancelled && setOccurrencesLoading(false));
    return () => { cancelled = true; };
  }, [encodedEventName, eventName, filterQuery, fixture, livePeriod, occurrencePage, occurrencePageSize, property.id, session]);

  async function openOccurrence(row: any) {
    const id = String(row.id);
    if (selectedOccurrence === id) {
      setSelectedOccurrence(null);
      setOccurrenceDetail(null);
      return;
    }
    setSelectedOccurrence(id);
    setOccurrenceDetail(null);
    setOccurrenceLoading(true);
    try {
      const detail = fixture
        ? analyticsEventDetailFixture(eventName).contexts[id]
        : session
          ? await api<any>(session, `/api/properties/${property.id}/analytics/events/${encodedEventName}/occurrences/${encodeURIComponent(id)}`)
          : null;
      setOccurrenceDetail(detail || null);
    } catch (reason: any) {
      setOccurrenceDetail({ error: reason.message || "Occurrence context could not be loaded" });
    } finally {
      setOccurrenceLoading(false);
    }
  }

  if (loading && !summary)
    return <Empty title="Loading event detail…" detail="Preparing the event totals, breakdowns and recent occurrences." />;
  if (error)
    return <div className="analytics-state" role="alert"><Empty title="Event detail could not be loaded" detail={error} /><button className="btn" onClick={onBack}>Back to events</button></div>;

  const eventOptions: AnalyticsFilterOptions = {
    ...options,
    paths: summary?.filterOptions?.paths || options.paths,
    sources: summary?.filterOptions?.sources || options.sources,
    countries: summary?.filterOptions?.countries || options.countries,
    devices: summary?.filterOptions?.devices || options.devices,
    browsers: summary?.filterOptions?.browsers || options.browsers,
  };
  const breakdowns = summary?.breakdowns || {};
  const breakdownForTab: Record<string, { rows: any[]; label: string; kind?: string }> = {
    Pages: { rows: breakdowns.pages || [], label: "Page" },
    Sources: { rows: breakdowns.sources || [], label: "Source", kind: "source" },
    Devices: { rows: breakdowns.devices || [], label: "Device", kind: "device" },
    Countries: { rows: breakdowns.countries || [], label: "Country", kind: "country" },
  };
  const selectedBreakdown = breakdownForTab[tab];
  const displayBreakdownName = (row: any) => tab === "Countries" ? countryLabel(row.name) : row.name;

  return (
    <div className="analytics-event-detail">
      <div className="analytics-detail-heading">
        <button className="btn" onClick={onBack}><ChevronLeft /> All events</button>
        <h2>{eventLabel(eventName)}</h2>
      </div>
      <Metrics values={[
        ["Total events", fmt(summary?.totalCount || 0), "Selected date range"],
        ["Unique sessions", occurrences?.uniqueSessions == null ? "Unavailable" : fmt(occurrences.uniqueSessions), occurrences?.uniqueSessions == null ? "Unavailable outside raw-event retention" : "Anonymous tab sessions"],
        ["First recorded", summary?.firstRecorded ? formatAnalyticsMoment(summary.firstRecorded, summary.timeZone) : "—", "Within the selected date range"],
        ["Most recent", summary?.mostRecent ? formatAnalyticsMoment(summary.mostRecent, summary.timeZone) : "—", "Within the selected date range"],
      ]} />
      <AnalyticsPageFilterToolbar filters={filters} options={eventOptions} onChange={onFilterChange} title={eventLabel(eventName)} categories={["Page", "Source", "Country", "Device", "Browser"]} />
      <Tabs labels={tabs} value={tab} onChange={setTab} />

      {summary?.totalCount === 0 ? (
        <Empty title="No occurrences in this period" detail="Try a wider date range or remove one of the active filters." />
      ) : tab === "Overview" ? (
        <>
          <Panel title="Events over time">
            <SeriesChart points={(summary.series || []).map((point: any) => ({ label: point.day, value: point.count }))} emptyTitle="No event activity in this period" unit=" events" label={`${eventLabel(eventName)} occurrences by day`} timeZone={summary.timeZone || property.settings?.timezone} />
          </Panel>
          <div className="grid equal event-summary-grid">
            <EventSummaryPanel title="Top pages" columnLabel="Page" rows={breakdowns.pages} />
            <EventSummaryPanel title="Top sources" columnLabel="Source" rows={breakdowns.sources} kind="source" />
            <EventSummaryPanel title="Top countries" columnLabel="Country" rows={breakdowns.countries} kind="country" country />
            <EventSummaryPanel title="Top devices" columnLabel="Device" rows={breakdowns.devices} kind="device" capitalize />
            <EventSummaryPanel title="Top browsers" columnLabel="Browser" rows={breakdowns.browsers} kind="browser" />
          </div>
          {summary.aggregateCoverage !== "raw" && <p className="subtle">Totals and breakdowns include retained daily rollups. Individual occurrence detail is available only while raw events are retained.</p>}
        </>
      ) : tab === "Occurrences" ? (
        <Panel title={`Occurrences · ${fmt(occurrences?.total || 0)}`}>
          {occurrencesLoading ? <Empty title="Loading occurrences…" detail="Fetching this page of retained event activity." /> : occurrencesError ? (
            <div className="analytics-state" role="alert"><Empty title="Occurrences could not be loaded" detail={occurrencesError} /></div>
          ) : occurrences?.rows?.length ? (
            <>
              <div className="table-wrap">
                <table className="event-occurrences-table">
                  <thead><tr>{["Time", "Page", "Source", "Referrer", "Country", "Device", "Browser", "Active time"].map((header) => <th key={header}>{header}</th>)}</tr></thead>
                  <tbody>{occurrences.rows.map((row: any) => (
                    <Fragment key={row.id}>
                      <tr className="clickable-table-row" onClick={() => void openOccurrence(row)} aria-expanded={selectedOccurrence === String(row.id)}>
                        <td><button className="table-detail-link" onClick={(event) => { event.stopPropagation(); void openOccurrence(row); }}>{formatAnalyticsMoment(row.occurred_at, summary.timeZone)}</button></td>
                        <td>{row.path || "/"}</td>
                        <td>{row.source || "Direct / unknown"}</td>
                        <td>{row.referrer_host || "—"}</td>
                        <td>{row.country_code ? countryLabel(row.country_code) : "—"}</td>
                        <td>{cap(row.device || "Unknown")}</td>
                        <td>{row.browser || "—"}</td>
                        <td>{Number(row.active_seconds) > 0 ? durationLabel(Number(row.active_seconds)) : "—"}</td>
                      </tr>
                      {selectedOccurrence === String(row.id) && (
                        <tr className="event-occurrence-expanded"><td colSpan={8}>
                          {occurrenceLoading ? <span className="subtle">Loading occurrence context…</span> : <EventOccurrenceDetail detail={occurrenceDetail} timeZone={summary.timeZone} />}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
              <AnalyticsPagination
                page={occurrences.page}
                pageSize={occurrences.pageSize}
                total={occurrences.total}
                pages={occurrences.pages}
                label="occurrences"
                onPage={setOccurrencePage}
                onPageSize={(size) => { setOccurrencePageSize(size); setOccurrencePage(1); }}
              />
              <p className="subtle">Occurrence-level detail is retained for {occurrences.occurrenceRetentionDays || 120} days. Older totals remain available from daily rollups.</p>
            </>
          ) : <Empty title="No retained occurrences" detail="Totals may include older rollups, but there are no raw occurrences in the retained period for these filters." />}
        </Panel>
      ) : selectedBreakdown ? (
        <Panel title={`${tab} · ${fmt(selectedBreakdown.rows.reduce((total: number, row: any) => total + Number(row.count || 0), 0))} events`}>
          <AnalyticsValueTable
            headers={[selectedBreakdown.label, "Events"]}
            rows={selectedBreakdown.rows.map((row: any) => ({ label: displayBreakdownName(row), value: row.count, iconKind: selectedBreakdown.kind, iconValue: row.name }))}
          />
        </Panel>
      ) : null}
    </div>
  );
}

function EventSummaryPanel({ title, columnLabel, rows = [], kind, country = false, capitalize = false }: { title: string; columnLabel: string; rows?: any[]; kind?: string; country?: boolean; capitalize?: boolean }) {
  return (
    <Panel title={title}>
      <AnalyticsValueTable headers={[columnLabel, "Events"]} rows={rows.slice(0, 5).map((row: any) => ({
        label: country ? countryLabel(row.name) : capitalize ? cap(row.name) : row.name,
        value: row.count,
        iconKind: kind,
        iconValue: row.name,
      }))} />
    </Panel>
  );
}

function EventOccurrenceDetail({ detail, timeZone }: { detail: any; timeZone?: string }) {
  if (!detail) return <span className="subtle">No additional context was captured for this occurrence.</span>;
  if (detail.error) return <span className="error-note">{detail.error}</span>;
  const acquisition = detail.acquisition || {};
  const visitor = detail.visitor || {};
  const behaviour = detail.behaviour || {};
  const acquisitionRows = [
    ["Source", acquisition.source], ["Source detail", acquisition.sourceDetail], ["Referrer", acquisition.referrer],
    ["Landing page", acquisition.landingPage],
    ["UTM source", acquisition.utmSource], ["UTM medium", acquisition.utmMedium], ["UTM campaign", acquisition.utmCampaign],
    ["UTM content", acquisition.utmContent], ["UTM term", acquisition.utmTerm],
  ];
  const visitorRows = [
    ["Country", visitor.country ? countryLabel(visitor.country) : null], ["Device", visitor.device ? cap(visitor.device) : null],
    ["Browser", visitor.browser], ["Screen", visitor.screen], ["Language", visitor.language],
  ];
  return (
    <div className="event-occurrence-detail">
      <div className="event-context-grid">
        <EventContextList title="Occurrence" rows={[
          ["Event type", detail.eventType ? eventLabel(detail.eventType) : null],
          ["Page", detail.path],
          ["Occurred", detail.occurredAt ? formatAnalyticsMoment(detail.occurredAt, timeZone) : null],
          ["Received", detail.receivedAt ? formatAnalyticsMoment(detail.receivedAt, timeZone) : null],
        ]} />
        <EventContextList title="Acquisition" rows={acquisitionRows} />
        <EventContextList title="Visitor context" rows={visitorRows} />
        <EventContextList title="Behaviour" rows={[
          ["Active time", behaviour.activeSeconds ? durationLabel(behaviour.activeSeconds) : null],
          ["Maximum scroll", behaviour.maxScroll ? `${Math.round(behaviour.maxScroll)}%` : null],
          ["Visible sections", behaviour.visibleSections?.join(", ")],
          ["JavaScript errors", behaviour.javascriptErrors == null ? null : fmt(behaviour.javascriptErrors)],
        ]} />
      </div>
      {behaviour.journey?.length ? <section><h4>Session journey</h4><div className="event-journey">{behaviour.journey.map((step: any, index: number) => <Fragment key={`${step.type}-${step.label}-${index}`}><span className={`event-journey-step ${step.type}`}>{step.label}</span>{index < behaviour.journey.length - 1 && <ChevronRight aria-hidden="true" />}</Fragment>)}</div></section> : null}
      <div className="event-context-grid">
        <EventContextList title="Nearby activity" rows={[
          ["Previous", occurrenceActivityLabel(behaviour.previous, timeZone)],
          ["Next", occurrenceActivityLabel(behaviour.next, timeZone)],
          ["Related key events", behaviour.relatedKeyEvents?.length ? behaviour.relatedKeyEvents.map((row: any) => eventLabel(row.name || row.type)).join(", ") : null],
        ]} />
        <EventContextList title="Page performance" rows={(detail.webVitals || []).map((vital: any) => [vital.name, formatVital(vital.name, vital.value)])} empty="No per-view web vitals were captured." />
      </div>
      <p className="subtle">Anonymous session and page-view references are used only to assemble this short journey. Claritude does not collect IP addresses or create a persistent visitor identity.</p>
    </div>
  );
}

function EventContextList({ title, rows, empty = "No compatible context was captured." }: { title: string; rows: any[][]; empty?: string }) {
  const visible = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return <section><h4>{title}</h4>{visible.length ? <dl>{visible.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className="subtle">{empty}</p>}</section>;
}

function occurrenceActivityLabel(activity: any, timeZone?: string) {
  if (!activity) return null;
  const label = activity.type === "pageview" ? activity.path : eventLabel(activity.name || activity.type);
  return activity.occurredAt ? `${label} · ${formatAnalyticsMoment(activity.occurredAt, timeZone)}` : label;
}

function formatAnalyticsMoment(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timeZone || undefined }).format(new Date(value));
}

function analyticsEventDetailFixture(eventName: string) {
  const now = new Date();
  const earlier = new Date(now.valueOf() - 46 * 60_000);
  const day = now.toISOString().slice(0, 10);
  const rows = [
    { id: "fixture-2", occurred_at: now.toISOString(), path: "/contact/", source: "Google", source_detail: "google", referrer_host: "google.com", country_code: "GB", device: "desktop", browser: "Chrome", active_seconds: 31 },
    { id: "fixture-1", occurred_at: earlier.toISOString(), path: "/services/", source: "Direct / unknown", source_detail: "Direct / unknown", referrer_host: null, country_code: "GB", device: "mobile", browser: "Safari", active_seconds: 18 },
  ];
  const context = (row: any) => ({
    ...row, name: eventName, eventType: "click", occurredAt: row.occurred_at, receivedAt: new Date(Date.parse(row.occurred_at) + 250).toISOString(), acquisition: { source: row.source, sourceDetail: row.source_detail, referrer: row.referrer_host, landingPage: row.path, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null },
    visitor: { country: row.country_code, device: row.device, browser: row.browser, screen: row.device === "mobile" ? "Small · under 768px" : "Large · 1280px+", language: "en-GB" },
    behaviour: { activeSeconds: row.active_seconds, maxScroll: 90, visibleSections: ["contact"], javascriptErrors: 0, relatedKeyEvents: [], previous: { type: "pageview", path: row.path, occurredAt: new Date(Date.parse(row.occurred_at) - 10_000).toISOString() }, next: null, journey: [{ type: "source", label: row.source }, { type: "page", label: row.path }, { type: "behaviour", label: "Scrolled 90%" }, { type: "event", label: eventLabel(eventName) }] },
    webVitals: [{ name: "LCP", value: 1840 }],
  });
  return {
    summary: { name: eventName, totalCount: 2, uniqueSessions: 2, firstRecorded: earlier.toISOString(), mostRecent: now.toISOString(), timeZone: "Europe/London", series: [{ day, count: 2 }], aggregateCoverage: "raw", breakdowns: { pages: [{ name: "/contact/", count: 1 }, { name: "/services/", count: 1 }], sources: [{ name: "Google", count: 1 }, { name: "Direct / unknown", count: 1 }], countries: [{ name: "GB", count: 2 }], devices: [{ name: "desktop", count: 1 }, { name: "mobile", count: 1 }], browsers: [{ name: "Chrome", count: 1 }, { name: "Safari", count: 1 }] }, filterOptions: { paths: ["/contact/", "/services/"], sources: ["Google", "Direct / unknown"], countries: ["GB"], devices: ["desktop", "mobile"], browsers: ["Chrome", "Safari"] } },
    occurrences: { rows, page: 1, pageSize: 20, total: 2, pages: 1, uniqueSessions: 2, occurrenceRetentionDays: 120 },
    contexts: Object.fromEntries(rows.map((row) => [row.id, context(row)])),
  };
}

function EventsPanel({
  session,
  property,
  fixture,
  notify,
  data,
  filters,
  options,
  onFilterChange,
  onOpenEvent,
}: {
  session: Session | null;
  property: Property;
  fixture: boolean;
  notify: Notify;
  data?: any;
  filters?: AnalyticsPageFilters;
  options?: AnalyticsFilterOptions;
  onFilterChange?: (filters: AnalyticsPageFilters) => void;
  onOpenEvent?: (eventName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("download-brochure");
  const [eventType, setEventType] = useState<EventDefinition["event_type"]>("click");
  const [description, setDescription] = useState("");
  const [pathMode, setPathMode] = useState<"exact" | "prefix">("exact");
  const [pathValue, setPathValue] = useState("/");
  const [eventError, setEventError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [eventAllowance, setEventAllowance] = useState<CustomEventAllowance | null>(null);
  const [eventsState, setEventsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [eventsLoadError, setEventsLoadError] = useState("");
  const [eventsReloadToken, setEventsReloadToken] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [eventToDelete, setEventToDelete] = useState<EventDefinition | null>(null);
  const [eventDeleteConfirmation, setEventDeleteConfirmation] = useState("");
  useEffect(() => {
    if (fixture) {
      setEvents([
        {
          name: "successful-form-submission",
          event_type: "form_success",
          received: 124,
          enabled: true,
        },
        {
          name: "download-brochure",
          event_type: "click",
          received: 72,
          enabled: true,
        },
      ]);
      setEventAllowance({ plan: "Scale", used: 2, limit: 20, remaining: 18, unlimited: false, canCreate: true });
      setEventsLoadError("");
      setEventsState("ready");
      return;
    }
    if (!session) {
      setEvents([]);
      setEventAllowance(null);
      setEventsLoadError("Authentication is required to load configured events.");
      setEventsState("error");
      return;
    }
    let cancelled = false;
    setEvents([]);
    setEventAllowance(null);
    setEventsLoadError("");
    setEventsState("loading");
    api<EventDefinitionsResponse | EventDefinition[]>(session, `/api/properties/${property.id}/events`)
      .then((next) => {
        if (cancelled) return;
        if (Array.isArray(next)) {
          setEvents(next);
          setEventAllowance({ plan: "Pro", used: next.length, limit: null, remaining: null, unlimited: true, canCreate: true });
        } else {
          setEvents(next.events);
          setEventAllowance(next.allowance);
        }
        setEventsState("ready");
      })
      .catch((reason) => {
        if (cancelled) return;
        setEventsLoadError(reason instanceof Error ? reason.message : "Configured events could not be loaded");
        setEventsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [eventsReloadToken, fixture, property.id, session]);
  async function saveEvent() {
    try {
      const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      if (!normalizedName) throw new Error("Enter a stable event name");
      if (eventType === "pageview" && !normalisePagePath(pathValue))
        throw new Error("Enter a valid page path");
      const matchSettings = eventType === "pageview" ? { mode: pathMode, path: normalisePagePath(pathValue) } : undefined;
      const created: EventDefinition = session
        ? await api<EventDefinition>(session, `/api/properties/${property.id}/events`, {
            method: "POST",
            body: JSON.stringify({ name: normalizedName, eventType, description, matchSettings }),
          })
        : { name: normalizedName, event_type: eventType, description, match_settings: matchSettings, enabled: true };
      setEvents((current) => [...current, created]);
      setEventAllowance((current) => {
        if (!current) return current;
        const used = current.used + 1;
        return {
          ...current,
          used,
          remaining: current.limit == null ? null : Math.max(0, current.limit - used),
          canCreate: current.limit == null || used < current.limit,
        };
      });
      setEventsState("ready");
      setOpen(false);
      setEventError("");
      setInstruction(
        eventType === "click"
          ? `<button data-claritude-event="${normalizedName}">…</button>`
          : eventType === "pageview"
            ? `claritude.pageview({ path: "${normalisePagePath(pathValue)}" });`
            : `claritude.formSuccess("${normalizedName}", { page: location.pathname });`,
      );
      notify("Event configuration saved");
    } catch (error: any) {
      if (error.message === "custom_event_plan_limit_reached") {
        setEventAllowance((current) => current ? { ...current, canCreate: false, remaining: 0 } : current);
        setEventError("This property has reached its custom event allowance. Upgrade the plan to create another event.");
      } else {
        setEventError(error.message);
      }
    }
  }
  async function toggleEvent(event: EventDefinition) {
    try {
      if (!session || !event.id) throw new Error("This event cannot be changed here");
      const updated = await api<EventDefinition>(session, `/api/properties/${property.id}/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !event.enabled }),
      });
      setEvents((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      notify(updated.enabled ? "Event enabled" : "Event disabled");
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function deleteEvent() {
    if (!session || !eventToDelete?.id || eventDeleteConfirmation !== eventToDelete.name) return;
    try {
      const result = await api<any>(session, `/api/properties/${property.id}/events/${eventToDelete.id}`, { method: "DELETE" });
      setEvents((current) => current.filter((event) => event.id !== eventToDelete.id));
      setEventAllowance((current) => current ? {
        ...current,
        used: Math.max(0, current.used - 1),
        remaining: current.limit == null ? null : Math.max(0, current.limit - Math.max(0, current.used - 1)),
        canCreate: true,
      } : current);
      setEventToDelete(null);
      setEventDeleteConfirmation("");
      notify(`Event deleted with ${fmt(Number(result.deletedOccurrences || 0))} collected occurrences`);
    } catch (error: any) {
      notify(error.message);
    }
  }
  const eventBreakdown = data?.eventBreakdown || [];
  const eventPageCount = Math.max(1, Math.ceil(eventBreakdown.length / 20));
  const shownEventBreakdown = paginateResults(eventBreakdown, eventPage);
  const eventLimitReached = Boolean(eventAllowance && !eventAllowance.canCreate);
  const eventUsage = customEventUsageText(eventAllowance);
  useEffect(() => setEventPage(1), [eventBreakdown.length, property.id]);
  return (
    <>
      <Panel
        title={data ? `Events · ${fmt(data.keyEvents || 0)} total` : "Configured events"}
        actions={
          <>
            {data && <Link className="btn" to={`/settings?property=${property.id}&settingsTab=Events`}>Event setup instructions</Link>}
            <button
              className={data ? "primary" : "btn"}
              onClick={() => setOpen(true)}
              disabled={eventLimitReached || eventsState === "loading"}
              title={eventLimitReached ? "Upgrade the property plan to create another custom event" : undefined}
            >
              {!data && <Plus />}
              Create event
            </button>
          </>
        }
      >
        <div className={`event-allowance${eventLimitReached ? " limit-reached" : ""}`}>
          <span>{eventUsage}</span>
          {eventLimitReached && (
            <span>
              Your {eventAllowance?.plan} plan allowance has been reached.{" "}
              <Link to="/account">Review upgrade options</Link>
            </span>
          )}
        </div>
        {data && filters && options && onFilterChange ? (
          <>
            <AnalyticsPageFilterToolbar filters={filters} options={options} onChange={onFilterChange} title="Events" categories={analyticsFilterConfigs.Events.categories} />
            <AnalyticsValueTable
              headers={["Event", "Count", "Share"]}
              rows={shownEventBreakdown.map((event: any) => ({
                label: eventLabel(event.name),
                value: event.count,
                secondary: data.keyEvents ? `${(event.count / data.keyEvents * 100).toFixed(1)}%` : "0.0%",
                onClick: onOpenEvent ? () => onOpenEvent(event.name) : undefined,
              }))}
            />
            {eventBreakdown.length > 20 && <ResultsPagination page={eventPage} total={eventBreakdown.length} label="events" onPage={(page) => setEventPage(Math.min(eventPageCount, page))} />}
            <p className="subtle">Event share is the proportion of all recorded key events in the selected scope.</p>
          </>
        ) : (
          <>
            {eventsState === "loading" ? (
              <Empty title="Loading configured events…" detail="Checking the selected property." />
            ) : eventsState === "error" ? (
              <div className="analytics-state" role="alert">
                <Empty title="Configured events could not be loaded" detail={eventsLoadError} />
                <button className="btn" onClick={() => setEventsReloadToken((value) => value + 1)}>Retry</button>
              </div>
            ) : events.length ? (
              <DataTable
                headers={["Event", "Trigger", "Key event", "Received", "Status", ""]}
                rows={events.map((event) => [
                  event.name,
                  <span className="event-trigger"><EventTriggerIcon type={event.event_type} />{event.event_type === "form_success" ? "Confirmed success" : event.event_type === "pageview" ? "Page view" : "Element click"}</span>,
                  "Yes",
                  event.received ?? "—",
                  <StatusPill tone={event.enabled === false ? "neutral" : "success"}>{event.enabled === false ? "Paused" : "Active"}</StatusPill>,
                  <div className="row-actions"><button className="btn" onClick={() => void toggleEvent(event)}>{event.enabled ? "Disable" : "Enable"}</button><button className="iconbtn danger-icon" aria-label={`Delete ${event.name}`} onClick={() => setEventToDelete(event)}><Trash2 /></button></div>,
                ])}
              />
            ) : (
              <Empty title="No configured events" detail="Create an event to define a tracked interaction for this property." />
            )}
            <p className="subtle">No form values or unrestricted button text are collected.</p>
          </>
        )}
      </Panel>
      {!data && (
        <Panel title="Install events tracking">
          <div className="snippet-grid">
            <div className="snippet-card">
              <h3>Buttons and link clicks</h3>
              <p>Add <code>data-claritude-event</code> to the clicked element. This records the interaction itself, not the downstream result.</p>
              <pre className="install-code install-code-dark">{`<button data-claritude-event="enquiry-submit-click">\n  Submit enquiry\n</button>`}</pre>
              <CopyButton text={'<button data-claritude-event="enquiry-submit-click">\n  Submit enquiry\n</button>'} label="Copy snippet" successMessage="Event snippet copied" notify={notify} />
              <p className="subtle">Use short, stable, lowercase names. Do not capture form values or unrestricted button text.</p>
            </div>
            <div className="snippet-card">
              <h3>Successful form submissions</h3>
              <p>Fire the event only after the server or form provider confirms success. Use a supported plugin callback, success callback, or dedicated thank-you page.</p>
              <pre className="install-code install-code-dark">{`claritude.formSuccess('successful-form-submission', {\n  page: '/contact/'\n});`}</pre>
              <CopyButton text={`claritude.formSuccess('successful-form-submission', {\n  page: '/contact/'\n});`} label="Copy snippet" successMessage="Form-success snippet copied" notify={notify} />
              <p className="subtle">Failed validation, rejected submissions and repeated button clicks are not counted as successful submissions.</p>
            </div>
          </div>
        </Panel>
      )}
      {open && (
        <SimpleDialog
          title="Create event"
          close={() => setOpen(false)}
          action="Create event"
          onSave={saveEvent}
          disabled={eventLimitReached}
        >
          <label className="field">
            Event name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this event records" />
          </label>
          <label className="field">
            Trigger type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value as EventDefinition["event_type"])}
            >
              <option value="click">Element click</option>
              <option value="pageview">Page view</option>
              <option value="form_success">Confirmed form success</option>
            </select>
          </label>
          {eventType === "pageview" && (
            <div className="dialog-grid">
              <label className="field">Path match<select value={pathMode} onChange={(event) => setPathMode(event.target.value as "exact" | "prefix")}><option value="exact">Exact path</option><option value="prefix">Path prefix</option></select></label>
              <label className="field">Page path<input value={pathValue} onChange={(event) => setPathValue(event.target.value)} placeholder="/thank-you/" /></label>
            </div>
          )}
          {eventError && <div className="error-note" role="alert">{eventError}</div>}
          <p className="subtle">
            Property: {property.canonical_host}. For click events, add{" "}
            <code>data-claritude-event=&quot;{name}&quot;</code> to the tracked element.
            Confirmed form successes must be emitted only after the provider reports success.
          </p>
        </SimpleDialog>
      )}
      {instruction && (
        <Modal title="Installation instructions" close={() => setInstruction("")}>
          <p>Use this on <b>{property.canonical_host}</b>. The tracker accepts no form values or unrestricted text.</p>
          <code className="instruction-code">{instruction}</code>
          <div className="dialog-actions"><button className="primary" onClick={() => setInstruction("")}>Done</button></div>
        </Modal>
      )}
      {eventToDelete && (
        <SimpleDialog
          title="Delete event"
          close={() => { setEventToDelete(null); setEventDeleteConfirmation(""); }}
          action="Delete event"
          danger
          disabled={eventDeleteConfirmation !== eventToDelete.name}
          onSave={deleteEvent}
        >
          <p>Deleting this event will permanently remove the event definition and all collected data associated with it.</p>
          <label className="field">Type <b>{eventToDelete.name}</b> to confirm<input autoFocus value={eventDeleteConfirmation} onChange={(event) => setEventDeleteConfirmation(event.target.value)} /></label>
        </SimpleDialog>
      )}
    </>
  );
}

function EventTriggerIcon({ type }: { type: EventDefinition["event_type"] }) {
  if (type === "form_success") return <ClipboardCheck />;
  if (type === "pageview") return <Globe2 />;
  return <SquareDashedMousePointer />;
}
const auditPreparingMessages = [
  "Preparing your audit",
  "Getting everything lined up",
  "Waking up an audit worker",
  "Loading the audit toolkit",
  "Getting the checks ready",
  "Almost ready to get started",
];
const auditEarlyMessages = [
  "Audit running",
  "Collecting page evidence",
  "Checking structure and metadata",
  "Giving the page a proper once-over",
];
const auditMiddleMessages = [
  "Inspecting links and resources",
  "Testing accessibility",
  "Checking performance signals",
  "Reviewing security headers",
  "Looking through technical details",
  "Crunching the numbers",
  "Checking the tricky bits",
  "No time for a coffee yet",
  "Checking under the bonnet",
  "Looking for things worth fixing",
];
const auditFinalMessages = [
  "Pulling the findings together",
  "Doing the final checks",
  "Tidying up the evidence",
  "Doing the final touches",
  "Saving everything for you",
];

export function auditProgressCeiling(elapsedMs: number, finalising = false) {
  if (finalising) return 97;
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed <= 5_000) return 12 + (elapsed / 5_000) * 16;
  if (elapsed <= 20_000) return 28 + ((elapsed - 5_000) / 15_000) * 37;
  if (elapsed <= 60_000) return 65 + ((elapsed - 20_000) / 40_000) * 20;
  return Math.min(90, 85 + ((elapsed - 60_000) / 60_000) * 5);
}

export function auditProgressMessagePhase(status: string, percent: number, finalising = false) {
  if (status === "queued") return "preparing";
  if (finalising || percent >= 82) return "final";
  if (percent < 32) return "early";
  return "middle";
}

export function auditProgressMessagePool(status: string, percent: number, finalising = false) {
  const phase = auditProgressMessagePhase(status, percent, finalising);
  if (phase === "preparing") return auditPreparingMessages;
  if (phase === "early") return auditEarlyMessages;
  if (phase === "final") return auditFinalMessages;
  return auditMiddleMessages;
}

function AuditProgress({ run, onRetry }: { run: AuditRun; onRetry: () => void }) {
  const total = run.progress_total || 0;
  const complete = Math.min(run.progress_completed || 0, total || Number.MAX_SAFE_INTEGER);
  const actualPercent = total ? (complete / total) * 100 : 0;
  const genuinelyComplete = ["completed", "partial"].includes(run.status);
  const finalising = run.execution_stage === "persisting_results" || run.execution_stage === "finalising";
  const progressStartedAt = useRef(Date.now());
  const [displayPercent, setDisplayPercent] = useState(() => auditDisplayProgress(0, actualPercent, genuinelyComplete, 12, 9 + Math.random() * 3));
  const messagePhase = auditProgressMessagePhase(run.status, displayPercent, finalising);
  const messagePool = auditProgressMessagePool(run.status, displayPercent, finalising);
  const [messageState, setMessageState] = useState(() => ({ runId: run.id, phase: messagePhase, index: 0 }));
  useEffect(() => {
    progressStartedAt.current = Date.now();
    setDisplayPercent(auditDisplayProgress(0, actualPercent, genuinelyComplete, 12, 9 + Math.random() * 3));
  }, [run.id]);
  useEffect(() => {
    const ceiling = finalising ? 97 : auditProgressCeiling(Date.now() - progressStartedAt.current);
    setDisplayPercent((current) => auditDisplayProgress(current, actualPercent, genuinelyComplete, ceiling));
  }, [actualPercent, finalising, genuinelyComplete]);
  useEffect(() => {
    if (genuinelyComplete || run.status === "failed") return;
    let timer = 0;
    let cancelled = false;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const ceiling = auditProgressCeiling(Date.now() - progressStartedAt.current, finalising);
        const increment = .4 + Math.random() * 2.1;
        setDisplayPercent((current) => auditDisplayProgress(current, actualPercent, false, ceiling, increment));
        schedule();
      }, 700 + Math.random() * 1_800);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actualPercent, finalising, genuinelyComplete, run.id, run.status]);
  useEffect(() => {
    if (genuinelyComplete || run.status === "failed") return;
    setMessageState((current) => current.runId === run.id && current.phase === messagePhase
      ? current
      : { runId: run.id, phase: messagePhase, index: 0 });
    let timer = 0;
    let cancelled = false;
    const rotate = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setMessageState((current) => {
          if (current.runId !== run.id || current.phase !== messagePhase)
            return { runId: run.id, phase: messagePhase, index: 0 };
          if (current.index >= messagePool.length - 1) return current;
          return { ...current, index: current.index + 1 };
        });
        rotate();
      }, 2_800 + Math.random() * 2_400);
    };
    rotate();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [genuinelyComplete, messagePhase, messagePool.length, run.id, run.status]);
  const heartbeat = Date.parse(run.heartbeat_at || run.created_at);
  const createdAt = Date.parse(run.created_at);
  const stalled = ["queued", "running"].includes(run.status) && (
    Number.isFinite(heartbeat) && Date.now() - heartbeat > 2 * 60_000 ||
    Number.isFinite(createdAt) && Date.now() - createdAt > 5 * 60_000
  );
  const messageIndex = messageState.runId === run.id && messageState.phase === messagePhase
    ? Math.min(messageState.index, messagePool.length - 1)
    : 0;
  const statusMessage = genuinelyComplete
    ? "Audit complete"
    : stalled
      ? "Audit stalled"
      : run.status === "failed"
        ? "Audit failed"
        : messagePool[messageIndex];
  const statusDetail = genuinelyComplete
    ? "Your latest results are ready."
    : stalled
      ? "The audit worker stopped reporting progress."
      : run.status === "failed"
        ? "The audit could not be completed."
        : run.status === "queued"
          ? "Your audit will start as soon as a worker is ready."
          : "We’re analysing the page and saving the data.";
  return (
    <section className={`audit-progress ${run.status === "failed" || stalled ? "failed" : ""}`} aria-live="polite">
      <div className="audit-progress-copy">
        <b>{statusMessage}</b>
        <span>{statusDetail}</span>
        {run.error && <small className="error-note">{run.error}</small>}
      </div>
      <div
        className="audit-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayPercent)}
        aria-valuetext={`${Math.round(displayPercent)} percent · ${statusMessage}`}
      >
        <span style={{ width: `${displayPercent.toFixed(2)}%` }} />
      </div>
      {(run.status === "failed" || stalled) && <button className="btn" onClick={onRetry}><RefreshCw /> Retry audit</button>}
    </section>
  );
}

type AuditFilterKind = "critical" | "security" | "warning" | "unable_to_test" | "advisory" | "passed" | "not_applicable";
type AuditBrowseFilters = { search?: string; category?: string; subcategory?: string; outcome?: string; types?: AuditFilterKind[] };

const auditFilterLabels: Record<AuditFilterKind, string> = {
  critical: "Critical",
  security: "Security",
  warning: "Warning",
  unable_to_test: "Unable to Test",
  advisory: "Advisory",
  passed: "Passed",
  not_applicable: "Not Applicable",
};

function AuditQuickFilter({ kind, count, filters, onChange }: { kind: AuditFilterKind; count: number; filters: AuditBrowseFilters; onChange: (filters: AuditBrowseFilters) => void }) {
  const selected = filters.types?.includes(kind) || false;
  return (
    <button
      className={`audit-summary-item ${kind} ${selected ? "selected" : ""}`}
      onClick={() => onChange({ ...filters, types: selected ? (filters.types || []).filter((value) => value !== kind) : [...(filters.types || []), kind] })}
      aria-pressed={selected}
      aria-label={`${auditFilterLabels[kind]}: ${count}`}
    >
      {auditGroupIcon(kind)}{count}
    </button>
  );
}

function AuditFilterMenu({ results, filters, onChange, kinds }: { results: any[]; filters: AuditBrowseFilters; onChange: (filters: AuditBrowseFilters) => void; kinds: AuditFilterKind[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);
  const categoryOptions = [...new Set(results.map((result) => String(result.category || "General")))].sort();
  const subcategoryOptions = [...new Set(results
    .filter((result) => !filters.category || result.category === filters.category)
    .map((result) => String(result.subcategory || "General")))].sort();
  const active = [
    ...(filters.search ? [{ key: "search", label: `Search: ${filters.search}` }] : []),
    ...(filters.category ? [{ key: "category", label: filters.category }] : []),
    ...(filters.subcategory ? [{ key: "subcategory", label: filters.subcategory }] : []),
    ...(filters.types || []).map((kind) => ({ key: `type:${kind}`, label: auditFilterLabels[kind] })),
  ];
  const remove = (key: string) => {
    if (key.startsWith("type:")) onChange({ ...filters, types: (filters.types || []).filter((kind) => kind !== key.slice(5)) });
    else onChange({ ...filters, [key]: undefined, ...(key === "category" ? { subcategory: undefined } : {}) });
  };
  return (
    <div className="audit-filter-row">
      <div className="audit-filter-wrap" ref={wrapper}>
        <button className="btn audit-overview-filter" aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}>
          <Filter /> Filters
        </button>
        {open && (
          <div className="action-menu audit-filter-actions" id={menuId} role="dialog" aria-label="Audit filters">
            <label className="audit-filter-field"><span>Search</span><input value={filters.search || ""} onChange={(event) => onChange({ ...filters, search: event.target.value || undefined })} placeholder="Search checks" /></label>
            <label className="audit-filter-field"><span>Category</span><select value={filters.category || ""} onChange={(event) => onChange({ ...filters, category: event.target.value || undefined, subcategory: undefined })}><option value="">All categories</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="audit-filter-field"><span>Subcategory</span><select value={filters.subcategory || ""} onChange={(event) => onChange({ ...filters, subcategory: event.target.value || undefined })}><option value="">All subcategories</option>{subcategoryOptions.map((subcategory) => <option key={subcategory}>{subcategory}</option>)}</select></label>
            <fieldset className="audit-filter-types"><legend>Type / severity</legend>{kinds.map((kind) => <label key={kind}><input type="checkbox" checked={filters.types?.includes(kind) || false} onChange={() => onChange({ ...filters, types: filters.types?.includes(kind) ? filters.types.filter((value) => value !== kind) : [...(filters.types || []), kind] })} />{auditFilterLabels[kind]}</label>)}</fieldset>
            <div className="menu-separator" />
            <button type="button" disabled={!active.length} onClick={() => onChange({})}>Clear filters</button>
          </div>
        )}
      </div>
      {active.map((chip) => <span className="filter-chip" key={chip.key}>{chip.label}<button aria-label={`Remove ${chip.label} filter`} onClick={() => remove(chip.key)}><X /></button></span>)}
      {active.length > 1 && <button className="text-link audit-filter-clear" onClick={() => onChange({})}>Clear all</button>}
    </div>
  );
}

function AuditScore({ run }: { run?: AuditRun }) {
  const categoryScores = auditRunCategoryScores(run);
  const complete = isAuditRunComplete(run);
  const score = run?.score;
  return (
    <div className="audit-score-row">
      <div className="audit-overall-score">
        <div
          className={`audit-score ${(score || 0) >= 80 ? "good" : "warn"} ${complete ? "" : "partial"}`}
          style={{ "--score": score || 0 } as any}
        >
          <span>{score ?? "—"}</span>
        </div>
        <div className="audit-overall-score-label"><b>Overall audit rating</b><span>/100</span></div>
      </div>
      <div className="audit-six-stats">
        {auditCategories.map((x) => {
          const categoryScore = categoryScores[x];
          return (
          <div className="audit-six-stat" key={x}>
            <small>{x}</small>
            <b>{categoryScore ?? "--"}</b>
          </div>
          );
        })}
      </div>
    </div>
  );
}
export function auditResultFilterKind(result: any): AuditFilterKind {
  if (result.outcome === "unable_to_test") return "unable_to_test";
  if (result.outcome === "not_applicable") return "not_applicable";
  if (result.outcome === "advisory") return "advisory";
  if (result.outcome === "passed") return "passed";
  return auditSeverityGroup(result) as AuditFilterKind;
}

export function isFixFirstAuditResult(result: any) {
  return result.outcome === "failed" && ["critical", "security", "warning"].includes(auditSeverityGroup(result));
}

export function shouldShowAuditQuickFilters(counts: Record<string, number>) {
  return Object.values(counts).filter((count) => count > 0).length > 1;
}

export function filterUserFacingAuditResults(results: any[], filters: AuditBrowseFilters, options: { hideUnableByDefault?: boolean } = {}) {
  const query = filters.search?.trim().toLowerCase();
  const selectedKinds = filters.types || [];
  return results.filter((result) =>
    (!filters.category || result.category === filters.category) &&
    (!filters.subcategory || result.subcategory === filters.subcategory) &&
    (!filters.outcome || result.outcome === filters.outcome) &&
    (!query || [result.title, result.category, result.subcategory, result.result_summary, result.focus].some((value) => String(value || "").toLowerCase().includes(query))) &&
    (!selectedKinds.length || selectedKinds.includes(auditResultFilterKind(result))) &&
    (!(options.hideUnableByDefault ?? false) || selectedKinds.includes("unable_to_test") || result.outcome !== "unable_to_test"));
}

function auditDetailedCategoriesFor(results: any[]) {
  const entries = new Map<string, { key: string; label: string; category: string; subcategory: string }>();
  for (const result of results) {
    const category = String(result.category || "General");
    const subcategory = String(result.subcategory || "General");
    const key = `${category}::${subcategory}`;
    entries.set(key, { key, label: `${category}: ${subcategory}`, category, subcategory });
  }
  const categoryOrder = new Map(auditCategories.map((category, index) => [category, index]));
  return [...entries.values()].sort((left, right) =>
    (categoryOrder.get(left.category) ?? 99) - (categoryOrder.get(right.category) ?? 99) ||
    left.subcategory.localeCompare(right.subcategory));
}

export function auditSeverityGroup(result: any) {
  if (result.outcome === "passed") return "pass";
  if (["advisory", "not_applicable", "unable_to_test"].includes(result.outcome)) return "advisory";
  const severity = String(result.severity).toLowerCase();
  if (severity === "security" || (String(result.category) === "Security" && ["critical", "high"].includes(severity))) return "security";
  if (["critical", "high"].includes(severity)) return "critical";
  return "warning";
}

function auditGroupIcon(group: string) {
  if (group === "security") return <ShieldAlert />;
  if (group === "warning") return <TriangleAlert />;
  if (group === "advisory") return <Eye />;
  if (["pass", "passed"].includes(group)) return <CheckCircle2 />;
  return <OctagonAlert />;
}

function AuditFindingsPanel({
  pageName,
  results,
  filters,
  setFilters,
  openCategories,
  setOpenCategories,
}: {
  pageName: string;
  results: any[];
  filters: AuditBrowseFilters;
  setFilters: (filters: AuditBrowseFilters) => void;
  openCategories: Set<string>;
  setOpenCategories: (value: Set<string>) => void;
}) {
  const [openResultId, setOpenResultId] = useState<string | null>(null);
  const filtered = filterUserFacingAuditResults(results, filters, { hideUnableByDefault: true });
  const categories = auditDetailedCategoriesFor(filtered);
  const quickKinds: AuditFilterKind[] = ["critical", "security", "warning", "advisory", "passed"];
  return (
    <section className="panel audit-findings-panel">
      <h2>{pageName} findings</h2>
      <div className="audit-summary audit-findings-summary" aria-label="Finding type filters">
        {quickKinds.map((kind) => (
          <AuditQuickFilter
            key={kind}
            kind={kind}
            count={results.filter((result) => auditResultFilterKind(result) === kind).length}
            filters={filters}
            onChange={setFilters}
          />
        ))}
      </div>
      <AuditFilterMenu results={results} filters={filters} onChange={setFilters} kinds={["critical", "security", "warning", "unable_to_test", "advisory", "passed", "not_applicable"]} />
      <div className="audit-findings-divider" />
      {categories.length ? categories.map(({ key, label, category, subcategory }) => {
        const categoryResults = filtered.filter((result) => result.category === category && result.subcategory === subcategory);
        const open = openCategories.has(key);
        return (
          <section className={`audit-category ${open ? "open" : ""}`} key={key}>
            <button className="audit-category-toggle" aria-expanded={open} onClick={() => {
              const next = new Set(openCategories);
              if (open) next.delete(key); else next.add(key);
              setOpenCategories(next);
            }}>
              <b>{label}</b><span>{categoryResults.length} {categoryResults.length === 1 ? "check" : "checks"}</span><span aria-hidden>{open ? "−" : "+"}</span>
            </button>
            {open && <AuditResults results={categoryResults} filters={filters} openId={openResultId} onOpenIdChange={setOpenResultId} />}
          </section>
        );
      }) : (
        <Empty title="No matching findings" detail="Clear the active filter to view all categories." />
      )}
    </section>
  );
}

function auditCheckMetrics(results: any[]) {
  const passed = results.filter((result) => result.outcome === "passed").length;
  const issues = results.filter((result) => ["failed", "advisory"].includes(result.outcome)).length;
  const informational = results.filter((result) => result.outcome === "not_applicable").length;
  const unable = results.filter((result) => result.outcome === "unable_to_test").length;
  const denominator = passed + issues;
  return {
    checks: results.length,
    passed,
    issues,
    informational,
    unable,
    passRate: denominator ? Math.round((passed / denominator) * 100) : null,
  };
}

function AuditChecksPanel({ pageName, run, results, onOpenCategory }: { pageName: string; run?: AuditRun; results: any[]; onOpenCategory: (category: string) => void }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const categoryScores = auditRunCategoryScores(run);
  const summary = {
    automated: run?.catalogue_summary?.userFacingGroups ?? results.length,
    passed: results.filter((result) => result.outcome === "passed").length,
    issues: results.filter((result) => ["failed", "advisory"].includes(result.outcome)).length,
    informational: results.filter((result) => result.outcome === "not_applicable").length,
  };
  const visibleCategories = auditCategories.filter((category) => results.some((result) => result.category === category));
  return (
    <>
      <div className="audit-check-summary">
        {[["Automated checks", summary.automated], ["Passed", summary.passed], ["Issues", summary.issues], ["Not applicable", summary.informational]].map(([label, value]) => (
          <div key={String(label)}><small>{label}</small><b>{value}</b></div>
        ))}
      </div>
      <section className="panel audit-checks-panel">
        <h2>{pageName} checks</h2>
        <div className="table-wrap">
          <table className="audit-checks-table">
            <thead><tr><th>Category</th><th>Checks</th><th>Passed</th><th>Issues</th><th>Pass rate</th><th><span className="sr-only">Expand</span></th></tr></thead>
            <tbody>
              {visibleCategories.map((category) => {
                const categoryResults = results.filter((result) => result.category === category);
                const metrics = auditCheckMetrics(categoryResults);
                const visualScore = categoryScores[category];
                const status = auditScoreBand(visualScore);
                const open = openCategory === category;
                const subcategories = auditDetailedCategoriesFor(categoryResults);
                const toggle = () => setOpenCategory(open ? null : category);
                return <Fragment key={category}>
                  <tr className="audit-check-category-row">
                    <td><button className={`audit-category-bar ${status}`} style={{ "--bar-value": visualScore ?? 0 } as any} title={visualScore == null ? "Category score unavailable" : `Category score: ${visualScore}/100`} aria-expanded={open} onClick={toggle}>{category}</button></td>
                    <td>{metrics.checks}</td><td>{metrics.passed}</td><td>{metrics.issues}</td><td>{metrics.passRate == null ? "--" : `${metrics.passRate}%`}</td>
                    <td><button className="audit-check-expand" aria-label={`${open ? "Collapse" : "Expand"} ${category}`} aria-expanded={open} onClick={toggle}><ChevronDown /></button></td>
                  </tr>
                  {open && subcategories.map(({ key, subcategory }) => {
                    const subcategoryResults = categoryResults.filter((result) => result.subcategory === subcategory);
                    const subcategoryMetrics = auditCheckMetrics(subcategoryResults);
                    return <tr className="audit-check-subcategory-row" key={key}>
                      <td><button className="audit-category-bar subcategory" style={{ "--bar-value": subcategoryMetrics.passRate ?? 0 } as any} onClick={() => onOpenCategory(key)}>{subcategory}</button></td>
                      <td>{subcategoryMetrics.checks}</td><td>{subcategoryMetrics.passed}</td><td>{subcategoryMetrics.issues}</td><td>{subcategoryMetrics.passRate == null ? "--" : `${subcategoryMetrics.passRate}%`}</td>
                      <td><button className="audit-check-open-findings" aria-label={`View ${subcategory} issues`} onClick={() => onOpenCategory(key)}><ChevronRight /></button></td>
                    </tr>;
                  })}
                </Fragment>;
              })}
            </tbody>
          </table>
          {!visibleCategories.length && <Empty title="No checks available" detail="Run an audit to populate the checks table." />}
        </div>
      </section>
    </>
  );
}

function auditFindingIdentity(result: any) {
  const evidence = result.evidence && typeof result.evidence === "object" ? result.evidence : {};
  const resource = evidence.resource || evidence.url || evidence.path || evidence.src || evidence.selector || evidence.element || "page";
  return `${result.group_id || result.check_id || result.id}:${String(resource).slice(0, 500)}`;
}

function AuditComparePanel({
  pageName,
  runs,
  earlierRunId,
  laterRunId,
  onEarlierChange,
  onLaterChange,
}: {
  pageName: string;
  runs: AuditRun[];
  earlierRunId: string;
  laterRunId: string;
  onEarlierChange: (id: string) => void;
  onLaterChange: (id: string) => void;
}) {
  const eligible = runs.filter((run) => ["completed", "partial"].includes(run.status));
  if (eligible.length < 2)
    return <Panel><Empty title="A second completed audit is required" detail={`Run another audit for ${pageName} to compare stored results.`} /></Panel>;
  const earlier = eligible.find((run) => run.id === earlierRunId);
  const later = eligible.find((run) => run.id === laterRunId);
  if (!earlier || !later || earlier.id === later.id)
    return <Panel><Empty title="Select two different scans" detail="Earlier and later scans must belong to this page and cannot be the same run." /></Panel>;
  const earlierResults = earlier.user_facing_results || earlier.audit_results || [];
  const laterResults = later.user_facing_results || later.audit_results || [];
  const identity = (result: any) => result.group_id || result.check_id;
  const previousByCheck = new Map(earlierResults.map((result: any) => [identity(result), result]));
  const currentByCheck = new Map(laterResults.map((result: any) => [identity(result), result]));
  const previousFindings = earlierResults.filter((result: any) => ["failed", "advisory"].includes(result.outcome));
  const currentFindings = laterResults.filter((result: any) => ["failed", "advisory"].includes(result.outcome));
  const previousFindingIds = new Set(previousFindings.map(auditFindingIdentity));
  const currentFindingIds = new Set(currentFindings.map(auditFindingIdentity));
  const resolved = previousFindings.filter((result: any) => {
    const current: any = currentByCheck.get(identity(result));
    return current && current.outcome !== "unable_to_test" && !["failed", "advisory"].includes(current.outcome) && !currentFindingIds.has(auditFindingIdentity(result));
  }).length;
  const added = currentFindings.filter((result: any) => {
    const previous: any = previousByCheck.get(identity(result));
    return previous && previous.outcome !== "unable_to_test" && !["failed", "advisory"].includes(previous.outcome) && !previousFindingIds.has(auditFindingIdentity(result));
  }).length;
  const unchanged = currentFindings.filter((result: any) => previousFindingIds.has(auditFindingIdentity(result))).length;
  const earlierPerformance = earlier.category_scores?.Performance ?? auditCategoryScore(earlierResults, auditCategoryPrefixes.Performance);
  const laterPerformance = later.category_scores?.Performance ?? auditCategoryScore(laterResults, auditCategoryPrefixes.Performance);
  const latestLabel = later.id === eligible[0].id ? "Latest scan" : "Later scan";
  const registryChanged = JSON.stringify((earlier as any).registry_snapshot?.map((check: any) => check.id) || []) !== JSON.stringify((later as any).registry_snapshot?.map((check: any) => check.id) || []);
  const scoreChange = (later.score ?? 0) - (earlier.score ?? 0);
  const performanceChange = laterPerformance != null && earlierPerformance != null ? laterPerformance - earlierPerformance : null;
  return (
    <>
      <section className="panel audit-compare-selectors">
        <label>Earlier scan<select value={earlier.id} onChange={(event) => onEarlierChange(event.target.value)}>{eligible.filter((run) => run.id !== later.id).map((run) => <option value={run.id} key={run.id}>{fmtDate(run.completed_at || run.created_at)} · {run.status}</option>)}</select></label>
        <span>compared with</span>
        <label>{latestLabel}<select value={later.id} onChange={(event) => onLaterChange(event.target.value)}>{eligible.filter((run) => run.id !== earlier.id).map((run) => <option value={run.id} key={run.id}>{fmtDate(run.completed_at || run.created_at)} · {run.status}</option>)}</select></label>
      </section>
      <div className="audit-compare-summary">
        <div><small>Overall</small><b>{earlier.score ?? "—"} → {later.score ?? "—"}</b><span>{scoreChange >= 0 ? "+" : ""}{scoreChange}</span></div>
        <div><small>Performance</small><b>{earlierPerformance ?? "—"} → {laterPerformance ?? "—"}</b><span>{performanceChange == null ? "—" : `${performanceChange >= 0 ? "+" : ""}${performanceChange}`}</span></div>
        <div><small>Resolved</small><b>{resolved}</b></div>
        <div><small>New</small><b>{added}</b></div>
      </div>
      <section className="panel audit-comparison-table">
        <h2>{pageName} finding comparison</h2>
        <DataTable headers={["Status", "Count"]} rows={[["Resolved", resolved], ["New", added], ["Unchanged", unchanged], ["Current findings", currentFindings.length]]} />
        <p className="subtle">Previous findings: {previousFindings.length}. Current findings: {currentFindings.length}. Resolved items are not included in the current total.</p>
        {(registryChanged || earlier.coverage !== later.coverage) && <p className="analytics-data-warning">Registry or coverage differs between these scans. Missing and unable-to-test checks are not classified as resolved or new.</p>}
      </section>
    </>
  );
}

function AuditOccurrences({ occurrences, presentation }: { occurrences: any[]; presentation?: { enabled?: boolean; initialLimit?: number; fields?: string[] } }) {
  const [showAll, setShowAll] = useState(false);
  if (presentation?.enabled === false || !occurrences.length) return null;
  const initialLimit = Math.max(1, Number(presentation?.initialLimit) || 10);
  const visible = showAll ? occurrences : occurrences.slice(0, initialLimit);
  const groups = new Map<string, { title: string; entries: any[] }>();
  for (const entry of visible) {
    const key = entry.check_id || entry.check_title || "affected-items";
    const group: { title: string; entries: any[] } = groups.get(key) || { title: entry.check_title || "Affected items", entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return (
    <div className="audit-occurrences">
      <p className="subtle">Showing {visible.length} of {occurrences.length}</p>
      {[...groups.entries()].map(([key, group]) => (
        <section className="audit-occurrence-group" key={key}>
          <h4>{group.title}</h4>
          <ol>{group.entries.map((entry, index) => <li key={`${key}-${index}`}><code>{auditOccurrenceText(entry.occurrence, presentation?.fields)}</code></li>)}</ol>
        </section>
      ))}
      {occurrences.length > initialLimit && <button className="text-link" onClick={() => setShowAll((value) => !value)}>{showAll ? `Show first ${initialLimit}` : "Show all"}</button>}
    </div>
  );
}

export function auditScoreBand(score: number | null | undefined) {
  return score == null ? "unknown" : score >= 80 ? "healthy" : score >= 60 ? "moderate" : "poor";
}

export function auditHistoryStatus(status: string) {
  if (["completed", "partial"].includes(status)) return "Successful";
  if (status === "failed") return "Failed";
  return "In progress";
}

export function buildAuditFixPrompt({ pageName, pageUrl, runId, results }: { pageName: string; pageUrl: string; runId: string; results: any[] }) {
  const findings = results.filter(isFixFirstAuditResult);
  const sections = findings.map((result, index) => {
    const subfindings = (result.subfindings || []).map((finding: any) => `- ${finding.title} [${String(finding.outcome).replaceAll("_", " ")}]: ${finding.evidence_summary || "No additional evidence summary"}`).join("\n");
    const occurrences = (result.occurrences || []).map((entry: any, occurrenceIndex: number) => `${occurrenceIndex + 1}. ${entry.check_title || "Affected item"}: ${auditOccurrenceText(entry.occurrence, result.occurrence_presentation?.fields)}`).join("\n");
    return [
      `## ${index + 1}. ${result.title || result.check_id}`,
      `Severity: ${result.severity || auditFilterLabels[auditResultFilterKind(result)]}`,
      `Issue: ${result.result_summary || result.focus || "The audit identified a problem that needs correction."}`,
      subfindings ? `Technical evidence:\n${subfindings}` : "",
      occurrences ? `Affected elements/resources:\n${occurrences}` : "Affected elements/resources: No element-level occurrence was recorded.",
      result.recommendation ? `Recommendation: ${result.recommendation}` : "",
      result.example_fix ? `Example fix:\n${result.example_fix}` : "",
    ].filter(Boolean).join("\n\n");
  });
  return [
    "You are fixing issues identified by a Claritude website audit.",
    `Website/page: ${pageName} — ${pageUrl}`,
    `Audit run: ${runId}`,
    `Issues to address: ${findings.length}`,
    "Fix every issue and every listed occurrence safely. Preserve the website's existing functionality, accessibility intent and visual design. Do not make speculative changes solely to satisfy a check. After making changes, summarise what you changed and explain any item you could not safely change.",
    ...sections,
  ].join("\n\n");
}

function AuditAiFixPrompt({ pageName, pageUrl, runId, results, notify }: { pageName: string; pageUrl: string; runId: string; results: any[]; notify: Notify }) {
  const eligible = results.filter(isFixFirstAuditResult);
  if (!eligible.length) return null;
  const prompt = buildAuditFixPrompt({ pageName, pageUrl, runId, results: eligible });
  return (
    <section className="audit-ai-fix-panel">
      <span><b>Fix with AI</b><small>Copy a ready-made prompt containing every critical, security and warning issue, its evidence, affected items and recommended fix.</small></span>
      <CopyButton
        text={prompt}
        label="Copy prompt"
        successMessage={`AI fix prompt copied with ${eligible.length} ${eligible.length === 1 ? "issue" : "issues"}`}
        notify={notify}
        className=""
      />
    </section>
  );
}

export function auditDisplayProgress(
  current: number,
  actual: number,
  complete: boolean,
  ceiling = 90,
  increment = 0,
) {
  if (complete) return 100;
  const safeCurrent = Math.max(0, Math.min(99, current));
  const safeActual = Math.max(0, Math.min(99, actual));
  const simulated = Math.min(Math.max(0, ceiling), safeCurrent + Math.max(0, increment));
  return Number(Math.min(99, Math.max(safeCurrent, safeActual, simulated)).toFixed(2));
}

export function filterAuditSubfindings(subfindings: any[] = [], types: AuditFilterKind[] = []) {
  if (!types.length) return subfindings;
  const outcomes = new Set<string>();
  for (const type of types) {
    if (["critical", "security", "warning"].includes(type)) outcomes.add("failed");
    else if (type === "advisory") {
      outcomes.add("advisory");
      outcomes.add("failed");
    } else outcomes.add(type);
  }
  return subfindings.filter((finding) => outcomes.has(finding.outcome));
}

function AuditResults({
  results,
  filters,
  hideOutcome = false,
  openId: controlledOpenId,
  onOpenIdChange,
}: {
  results: any[];
  filters?: AuditBrowseFilters;
  hideOutcome?: boolean;
  openId?: string | null;
  onOpenIdChange?: (id: string | null) => void;
}) {
  const [internalOpenId, setInternalOpenId] = useState<string | null>(null);
  const openId = controlledOpenId === undefined ? internalOpenId : controlledOpenId;
  const setOpenId = onOpenIdChange || setInternalOpenId;
  const itemRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!openId) return;
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current.get(openId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openId]);
  return (
    <div className={`audit-result-list ${hideOutcome ? "hide-result-outcome" : ""}`}>
      {results.length ? results.map((result, index) => {
        const itemId = String(result.group_id || result.id || index);
        const open = itemId === openId;
        const passed = result.outcome === "passed";
        const visibleSubfindings = filterAuditSubfindings(result.subfindings || [], filters?.types);
        const visibleCheckIds = new Set(visibleSubfindings.map((finding: any) => finding.check_id));
        const visibleOccurrences = filters?.types?.length
          ? (result.occurrences || []).filter((entry: any) => visibleCheckIds.has(entry.check_id))
          : result.occurrences || [];
        return (
          <section
            className={`audit-item ${open ? "open" : ""}`}
            key={itemId}
            ref={(element) => {
              if (element) itemRefs.current.set(itemId, element);
              else itemRefs.current.delete(itemId);
            }}
          >
            <button className="audit-item-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : itemId)}>
              <span className={`severity-icon ${auditSeverityGroup(result)}`}>{auditGroupIcon(auditSeverityGroup(result))}</span>
              <span><b>{result.title || result.title_snapshot || result.check_id}</b><small>{result.category || "General"}{result.subcategory && result.subcategory !== "General" ? ` · ${result.subcategory}` : ""}</small></span>
              {!hideOutcome && <span className={`audit-item-state outcome-${result.outcome}`}>{cap(String(result.outcome || result.status || "Recorded").replaceAll("_", " "))}</span>}
              <ChevronDown />
            </button>
            {open && <div className="audit-detail">
              {Array.isArray(result.subfindings) ? <>
                {result.focus && <section className="audit-information-panel"><b>What Claritude checks</b><p>{result.focus}</p></section>}
                {!passed && result.result_summary && <section className="audit-result-summary" aria-label="Audit result summary">{result.result_summary}</section>}
                {!passed && visibleSubfindings.length > 0 && <><b className="audit-detail-label">Technical sub-findings</b><ul className="audit-subfindings">{visibleSubfindings.map((finding: any) => <li key={finding.check_id}><span className={`audit-subfinding-outcome outcome-${finding.outcome}`}>{cap(String(finding.outcome).replaceAll("_", " "))}</span><span><b>{finding.title}</b><small>{finding.evidence_summary}</small></span></li>)}</ul></>}
                {!passed && result.occurrence_presentation?.enabled !== false && visibleOccurrences.length > 0 && <><b className="audit-detail-label">Affected elements or resources</b><AuditOccurrences occurrences={visibleOccurrences} presentation={result.occurrence_presentation} /></>}
                {!passed && ["failed", "advisory"].includes(result.outcome) && result.recommendation && <section className="audit-recommendation-panel"><b>How to fix</b><p>{result.recommendation}</p></section>}
                {!passed && ["failed", "advisory"].includes(result.outcome) && result.example_fix && <section className="audit-example-fix"><b>Example fix</b><pre><code>{result.example_fix}</code></pre></section>}
              </> : <>
                <p>{result.focus || result.description || "The audit recorded this result for the selected page."}</p>
                {!passed && <><b className="audit-detail-label">Affected element or resource</b><code>{auditEvidenceText(result.evidence)}</code><b className="audit-detail-label">Recommended fix</b><p>{result.recommendation || "Review the recorded evidence and update the affected implementation."}</p></>}
              </>}
              {!passed && <div className="audit-detail-actions"><a className="text-link audit-more-information" href={auditLearnMoreUrl(result.category, result.source_reference)} target="_blank" rel="noreferrer">More information <ExternalLink /></a></div>}
            </div>}
          </section>
        );
      }) : <Empty title="No matching findings" detail="Adjust the active filters or run an audit to generate results." />}
    </div>
  );
}
function auditEvidenceText(evidence: unknown) {
  if (typeof evidence === "string") return evidence;
  if (!evidence || typeof evidence !== "object") return "No element-level evidence was recorded.";
  const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const readable = (value: unknown): string => {
    if (Array.isArray(value)) return value.length ? value.map((item) => readable(item)).join(", ") : "None";
    if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${label(key)} ${readable(item)}`).join("; ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };
  const entries = Object.entries(evidence as Record<string, unknown>)
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${label(key)}: ${readable(value)}`);
  return entries.join("\n") || "No element-level evidence was recorded.";
}
function auditLearnMoreUrl(category?: string, sourceReference?: string) {
  if (sourceReference) {
    try {
      const url = new URL(sourceReference);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch { /* use the category destination */ }
  }
  if (category === "Accessibility") return "https://web.dev/learn/accessibility/";
  if (category === "Performance") return "https://web.dev/learn/performance/";
  if (category === "Security") return "https://developer.mozilla.org/en-US/docs/Web/Security";
  return "https://web.dev/learn/seo/";
}
function PerformanceTable({
  mobile,
  run,
}: {
  mobile: boolean;
  run?: AuditRun;
}) {
  const rows = mobile
    ? run?.performance_metrics?.mobile
    : run?.performance_metrics?.desktop;
  return (
    rows?.length ? (
      <DataTable
        headers={["Metric", "Value", "Target"]}
        rows={rows.map((row) => [
          <MetricTerm key={String(row[0])} term={String(row[0])} />,
          row[1],
          <PerformanceTarget key={String(row[0])} metric={String(row[0])} value={row[1]} target={String(row[2])} />,
        ])}
      />
    ) : (
      <EmptyCompact
        title="Browser lab metrics not implemented"
        detail="The current source audit did not execute a rendered-browser performance pass."
      />
    )
  );
}

function auditOccurrenceText(occurrence: unknown, configuredFields?: string[]) {
  if (typeof occurrence === "string" || typeof occurrence === "number") return String(occurrence);
  if (!occurrence || typeof occurrence !== "object") return "Recorded affected occurrence";
  const allowed = new Set(["selector", "element", "html", "locator", "url", "path", "resource", "resourceType", "message", "description", "snippet", "attribute", "viewport", "status", "value", "source"]);
  const safeKeys = (configuredFields?.length ? configuredFields : [...allowed]).filter((key) => allowed.has(key));
  const details = safeKeys.flatMap((key) => {
    const value = (occurrence as Record<string, unknown>)[key];
    if (value == null || value === "" || typeof value === "object") return [];
    const compact = String(value).replace(/\s+/g, " ").trim();
    return [`${key.replaceAll("_", " ")}: ${compact.length > 240 ? `${compact.slice(0, 237)}…` : compact}`];
  });
  const values = (occurrence as Record<string, unknown>).values;
  if (values && typeof values === "object" && !Array.isArray(values)) {
    for (const key of ["viewport", "status", "value"]) {
      if (!safeKeys.includes(key)) continue;
      const value = (values as Record<string, unknown>)[key];
      if (typeof value === "string" || typeof value === "number") details.push(`${key}: ${String(value)}`);
    }
  }
  return details.join(" · ") || "Recorded affected occurrence";
}
const performanceTermDescriptions: Record<string, string> = {
  "SESSIONS": "A session is one anonymous browser session. It can contain multiple pageviews and events, and does not use cookies or persistent identity.",
  "BOUNCE RATE": "The percentage of measured sessions with less than 10 seconds of active time, less than 50% scroll depth and no key event. It is 100% minus the session engagement rate.",
  "AVERAGE ACTIVE SESSION DURATION": "The mean visible, active foreground time across measured anonymous sessions. Inactive background time is excluded.",
  "MEDIAN ACTIVE SESSION DURATION": "The middle active-session duration after measured anonymous sessions are ordered from shortest to longest.",
  P75: "The 75th percentile: 75% of recorded visits were at or faster than this value.",
  LCP: "Largest Contentful Paint measures how quickly the page's main content appears.",
  TBT: "Total Blocking Time estimates how long the browser's main thread was blocked during a lab test.",
  INP: "Interaction to Next Paint measures real-user responsiveness after a click, tap or keyboard interaction.",
  CLS: "Cumulative Layout Shift measures unexpected movement of visible page content.",
  FCP: "First Contentful Paint measures how quickly the first visible content appears.",
};
const performanceTermLabels: Record<string, string> = {
  "SESSIONS": "Sessions",
  "BOUNCE RATE": "Bounce rate",
  "AVERAGE ACTIVE SESSION DURATION": "Average active session duration",
  "MEDIAN ACTIVE SESSION DURATION": "Median active session duration",
  P75: "75th percentile (p75)",
  LCP: "Largest Contentful Paint (LCP)",
  TBT: "Total Blocking Time (TBT)",
  INP: "Interaction to Next Paint (INP)",
  CLS: "Cumulative Layout Shift (CLS)",
  FCP: "First Contentful Paint (FCP)",
};

function MetricHelp({ term }: { term: string }) {
  const key = term.toUpperCase();
  const description = performanceTermDescriptions[key];
  const label = performanceTermLabels[key] || term;
  const helpId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== helpId) setOpen(false);
    };
    window.addEventListener("claritude:metric-help-open", closeOther);
    return () => window.removeEventListener("claritude:metric-help-open", closeOther);
  }, [helpId]);
  if (!description) return null;
  const toggle = () => {
    const next = !open;
    if (next) window.dispatchEvent(new CustomEvent("claritude:metric-help-open", { detail: helpId }));
    setOpen(next);
  };
  return (
    <span className={`metric-help ${open ? "open" : ""}`}>
      <button type="button" aria-label={`What does ${term} mean?`} title={`What does ${term} mean?`} aria-expanded={open} onClick={toggle}><Info /></button>
      {open && <span role="note"><b>{label}.</b> {description}</span>}
    </span>
  );
}

function MetricTerm({ term }: { term: string }) {
  return <span className="metric-term">{term}<MetricHelp term={term} /></span>;
}

export function performanceTargetStatus(metric: string, formattedValue: string | number) {
  const value = Number.parseFloat(String(formattedValue).replace(/[^\d.].*$/, ""));
  const targets: Record<string, { value: number; direction: "min" | "max" }> = {
    "Performance score": { value: 90, direction: "min" },
    LCP: { value: 2.5, direction: "max" },
    TBT: { value: 200, direction: "max" },
    INP: { value: 200, direction: "max" },
    CLS: { value: .1, direction: "max" },
    FCP: { value: 1.8, direction: "max" },
  };
  const target = targets[metric];
  if (!target || !Number.isFinite(value)) return "unknown";
  if (target.direction === "min") {
    if (value >= target.value) return "good";
    return value >= target.value * .95 ? "close" : "failed";
  }
  if (value <= target.value) return "good";
  return value <= target.value * 1.1 ? "close" : "failed";
}

function PerformanceTarget({ metric, value, target }: { metric: string; value: string | number; target: string }) {
  const status = performanceTargetStatus(metric, value);
  const label = status === "good" ? "Meets target" : status === "close" ? "Close to target" : status === "failed" ? "Does not meet target" : "Target status unavailable";
  return <span className="performance-target">{target.replace(/\s*●\s*$/, "")}<i className={status} aria-label={label} title={label} /></span>;
}

export function performanceTargetLabel(metric: string) {
  const targets: Record<string, string> = {
    LCP: "≤ 2.5 s",
    INP: "≤ 200 ms",
    CLS: "≤ 0.1",
    FCP: "≤ 1.8 s",
    TBT: "≤ 200 ms",
  };
  return targets[metric.toUpperCase()] || "Observed";
}

function RealUserPerformanceTable({ data, device }: { data: any; device: "desktop" | "mobile" }) {
  const source = data?.[device];
  const performance = source?.performance;
  const vitals = performance?.vitals || [];
  if (!vitals.length)
    return (
      <EmptyCompact
        title="Awaiting real-user performance samples"
        detail="No field Core Web Vitals were recorded for this device in the selected period."
      />
    );
  return (
    <>
      <DataTable
        headers={["Metric", "Value", "Target", "Samples"]}
        headerHelp={{ 1: <MetricHelp term="P75" /> }}
        rows={vitals.map((vital: any) => [
          <MetricTerm key={vital.name} term={vital.name} />,
          formatVital(vital.name, vital.value),
          <PerformanceTarget
            key={`${vital.name}-target`}
            metric={vital.name}
            value={formatVital(vital.name, vital.value)}
            target={performanceTargetLabel(vital.name)}
          />,
          fmt(vital.samples || 0),
        ])}
      />
      {source?.from && source?.to && (
        <p className="subtle">Reporting range: {fmtDate(source.from)} to {fmtDate(source.to)} · page-specific 75th-percentile field observations.</p>
      )}
      {vitals.some((vital: any) => vital.samples < (performance.minimumSamples || 1)) && (
        <p className="subtle">No valid observation has been received for one or more metrics. INP requires an eligible user interaction.</p>
      )}
    </>
  );
}
function ActivityList({ property }: { property: Property }) {
  const items = [
    [
      property.uptime_monitors?.[0]?.last_checked_at,
      "Uptime check completed",
      property.uptime_monitors?.[0]?.last_status,
    ],
    [
      property.audit_runs?.[0]?.created_at,
      "Audit run completed",
      property.audit_runs?.[0]?.status,
    ],
    [
      property.tracking_last_received_at,
      "Analytics event received",
      "accepted",
    ],
  ].filter((x) => x[0]);
  return (
    <ul className="activity-list">
      {items.map((x, i) => (
        <li key={i}>
          <i className="status-dot online" />
          <span>
            <b>{x[1]}</b>
            <small>
              {relative(String(x[0]))} · {cap(String(x[2]))}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}
function SetupPanel({ property }: { property: Property }) {
  const checks = propertyOnboardingChecks(property);
  return (
    <Panel title="Onboarding checklist">
      <div className="onboarding-list large">
        {checks.map((check) => (
          <span className={check.complete ? "complete" : "pending"} key={check.label}>
            {check.complete ? <CheckCircle2 /> : <CircleAlert />}
            <b>{check.label}</b>
            <small>{check.detail}</small>
          </span>
        ))}
      </div>
      {!checks.every((check) => check.complete) && (
        <div className="settings-actions">
          {!property.tracking_last_received_at && <Link className="btn" to={`/settings?property=${property.id}&settingsTab=Tracking`}>Install tracking</Link>}
          {!property.uptime_monitors?.[0]?.last_checked_at && <Link className="btn" to={`/uptime?property=${property.id}`}>Check uptime</Link>}
          {!property.audit_runs?.some((run) => ["completed", "partial"].includes(run.status)) && <Link className="btn" to={`/audit?property=${property.id}`}>Run first audit</Link>}
        </div>
      )}
    </Panel>
  );
}
function Preferences({
  session,
  profile,
  reload,
  notify,
}: {
  session: Session | null;
  profile: any;
  reload: () => void;
  notify: Notify;
}) {
  const labels: [string, string][] = [
    ["monitor_incidents", "Monitor incidents"],
    ["recoveries", "Recoveries"],
    ["tracking_problems", "Tracking problems"],
    ["audit_issues", "Audit issues"],
    ["billing_subscription", "Billing & subscription"],
    ["account_security", "Account security"],
  ];
  const stored = profile?.notification_preferences || {};
  const [preferences, setPreferences] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(labels.map(([key]) => [key, stored[key] !== false])),
  );
  async function update(key: string, checked: boolean) {
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    try {
      if (!session) throw new Error("Authentication required");
      await api(session, "/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ notification_preferences: next }),
      });
      notify("Notification preference saved");
      reload();
    } catch (error: any) {
      setPreferences(preferences);
      notify(error.message);
    }
  }
  return (
    <Panel title="Notification preferences">
      {labels.map(([key, label]) => (
        <label className="pref-row" key={key}>
          <input
            type="checkbox"
            checked={preferences[key] !== false}
            onChange={(event) => void update(key, event.target.checked)}
          />
          <span>
            <b>{label}</b>
            <small>Email and in-app notifications</small>
          </span>
        </label>
      ))}
    </Panel>
  );
}
function AdvancedRow({
  title,
  detail,
  action,
  danger = false,
}: {
  title: string;
  detail: string;
  action: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={`advanced-row ${danger ? "danger-zone" : ""}`}>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      {action}
    </div>
  );
}

const auditCategories = [
  "SEO",
  "Accessibility",
  "Performance",
  "Security",
  "Technical",
  "AI & Crawler Readiness",
];
const auditCategoryPrefixes: Record<string, string[]> = {
  SEO: ["SEO"],
  Accessibility: ["Accessibility"],
  Performance: ["Performance"],
  Security: ["Security"],
  Technical: ["Technical"],
  "AI & Crawler Readiness": ["AI & Crawler Readiness"],
};

export function auditRunCategoryScores(run?: AuditRun) {
  const performanceScores = run?.performance_metrics?.scores;
  const measuredPerformance = performanceScores && [performanceScores.desktop, performanceScores.mobile].some((score) => score != null)
    ? Math.round([performanceScores.desktop, performanceScores.mobile].filter((score): score is number => score != null).reduce((sum, score) => sum + score, 0) /
      [performanceScores.desktop, performanceScores.mobile].filter((score) => score != null).length)
    : null;
  return Object.fromEntries(
    auditCategories.map((category) => [
      category,
      category === "Performance" && measuredPerformance != null
        ? measuredPerformance
        : run?.category_scores?.[category] ?? auditCategoryScore(run?.user_facing_results || run?.audit_results, auditCategoryPrefixes[category]),
    ]),
  ) as Record<string, number | null>;
}

function isAuditRunComplete(run?: AuditRun) {
  return Boolean(
    run &&
      (run.coverage ?? 0) >= 80 &&
      Object.values(auditRunCategoryScores(run)).every((score) => score != null),
  );
}

function fixtureAudit(
  property: Property | undefined,
  page: AuditPage = { id: "fixture-homepage", name: "Homepage", path: "/" },
  previous = false,
): AuditRun {
  const categoryPlan = [
    ["page.metadata", "SEO: Page Metadata", "SEO", 17, 2, 0],
    ["crawling.and.indexing", "SEO: Crawling and Indexing", "SEO", 20, 2, 1],
    ["content.structure.and.headings", "Content Structure and Headings", "SEO", 15, 1, 0],
    ["links.and.navigation", "Links and Navigation", "SEO", 29, 3, 1],
    ["images.and.media", "Images and Media", "SEO", 20, 2, 0],
    ["accessibility", "Accessibility", "Accessibility", 30, 3, 1],
    ["mobile.and.responsive.layout", "Mobile and Responsive Layout", "Performance", 12, 1, 0],
    ["performance", "Performance", "Performance", 28, 3, 1],
    ["security.and.browser.protections", "Security and Browser Protections", "Security", 23, 4, 1],
    ["server.and.http.information", "Server and HTTP Information", "Infrastructure", 12, 1, 2],
    ["dns.and.domain.configuration", "DNS and Domain Configuration", "Infrastructure", 19, 2, 2],
    ["structured.data", "Structured Data", "Infrastructure", 21, 2, 1],
    ["social.sharing.and.site.identity", "Social Sharing and Site Identity", "Infrastructure", 20, 2, 1],
    ["crawler.permissions", "AI Readiness: Crawler Permissions", "AI Readiness", 12, 1, 1],
    ["content.and.attribution", "AI Readiness: Content and Attribution", "AI Readiness", 16, 1, 1],
    ["optional.resources", "AI Readiness: Optional Resources", "AI Readiness", 12, 1, 2],
  ] as const;
  const featuredTitles: Record<string, string[]> = {
    "page.metadata": ["Meta description duplicated"],
    "crawling.and.indexing": ["Canonical target contains a noindex directive"],
    "links.and.navigation": ["Keyboard focus is hidden"],
    accessibility: ["Contact form label missing"],
    performance: ["Hero image discovered too late", "Unused JavaScript (71 KB)", "Cache lifetime too short"],
    "security.and.browser.protections": ["Content Security Policy missing"],
  };
  let criticals = 0;
  let resultId = 0;
  const generatedResults = categoryPlan.flatMap(([subcategory, label, category, checks, findings, info]) =>
    Array.from({ length: checks }, (_, index) => {
      resultId += 1;
      const isFinding = index < findings;
      const isInfo = index >= findings && index < findings + info;
      const securityCritical = category === "Security" && isFinding;
      const ordinaryCritical = isFinding && !securityCritical && criticals < 12;
      if (ordinaryCritical) criticals += 1;
      const outcome = isFinding ? (securityCritical || ordinaryCritical ? "failed" : "advisory") : isInfo ? "not_applicable" : "passed";
      const checkId = `fixture.${subcategory}.${index + 1}`;
      return {
        id: String(resultId),
        check_id: checkId,
        title: featuredTitles[subcategory]?.[index] || `${label} check ${index + 1}`,
        category,
        subcategory,
        outcome,
        severity: securityCritical || ordinaryCritical ? "critical" : isFinding ? "warning" : "informational",
        review_status: "not_reviewed",
        description: `This deterministic visual-test result exercises the production ${label} component.`,
        evidence: index === 0 && subcategory === "performance"
          ? { element: '<img src="/assets/hero-home.webp" loading="lazy">' }
          : { summary: `${label} evidence ${index + 1}` },
        recommendation: isFinding ? `Review and correct the affected ${label.toLowerCase()} implementation.` : "No corrective action is required.",
        source_reference: "https://developer.mozilla.org/",
      };
    }),
  );
  if (previous) {
    const resolvedIndex = generatedResults.findIndex((result) => result.outcome === "passed");
    generatedResults[0] = { ...generatedResults[0], outcome: "passed", severity: "informational" };
    generatedResults[resolvedIndex] = { ...generatedResults[resolvedIndex], outcome: "advisory", severity: "warning" };
  }
  const featuredOrder = [
    "Hero image discovered too late",
    "Contact form label missing",
    "Content Security Policy missing",
    "Unused JavaScript (71 KB)",
    "Cache lifetime too short",
    "Meta description duplicated",
    "Keyboard focus is hidden",
  ];
  const auditResults = generatedResults.sort((left, right) => {
    const leftIndex = featuredOrder.indexOf(left.title);
    const rightIndex = featuredOrder.indexOf(right.title);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  });
  const pageOffset = page.name === "Contact" ? -37 : page.name === "About" ? -8 : 0;
  const comparisonOffset = previous ? -7 : 0;
  const userFacingResults = USER_FACING_AUDIT_GROUPS.map((group, groupIndex) => {
    const optional = group.weight === 0;
    const finding = !optional && (groupIndex + (previous ? 3 : 0)) % 11 === 0;
    const advisory = optional && groupIndex % 3 === 0;
    const outcome = finding ? "failed" : advisory ? "advisory" : "passed";
    const subfindings = group.technicalChecks.map((mapping, checkIndex) => ({
      result_id: `fixture-group-${groupIndex + 1}-${checkIndex + 1}`,
      check_id: mapping.checkId,
      title: `${group.name} technical check ${checkIndex + 1}`,
      outcome: checkIndex === 0 ? outcome : "passed",
      evidence_summary: checkIndex === 0 && outcome !== "passed"
        ? `Fixture evidence for ${group.name.toLowerCase()}`
        : "positively verified",
      occurrence_count: checkIndex === 0 && outcome !== "passed" ? 1 : 0,
      review_status: "not_reviewed",
    }));
    return {
      group_id: group.id,
      title: group.name,
      category: group.category,
      subcategory: group.subcategory,
      presentation_role: group.presentationRole,
      outcome_policy: group.outcomePolicy,
      outcome,
      severity: group.severity,
      weight: group.weight,
      source_reference: group.authoritativeReference,
      technical_check_ids: group.technicalChecks.map((mapping) => mapping.checkId),
      result_ids: subfindings.map((finding) => finding.result_id),
      evidence_summary: subfindings.map((finding) => `${finding.title}: ${finding.evidence_summary}`),
      subfindings,
      occurrences: outcome === "passed" ? [] : [{
        check_id: group.technicalChecks[0]?.checkId,
        check_title: subfindings[0]?.title,
        occurrence: { message: `Fixture occurrence for ${group.name.toLowerCase()}` },
      }],
      review_status: "not_reviewed",
    };
  });
  const categoryScores = {
    SEO: 94 + pageOffset + comparisonOffset,
    Performance: 82 + pageOffset + comparisonOffset,
    Accessibility: 91 + pageOffset + comparisonOffset,
    Security: 88 + pageOffset + comparisonOffset,
    Technical: 92 + pageOffset + comparisonOffset,
    "AI & Crawler Readiness": 84 + pageOffset + comparisonOffset,
  };
  return {
    id: `${page.id}-${previous ? "earlier" : "latest"}`,
    status: "completed",
    score: Math.max(0, (property?.demo?.audit ?? 87) + pageOffset + comparisonOffset),
    coverage: 100,
    audit_page_id: page.id,
    page_url: new URL(page.path, property?.url || "https://websi.com").href,
    created_at: new Date(previous ? "2026-09-01T09:00:00Z" : "2026-09-29T14:20:00Z").toISOString(),
    completed_at: new Date(previous ? "2026-09-01T09:00:03Z" : "2026-09-29T14:20:03Z").toISOString(),
    duration_ms: 2840,
    category_scores: categoryScores,
    performance_metrics: {
      desktop: [
        ["LCP", "2.1 s", "≤ 2.5 s ●"],
        ["TBT", "142 ms", "≤ 200 ms ●"],
        ["CLS", "0.02", "≤ 0.1 ●"],
        ["FCP", "1.4 s", "≤ 1.8 s ●"],
      ],
      mobile: [
        ["LCP", "3.4 s", "≤ 2.5 s ●"],
        ["TBT", "196 ms", "≤ 200 ms ●"],
        ["CLS", "0.03", "≤ 0.1 ●"],
        ["FCP", "1.9 s", "≤ 1.8 s ●"],
      ],
    },
    catalogue_summary: {
      catalogueSize: 306,
      implementedChecks: 306,
      snapshotChecks: 306,
      attemptedChecks: 306,
      successfullyExecutedChecks: 306,
      passedChecks: auditResults.filter((result) => result.outcome === "passed").length,
      userFacingGroups: userFacingResults.length,
    },
    registry_snapshot: auditResults.map((result) => ({ id: result.check_id })),
    audit_results: auditResults,
    user_facing_results: userFacingResults,
  };
}
function severity(value: string) {
  return value === "pass"
    ? "pass"
    : value === "warning"
      ? "warning"
      : "critical";
}

function fixtureAnalytics(property: Property) {
  const pageviews = property.demo?.pageviews || 0;
  const events = property.demo?.events || 0;
  const series = Array.from({ length: 30 }, (_, index) => ({
    day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    pageviews: Math.max(0, Math.round((pageviews / 30) * (0.72 + ((index * 17) % 41) / 100))),
    events: Math.max(0, Math.round((events / 30) * (0.7 + ((index * 11) % 45) / 100))),
  }));
  const desktopVitals = [
    { name: "LCP", value: 2300, samples: 742 },
    { name: "INP", value: 168, samples: 742 },
    { name: "CLS", value: 0.04, samples: 742 },
  ];
  const mobileVitals = [
    { name: "LCP", value: 2800, samples: 506 },
    { name: "INP", value: 186, samples: 506 },
    { name: "CLS", value: 0.05, samples: 506 },
  ];
  return {
    pageviews,
    events,
    keyEvents: events,
    performanceScore: property.demo?.performance ?? null,
    mobilePerformanceScore: property.demo?.performance ?? null,
    desktopPerformanceScore:
      property.demo?.performance != null
        ? Math.min(100, property.demo.performance + 14)
        : null,
    pages: [
      { path: "/", pageviews: Math.round(pageviews * 0.38), events: Math.round(events * 0.27) },
      { path: "/services/", pageviews: Math.round(pageviews * 0.22), events: Math.round(events * 0.2) },
      { path: "/work/", pageviews: Math.round(pageviews * 0.16), events: Math.round(events * 0.11) },
      { path: "/contact/", pageviews: Math.round(pageviews * 0.08), events: Math.round(events * 0.35) },
    ],
    series,
    vitals: desktopVitals,
    mobileVitals,
    desktopVitals,
  };
}

function auditCategoryScore(
  results: any[] | undefined,
  categoryPrefixes: string[],
) {
  const executed = (results || []).filter(
    (result) =>
      categoryPrefixes.some((prefix) =>
        String(result.category || "").startsWith(prefix),
      ) && ["passed", "advisory", "failed"].includes(result.outcome),
  );
  if (!executed.length) return null;
  const weighted = executed.map((result) => ({
    value: result.outcome === "passed" ? 1 : result.outcome === "advisory" ? 0.5 : 0,
    weight: Math.max(0, Number(result.weight ?? 1)),
  }));
  const totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
  if (!totalWeight) return null;
  const points = weighted.reduce(
    (total, item) => total + item.value * item.weight,
    0,
  );
  return Math.round((points / totalWeight) * 100);
}

function webVitalsScore(vitals: any[] | undefined) {
  if (!vitals?.length) return null;
  const known = new Map(vitals.map((vital) => [String(vital.name).toUpperCase(), Number(vital.value)]));
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    INP: [200, 500],
    CLS: [0.1, 0.25],
  };
  const scores = Object.entries(thresholds).flatMap(([name, [good, needsImprovement]]) => {
    const value = known.get(name);
    return Number.isFinite(value)
      ? [value! <= good ? 100 : value! <= needsImprovement ? 50 : 0]
      : [];
  });
  return scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : null;
}

function scoreState(score: number | null, unavailable: string) {
  return score == null ? unavailable : `${score} / 100`;
}

function propertyHealthScoreValue(score: number | null, unavailable: string) {
  return score == null ? unavailable : <>{score}<small className="health-score-total"> /100</small></>;
}

function formatVital(name: string, value: number) {
  if (name.toUpperCase() === "CLS") return Number(value).toFixed(2);
  if (name.toUpperCase() === "LCP") return `${(Number(value) / 1000).toFixed(1)} s`;
  return `${Math.round(Number(value))} ms`;
}

function downloadSeriesCsv(
  points: Array<{ label: string; value: number }>,
  filename: string,
  valueHeader: string,
) {
  const rows = [["Date", valueHeader], ...points.map((point) => [point.label, String(point.value)])];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const analyticsFilterParamKeys = [
  "pageSearch", "pathMode", "pathValue", "device", "source", "country", "browser",
  "eventName", "metric", "sourceType", "utmSource", "utmMedium", "utmCampaign",
] as const;

const emptyAnalyticsFilterOptions: AnalyticsFilterOptions = {
  paths: [], devices: [], sources: [], countries: [], browsers: [], eventNames: [], metrics: [],
  sourceTypes: [], utmSources: [], utmMediums: [], utmCampaigns: [],
};

const analyticsFilterConfigs: Record<string, { title: string; categories: string[]; scope: string }> = {
  Overview: { title: "Analytics overview", categories: ["Device", "Page", "Source", "Country", "Browser", "Event name", "UTM source", "UTM medium", "UTM campaign"], scope: "the whole analytics overview" },
  Pages: { title: "Pages", categories: ["Exact path / prefix", "Device", "Source", "Country"], scope: "this page table" },
  Sources: { title: "Sources", categories: ["Source", "Source type", "UTM source", "UTM medium", "UTM campaign", "Page", "Device"], scope: "this source table" },
  Events: { title: "Events", categories: ["Event name", "Page", "Source", "Device", "Country", "Browser"], scope: "this event table" },
  Audience: { title: "Audience", categories: ["Device", "Browser", "Country", "Page"], scope: "all audience breakdowns" },
  Engagement: { title: "Engagement", categories: ["Page", "Device", "Source", "Country"], scope: "all engagement panels" },
  Performance: { title: "Visitor performance", categories: ["Page", "Metric", "Device", "Browser", "Country"], scope: "this performance chart" },
};

function writeAnalyticsFilters(params: URLSearchParams, filters: AnalyticsPageFilters) {
  if (filters.pageSearch) params.set("pageSearch", filters.pageSearch);
  if (filters.pathMode && filters.pathValue) {
    params.set("pathMode", filters.pathMode);
    params.set("pathValue", filters.pathValue);
  }
  if (filters.device) params.set("device", filters.device);
  if (filters.source) params.set("source", filters.source);
  if (filters.country) params.set("country", filters.country);
  if (filters.browser) params.set("browser", filters.browser);
  if (filters.eventName) params.set("eventName", filters.eventName);
  if (filters.metric) params.set("metric", filters.metric);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.utmSource) params.set("utmSource", filters.utmSource);
  if (filters.utmMedium) params.set("utmMedium", filters.utmMedium);
  if (filters.utmCampaign) params.set("utmCampaign", filters.utmCampaign);
}

function analyticsFilterKey(category: string): keyof AnalyticsPageFilters | null {
  const keys: Record<string, keyof AnalyticsPageFilters> = {
    "Page": "pathValue",
    "Measured page": "pathValue",
    "Device": "device",
    "Source": "source",
    "Source / referrer": "source",
    "Country": "country",
    "Browser": "browser",
    "Event name": "eventName",
    "Metric": "metric",
    "Source type": "sourceType",
    "UTM source": "utmSource",
    "UTM medium": "utmMedium",
    "UTM campaign": "utmCampaign",
  };
  return keys[category] || null;
}

function analyticsFilterValues(category: string, options: AnalyticsFilterOptions): string[] {
  const values: Record<string, string[] | undefined> = {
    "Page": options.paths,
    "Measured page": options.paths,
    "Device": options.devices,
    "Source": options.sources,
    "Source / referrer": options.sources,
    "Country": options.countries,
    "Browser": options.browsers,
    "Event name": options.eventNames,
    "Metric": options.metrics,
    "Source type": options.sourceTypes,
    "UTM source": options.utmSources,
    "UTM medium": options.utmMediums,
    "UTM campaign": options.utmCampaigns,
  };
  return values[category] || [];
}

function analyticsFilterValueLabel(category: string, value: string) {
  if (category === "Country") return countryLabel(value);
  if (category === "Event name") return eventLabel(value);
  return ["Page", "Measured page", "Metric"].includes(category) ? value : cap(value);
}

function formatPercentage(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}%`;
}

function metricDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  mode: "percent" | "percentage points",
  improvementIsDecrease = false,
) {
  if (current == null || previous == null) return "";
  const raw = mode === "percent" && previous !== 0
    ? ((current - previous) / previous) * 100
    : current - previous;
  if (!Number.isFinite(raw)) return "";
  const direction = raw === 0 ? "→" : improvementIsDecrease ? (raw < 0 ? "↘" : "↗") : (raw > 0 ? "↗" : "↘");
  return `${direction} ${raw > 0 ? "+" : ""}${raw.toFixed(mode === "percentage points" ? 2 : 0)}${mode === "percent" ? "%" : "%"} vs previous period`;
}

export function eventLabel(value: string) {
  const known: Record<string, string> = {
    form_success: "Successful form submissions",
    "successful-form-submission": "Successful form submissions",
    outbound: "Outbound clicks",
  };
  if (known[value]) return known[value];
  const label = String(value || "Event").replaceAll(/[-_]+/g, " ");
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(label) ? label.toLocaleLowerCase() : label;
}

function shareRows(values: any[] = [], total = 0, iconKind?: string) {
  return values.map((row) => ({
    label: iconKind === "country" ? <CountryName code={row.name} /> : cap(String(row.name)),
    value: Number(row.count || 0),
    secondary: total ? `${Math.round(Number(row.count || 0) / total * 100)}%` : "0%",
    iconKind,
    iconValue: row.name,
  }));
}

function countryFlag(value: string) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)))
    : "";
}

export function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)} min ${String(rounded % 60).padStart(2, "0")} ${rounded % 60 === 1 ? "sec" : "secs"}`
    : `${rounded} ${rounded === 1 ? "sec" : "secs"}`;
}

export function pageActiveTimeLabel(seconds: number) {
  if (!Number.isFinite(seconds)) return "Unavailable";
  const safe = Math.max(0, seconds);
  if (safe < 10) return `${safe.toFixed(1)} s`;
  const rounded = Math.round(safe);
  if (rounded === 60) return "60 s";
  return rounded >= 60
    ? `${Math.floor(rounded / 60)} min ${String(rounded % 60).padStart(2, "0")} s`
    : `${rounded} s`;
}

function vitalMetricValue(vital: any, minimumSamples: number) {
  return !vital || vital.samples < minimumSamples ? "Unavailable" : formatVital(vital.name, vital.value);
}

function vitalMetricSamples(vital: any, minimumSamples: number) {
  if (!vital) return "No samples";
  return vital.samples < minimumSamples ? `${fmt(vital.samples)} of ${fmt(minimumSamples)} required samples` : `${fmt(vital.samples)} samples · p75`;
}

function formatChartAxis(value: number, unit: string) {
  if (unit.trim() === "ms" && value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value).toLocaleString()}${unit.trim() === "ms" ? " ms" : ""}`;
}

function formatChartTooltip(value: number, unit: string) {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: unit ? 0 : 2 })}${unit}`;
}

function chartDateLabel(value: string, timeZone?: string, granularity?: "check" | "hour" | "day" | "month") {
  if (value.includes("T")) {
    const instant = new Date(value);
    return Number.isFinite(instant.valueOf())
      ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone }).format(instant)
      : value;
  }
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", granularity === "month"
    ? { month: "short", year: "numeric" }
    : { day: "numeric", month: "short" }).format(date);
}

const ANALYTICS_FIXTURE_PAGES = [
  { path: "/", pageviews: 10840, events: 96, device: "desktop", source: "Google", country: "GB", browser: "Chrome", sourceType: "Search", utmSource: "google", utmMedium: "organic", utmCampaign: "september-launch" },
  { path: "/services/", pageviews: 6320, events: 72, device: "desktop", source: "Google", country: "GB", browser: "Chrome", sourceType: "Search", utmSource: "google", utmMedium: "cpc", utmCampaign: "september-launch" },
  { path: "/work/", pageviews: 4610, events: 41, device: "desktop", source: "Direct", country: "GB", browser: "Safari", sourceType: "Direct", utmSource: "", utmMedium: "", utmCampaign: "" },
  { path: "/contact/", pageviews: 2140, events: 124, device: "mobile", source: "Google", country: "US", browser: "Safari", sourceType: "Search", utmSource: "google", utmMedium: "cpc", utmCampaign: "september-launch" },
  { path: "/insights/", pageviews: 1880, events: 25, device: "mobile", source: "LinkedIn", country: "GB", browser: "Chrome", sourceType: "Social", utmSource: "linkedin", utmMedium: "social", utmCampaign: "september-launch" },
  { path: "/privacy/", pageviews: 980, events: 0, device: "desktop", source: "Direct", country: "GB", browser: "Edge", sourceType: "Direct", utmSource: "", utmMedium: "", utmCampaign: "" },
  { path: "/terms/", pageviews: 720, events: 0, device: "mobile", source: "Direct", country: "US", browser: "Safari", sourceType: "Direct", utmSource: "", utmMedium: "", utmCampaign: "" },
  { path: "/about/", pageviews: 610, events: 0, device: "tablet", source: "Google", country: "DE", browser: "Firefox", sourceType: "Search", utmSource: "google", utmMedium: "organic", utmCampaign: "" },
  { path: "/video/", pageviews: 360, events: 0, device: "mobile", source: "LinkedIn", country: "DE", browser: "Chrome", sourceType: "Social", utmSource: "linkedin", utmMedium: "social", utmCampaign: "" },
];

function analyticsFixtureSummary() {
  const series = Array.from({ length: 30 }, (_, index) => ({
    day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    pageviews: 620 + ((index * 97) % 610),
    events: 6 + ((index * 7) % 19),
    dailyVisitors: 360 + ((index * 31) % 230),
  }));
  const performanceSeries = {
    LCP: series.map((point, index) => ({ day: point.day, value: 1950 + ((index * 83) % 620), samples: 35 + (index % 14) })),
    INP: series.map((point, index) => ({ day: point.day, value: 135 + ((index * 17) % 95), samples: 22 + (index % 9) })),
    CLS: series.map((point, index) => ({ day: point.day, value: 0.025 + ((index * 7) % 5) / 100, samples: 35 + (index % 14) })),
  };
  return {
    pageviews: 28460,
    events: 358,
    keyEvents: 358,
    sessions: 14220,
    averageDailyVisitors: 474,
    dailyVisitorMethod: "anonymous_sessions",
    pages: ANALYTICS_FIXTURE_PAGES.map(({ path, pageviews, events }, index) => ({
      path,
      pageviews,
      events,
      averageActiveSeconds: 38 + ((index * 17) % 94),
    })),
    series,
    previous: {
      pageviews: 25320,
      keyEvents: 334,
      sessions: 13120,
      countries: [{ name: "GB", count: 17200 }, { name: "US", count: 3600 }, { name: "DE", count: 2700 }],
      devices: [{ name: "Desktop", count: 15800 }, { name: "Mobile", count: 8800 }, { name: "Tablet", count: 720 }],
      engagement: {
        engagedSessions: 8120,
        bounceRate: 38.1,
        averageActiveSessionSeconds: 88,
        medianActiveSessionSeconds: 64,
        engagedPageviews: 16980,
        averageActiveSeconds: 84,
      },
      series: series.map((point, index) => ({ ...point, day: `2026-08-${String(index + 1).padStart(2, "0")}`, pageviews: Math.round(point.pageviews * 0.89), events: Math.round(point.events * 0.91), dailyVisitors: Math.round(point.dailyVisitors * 0.92) })),
      performance: {
        vitals: [
          { name: "LCP", value: 2480, samples: 1180, percentile: 75 },
          { name: "INP", value: 181, samples: 701, percentile: 75 },
          { name: "CLS", value: 0.05, samples: 1180, percentile: 75 },
        ],
        goodExperiencesPercent: 78,
        series: Object.fromEntries(Object.entries(performanceSeries).map(([metric, points]) => [metric, points.map((point: any, index) => ({ ...point, day: `2026-08-${String(index + 1).padStart(2, "0")}`, value: point.value * 1.08 }))])),
      },
    },
    sources: [
      { name: "Google", pageviews: 10020, events: 142 },
      { name: "Direct / unknown", pageviews: 8120, events: 92 },
      { name: "LinkedIn", pageviews: 3260, events: 41 },
      { name: "Instagram", pageviews: 2190, events: 29 },
      { name: "Other referrals", pageviews: 4870, events: 54 },
    ],
    countries: [{ name: "GB", count: 19353 }, { name: "US", count: 3984 }, { name: "DE", count: 2846 }, { name: "Unknown", count: 2277 }],
    devices: [{ name: "Desktop", count: 17645 }, { name: "Mobile", count: 9961 }, { name: "Tablet", count: 854 }],
    browsers: [{ name: "Chrome", count: 16507 }, { name: "Safari", count: 7684 }, { name: "Edge", count: 2846 }, { name: "Firefox", count: 1423 }],
    screens: [{ name: "Large · 1280px+", count: 14515 }, { name: "Medium · 768–1279px", count: 3984 }, { name: "Small · under 768px", count: 9961 }],
    eventBreakdown: [
      { name: "successful-form-submission", count: 124 },
      { name: "downloads", count: 86 },
      { name: "telephone-clicks", count: 68 },
      { name: "outbound-clicks", count: 30 },
      ...Array.from({ length: 21 }, (_, index) => ({ name: `custom-event-${index + 1}`, count: index < 8 ? 3 : 2 })),
    ],
    engagement: {
      eligiblePageviews: 28460,
      engagedPageviews: 18402,
      medianScrollDepth: 64,
      pageviewsWithKeyEvents: 318,
      medianActiveSeconds: 102,
      averageActiveSeconds: 118,
      engagementRate: 64.7,
      eligibleSessions: 14220,
      engagedSessions: 9450,
      sessionEngagementRate: 66.5,
      bounceRate: 33.5,
      averageActiveSessionSeconds: 96,
      medianActiveSessionSeconds: 72,
      javascriptErrors: 36,
      scrollDepth: [{ depth: 25, pageviews: 21320 }, { depth: 50, pageviews: 16840 }, { depth: 75, pageviews: 10260 }, { depth: 90, pageviews: 6740 }],
      pages: [
        { path: "/services/", engagedViews: 4820 },
        { path: "/work/", engagedViews: 3940 },
        { path: "/contact/", engagedViews: 1740 },
        { path: "/insights/", engagedViews: 1480 },
        ...Array.from({ length: 21 }, (_, index) => ({ path: `/guide-${index + 1}/`, engagedViews: 300 - index * 8 })),
      ],
      visibleSections: [{ name: "services", count: 13250 }],
      visitTimes: Array.from({ length: 7 * 24 }, (_, index) => {
        const weekday = Math.floor(index / 24);
        const hour = index % 24;
        const workingHour = hour >= 7 && hour <= 21;
        const pageCount = workingHour ? 8 + ((weekday * 19 + hour * 13) % 74) : (weekday + hour) % 5;
        return { weekday, hour, visitors: Math.round(pageCount * 0.72), visitorsComplete: true, pageCount };
      }),
      collectionStatus: "available",
    },
    vitals: [
      { name: "LCP", value: 2300, samples: 1248 },
      { name: "INP", value: 168, samples: 1109 },
      { name: "CLS", value: 0.04, samples: 1248 },
    ],
    performance: {
      vitals: [
        { name: "LCP", value: 2300, samples: 1248, percentile: 75 },
        { name: "INP", value: 168, samples: 742, percentile: 75 },
        { name: "CLS", value: 0.04, samples: 1248, percentile: 75 },
      ],
      series: performanceSeries,
      eligibleGoodExperienceViews: 1040,
      goodExperiencesPercent: 83,
      minimumSamples: 75,
      method: "p75",
    },
    filterOptions: {
      paths: ANALYTICS_FIXTURE_PAGES.map((page) => page.path),
      devices: ["desktop", "mobile", "tablet"],
      sources: ["Direct", "Google", "LinkedIn"],
      countries: ["DE", "GB", "US"],
      browsers: ["Chrome", "Edge", "Firefox", "Safari"],
      eventNames: ["downloads", "email-clicks", "outbound-clicks", "successful-form-submission", "telephone-clicks"],
      metrics: ["CLS", "INP", "LCP"],
      sourceTypes: ["Direct", "Referral", "Search", "Social"],
      utmSources: ["google", "linkedin", "instagram"],
      utmMediums: ["cpc", "organic", "social"],
      utmCampaigns: ["september-launch"],
    },
  };
}

function filterAnalyticsFixture(filters: AnalyticsPageFilters) {
  const summary = analyticsFixtureSummary();
  if (!hasAnalyticsPageFilters(filters)) return summary;
  const pageSearch = filters.pageSearch?.trim().toLocaleLowerCase();
  const normalizedPathValue = filters.pathValue
    ? normalisePagePath(filters.pathValue).toLocaleLowerCase()
    : "";
  const pathValue = filters.pathMode === "prefix" && normalizedPathValue !== "/"
    ? normalizedPathValue.replace(/\/$/, "")
    : normalizedPathValue;
  const rows = ANALYTICS_FIXTURE_PAGES.filter((page) => {
    const path = page.path.toLocaleLowerCase();
    if (pageSearch && !path.includes(pageSearch)) return false;
    if (pathValue && filters.pathMode === "exact" && path !== pathValue) return false;
    if (pathValue && filters.pathMode === "prefix" && !path.startsWith(pathValue)) return false;
    if (filters.device && page.device !== filters.device.toLocaleLowerCase()) return false;
    if (filters.source && page.source !== filters.source) return false;
    if (filters.country && page.country !== filters.country) return false;
    if (filters.browser && page.browser !== filters.browser) return false;
    if (filters.sourceType && page.sourceType !== filters.sourceType) return false;
    if (filters.utmSource && page.utmSource !== filters.utmSource) return false;
    if (filters.utmMedium && page.utmMedium !== filters.utmMedium) return false;
    if (filters.utmCampaign && page.utmCampaign !== filters.utmCampaign) return false;
    return true;
  });
  const pageviews = rows.reduce((sum, page) => sum + page.pageviews, 0);
  const rowEvents = rows.reduce((sum, page) => sum + page.events, 0);
  const eventBreakdown = filters.eventName
    ? summary.eventBreakdown.filter((event) => event.name === filters.eventName)
    : summary.eventBreakdown;
  const events = filters.eventName
    ? eventBreakdown.reduce((sum, event) => sum + event.count, 0)
    : rowEvents;
  const aggregate = (field: string, key: string) => {
    const values = new Map<string, number>();
    for (const row of rows as Record<string, any>[]) {
      const name = String(row[field] || "Unknown");
      values.set(name, (values.get(name) || 0) + Number(row[key] || 0));
    }
    return [...values].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count);
  };
  const pageviewRatio = summary.pageviews ? pageviews / summary.pageviews : 0;
  const eventRatio = summary.events ? events / summary.events : 0;
  return {
    ...summary,
    pageviews,
    events,
    keyEvents: events,
    sessions: Math.round(summary.sessions * pageviewRatio),
    pages: rows.map((row) => ({
      path: row.path,
      pageviews: row.pageviews,
      events: row.events,
      averageActiveSeconds: 38 + ((ANALYTICS_FIXTURE_PAGES.indexOf(row) * 17) % 94),
    })),
    sources: rows.map((row) => ({ name: row.source === "Direct" ? "Direct / unknown" : row.source, pageviews: row.pageviews, events: row.events })),
    countries: aggregate("country", "pageviews"),
    devices: aggregate("device", "pageviews"),
    browsers: aggregate("browser", "pageviews"),
    eventBreakdown,
    series: summary.series.map((point) => ({
      ...point,
      pageviews: Math.round(point.pageviews * pageviewRatio),
      events: Math.round(point.events * eventRatio),
      dailyVisitors: Math.round(point.dailyVisitors * pageviewRatio),
    })),
    performance: {
      ...summary.performance,
      vitals: filters.metric
        ? summary.performance.vitals.filter((vital) => vital.name === filters.metric)
        : summary.performance.vitals,
      series: filters.metric
        ? { [filters.metric]: (summary.performance.series as Record<string, any[]>)[filters.metric] || [] }
        : summary.performance.series,
    },
  };
}

function analyticsPageFiltersFromParams(params: URLSearchParams): AnalyticsPageFilters {
  const pathMode = params.get("pathMode");
  return {
    pageSearch: params.get("pageSearch") || undefined,
    pathMode: pathMode === "exact" || pathMode === "prefix" ? pathMode : undefined,
    pathValue: params.get("pathValue") || undefined,
    device: params.get("device") || undefined,
    source: params.get("source") || undefined,
    country: params.get("country") || undefined,
    browser: params.get("browser") || undefined,
    eventName: params.get("eventName") || undefined,
    metric: params.get("metric") || undefined,
    sourceType: params.get("sourceType") || undefined,
    utmSource: params.get("utmSource") || undefined,
    utmMedium: params.get("utmMedium") || undefined,
    utmCampaign: params.get("utmCampaign") || undefined,
  };
}

function analyticsPageFilterQuery(filters: AnalyticsPageFilters) {
  const params = new URLSearchParams();
  if (filters.pageSearch) params.set("page_search", filters.pageSearch);
  if (filters.pathMode && filters.pathValue) {
    params.set("path_mode", filters.pathMode);
    params.set("path_value", filters.pathValue);
  }
  if (filters.device) params.set("device", filters.device);
  if (filters.source) params.set("source", filters.source);
  if (filters.country) params.set("country", filters.country);
  if (filters.browser) params.set("browser", filters.browser);
  if (filters.eventName) params.set("event_name", filters.eventName);
  if (filters.metric) params.set("metric", filters.metric);
  if (filters.sourceType) params.set("source_type", filters.sourceType);
  if (filters.utmSource) params.set("utm_source", filters.utmSource);
  if (filters.utmMedium) params.set("utm_medium", filters.utmMedium);
  if (filters.utmCampaign) params.set("utm_campaign", filters.utmCampaign);
  return params.toString();
}

function hasAnalyticsPageFilters(filters: AnalyticsPageFilters) {
  return Boolean(
    filters.pageSearch ||
      filters.pathValue ||
      filters.device ||
      filters.source ||
      filters.country ||
      filters.browser ||
      filters.eventName ||
      filters.metric ||
      filters.sourceType ||
      filters.utmSource ||
      filters.utmMedium ||
      filters.utmCampaign,
  );
}

function normalisePagePath(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const pathname = new URL(clean, "https://invalid.local").pathname || "/";
    const collapsed = `/${pathname.split("/").filter(Boolean).join("/")}`;
    return collapsed === "/" ? "/" : `${collapsed}/`;
  } catch {
    return "";
  }
}

function countryLabel(value: string) {
  const code = value.toUpperCase() === "UK" ? "GB" : value.toUpperCase();
  if (code === "UNKNOWN") return "Unknown";
  if (!/^[A-Z]{2}$/.test(code)) return value;
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) || value;
  } catch {
    return value;
  }
}
function CountryName({ code }: { code: string }) {
  const short = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
  return <><span className="country-name-desktop">{countryLabel(code)}</span><span className="country-name-mobile">{short === "UNKNOWN" ? "—" : short}</span></>;
}

function fmt(x: number) {
  return new Intl.NumberFormat("en-GB").format(x || 0);
}
function fmtDate(x: string) {
  const locale = activeDateFormat === "MM/DD/YYYY" ? "en-US" : activeDateFormat === "YYYY-MM-DD" ? "en-CA" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: activeDisplayTimezone,
  }).format(new Date(x));
}
function shortDate(x: string) {
  const value = new Date(`${x}T12:00:00`);
  if (activeDateFormat === "YYYY-MM-DD") return x;
  if (activeDateFormat === "MM/DD/YYYY")
    return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
  if (activeDateFormat === "DD/MM/YYYY")
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: value.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(value);
}
export function periodLabel(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const day = (value: Date) => value.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = (value: Date) => months[value.getMonth()];
  if (from === to) return `${day(start)} ${month(start)} ${start.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth())
      return `${day(start)} – ${day(end)} ${month(end)} ${end.getFullYear()}`;
    return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${end.getFullYear()}`;
  }
  return `${day(start)} ${month(start)} ${start.getFullYear()} – ${day(end)} ${month(end)} ${end.getFullYear()}`;
}
function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
function relative(x: string) {
  const s = Math.max(
    1,
    Math.round((Date.now() - new Date(x).getTime()) / 1000),
  );
  return s < 60
    ? `${s} seconds ago`
    : s < 3600
      ? `${Math.floor(s / 60)} minutes ago`
      : s < 86400
        ? `${Math.floor(s / 3600)} hours ago`
        : `${Math.floor(s / 86400)} days ago`;
}
function cap(x: string) {
  return x ? x.charAt(0).toUpperCase() + x.slice(1).replaceAll("_", " ") : "—";
}
