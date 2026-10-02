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
  LayoutGrid,
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
  SquareCheckBig,
  Smartphone,
  Tablet,
  TriangleAlert,
  Users,
  Eye,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
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
  category_scores?: Record<string, number>;
  performance_metrics?: {
    desktop?: (string | number)[][];
    mobile?: (string | number)[][];
  };
  catalogue_summary?: {
    catalogueSize: number;
    implementedChecks: number;
    snapshotChecks: number;
    attemptedChecks: number;
    successfullyExecutedChecks: number;
    passedChecks: number;
  };
};
type AuditPage = {
  id: string;
  property_id?: string;
  name: string;
  path: string;
};
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
type Bootstrap = {
  profile: any;
  accounts: any[];
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
    [toast, setToast] = useState(""),
    [addOpen, setAddOpen] = useState(false),
    [workspaceOpen, setWorkspaceOpen] = useState(false),
    [workspaceName, setWorkspaceName] = useState(""),
    [helpOpen, setHelpOpen] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const allProperties = data.properties;
  const requestedWorkspace = new URLSearchParams(loc.search).get("workspace");
  const requested = new URLSearchParams(loc.search).get("property");
  const property =
    allProperties.find((p) => p.id === requested) ||
    (loc.pathname !== "/" && loc.pathname !== "/notifications"
      ? allProperties[0]
      : undefined);
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
    loc.pathname === "/" || loc.pathname === "/notifications";
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
  const href = (path: string, id = property?.id) =>
    `/${path}${id ? `?property=${id}` : ""}`;
  const title = workspaceContext
    ? "Overview"
    : section === "account"
      ? "Account settings"
      : section === "settings"
        ? "Property settings"
        : cap(section);
  const alertsSnoozed = data.profile?.alerts_snoozed_until &&
    new Date(data.profile.alerts_snoozed_until).valueOf() > Date.now();
  const warning = alertsSnoozed
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
    : property?.verification_status !== "verified"
      ? {
          title: "Property verification is incomplete",
          detail:
            "Verify ownership to confirm installation and unlock trusted status.",
        }
      : property && !property.tracking_last_received_at
        ? {
            title: "Analytics is not receiving data",
            detail: "Install the tracking snippet or run the guided test.",
          }
        : data.notifications[0]
          ? {
              title: data.notifications[0].title,
              detail: data.notifications[0].body,
            }
          : null;
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
    if (!workspaceMenu && !propertyMenu) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorkspaceMenu(false);
      setPropertyMenu(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [workspaceMenu, propertyMenu]);
  async function snoozeAlerts() {
    if (!session) return;
    try {
      await api(session, "/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          full_name: data.profile?.full_name,
          timezone: data.profile?.timezone,
          alerts_snoozed_until: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      });
      notify("Alerts snoozed for one hour");
      reload();
    } catch (error: any) {
      notify(error.message);
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
          <b>{fixture ? "Websi workspace" : workspace.name || "Shared properties"}</b>
          <span className="badge">{fixture ? "Scale" : "Pro"}</span>
          <img className="selector-chevrons" src="/assets/chevrons-up-down.svg" alt="" />
        </button>
        <button
          className="selector selector-button"
          aria-expanded={propertyMenu}
          onClick={() => {
            setWorkspaceMenu(false);
            setPropertyMenu((v) => !v);
          }}
        >
          <span className="favicon">
            {property ? (
              <img src="/assets/websi-mark.svg" alt="" />
            ) : (
              <Globe2 />
            )}
          </span>
          <b>{property ? property.canonical_host : "Your properties"}</b>
          <span className="spacer" />
          <img className="selector-chevrons" src="/assets/chevrons-up-down.svg" alt="" />
        </button>
        <div className="page-title">{title}</div>
        <div className="brand">
          <img src="/assets/claritude-logo.svg" alt="Claritude" />
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
        <aside className={mobile ? "open" : ""}>
          <nav>
            {workspaceContext ? (
              <>
                <Link
                  className={section === "workspace" ? "active" : ""}
                  to="/"
                >
                  <Home />
                  Overview
                </Link>
                <Link
                  className={section === "notifications" ? "active" : ""}
                  to="/notifications"
                >
                  <Bell />
                  Notifications
                </Link>
              </>
            ) : (
              <>
                <Link to="/">
                  <LayoutGrid />
                  Your properties
                </Link>
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
          <div className="nav-bottom">
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
                <Link to={href("account")} onClick={() => setUserMenu(false)}>
                  <Users />
                  Account settings
                </Link>
                <button onClick={onSignOut}>
                  <LogOut />
                  Sign out
                </button>
              </div>
            )}
            <div className="user">
              <Link className="user-identity" to={href("account")}>
                <span className="avatar user-avatar">
                  {(data.profile?.full_name || "C")[0]}
                </span>
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
                to="/notifications"
              >
                <Bell />
                {(fixture
                  ? 5
                  : data.notifications.filter((notification: any) => !notification.read_at).length
                ) > 0 && (
                  <i className="notif-count">
                    {fixture
                      ? 5
                      : data.notifications.filter((notification: any) => !notification.read_at).length}
                  </i>
                )}
              </Link>
            </div>
          </div>
        </aside>
        <main onClick={() => setMobile(false)}>
          {warning && (
            <div className="warning">
              <i className="dot" />
              <b>{warning.title}</b>
              <span className="subtle">{warning.detail}</span>
              <span className="warning-actions">
                <Link
                  className="text-link"
                  to={workspaceContext ? "/notifications" : href("audit")}
                >
                  Review notification
                </Link>
                <button
                  className="text-link"
                  onClick={snoozeAlerts}
                >
                  Snooze alerts
                </button>
              </span>
            </div>
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
                />
              }
            />
            <Route
              path="/overview"
              element={
                <PropertyOverview
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
                {p.id === "fixture-property" ? (
                  <img src="/assets/websi-mark.svg" alt="" />
                ) : (
                  p.name[0]
                )}
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
    [filter, setFilter] = useState("All"),
    [page, setPage] = useState(1),
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
    if (fixture || !session || !properties.length) return;
    let cancelled = false;
    Promise.all(
      properties.map(async (property) => {
        try {
          const monitor = property.uptime_monitors?.[0];
          const [summary, checks] = await Promise.all([
            api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}`),
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
  const filtered = properties.filter(
    (p) =>
      (p.name + p.canonical_host).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" || p.uptime_monitors?.[0]?.last_status === filter),
  );
  const shown = filtered.slice((page - 1) * 7, page * 7);
  const totals = properties.reduce(
    (a, p) => ({
      views: a.views + (measured[p.id]?.pageviews || 0),
      events: a.events + (measured[p.id]?.keyEvents || measured[p.id]?.events || 0),
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
      title="Your properties"
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
        <>
          <Metrics
            values={[
              [
                "Properties",
                properties.length,
                `${properties.filter((p) => p.uptime_monitors?.[0]?.last_status === "online").length} online · ${properties.filter((p) => p.uptime_monitors?.[0]?.last_status === "offline").length} down · ${properties.filter((p) => p.uptime_monitors?.[0]?.last_status === "paused").length} paused`,
              ],
              [
                "Properties down",
                properties.filter(
                  (p) => p.uptime_monitors?.[0]?.last_status === "offline",
                ).length,
                fixture ? "North Commerce" : "Latest state",
              ],
              [
                "Pageviews",
                fmt(totals.views),
                fixture ? "↗ 12.8%" : "Accepted pageviews across this workspace",
              ],
              [
                "Key events",
                fmt(totals.events),
                fixture ? "↗ 8.2%" : "Configured events across this workspace",
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
                <div className="action-menu filter-action-menu">
                  <b>Monitor status</b>
                  {["All", "online", "offline", "paused", "pending"].map((value) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      onClick={() => { setFilter(value); setPage(1); setFilterOpen(false); }}
                    >
                      <Status value={value} />
                      {filter === value && <Check />}
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
              {filter !== "All" && (
                <span className="filter-chip">
                  Monitor: {cap(filter)}{" "}
                  <button onClick={() => setFilter("All")}>
                    <X />
                  </button>
                </span>
              )}
              <span className="subtle">Filters affect this property table</span>
            </div>
            <DataTable
              headers={[
                "Property",
                "Monitor status",
                "Uptime",
                "Pageviews",
                "Key events",
                "Audit",
                "Performance",
                "Tracking status",
                "",
              ]}
              rows={shown.map((p) => [
                <Link
                  className="project-cell"
                  to={`/overview?property=${p.id}`}
                >
                  <span className="favicon project-icon">
                    {p.id === "fixture-property" ? (
                      <img src="/assets/websi-mark.svg" alt="" />
                    ) : (
                      p.name[0]
                    )}
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
                  ? `${Number(measured[p.id].availability).toFixed(2)}%`
                  : "Pending",
                measured[p.id] ? fmt(measured[p.id].pageviews || 0) : "Pending",
                measured[p.id]
                  ? fmt(measured[p.id].keyEvents || measured[p.id].events || 0)
                  : "Pending",
                p.audit_runs?.[0]?.score
                  ? `${p.audit_runs[0].score} / 100`
                  : "—",
                scoreState(
                  measured[p.id]?.performanceScore ??
                    webVitalsScore(measured[p.id]?.vitals),
                  "Awaiting field data",
                ),
                p.tracking_last_received_at
                  ? "Receiving data"
                  : "Not installed",
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
                Showing {(page - 1) * 7 + 1}–
                {Math.min(page * 7, filtered.length)} of {filtered.length}
              </span>
              <div className="pagination">
                <button onClick={() => setPage(Math.max(1, page - 1))}>
                  <ChevronLeft />
                </button>
                {Array.from(
                  { length: Math.max(1, Math.ceil(filtered.length / 7)) },
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
                    setPage(Math.min(Math.ceil(filtered.length / 7), page + 1))
                  }
                >
                  <ChevronRight />
                </button>
              </div>
            </div>
          </Panel>
          <Panel
            title="Workspace traffic"
            actions={<ChartSwitch notify={notify} />}
          >
            <SeriesChart points={workspaceSeries} emptyTitle="No measured workspace traffic yet" />
          </Panel>
        </>
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
              ["Period", "30 days", `${shortDate(new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10))}–${shortDate(new Date().toISOString().slice(0, 10))}`],
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
}: {
  session: Session | null;
  data: Bootstrap;
  fixture: boolean;
  reload: () => void;
  notify: Notify;
}) {
  const [scope, setScope] = useState("All"),
    [status, setStatus] = useState("All statuses");
  const fixtureItems = fixture
    ? [
        { id: "f1", title: "Monitor alert", body: "North Commerce returned HTTP 503 and is currently unavailable.", category: "monitoring", created_at: new Date().toISOString(), read_at: null },
        { id: "f2", title: "Audit issues", body: "Five unresolved audit findings need review.", category: "audits", created_at: new Date().toISOString(), read_at: null },
      ]
    : [];
  const source = fixture ? fixtureItems : data.notifications;
  const items = source.filter((notification: any) => {
    const category = String(notification.category || "account").toLowerCase();
    const scopeMatch =
      scope === "All" ||
      (scope === "Unread" && !notification.read_at) ||
      (scope === "Monitoring" && category === "monitoring") ||
      (scope === "Audits" && category === "audits") ||
      (scope === "Analytics" && category === "analytics") ||
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
      const result = await api<{ updated: number }>(session, "/api/notifications/read-all", { method: "POST" });
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
            <select>
              <option>All properties</option>
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
                  <i className="notification-property-tag">{cap(notification.category || "account")}</i>
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
  const livePeriod = periodQuery(overviewLocation.search);
  const [tab, setTab] = useState("Overview"),
    [analytics, setAnalytics] = useState<any>(null),
    [mobileAnalytics, setMobileAnalytics] = useState<any>(null),
    [desktopAnalytics, setDesktopAnalytics] = useState<any>(null),
    [audits, setAudits] = useState<AuditRun[]>([]);
  useEffect(() => {
    if (session && property) {
      Promise.all([
        api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}`),
        api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&device=mobile`),
        api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&device=desktop`),
        api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}`),
      ])
        .then(([all, mobile, desktop, storedAudits]) => {
          setAnalytics(all);
          setMobileAnalytics(mobile);
          setDesktopAnalytics(desktop);
          setAudits(storedAudits);
        })
        .catch(() => {
          setAnalytics(null);
          setMobileAnalytics(null);
          setDesktopAnalytics(null);
          setAudits([]);
        });
    } else if (property && fixture) {
      const fixtureSummary = fixtureAnalytics(property);
      setAnalytics(fixtureSummary);
      setMobileAnalytics({
        ...fixtureSummary,
        vitals: fixtureSummary.mobileVitals,
        performanceScore: fixtureSummary.mobilePerformanceScore,
      });
      setDesktopAnalytics({
        ...fixtureSummary,
        vitals: fixtureSummary.desktopVitals,
        performanceScore: fixtureSummary.desktopPerformanceScore,
      });
      setAudits([fixtureAudit(property)]);
    }
  }, [property?.id, session, fixture, livePeriod]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Choose a property to open its overview."
      />
    );
  const monitor = property.uptime_monitors?.[0],
    audit = audits[0] || property.audit_runs?.[0],
    views = analytics?.pageviews || 0,
    mobileScore =
      mobileAnalytics?.performanceScore ??
      webVitalsScore(mobileAnalytics?.vitals),
    desktopScore =
      desktopAnalytics?.performanceScore ??
      webVitalsScore(desktopAnalytics?.vitals),
    seoScore =
      audit?.category_scores?.SEO ??
      auditCategoryScore(audit?.audit_results, ["SEO"]),
    vitalRows = (analytics?.vitals || []).map((vital: any) => [
      vital.name,
      formatVital(vital.name, vital.value),
      fmt(vital.samples || 0),
    ]);
  return (
    <Page
      title="Property overview"
      status={<Period />}
      actions={
        <Link className="primary" to={`/audit?property=${property.id}`}>
          <RefreshCw />
          Run audit
        </Link>
      }
    >
      <Tabs
        labels={["Overview", "Activity", "Setup"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Overview" ? (
        <>
          <div className="summary-note">
            <b>Latest audit:</b> {audit ? fmtDate(audit.created_at) : "not run"}{" "}
            · <b>Tracking:</b>{" "}
            {property.tracking_last_received_at
              ? `receiving data ${relative(property.tracking_last_received_at)}`
              : "not installed"}{" "}
            ·{" "}
            <Link to={`/settings?property=${property.id}`}>
              2 priority actions
            </Link>
          </div>
          <Metrics
            values={[
              [
                "Uptime",
                fixture
                  ? property.demo?.uptime || "99.92%"
                  : monitor?.last_status === "online"
                    ? "Online"
                    : cap(monitor?.last_status || "Pending"),
                fixture
                  ? "35 min estimated downtime"
                  : monitor?.last_checked_at
                    ? `Checked ${relative(monitor.last_checked_at)}`
                    : "Awaiting first check",
              ],
              [
                "Pageviews",
                fmt(views),
                fixture ? "↑ 12.4%" : "Measured in this period",
              ],
              [
                "Avg daily visitors",
                fixture ? fmt(property.demo?.visitors || 474) : "—",
                fixture
                  ? "Estimated, not unique users"
                  : "Not available without a visitor estimate",
              ],
              [
                "Key events",
                fmt(analytics?.events || 0),
                fixture ? "1.3% of pageviews" : "All accepted events",
              ],
            ]}
          />
          <div className="grid">
            <div>
              <Panel
                title="Traffic (last 30 days)"
                actions={<ChartSwitch notify={notify} events />}
              >
                <SeriesChart
                  points={(analytics?.series || []).map((point: any) => ({
                    label: point.day,
                    value: point.pageviews || 0,
                  }))}
                  emptyTitle="No measured property traffic yet"
                />
              </Panel>
              <Panel title="Website health">
                <div className="health-metrics">
                  <Metric
                    label="Overall"
                    value={audit?.score ? `${audit.score} / 100` : "—"}
                  />
                  <Metric label="Mobile" value={scoreState(mobileScore, "Awaiting field data")} />
                  <Metric label="Desktop" value={scoreState(desktopScore, "Awaiting field data")} />
                  <Metric label="SEO" value={scoreState(seoScore, audit ? "Not implemented by this audit run" : "Awaiting audit")} />
                </div>
                <div className="settings-actions">
                  <Link className="btn" to={`/audit?property=${property.id}`}>
                    Review audit
                  </Link>
                  <Link
                    className="btn"
                    to={`/analytics?property=${property.id}`}
                  >
                    View performance
                  </Link>
                </div>
              </Panel>
            </div>
            <div>
              <Panel title="Real-user performance">
                {vitalRows.length ? (
                  <DataTable
                    headers={["Metric", "Result", "Samples"]}
                    rows={vitalRows}
                  />
                ) : (
                  <EmptyCompact
                    title="No Core Web Vitals samples"
                    detail="This is pending field data, not an estimated score."
                  />
                )}
              </Panel>
              <Panel title="Top pages">
                {analytics?.pages?.length ? (
                  <DataTable
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
                <Link className="btn" to={`/analytics?property=${property.id}`}>
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
      ) : (
        <SetupPanel property={property} />
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
  const livePeriod = periodQuery(uptimeLocation.search);
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
    [chartMenuOpen, setChartMenuOpen] = useState(false),
    [showPreviousChecks, setShowPreviousChecks] = useState(true);
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
        })
        .catch(() => {
          setCheckData(null);
          setIncidentData([]);
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
        checks,
        summary: { availability: 99.92, averageResponseMs: 246, medianResponseMs: 231, p95ResponseMs: 341 },
        previous: {
          checks: checks.map((check) => ({ ...check, response_ms: Math.round(check.response_ms * 1.18) })),
          summary: { availability: 99.9, averageResponseMs: 300, medianResponseMs: 284, p95ResponseMs: 710 },
        },
        days: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, total: 288, successful: i === 22 ? 284 : 288 })),
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
      : incidentData;
  const resolvedIncidents = relevant.filter((incident) => incident.resolved_at);
  const downtimeMs = resolvedIncidents.reduce(
    (total, incident) =>
      total + Math.max(0, new Date(incident.resolved_at).valueOf() - new Date(incident.opened_at).valueOf()),
    0,
  );
  const latestCheck = checkData?.checks?.at(-1);
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
          <span className="online-label"><i className="status-dot online" /> Online</span>
          <Period />
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
        labels={[
          "Overview",
          "Incidents",
          "Maintenance",
          "Alerts",
          "Monitor settings",
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Overview" ? (
        <>
          <Metrics
            values={[
              [
                "Availability",
                fixture
                  ? "99.92%"
                  : checkData?.summary?.availability != null
                    ? `${checkData.summary.availability.toFixed(2)}%`
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
              ["Resolved incidents", resolvedIncidents.length, `${relevant.length - resolvedIncidents.length} open`],
              [
                "Estimated downtime",
                downtimeMs ? formatDuration(downtimeMs) : "0 min",
                "Confirmed incident duration",
              ],
            ]}
          />
          <Panel
            title="Response time"
            actions={
              <>
                <span className="subtle">
                  Median {checkData?.summary?.medianResponseMs ?? "—"} ms · P95{" "}
                  {checkData?.summary?.p95ResponseMs ?? "—"} ms
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
                          (checkData?.checks || []).map((entry: any) => ({ label: entry.checked_at, value: entry.response_ms || 0 })),
                          "uptime-response-time.csv",
                          "Response time (ms)",
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
              points={(checkData?.checks || []).map((x: any) => ({
                label: fmtDate(x.checked_at),
                value: x.response_ms || 0,
              }))}
              previousPoints={showPreviousChecks
                ? (checkData?.previous?.checks || []).map((x: any) => ({
                    label: fmtDate(x.checked_at),
                    value: x.response_ms || 0,
                  }))
                : []}
              unit="ms"
              label="Response time"
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
            <div className="checkstrip">
              {(checkData?.days?.length
                ? checkData.days
                : Array.from({ length: 30 }, (_, i) => ({
                    day: String(i),
                    total: 0,
                    successful: 0,
                  }))).map((day: any, i: number) => (
                <button
                  key={i}
                  className={
                    day.total
                      ? day.successful < day.total
                        ? "warn"
                        : "available"
                      : day.suppressed
                        ? "suppressed"
                        : "missing"
                  }
                  title={
                    day.total
                      ? `${day.day}: ${day.successful}/${day.total} checks available`
                    : day.suppressed
                      ? `${day.day}: checks suppressed during maintenance`
                      : `${day.day}: no checks recorded`
                  }
                />
              ))}
            </div>
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
              <button
                className="btn panel-action"
                onClick={() => setTab("Monitor settings")}
              >
                Open settings
              </button>
            </Panel>
          </div>
        </>
      ) : tab === "Incidents" ? (
        <IncidentTable incidents={relevant} />
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
      ) : tab === "Alerts" ? (
        <AlertPanel
          session={session}
          property={property}
          fixture={fixture}
          notify={notify}
        />
      ) : (
        <MonitorPanel
          session={session}
          monitor={monitor}
          reload={reload}
          notify={notify}
        />
      )}{" "}
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
  const [chartMetric, setChartMetric] = useState("Pageviews");
  const [chartMenuOpen, setChartMenuOpen] = useState(false);
  const [showPreviousTraffic, setShowPreviousTraffic] = useState(true);
  const [pageList, setPageList] = useState<{ rows: any[]; page: number; pageSize: number; total: number; pages: number } | null>(null);
  const [pageListError, setPageListError] = useState("");
  const [pageListLoading, setPageListLoading] = useState(false);
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
    ["pagePath", "sourceDetail", "listPage", "pageSize"].forEach((key) => next.delete(key));
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
    if (session && property) {
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}`)
        .then((next) => !cancelled && setBaseData(next))
        .catch(() => !cancelled && setBaseData(null));
    } else if (fixture) setBaseData(analyticsFixtureSummary());
    return () => { cancelled = true; };
  }, [fixture, livePeriod, property?.id, session]);

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
  }, [filterQuery, fixture, livePeriod, property?.id, reloadToken, session, tab]);

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

  if (!property) return <Empty title="Select a property" detail="Analytics is property-specific." />;

  const scoped = data || baseData || analyticsFixtureSummary();
  const analyticsTimeZone = scoped.timeZone || property?.settings?.timezone || "Europe/London";
  const options: AnalyticsFilterOptions = baseData?.filterOptions || scoped.filterOptions || emptyAnalyticsFilterOptions;
  const pages = (scoped.pages || []).map((page: any) => ({
    page: page.path,
    views: page.pageviews || 0,
    events: page.events || 0,
  }));
  const config = analyticsFilterConfigs[tab];
  const keyEventRate = scoped.pageviews ? (scoped.keyEvents / scoped.pageviews) * 100 : null;
  const engagement = scoped.engagement || {};
  const performance = scoped.performance || { vitals: scoped.vitals || [], series: {}, minimumSamples: 1 };
  const minimumSamples = performance.minimumSamples || 1;
  const vital = (name: string) => (performance.vitals || []).find((entry: any) => entry.name === name);
  const selectedPerformanceMetric = filters.metric || "LCP";
  const seriesKey = chartMetric === "Daily visitors" ? "dailyVisitors" : chartMetric === "Events" ? "events" : "pageviews";
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
      scope={config.scope}
    />
  );

  return (
    <Page title="Analytics" status={<Period />}>
      <Tabs labels={tabs} value={tab} onChange={changeTab} />
      {loading ? (
        <Empty title="Loading analytics…" detail="Applying the selected property, dates and filters." />
      ) : error ? (
        <div className="analytics-state" role="alert">
          <Empty title="Analytics could not be loaded" detail={error} />
          <button className="btn" onClick={() => setReloadToken((value) => value + 1)}>Retry</button>
        </div>
      ) : tab === "Overview" ? (
        <>
          <Metrics values={[
            ["Pageviews", fmt(scoped.pageviews || 0), comparisonText(scoped.pageviews, scoped.previous?.pageviews)],
            ["Avg daily visitors", scoped.averageDailyVisitors == null ? "Unavailable" : fmt(scoped.averageDailyVisitors), scoped.averageDailyVisitors == null ? "Anonymous session estimate unavailable" : "Anonymous sessions per calendar day"],
            ["Key events", fmt(scoped.keyEvents || 0), comparisonText(scoped.keyEvents, scoped.previous?.keyEvents)],
            ["Key events per pageview", keyEventRate == null ? "—" : `${keyEventRate.toFixed(1)}%`, scoped.pageviews ? `${fmt(scoped.keyEvents)} ÷ ${fmt(scoped.pageviews)}` : "No pageviews in range"],
          ]} />
          <Panel
            title="Traffic"
            actions={
              <>
                <span className="seg">
                  {["Pageviews", "Daily visitors", "Events"].map((metric) => (
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
            <Panel title="Top pages"><AnalyticsTable pages={pages} property={property} groupedLimit={5} eventHeader="Key events" /></Panel>
            <Panel title="Traffic sources"><AnalyticsSourceTable sources={scoped.sources || []} /></Panel>
          </div>
          <div className="grid analytics-overview-bottom">
            <Panel title="Key events"><AnalyticsValueTable headers={["Event", "Count", "%"]} rows={(scoped.eventBreakdown || []).slice(0, 5).map((row: any) => ({ label: eventLabel(row.name), value: row.count, secondary: scoped.keyEvents ? `${Math.round(row.count / scoped.keyEvents * 100)}%` : "0%" }))} /></Panel>
            <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Share"]} rows={shareRows(scoped.devices, scoped.pageviews, "device")} /></Panel>
            <Panel title="Countries"><AnalyticsValueTable headers={["Country", "Visitors"]} rows={shareRows(scoped.countries, scoped.pageviews, "country")} /></Panel>
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
        <Panel title="Pages">
          {filtersToolbar}
          {pageListLoading ? (
            <Empty title="Loading pages…" detail="Fetching this page of the complete, filtered result." />
          ) : pageListError ? (
            <div className="analytics-state" role="alert"><Empty title="Pages could not be loaded" detail={pageListError} /><button className="btn" onClick={() => setReloadToken((value) => value + 1)}>Retry</button></div>
          ) : pageList?.rows?.length ? (
            <>
              <AnalyticsTable
                pages={pageList.rows.map((row: any) => ({ page: row.path, views: row.pageviews, events: row.events }))}
                property={property}
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
      ) : tab === "Sources" && detailSource ? (
        <AnalyticsSourceDetail data={scoped} source={detailSource} property={property} onBack={() => updateAnalyticsParams({ sourceDetail: null })} />
      ) : tab === "Sources" ? (
        <Panel title="Traffic sources">
          {filtersToolbar}
          <AnalyticsSourceTable sources={scoped.sources || []} onDetail={(source) => updateAnalyticsParams({ sourceDetail: source })} />
          <p className="subtle">Source categories are mutually exclusive and total {fmt((scoped.sources || []).reduce((sum: number, source: any) => sum + source.pageviews, 0))} pageviews.</p>
        </Panel>
      ) : tab === "Events" ? (
        <EventsPanel session={session} property={property} fixture={fixture} notify={notify} data={scoped} filters={filters} options={options} onFilterChange={changeFilters} />
      ) : tab === "Audience" ? (
        <>
          {filtersToolbar}
          <div className="grid equal">
            <Panel title="Devices"><AnalyticsValueTable headers={["Device", "Share"]} rows={shareRows(scoped.devices, scoped.pageviews, "device")} /></Panel>
            <Panel title="Countries"><AnalyticsValueTable headers={["Country", "Visitors"]} rows={shareRows(scoped.countries, scoped.pageviews, "country")} /></Panel>
            <Panel title="Browsers"><AnalyticsValueTable headers={["Browser", "Share"]} rows={shareRows(scoped.browsers, scoped.pageviews, "browser")} /></Panel>
            <Panel title="Screen categories"><AnalyticsValueTable headers={["Width", "Share"]} rows={shareRows(scoped.screens, scoped.pageviews)} /></Panel>
          </div>
        </>
      ) : tab === "Engagement" ? (
        <>
          <Metrics values={[
            ["Engaged pageviews", engagement.engagedPageviews == null ? "Unavailable" : fmt(engagement.engagedPageviews), engagement.engagedPageviews == null ? "New correlated pageviews only" : `${fmt(engagement.eligiblePageviews)} eligible pageviews`],
            ["Median scroll depth", engagement.medianScrollDepth == null ? "Unavailable" : `${Math.round(engagement.medianScrollDepth)}%`, engagement.medianScrollDepth == null ? "Awaiting correlated scroll signals" : "Per-page-view maximum"],
            ["Pageviews with key events", engagement.pageviewsWithKeyEvents == null ? "Unavailable" : fmt(engagement.pageviewsWithKeyEvents), "Each pageview counted once"],
            ["Median active time", engagement.medianActiveSeconds == null ? "Unavailable" : durationLabel(engagement.medianActiveSeconds), "Visible foreground time"],
          ]} />
          {filtersToolbar}
          <div className="grid equal">
            <Panel title="Scroll depth"><AnalyticsValueTable headers={["Depth", "Pageviews"]} rows={(engagement.scrollDepth || []).map((row: any) => ({ label: `${row.depth}% reached`, value: row.pageviews }))} /></Panel>
            <Panel title="Most engaging pages"><AnalyticsValueTable headers={["Page", "Engaged views"]} rows={(engagement.pages || []).map((row: any) => ({ label: row.path, value: row.engagedViews }))} /></Panel>
          </div>
          <Panel title="Additional aggregate insights">
            <KeyValues rows={[
              ["Engagement rate", engagement.engagementRate == null ? "Unavailable" : `${engagement.engagementRate.toFixed(1)}%`],
              ["JavaScript errors", engagement.collectionStatus === "available" ? fmt(engagement.javascriptErrors || 0) : "Unavailable"],
              ["Median active time", engagement.medianActiveSeconds == null ? "Unavailable" : durationLabel(engagement.medianActiveSeconds)],
              ["Top visible section", engagement.visibleSections?.[0] ? `${eventLabel(engagement.visibleSections[0].name)} · ${fmt(engagement.visibleSections[0].count)} pageviews` : "Unavailable"],
            ]} />
            <p className="subtle">Aggregate signals use anonymous page-view identifiers and do not create person profiles.</p>
          </Panel>
        </>
      ) : (
        <>
          <Metrics values={[
            ["LCP", vitalMetricValue(vital("LCP"), minimumSamples), vitalMetricSamples(vital("LCP"), minimumSamples)],
            ["INP", vitalMetricValue(vital("INP"), minimumSamples), vitalMetricSamples(vital("INP"), minimumSamples)],
            ["CLS", vitalMetricValue(vital("CLS"), minimumSamples), vitalMetricSamples(vital("CLS"), minimumSamples)],
            ["Good experiences", performance.goodExperiencesPercent == null || performance.eligibleGoodExperienceViews < minimumSamples ? "Unavailable" : `${Math.round(performance.goodExperiencesPercent)}%`, performance.goodExperiencesPercent == null ? "Requires LCP, INP and CLS per view" : `${fmt(performance.eligibleGoodExperienceViews)} eligible pageviews`],
          ]} />
          <Panel>
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
    [tab, setTab] = useState(
      ["Overview", "Findings", "Checks", "History", "Compare"].includes(requestedTab || "")
        ? requestedTab!
        : "Overview",
    ),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("All"),
    [pageMenu, setPageMenu] = useState(false),
    [addPage, setAddPage] = useState(false),
    [performanceMode, setPerformanceMode] = useState<"Lab audit" | "Real-user data">("Lab audit"),
    [realUserPerformance, setRealUserPerformance] = useState<any>(null),
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
    }
  }, [property?.id, session, fixture]);
  useEffect(() => {
    if (!fixture || !property || !selectedPage) return;
    setRuns([
      fixtureAudit(property, selectedPage, false),
      fixtureAudit(property, selectedPage, true),
    ]);
  }, [fixture, property?.id, selectedPage?.id]);
  useEffect(() => {
    if (!session || !property || !selectedPage) return;
    const sequence = ++requestSequence.current;
    setRuns([]);
    setRealUserPerformance(null);
    Promise.all([
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}&pageId=${encodeURIComponent(selectedPage.id)}`),
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&device=desktop&pathMode=exact&pathValue=${encodeURIComponent(selectedPage.path)}`),
      api<any>(session, `/api/properties/${property.id}/analytics?${livePeriod}&device=mobile&pathMode=exact&pathValue=${encodeURIComponent(selectedPage.path)}`),
    ])
      .then(([nextRuns, desktop, mobile]) => {
        if (requestSequence.current !== sequence) return;
        setRuns(nextRuns);
        setRealUserPerformance({ desktop, mobile });
      })
      .catch(() => {
        if (requestSequence.current !== sequence) return;
        setRuns([]);
        setRealUserPerformance(null);
      });
  }, [property?.id, session, fixture, livePeriod, selectedPage?.id]);
  const activeRunId = runs.find((run) => ["queued", "running"].includes(run.status))?.id;
  useEffect(() => {
    if (!activeRunId || !session || !property || !selectedPage) return;
    const interval = window.setInterval(() => {
      const sequence = ++requestSequence.current;
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}&pageId=${encodeURIComponent(selectedPage.id)}`)
        .then((nextRuns) => {
          if (requestSequence.current !== sequence) return;
          setRuns(nextRuns);
          const finished = nextRuns.find((run) => run.id === activeRunId);
          if (finished && ["completed", "partial", "failed"].includes(finished.status)) {
            setBusy(false);
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
    setFilter("All");
  }, [selectedPage?.id, latestRunId]);
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
  const activeRun = runs.find((run) => ["queued", "running"].includes(run.status)),
    latest = runs.find((run) => ["completed", "partial"].includes(run.status)),
    results = latest?.audit_results || [],
    completedCategoryCount = Object.values(auditRunCategoryScores(latest)).filter((score) => score != null).length,
    partial = Boolean(latest) && !isAuditRunComplete(latest),
    actionable = results.filter((result: any) => ["fail", "warning"].includes(result.outcome));
  const resultCounts = {
    critical: actionable.filter((result: any) => String(result.category) !== "Security" && (["critical", "high"].includes(result.severity) || result.outcome === "fail")).length,
    security: actionable.filter((result: any) => result.category === "Security" && ["critical", "high"].includes(result.severity)).length,
    warnings: actionable.filter((result: any) => !["critical", "high"].includes(result.severity) && result.outcome === "warning").length,
  };
  async function run(checkIds?: string[]) {
    if (!selectedPage) return;
    setBusy(true);
    try {
      if (session)
        await api(session, "/api/audits", {
          method: "POST",
          body: JSON.stringify({
            propertyId: property!.id,
            pageId: selectedPage.id,
            ...(checkIds?.length ? { checkIds } : {}),
          }),
        });
      notify("Audit queued");
      if (session) {
        const next = await api<AuditRun[]>(session, `/api/properties/${property!.id}/audits?${livePeriod}&pageId=${encodeURIComponent(selectedPage.id)}`);
        setRuns(next);
        setBusy(next.some((candidate) => ["queued", "running"].includes(candidate.status)));
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
  async function updateReview(resultId: string | number, status: string) {
    if (!session) return;
    try {
      const updated = await api<any>(session, `/api/audit-results/${resultId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setRuns((current) => current.map((candidate) => ({
        ...candidate,
        audit_results: (candidate.audit_results || []).map((result: any) => result.id === updated.id ? { ...result, ...updated } : result),
      })));
      notify(status === "not_reviewed" ? "Review status cleared" : `Finding marked ${status.replaceAll("_", " ")}`);
    } catch (error: any) {
      notify(error.message);
    }
  }
  function openFindingCategory(category: string) {
    setTab("Findings");
    setFilter("All");
    setOpenCategories(new Set([category]));
    updateAuditLocation({ auditTab: "Findings" });
  }
  const failedRun = !activeRun && runs[0]?.status === "failed" ? runs[0] : undefined;
  return (
    <Page
      title="Audit"
      status={<Period />}
      actions={
        <button className="primary" onClick={() => void run()} disabled={busy || Boolean(activeRun) || !selectedPage}>
          <RefreshCw className={busy || activeRun ? "audit-spin" : ""} />
          {activeRun?.status === "queued" ? "Queued" : activeRun?.status === "running" ? "Running" : busy ? "Queuing…" : "Run audit"}
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
              <button
                key={page.path}
                className={selectedPage?.id === page.id ? "selected" : ""}
                onClick={() => {
                  setSelectedPage(page);
                  setPageMenu(false);
                  setFilter("All");
                  updateAuditLocation({ auditPage: page.id });
                }}
              >
                <Globe2 /> {page.name} {selectedPage?.id === page.id && <Check />}
              </button>
            ))}
            <button onClick={() => { setPageMenu(false); setAddPage(true); }}><Plus /> Add page</button>
          </div>
        )}
        <button className="iconbtn" onClick={() => setAddPage(true)} aria-label="Add audit page">
          <Plus />
        </button>
        <Tabs
          labels={["Overview", "Findings", "Checks", "History", "Compare"]}
          value={tab}
          onChange={(nextTab) => { setTab(nextTab); updateAuditLocation({ auditTab: nextTab }); }}
        />
      </div>
      {(activeRun || failedRun) && <AuditProgress run={(activeRun || failedRun)!} onRetry={() => void run()} />}
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
          <p className="audit-run-meta">
            {latest
              ? `Latest completed result for ${selectedPage?.name}: ${fmtDate(latest.completed_at || latest.created_at)} · run ${latest.id.slice(0, 8)}`
              : `${selectedPage?.name || "This page"} has not been audited yet.`}
            {activeRun && latest ? " · Previous completed result remains visible while the new run is active." : ""}
          </p>
          <div className="grid">
            <Panel title={`Fix these first · ${selectedPage?.name || "Selected page"}`}>
              <div className="audit-summary" aria-label="Finding severity filters">
                <button className={`audit-summary-item ${filter === "critical" ? "selected" : ""}`} onClick={() => setFilter(filter === "critical" ? "All" : "critical")}>
                  <OctagonAlert />{resultCounts.critical}
                </button>
                <button className={`audit-summary-item ${filter === "security" ? "selected" : ""}`} onClick={() => setFilter(filter === "security" ? "All" : "security")}>
                  <ShieldAlert />{resultCounts.security}
                </button>
                <button className={`audit-summary-item ${filter === "warning" ? "selected" : ""}`} onClick={() => setFilter(filter === "warning" ? "All" : "warning")}>
                  <TriangleAlert />{resultCounts.warnings}
                </button>
              </div>
              <AuditFilterButton value={filter} onChange={setFilter} compact />
              <AuditResults
                results={filterAuditFindings(actionable, filter).slice(0, 7)}
                onRetest={(checkId) => void run([checkId])}
                onReview={updateReview}
              />
            </Panel>
            <div>
              <div className="segmented audit-performance-mode" role="group" aria-label="Performance data source">
                {(["Lab audit", "Real-user data"] as const).map((mode) => (
                  <button key={mode} className={performanceMode === mode ? "active" : ""} onClick={() => setPerformanceMode(mode)}>{mode}</button>
                ))}
              </div>
              {performanceMode === "Lab audit" ? (
                <>
                  <Panel title="Desktop performance"><PerformanceTable mobile={false} run={latest} /></Panel>
                  <Panel title="Mobile performance"><PerformanceTable mobile run={latest} /></Panel>
                </>
              ) : (
                <>
                  <Panel title="Desktop performance"><RealUserPerformanceTable data={realUserPerformance} device="desktop" /></Panel>
                  <Panel title="Mobile performance"><RealUserPerformanceTable data={realUserPerformance} device="mobile" /></Panel>
                </>
              )}
            </div>
          </div>
        </>
      ) : tab === "Findings" ? (
        <AuditFindingsPanel
          pageName={selectedPage?.name || "Selected page"}
          results={results}
          filter={filter}
          setFilter={setFilter}
          openCategories={openCategories}
          setOpenCategories={setOpenCategories}
          onRetest={(checkId) => void run([checkId])}
          onReview={updateReview}
        />
      ) : tab === "Checks" ? (
        <AuditChecksPanel
          pageName={selectedPage?.name || "Selected page"}
          run={latest}
          results={results}
          onOpenCategory={openFindingCategory}
        />
      ) : tab === "History" ? (
        <Panel title="Audit history">
          <DataTable
            headers={[
              "Started",
              "Page",
              "Status",
              "Score",
              "Coverage",
              "Duration",
            ]}
            rows={runs.map((r) => [
              fmtDate(r.created_at),
              r.page_url || property.url,
              cap(r.status),
              r.score ?? "—",
              r.coverage != null ? `${r.coverage}%` : "—",
              r.duration_ms ? `${r.duration_ms} ms` : "—",
            ])}
          />
        </Panel>
      ) : (
        <AuditComparePanel
          pageName={selectedPage?.name || "Selected page"}
          runs={runs}
          earlierRunId={earlierRunId}
          laterRunId={laterRunId}
          onEarlierChange={(id) => { setEarlierRunId(id); updateAuditLocation({ auditEarlier: id }); }}
          onLaterChange={(id) => { setLaterRunId(id); updateAuditLocation({ auditLater: id }); }}
        />
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
            period: "1–30 Sep 2026",
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
              <p>1–30 Sep 2026</p>
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
    [viewerToRemove, setViewerToRemove] = useState<any | null>(null),
    [deleteOpen, setDeleteOpen] = useState(false),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
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
  }, [property?.id, session]);
  useEffect(() => {
    if (requestedSettingsTab && settingsTabs.includes(requestedSettingsTab)) setTab(requestedSettingsTab);
  }, [requestedSettingsTab]);
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
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option>Europe/London</option>
                <option>UTC</option>
              </select>
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
      ) : tab === "Tracking" ? (
        <>
          <Panel title="Installation">
            <pre className="install-code">{snippet}</pre>
            <button
              className="btn"
              onClick={() =>
                navigator.clipboard
                  .writeText(snippet)
                  .then(() => notify("Tracking snippet copied"))
              }
            >
              <Copy />
              Copy snippet
            </button>
          </Panel>
          <Panel title="Tracking status">
            <KeyValues
              rows={[
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
        <MonitorPanel
          session={session}
          monitor={property.uptime_monitors?.[0]}
          reload={reload}
          notify={notify}
        />
      ) : tab === "Events" ? (
        <EventsPanel
          session={session}
          property={property}
          fixture={false}
          notify={notify}
        />
      ) : tab === "Sharing" ? (
        <Panel title="Property access">
          <DataTable
            headers={[
              "User",
              "Role",
              "Analytics",
              "Audit",
              "Uptime",
              "Settings",
              "",
            ]}
            rows={[
              ["Account holder", "Owner", "Allowed", "Allowed", "Allowed", "Allowed", ""],
              ...viewers.map((viewer) => [
                viewer.name || viewer.email,
                cap(viewer.role),
                "View only",
                "View only",
                "View only",
                "Not allowed",
                <button className="btn" onClick={() => setViewerToRemove(viewer)}>Remove access</button>,
              ]),
            ]}
          />
          <button className="btn" onClick={() => setViewerOpen(true)}>
            <Plus />
            Invite viewer
          </button>
        </Panel>
      ) : (
        <>
        <Panel title="Privacy & data collection">
          <div className="form-two">
            <label className="field">
              Analytics cookies
              <select value="disabled" disabled><option value="disabled">Disabled — cookieless</option></select>
            </label>
            <label className="field">
              Visitor profiles
              <select value="anonymous" disabled><option value="anonymous">Anonymous</option></select>
            </label>
            <label className="field">
              Sensitive query parameters
              <input value={sensitiveParams} onChange={(event) => setSensitiveParams(event.target.value)} />
            </label>
            <label className="field">
              IP address handling
              <select value={ipHandling} onChange={(event) => setIpHandling(event.target.value)}>
                <option value="discard_after_geolocation">Discard after geolocation</option>
                <option value="discard_immediately">Discard immediately</option>
              </select>
            </label>
          </div>
          <div className="settings-actions right">
            <button className="primary" disabled={busy} onClick={save}>Save privacy options</button>
          </div>
        </Panel>
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
            title="Website URL"
            detail={`${property.url} · fixed after setup`}
            action={<Status value={property.verification_status} />}
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
    </Page>
  );
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
  const [tab, setTab] = useState("Profile"),
    [name, setName] = useState(data.profile?.full_name || ""),
    [timezone, setTimezone] = useState(
      data.profile?.timezone || "Europe/London",
    ),
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
    [workspaceToDelete, setWorkspaceToDelete] = useState<any | null>(null),
    [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("");
  const role = data.accounts?.[0]?.role || data.workspaces?.[0]?.role || "viewer";
  const tabs = role === "viewer"
    ? ["Profile", "Notification preferences", "Security"]
    : [
        "Profile",
        "Workspace",
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
  async function save() {
    try {
      if (session)
        await api(session, "/api/profile", {
          method: "PATCH",
          body: JSON.stringify({ full_name: name, timezone }),
        });
      notify("Profile saved");
      reload();
    } catch (e: any) {
      notify(e.message);
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
            <span className="avatar profile-avatar">{(name || "C")[0]}</span>
            <span>
              <h2>{name || "Claritude user"}</h2>
              <small>Personal profile</small>
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
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option>Europe/London</option>
              <option>UTC</option>
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
                <input
                  aria-label={`Workspace name for ${workspace?.name || "Workspace"}`}
                  value={workspaceDrafts[workspace?.id] || ""}
                  readOnly={!canEditWorkspace}
                  onChange={(event) => setWorkspaceDrafts((current) => ({ ...current, [workspace?.id]: event.target.value }))}
                />,
                propertyCount,
                cap(entry.role),
                <div className="row-actions">
                  {canEditWorkspace && <button className="btn" disabled={!workspaceDrafts[workspace?.id]?.trim()} onClick={() => void saveWorkspace(workspace?.id)}>Save</button>}
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
      ) : tab === "Billing & plan" ? (
        <Billing fixture={fixture} notify={notify} />
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

function Billing({ fixture, notify }: { fixture: boolean; notify: Notify }) {
  const [annual, setAnnual] = useState(true);
  const downloadInvoice = (date: string) => {
    const url = URL.createObjectURL(
      new Blob([`Claritude invoice\n${date}\nAnnual Scale\n£468 excl. VAT\nPaid`], {
        type: "text/plain",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `claritude-invoice-${date.replaceAll(" ", "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="grid equal">
        <Panel title="Subscription">
          <span className="tag">{fixture ? "Active" : "Early access"}</span>
          <div className="price">{fixture ? "Scale" : "Pro"}</div>
          {fixture ? (
            <>
              <b>£39 / month</b>
              <p className="subtle">
                Billed annually · £468 / year excluding VAT
                <br />
                Renews 30 September 2027
              </p>
              <button className="btn" onClick={() => notify("Choose a plan below to review a change")}>Change plan</button>{" "}
              <button className="btn" onClick={() => notify("Billing management opened")}>Manage billing</button>
            </>
          ) : (
            <p className="subtle">
              Pro access is included during early access. No charge is
              represented by this interface.
            </p>
          )}
        </Panel>
        <Panel title="Usage this month">
          <KeyValues
            rows={
              fixture
                ? [
                    ["Properties", "12 / 50 · resets never"],
                    ["Analytics events", "85,408 / 250,000 · resets 1 Oct"],
                    ["Audits", "42 / 200 · resets 1 Oct"],
                    ["Editing seats", "3 included · 3 used"],
                    ["Additional seats", "1 · £8 / month excl. VAT"],
                  ]
                : [
                    ["Properties", "Measured from workspace"],
                    ["Analytics events", "Usage billing not active"],
                    ["Audits", "Usage billing not active"],
                    ["Editing seats", "Not enforced in Stage 1"],
                  ]
            }
          />
        </Panel>
      </div>
      {fixture && (
        <div className="grid equal">
          <Panel title="Payment method">
            <div className="payment-card">
              <b>VISA</b>
              <span>
                •••• 4242<small>Exp 12/28</small>
              </span>
              <button className="btn" onClick={() => notify("Payment method editor opened")}>Update</button>
            </div>
            <p className="subtle">No cancellation or downgrade is scheduled.</p>
          </Panel>
          <Panel title="Invoice history">
            <DataTable
              headers={["Date", "Description", "Amount", "Status", ""]}
              rows={[
                [
                  "30 Sep 2026",
                  "Annual Scale",
                  "£468 excl. VAT",
                  "● Paid",
                  <button className="btn" onClick={() => downloadInvoice("30 Sep 2026")}>Download</button>,
                ],
                [
                  "30 Sep 2025",
                  "Annual Scale",
                  "£468 excl. VAT",
                  "● Paid",
                  <button className="btn" onClick={() => downloadInvoice("30 Sep 2025")}>Download</button>,
                ],
              ]}
            />
          </Panel>
        </div>
      )}
      {fixture ? (
        <Panel
          title="Choose a plan"
          actions={
            <span className="seg">
              <button className={annual ? "active" : ""} onClick={() => setAnnual(true)}>Annual</button>
              <button className={!annual ? "active" : ""} onClick={() => setAnnual(false)}>Monthly</button>
            </span>
          }
        >
          <div className="plans">
            {[
              ["Free", "£0 / mo", "2 properties · 15-minute monitoring"],
              ["Essentials", "£9 / mo", "5 properties · 5-minute monitoring"],
              ["Scale", "£39 / mo", "50 properties · 5-minute monitoring"],
              ["Pro", "£99 / mo", "200 properties · branded reports"],
            ].map((x) => (
              <div className={`plan ${x[0] === "Scale" ? "current" : ""}`} key={x[0]}>
                <h2>{x[0]}</h2>
                <div className="price">{x[1]}</div>
                <p>{x[2]}</p>
                <button
                  className="btn"
                  disabled={x[0] === "Scale"}
                  onClick={() => notify(`${x[0]} ${annual ? "annual" : "monthly"} plan review opened`)}
                >
                  {x[0] === "Scale" ? "Current plan" : "Choose"}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel title="Billing integration deferred">
          <p>
            Early-access Pro features are enabled without a charge. Stripe checkout,
            payment methods, invoices, plan changes and usage billing are not active in Stage 1.
          </p>
          <p className="subtle">No billing action can be performed from this screen.</p>
        </Panel>
      )}
    </>
  );
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
  children,
}: {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
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
  return (
    <div className={`content ${compact ? "compact-content" : ""}`}>
      <div className="title-row">
        <h1>{title}</h1>
        {status}
        <span className="spacer" />
        {actions}
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
            <button
              disabled={!status}
              title={status ? undefined : "This page does not expose period-filtered data"}
              onClick={() => { setPeriodOpen(true); setMenu(false); }}
            >
              <CalendarDays /> Date range
            </button>
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
      {children}
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
function Period() {
  const periodLocation = useLocation();
  const params = new URLSearchParams(periodLocation.search);
  const to = params.get("to") || new Date().toISOString().slice(0, 10);
  const from = params.get("from") || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
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
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
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
function Metrics({ values }: { values: (string | number)[][] }) {
  return (
    <div className="metrics">
      {values.map((v, i) => (
        <div className="metric" key={i}>
          <small>{v[0]}</small>
          <b>{v[1]}</b>
          <span>{v[2]}</span>
        </div>
      ))}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td key={j}>{x}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
function ChartSwitch({
  notify,
  events = false,
}: {
  notify: Notify;
  events?: boolean;
}) {
  const [kind, setKind] = useState("Pageviews");
  return (
    <span className="seg">
      {["Pageviews", "Daily visitors", ...(events ? ["Events"] : [])].map(
        (x) => (
          <button
            className={kind === x ? "active" : ""}
            onClick={() => {
              setKind(x);
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
}: {
  points: { label: string; value: number }[];
  previousPoints?: { label: string; value: number }[];
  emptyTitle: string;
  unit?: string;
  label?: string;
  timeZone?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length)
    return (
      <Empty
        title={emptyTitle}
        detail="This chart populates as measured data is received."
      />
    );
  const width = 825,
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
    <div className="live-chart-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="chart live-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label={label}
      >
        {ticks.map((tick, index) => {
          const y = plotTop + index * (plotBottom - plotTop) / 3;
          return <g key={index}><line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} /><text className="chart-axis-label" x="2" y={y + 4}>{formatChartAxis(tick, unit)}</text></g>;
        })}
        <polygon
          className="series-fill"
          points={`${plotLeft},${plotBottom} ${polyline} ${plotRight},${plotBottom}`}
        />
        {previousPolyline && <polyline className="compare" points={previousPolyline} />}
        <polyline className="series" points={polyline} />
        {xLabelIndexes.map((index) => coords[index] && <text className="chart-axis-label chart-x-label" x={coords[index].x} y={height - 5} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} key={`label-${index}`}>{chartDateLabel(coords[index].label, timeZone)}</text>)}
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
      {hover != null && (
        <div
          className="chart-tooltip"
          style={{ left: `${Math.min(86, Math.max(4, (coords[hover].x / width) * 100))}%` }}
        >
          <b>{formatChartTooltip(coords[hover].value, unit)}</b>
          <small>{chartDateLabel(coords[hover].label, timeZone)}</small>
          {previousCoords[hover] && <small>Previous: {formatChartTooltip(previousCoords[hover].value, unit)}</small>}
        </div>
      )}
    </div>
  );
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
function IncidentTable({ incidents, compact = false }: { incidents: any[]; compact?: boolean }) {
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
        return compact ? values : [incident.property || "Selected property", ...values];
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
    [testing, setTesting] = useState(false);
  const [recipients, setRecipients] = useState<any[]>(
    fixture ? [{ email: "alerts@websi.co.uk", enabled: true }] : [],
  );
  useEffect(() => {
    if (session)
      api<any[]>(session, `/api/properties/${property.id}/alert-recipients`)
        .then(setRecipients)
        .catch(() => setRecipients([]));
  }, [session, property.id]);
  async function addRecipient() {
    if (!email) return;
    try {
      const recipient = session
        ? await api<any>(
            session,
            `/api/properties/${property.id}/alert-recipients`,
            { method: "POST", body: JSON.stringify({ email }) },
          )
        : { email, enabled: true };
      setRecipients((current) => [
        ...current.filter((x) => x.email !== recipient.email),
        recipient,
      ]);
      setEmail("");
      notify("Alert recipient saved");
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
  return (
    <div className="grid equal">
      <Panel title="Recipients">
        <DataTable
          headers={["Email", "Down", "Recovery", ""]}
          rows={recipients.map((recipient) => [
            recipient.email,
            recipient.enabled ? "On" : "Off",
            recipient.enabled ? "On" : "Off",
            <button className="btn" onClick={() => void removeRecipient(recipient)}>
              Remove
            </button>,
          ])}
        />
        <div className="inline-form">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alerts@example.com"
          />
          <button className="btn" onClick={addRecipient} disabled={!email}>
            <Plus />
            Add recipient
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
          className="btn"
          disabled={testing || !recipients.length || !session}
          onClick={async () => {
            if (!session) return;
            setTesting(true);
            try {
              const result = await api<{ delivered: number }>(
                session,
                `/api/properties/${property.id}/test-alert`,
                { method: "POST" },
              );
              notify(`Test alert delivered to ${result.delivered} recipient${result.delivered === 1 ? "" : "s"}`);
            } catch (error: any) {
              notify(error.message);
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? "Sending…" : "Send test alert"}
        </button>
      </Panel>
    </div>
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
  const [interval, setInterval] = useState(monitor?.interval_minutes || 5),
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
              <option key={x}>{x}</option>
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
  scope = "this page table",
}: {
  filters: AnalyticsPageFilters;
  options: AnalyticsFilterOptions;
  onChange: (filters: AnalyticsPageFilters) => void;
  title?: string;
  categories?: string[];
  scope?: string;
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
      <small className="subtle">Filters affect {scope}.</small>
    </div>
  );
}

function AnalyticsTable({
  pages,
  property,
  groupedLimit,
  eventHeader = "Events",
  onDetail,
}: {
  pages: any[];
  property: Property;
  groupedLimit?: number;
  eventHeader?: string;
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
  return (
    <>
      <div className="table-wrap">
        <table className="bar-table analytics-pages-table">
          <thead>
            <tr><th>Page</th><th>Pageviews</th><th>{eventHeader}</th></tr>
          </thead>
          <tbody>
            {rows.map((page) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groupOpen && (
        <Modal title="Other grouped pages" close={() => setGroupOpen(false)}>
          <p>Lower-volume pages are grouped here instead of being replaced with a fictional row.</p>
          <DataTable
            headers={["Page", "Pageviews", "Events"]}
            rows={groupedPages.map((page) => [page.page, fmt(page.views), fmt(page.events)])}
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
  if (!sources.length)
    return <Empty title="No measured sources" detail="Source categories appear after pageviews are received." />;
  const max = Math.max(1, ...sources.map((source) => Number(source.pageviews || source.count || 0)));
  return (
    <div className="table-wrap">
      <table className="bar-table analytics-three-column-table">
        <thead><tr><th>Source / referrer</th><th>Pageviews</th><th>Events</th></tr></thead>
        <tbody>
          {sources.map((source) => {
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

function AnalyticsPagination({ page, pageSize, total, pages, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="pagination-row analytics-pagination" aria-label="Pages table pagination">
      <span>{fmt(first)}–{fmt(last)} of {fmt(total)} pages</span>
      <label>Rows<select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[20, 100, 200].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
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
        ["Pageviews", fmt(pageRow?.pageviews || data.pageviews || 0), "Selected page only"],
        ["Key events", fmt(pageRow?.events || data.keyEvents || 0), "Clicks, outbound clicks and confirmed forms"],
        ["Engaged pageviews", data.engagement?.engagedPageviews == null ? "Unavailable" : fmt(data.engagement.engagedPageviews), "Correlated pageviews only"],
        ["Median active time", data.engagement?.medianActiveSeconds == null ? "Unavailable" : durationLabel(data.engagement.medianActiveSeconds), "Visible, active foreground time"],
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
        ["Pageviews", fmt(data.pageviews || 0), "Selected source only"],
        ["Key events", fmt(data.keyEvents || 0), "Selected source only"],
        ["Pages", fmt(pages.length), "Observed landing and visited paths"],
        ["Property", property.name, property.canonical_host],
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
}: {
  headers: string[];
  rows: { label: ReactNode; value: number; secondary?: ReactNode; iconKind?: string; iconValue?: string }[];
}) {
  if (!rows.length)
    return <Empty title="No measured data" detail="This breakdown will populate after compatible events are received." />;
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return (
    <div className="table-wrap">
      <table className={`bar-table analytics-value-table ${headers.length === 3 ? "analytics-three-column-table" : ""}`}>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row.label)}-${index}`}>
              <InCellBar value={row.value} max={max}>
                <span className="dimension-label">
                  {row.iconKind && <DimensionMark kind={row.iconKind} value={row.iconValue || String(row.label)} />}
                  <b>{row.label}</b>
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
  const short = clean.includes("google") ? "G" : clean.includes("linkedin") ? "in" : clean.includes("instagram") ? "◎" : clean.includes("chrome") ? "●" : clean.includes("safari") ? "●" : clean.includes("edge") ? "e" : clean.includes("firefox") ? "●" : clean.includes("direct") ? "↗" : "↗";
  const brand = clean.includes("google") ? "google" : clean.includes("linkedin") ? "linkedin" : clean.includes("instagram") ? "instagram" : clean.includes("chrome") ? "chrome" : clean.includes("safari") ? "safari" : clean.includes("edge") ? "edge" : clean.includes("firefox") ? "firefox" : "neutral";
  return <span className={`dimension-mark ${brand}`} aria-hidden="true">{short}</span>;
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
}: {
  session: Session | null;
  property: Property;
  fixture: boolean;
  notify: Notify;
  data?: any;
  filters?: AnalyticsPageFilters;
  options?: AnalyticsFilterOptions;
  onFilterChange?: (filters: AnalyticsPageFilters) => void;
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
  const [eventsState, setEventsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [eventsLoadError, setEventsLoadError] = useState("");
  const [eventsReloadToken, setEventsReloadToken] = useState(0);
  useEffect(() => {
    if (data) return;
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
      setEventsLoadError("");
      setEventsState("ready");
      return;
    }
    if (!session) {
      setEvents([]);
      setEventsLoadError("Authentication is required to load configured events.");
      setEventsState("error");
      return;
    }
    let cancelled = false;
    setEvents([]);
    setEventsLoadError("");
    setEventsState("loading");
    api<EventDefinition[]>(session, `/api/properties/${property.id}/events`)
      .then((next) => {
        if (cancelled) return;
        setEvents(next);
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
  }, [data, eventsReloadToken, fixture, property.id, session]);
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
      setEventsState("ready");
      setOpen(false);
      setEventError("");
      setInstruction(
        eventType === "click"
          ? `<button data-claritude-event="${normalizedName}">…</button>`
          : eventType === "pageview"
            ? `claritude.pageview({ path: "${normalisePagePath(pathValue)}" });`
            : `claritude.event("${normalizedName}", { page: location.pathname }); // call only after confirmed success`,
      );
      notify("Event configuration saved");
    } catch (error: any) {
      setEventError(error.message);
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
  return (
    <>
      <Panel
        title={data ? `Events · ${fmt(data.keyEvents || 0)} total` : "Configured events"}
        actions={
          <>
            {data && <Link className="btn" to={`/settings?property=${property.id}&settingsTab=Events`}>Event setup instructions</Link>}
            <button className={data ? "primary" : "btn"} onClick={() => setOpen(true)}>
              {!data && <Plus />}
              Create event
            </button>
          </>
        }
      >
        {data && filters && options && onFilterChange ? (
          <>
            <AnalyticsPageFilterToolbar filters={filters} options={options} onChange={onFilterChange} title="Events" categories={analyticsFilterConfigs.Events.categories} scope="this event table" />
            <AnalyticsValueTable
              headers={["Event", "Count", "Share"]}
              rows={(data.eventBreakdown || []).map((event: any) => ({
                label: eventLabel(event.name),
                value: event.count,
                secondary: data.keyEvents ? `${(event.count / data.keyEvents * 100).toFixed(1)}%` : "0.0%",
              }))}
            />
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
                  event.event_type === "form_success" ? "Confirmed success" : event.event_type === "pageview" ? "Page view" : "Element click",
                  "Yes",
                  event.received ?? "—",
                  event.enabled === false ? "Paused" : "Active",
                  <button className="btn" onClick={() => void toggleEvent(event)}>{event.enabled ? "Disable" : "Enable"}</button>,
                ])}
              />
            ) : (
              <Empty title="No configured events" detail="Create an event to define a tracked interaction for this property." />
            )}
            <p className="subtle">No form values or unrestricted button text are collected.</p>
          </>
        )}
      </Panel>
      {open && (
        <SimpleDialog
          title="Create event"
          close={() => setOpen(false)}
          action="Create event"
          onSave={saveEvent}
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
    </>
  );
}
function AuditProgress({ run, onRetry }: { run: AuditRun; onRetry: () => void }) {
  const total = run.progress_total || 0;
  const complete = Math.min(run.progress_completed || 0, total || Number.MAX_SAFE_INTEGER);
  const percent = total ? Math.round((complete / total) * 100) : null;
  const heartbeat = Date.parse(run.heartbeat_at || run.created_at);
  const stalled = ["queued", "running"].includes(run.status) && Number.isFinite(heartbeat) && Date.now() - heartbeat > 10 * 60_000;
  const stageLabels: Record<string, string> = {
    queued: "Waiting for an audit worker",
    fetching_page: "Collecting the selected page",
    evaluating_checks: "Evaluating available checks",
    collecting_network_evidence: "Checking DNS, robots, sitemaps and optional resources",
    persisting_results: "Saving evidence and scores",
    failed: "Audit failed",
  };
  return (
    <section className={`audit-progress ${run.status === "failed" || stalled ? "failed" : ""}`} aria-live="polite">
      <div className="audit-progress-copy">
        <b>{stalled ? "Audit stalled" : run.status === "queued" ? "Queued" : run.status === "failed" ? "Audit failed" : "Audit in progress"}</b>
        <span>{stalled ? "The audit worker stopped reporting progress." : stageLabels[run.execution_stage || run.status] || cap((run.execution_stage || run.status).replaceAll("_", " "))}</span>
        <small>
          {total ? `${complete} of ${total} checks` : "Preparing work total"}
          {run.created_at ? ` · ${relative(run.created_at)}` : ""}
        </small>
        {run.error && <small className="error-note">{run.error}</small>}
      </div>
      <div
        className={`audit-progress-track ${percent == null ? "indeterminate" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total || undefined}
        aria-valuenow={total ? complete : undefined}
      >
        <span style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      {(run.status === "failed" || stalled) && <button className="btn" onClick={onRetry}><RefreshCw /> Retry audit</button>}
    </section>
  );
}

function AuditFilterButton({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
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
  const options = compact
    ? ["critical", "security", "warning"]
    : ["critical", "security", "warning", "advisory", "pass"];
  const icons: Record<string, ReactNode> = {
    critical: <OctagonAlert />,
    security: <ShieldAlert />,
    warning: <TriangleAlert />,
    advisory: <Eye />,
    pass: <SquareCheckBig />,
  };
  return (
    <div className="audit-filter-wrap" ref={wrapper}>
      <button className="btn audit-overview-filter" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}>
        <Filter /> {value === "All" ? "Filters" : cap(value)}
      </button>
      {open && (
        <div className="action-menu audit-filter-actions" id={menuId} role="menu">
          {options.map((option) => (
            <button key={option} role="menuitemcheckbox" aria-checked={value === option} className={value === option ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>
              <span className={`audit-filter-icon ${option}`}>{icons[option]}</span>{option === "security" ? "Security critical" : cap(option)}{value === option && <Check />}
            </button>
          ))}
          <div className="menu-separator" />
          <button role="menuitem" disabled={value === "All"} onClick={() => { onChange("All"); setOpen(false); }}>Clear filters</button>
        </div>
      )}
    </div>
  );
}

function AuditScore({ run }: { run?: AuditRun }) {
  const categoryScores = auditRunCategoryScores(run);
  const complete = isAuditRunComplete(run);
  const score = complete ? run?.score : undefined;
  return (
    <div className="audit-score-row">
      <div
        className={`audit-score ${complete && (score || 0) >= 80 ? "good" : "warn"} ${complete ? "" : "partial"}`}
        style={{ "--score": score || 0 } as any}
      >
        <span>{complete ? score ?? "—" : run ? "Partial" : "—"}</span>
      </div>
      <div className="audit-six-stats">
        {auditCategories.map((x) => {
          const categoryScore = categoryScores[x];
          return (
          <div className="audit-six-stat" key={x}>
            <small>{x}</small>
            <b>{categoryScore ?? "Pending"}</b>
            <span className={categoryScore == null ? "subtle" : "trend-up"}>
              {categoryScore == null
                ? run
                  ? "Not implemented in this run"
                  : "Awaiting audit"
                : "Evidence-backed checks"}
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
const auditDetailedCategories = [
  ["page.metadata", "SEO: Page Metadata", "SEO"],
  ["crawling.and.indexing", "SEO: Crawling and Indexing", "SEO"],
  ["content.structure.and.headings", "Content Structure and Headings", "SEO"],
  ["links.and.navigation", "Links and Navigation", "SEO"],
  ["images.and.media", "Images and Media", "SEO"],
  ["accessibility", "Accessibility", "Accessibility"],
  ["mobile.and.responsive.layout", "Mobile and Responsive Layout", "Performance"],
  ["performance", "Performance", "Performance"],
  ["security.and.browser.protections", "Security and Browser Protections", "Security"],
  ["server.and.http.information", "Server and HTTP Information", "Infrastructure"],
  ["dns.and.domain.configuration", "DNS and Domain Configuration", "Infrastructure"],
  ["structured.data", "Structured Data", "Infrastructure"],
  ["social.sharing.and.site.identity", "Social Sharing and Site Identity", "Infrastructure"],
  ["crawler.permissions", "AI Readiness: Crawler Permissions", "AI Readiness"],
  ["content.and.attribution", "AI Readiness: Content and Attribution", "AI Readiness"],
  ["optional.resources", "AI Readiness: Optional Resources", "AI Readiness"],
] as const;

function auditSeverityGroup(result: any) {
  if (result.outcome === "pass") return "pass";
  if (["informational", "not_applicable", "unable_to_test"].includes(result.outcome)) return "advisory";
  const severe = ["critical", "high"].includes(String(result.severity).toLowerCase()) || result.outcome === "fail";
  if (severe && String(result.category) === "Security") return "security";
  if (severe) return "critical";
  return "warning";
}

function auditGroupIcon(group: string) {
  if (group === "security") return <ShieldAlert />;
  if (group === "warning") return <TriangleAlert />;
  if (group === "advisory") return <Eye />;
  if (group === "pass") return <SquareCheckBig />;
  return <OctagonAlert />;
}

function AuditFindingsPanel({
  pageName,
  results,
  filter,
  setFilter,
  openCategories,
  setOpenCategories,
  onRetest,
  onReview,
}: {
  pageName: string;
  results: any[];
  filter: string;
  setFilter: (filter: string) => void;
  openCategories: Set<string>;
  setOpenCategories: (value: Set<string>) => void;
  onRetest: (checkId: string) => void;
  onReview: (resultId: string | number, status: string) => void;
}) {
  const counts = Object.fromEntries(["critical", "security", "warning", "advisory", "pass"].map((group) => [group, results.filter((result) => auditSeverityGroup(result) === group).length]));
  const filtered = filter === "All" ? results : results.filter((result) => auditSeverityGroup(result) === filter);
  const categories = auditDetailedCategories.filter(([key]) => filter === "All" || filtered.some((result) => result.subcategory === key));
  return (
    <section className="panel audit-findings-panel">
      <h2>{pageName} findings</h2>
      <div className="audit-summary audit-findings-summary" aria-label="Finding result filters">
        {(["critical", "security", "warning", "advisory", "pass"] as const).map((group) => (
          <button key={group} className={`audit-summary-item ${group} ${filter === group ? "selected" : ""}`} onClick={() => setFilter(filter === group ? "All" : group)} aria-label={`${group === "security" ? "Security critical" : group}: ${counts[group]}`}>
            {auditGroupIcon(group)} {counts[group]}
          </button>
        ))}
      </div>
      <AuditFilterButton value={filter} onChange={setFilter} />
      <div className="audit-findings-divider" />
      {categories.length ? categories.map(([key, label]) => {
        const categoryResults = filtered.filter((result) => result.subcategory === key);
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
            {open && <AuditResults results={categoryResults} onRetest={onRetest} onReview={onReview} />}
          </section>
        );
      }) : (
        <Empty title="No matching findings" detail="Clear the active filter to view all categories." />
      )}
    </section>
  );
}

function AuditChecksPanel({ pageName, run, results, onOpenCategory }: { pageName: string; run?: AuditRun; results: any[]; onOpenCategory: (category: string) => void }) {
  const summary = {
    automated: run?.catalogue_summary?.snapshotChecks ?? results.length,
    passed: results.filter((result) => result.outcome === "pass").length,
    findings: results.filter((result) => ["fail", "warning"].includes(result.outcome)).length,
    informational: results.filter((result) => ["informational", "not_applicable"].includes(result.outcome)).length,
    reviewed: results.filter((result) => result.review_status && result.review_status !== "not_reviewed").length,
  };
  const unable = results.filter((result) => result.outcome === "unable_to_test").length;
  return (
    <>
      <div className="audit-check-summary">
        {[["Automated checks", summary.automated], ["Passed", summary.passed], ["Findings", summary.findings], ["Informational / N/A", summary.informational], ["Reviewed", summary.reviewed]].map(([label, value]) => (
          <div key={String(label)}><small>{label}</small><b>{value}</b></div>
        ))}
      </div>
      <section className="panel audit-checks-panel">
        <h2>{pageName} checks</h2>
        <div className="table-wrap">
          <table className="audit-checks-table">
            <thead><tr><th>Category</th><th>Checks</th><th>Passed</th><th>Findings</th><th>Info / N/A</th><th>Pass rate</th></tr></thead>
            <tbody>
              {auditDetailedCategories.map(([key, label]) => {
                const rows = results.filter((result) => result.subcategory === key);
                const passed = rows.filter((result) => result.outcome === "pass").length;
                const findings = rows.filter((result) => ["fail", "warning"].includes(result.outcome)).length;
                const info = rows.filter((result) => ["informational", "not_applicable"].includes(result.outcome)).length;
                const denominator = passed + findings;
                const passRate = denominator ? Math.round(passed / denominator * 100) : null;
                return (
                  <tr key={key}>
                    <td><button className={`audit-category-bar ${passRate == null ? "unknown" : ""}`} style={{ "--pass-rate": passRate || 0 } as any} onClick={() => onOpenCategory(key)}><span>{label}</span></button></td>
                    <td>{rows.length}</td><td>{passed}</td><td>{findings}</td><td>{info}</td><td>{passRate == null ? "—" : `${passRate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="subtle audit-checks-note">Pass rate is Passed ÷ (Passed + Findings). Informational, not applicable and {unable} unable-to-test {unable === 1 ? "result is" : "results are"} excluded from that denominator. Reviewed is a separate status and can overlap any outcome.</p>
      </section>
    </>
  );
}

function auditFindingIdentity(result: any) {
  const evidence = result.evidence && typeof result.evidence === "object" ? result.evidence : {};
  const resource = evidence.resource || evidence.url || evidence.path || evidence.src || evidence.selector || evidence.element || "page";
  return `${result.check_id || result.id}:${String(resource).slice(0, 500)}`;
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
  const earlierResults = earlier.audit_results || [];
  const laterResults = later.audit_results || [];
  const previousByCheck = new Map(earlierResults.map((result: any) => [result.check_id, result]));
  const currentByCheck = new Map(laterResults.map((result: any) => [result.check_id, result]));
  const previousFindings = earlierResults.filter((result: any) => ["fail", "warning"].includes(result.outcome));
  const currentFindings = laterResults.filter((result: any) => ["fail", "warning"].includes(result.outcome));
  const previousFindingIds = new Set(previousFindings.map(auditFindingIdentity));
  const currentFindingIds = new Set(currentFindings.map(auditFindingIdentity));
  const resolved = previousFindings.filter((result: any) => {
    const current: any = currentByCheck.get(result.check_id);
    return current && current.outcome !== "unable_to_test" && !["fail", "warning"].includes(current.outcome) && !currentFindingIds.has(auditFindingIdentity(result));
  }).length;
  const added = currentFindings.filter((result: any) => {
    const previous: any = previousByCheck.get(result.check_id);
    return previous && previous.outcome !== "unable_to_test" && !["fail", "warning"].includes(previous.outcome) && !previousFindingIds.has(auditFindingIdentity(result));
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

function AuditResults({ results, onRetest, onReview }: { results: any[]; onRetest?: (checkId: string) => void; onReview?: (resultId: string | number, status: string) => void }) {
  return (
    <div className="audit-result-list">
      {results.length ? (
        results.map((x, i) => (
          <details className="audit-item" key={x.id || i}>
            <summary>
              <span className={`severity-icon ${auditSeverityGroup(x)}`}>{auditGroupIcon(auditSeverityGroup(x))}</span>
              <span>
                <b>{x.title || x.title_snapshot || x.check_id}</b>
                <small>
                  {x.category || "General"}
                  {x.subcategory && x.subcategory !== "General" ? ` · ${x.subcategory}` : ` · ${cap(x.outcome || x.status || "Recorded")}`}
                </small>
              </span>
            </summary>
            <div className="audit-detail">
              <div className="audit-review-row">
                <span className="tag">{cap(x.outcome || "recorded")}</span>
                <span className="subtle">Review status: {String(x.review_status || "not_reviewed").replaceAll("_", " ")}</span>
                {onReview && x.id && <button className="text-link" onClick={() => onReview(x.id, x.review_status === "reviewed" ? "not_reviewed" : "reviewed")}>{x.review_status === "reviewed" ? "Clear review" : "Mark reviewed"}</button>}
              </div>
              <p>{x.description || "The audit recorded this result for the selected page."}</p>
              <b className="audit-detail-label">Affected element or resource</b>
              <code>{auditEvidenceText(x.evidence)}</code>
              <b className="audit-detail-label">Recommended fix</b>
              <p>{x.recommendation || "Review the recorded evidence and update the affected implementation."}</p>
              <div className="audit-detail-actions">
                <button className="btn" onClick={() => onRetest?.(x.check_id)} disabled={!onRetest || !x.check_id}><RefreshCw /> Re-test</button>
                <a className="btn" href={auditLearnMoreUrl(x.category, x.source_reference)} target="_blank" rel="noreferrer"><HelpCircle /> Learn more</a>
              </div>
            </div>
          </details>
        ))
      ) : (
        <Empty
          title="No findings available"
          detail="Run an audit to generate evidence-backed findings."
        />
      )}
    </div>
  );
}
function filterAuditFindings(results: any[], filter: string) {
  if (filter === "All") return results;
  const normalized = filter.toLowerCase();
  if (normalized === "critical")
    return results.filter((result) => String(result.category) !== "Security" && (["critical", "high"].includes(result.severity) || result.outcome === "fail"));
  if (normalized === "security")
    return results.filter((result) => String(result.category).toLowerCase() === "security" && (["critical", "high"].includes(result.severity) || result.outcome === "fail"));
  if (normalized === "advisory")
    return results.filter((result) => ["informational", "not_applicable", "unable_to_test"].includes(result.outcome));
  return results.filter(
    (result) =>
      String(result.category || "").toLowerCase().includes(normalized) ||
      String(result.outcome || "").toLowerCase().includes(normalized) ||
      String(result.severity || "").toLowerCase().includes(normalized),
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
      <DataTable headers={["Metric", "Value", "Target"]} rows={rows} />
    ) : (
      <EmptyCompact
        title="Browser lab metrics not implemented"
        detail="The current source audit did not execute a rendered-browser performance pass."
      />
    )
  );
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
        headers={["Metric", "P75 value", "Target", "Samples"]}
        rows={vitals.map((vital: any) => [
          vital.name,
          formatVital(vital.name, vital.value),
          vital.name === "LCP" ? "≤ 2.5 s" : vital.name === "INP" ? "≤ 200 ms" : vital.name === "CLS" ? "≤ 0.1" : "Observed",
          fmt(vital.samples || 0),
        ])}
      />
      {source?.from && source?.to && (
        <p className="subtle">Reporting range: {fmtDate(source.from)} to {fmtDate(source.to)} · page-specific p75 field observations.</p>
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
  return (
    <Panel title="Onboarding checklist">
      <div className="onboarding-list large">
        {[
          [property.verification_status === "verified", "Property verified"],
          [!!property.uptime_monitors?.length, "Uptime monitoring enabled"],
          [!!property.tracking_last_received_at, "Analytics receiving data"],
          [!!property.audit_runs?.length, "First audit completed"],
        ].map(([ok, label]) => (
          <span key={String(label)}>
            {ok ? <CheckCircle2 /> : <CircleAlert />}
            <b>{label}</b>
            <small>{ok ? "Complete" : "Needs attention"}</small>
          </span>
        ))}
      </div>
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
  "Performance",
  "Accessibility",
  "Security",
  "Infrastructure",
  "AI Readiness",
];
const auditCategoryPrefixes: Record<string, string[]> = {
  SEO: ["SEO"],
  Performance: ["Performance", "Mobile"],
  Accessibility: ["Accessibility"],
  Security: ["Security"],
  Infrastructure: ["Infrastructure", "Server", "DNS", "Structured Data", "Social Sharing"],
  "AI Readiness": ["AI Readiness"],
};

function auditRunCategoryScores(run?: AuditRun) {
  return Object.fromEntries(
    auditCategories.map((category) => [
      category,
      run?.category_scores?.[category] ?? auditCategoryScore(run?.audit_results, auditCategoryPrefixes[category]),
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
      const outcome = isFinding ? (securityCritical || ordinaryCritical ? "fail" : "warning") : isInfo ? "informational" : "pass";
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
    const resolvedIndex = generatedResults.findIndex((result) => result.outcome === "pass");
    generatedResults[0] = { ...generatedResults[0], outcome: "pass", severity: "informational" };
    generatedResults[resolvedIndex] = { ...generatedResults[resolvedIndex], outcome: "warning", severity: "warning" };
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
  const categoryScores = {
    SEO: 94 + pageOffset + comparisonOffset,
    Performance: 82 + pageOffset + comparisonOffset,
    Accessibility: 91 + pageOffset + comparisonOffset,
    Security: 88 + pageOffset + comparisonOffset,
    Infrastructure: 92 + pageOffset + comparisonOffset,
    "AI Readiness": 84 + pageOffset + comparisonOffset,
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
      passedChecks: auditResults.filter((result) => result.outcome === "pass").length,
    },
    registry_snapshot: auditResults.map((result) => ({ id: result.check_id })),
    audit_results: auditResults,
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
      ) && ["pass", "warning", "fail"].includes(result.outcome),
  );
  if (!executed.length) return null;
  const weighted = executed.map((result) => ({
    value: result.outcome === "pass" ? 1 : result.outcome === "warning" ? 0.5 : 0,
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
  Events: { title: "Events", categories: ["Event name", "Page", "Source", "Device", "Country"], scope: "this event table" },
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

function comparisonText(current: number | undefined, previous: number | undefined) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !previous) return "No comparable previous period";
  const change = ((Number(current) - Number(previous)) / Number(previous)) * 100;
  return `${change >= 0 ? "↑" : "↓"} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
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

function eventLabel(value: string) {
  const known: Record<string, string> = {
    form_success: "Successful form submissions",
    "successful-form-submission": "Successful form submissions",
    outbound: "Outbound clicks",
  };
  return known[value] || String(value || "Event").replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shareRows(values: any[] = [], total = 0, iconKind?: string) {
  return values.map((row) => ({
    label: iconKind === "country" ? countryLabel(row.name) : cap(String(row.name)),
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

function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return rounded >= 60 ? `${Math.floor(rounded / 60)} min ${rounded % 60} s` : `${rounded} s`;
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

function chartDateLabel(value: string, timeZone?: string) {
  if (value.includes("T")) {
    const instant = new Date(value);
    return Number.isFinite(instant.valueOf())
      ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone }).format(instant)
      : value;
  }
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date) : value;
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
    averageDailyVisitors: 474,
    dailyVisitorMethod: "anonymous_sessions",
    pages: ANALYTICS_FIXTURE_PAGES.map(({ path, pageviews, events }) => ({
      path,
      pageviews,
      events,
    })),
    series,
    previous: {
      pageviews: 25320,
      keyEvents: 334,
      series: series.map((point, index) => ({ ...point, day: `2026-08-${String(index + 1).padStart(2, "0")}`, pageviews: Math.round(point.pageviews * 0.89), events: Math.round(point.events * 0.91), dailyVisitors: Math.round(point.dailyVisitors * 0.92) })),
      performance: { series: Object.fromEntries(Object.entries(performanceSeries).map(([metric, points]) => [metric, points.map((point: any, index) => ({ ...point, day: `2026-08-${String(index + 1).padStart(2, "0")}`, value: point.value * 1.08 }))])) },
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
      { name: "email-clicks", count: 50 },
      { name: "outbound-clicks", count: 30 },
    ],
    engagement: {
      eligiblePageviews: 28460,
      engagedPageviews: 18402,
      medianScrollDepth: 64,
      pageviewsWithKeyEvents: 318,
      medianActiveSeconds: 102,
      engagementRate: 64.7,
      javascriptErrors: 36,
      scrollDepth: [{ depth: 25, pageviews: 21320 }, { depth: 50, pageviews: 16840 }, { depth: 75, pageviews: 10260 }, { depth: 90, pageviews: 6740 }],
      pages: [{ path: "/services/", engagedViews: 4820 }, { path: "/work/", engagedViews: 3940 }, { path: "/contact/", engagedViews: 1740 }, { path: "/insights/", engagedViews: 1480 }],
      visibleSections: [{ name: "services", count: 13250 }],
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
    pages: rows.map(({ path, pageviews, events }) => ({ path, pageviews, events })),
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
  const labels: Record<string, string> = {
    DE: "Germany",
    GB: "United Kingdom",
    US: "United States",
    UNKNOWN: "Unknown",
  };
  return labels[value.toUpperCase()] || value;
}

function fmt(x: number) {
  return new Intl.NumberFormat("en-GB").format(x || 0);
}
function fmtDate(x: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(x));
}
function shortDate(x: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: new Date(x).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(`${x}T12:00:00`));
}
function periodLabel(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const day = (value: Date) => value.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = (value: Date) => months[value.getMonth()];
  if (from === to) return `${day(start)} ${month(start)} ${start.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth())
      return `${day(start)}–${day(end)} ${month(end)} ${end.getFullYear()}`;
    return `${day(start)} ${month(start)}–${day(end)} ${month(end)} ${end.getFullYear()}`;
  }
  return `${day(start)} ${month(start)} ${start.getFullYear()}–${day(end)} ${month(end)} ${end.getFullYear()}`;
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
