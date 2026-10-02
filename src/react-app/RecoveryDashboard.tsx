import type { Session } from "@supabase/supabase-js";
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
  Globe2,
  HelpCircle,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  MoreHorizontal,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
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
  score?: number;
  coverage?: number;
  page_url?: string;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
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
};
type AnalyticsFilterOptions = {
  paths: string[];
  devices: string[];
  sources: string[];
  countries: string[];
};

async function api<T>(
  session: Session,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body as T;
}

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
  reload: () => void;
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
  const allProperties = data.properties;
  const requestedWorkspace = new URLSearchParams(loc.search).get("workspace");
  const requested = new URLSearchParams(loc.search).get("property");
  const property =
    allProperties.find((p) => p.id === requested) ||
    (loc.pathname !== "/" && loc.pathname !== "/notifications"
      ? allProperties[0]
      : undefined);
  const workspaceMemberships = data.workspaces || [];
  const workspace: any =
    workspaceMemberships.find((entry: any) => entry.workspaces?.id === requestedWorkspace)
      ?.workspaces ||
    workspaceMemberships.find((entry: any) => entry.workspaces?.id === property?.workspace_id)
      ?.workspaces ||
    workspaceMemberships[0]?.workspaces || {
    name: "Websi workspace",
  };
  const currentWorkspaceMembership = workspaceMemberships.find(
    (entry: any) => entry.workspaces?.id === workspace?.id,
  );
  const canManageWorkspace = fixture || ["owner", "member"].includes(currentWorkspaceMembership?.role);
  const canManageAccount = fixture || ["owner", "member"].includes(data.accounts?.[0]?.role);
  const properties = property
    ? allProperties
    : workspace?.id
      ? allProperties.filter((item) => item.workspace_id === workspace.id)
      : allProperties;
  const workspaceContext =
    loc.pathname === "/" || loc.pathname === "/notifications";
  const section = loc.pathname.split("/")[1] || "workspace";
  const notify: Notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  };
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
    navigate(id ? href("overview", id) : "/");
  }
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
              setWorkspaceMenu((value) => !value);
            }
          }}
        >
          <Menu className="mobile-toggle" />
          <span className="avatar">
            <img src="/assets/websi-mark.svg" alt="" />
          </span>
          <b>{fixture ? "Websi workspace" : workspace.name || "Shared properties"}</b>
          <span className="badge">{fixture ? "Scale" : "Pro"}</span>
          <span className="chevs">
            ⌃<br />⌄
          </span>
        </button>
        <button
          className="selector selector-button"
          onClick={() => setPropertyMenu((v) => !v)}
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
          <ChevronDown />
        </button>
        <div className="page-title">{title}</div>
        <div className="brand">
          <img src="/assets/claritude-logo.svg" alt="Claritude" />
        </div>
      </header>
      {workspaceMenu && (
        <SelectorMenu
          className="workspace-menu"
          search="Find workspace"
          close={() => setWorkspaceMenu(false)}
        >
          {(fixture
            ? [{ workspaces: { id: "fixture", name: "Websi workspace" } }]
            : workspaceMemberships
          ).map((entry: any) => {
            const candidate = entry.workspaces;
            const count = allProperties.filter((item) => item.workspace_id === candidate.id).length;
            return (
              <button
                className="selector-option"
                key={candidate.id}
                onClick={() => {
                  setWorkspaceMenu(false);
                  navigate(fixture ? "/" : `/?workspace=${candidate.id}`);
                }}
              >
                <span className="avatar">
                  <img src="/assets/websi-mark.svg" alt="" />
                </span>
                <span>
                  <b>{candidate.name}</b>
                  <small>{count} properties</small>
                </span>
                {candidate.id === workspace.id && <Check />}
              </button>
            );
          })}
          {canManageAccount && (
            <button
              className="selector-option"
              onClick={() => {
                setWorkspaceMenu(false);
                setWorkspaceOpen(true);
              }}
            >
              <Plus />
              <span>
                <b>Add new workspace</b>
                <small>Create another workspace</small>
              </span>
            </button>
          )}
        </SelectorMenu>
      )}
      {propertyMenu && (
        <PropertyMenu
          properties={properties}
          active={property?.id}
          select={selectProperty}
          add={canManageWorkspace ? () => {
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
      {addOpen && canManageWorkspace && (
        <AddPropertyDialog
          session={session}
          workspaceId={workspace?.id}
          close={() => setAddOpen(false)}
          done={() => {
            setAddOpen(false);
            reload();
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
            const accountId = data.accounts?.[0]?.accounts?.id;
            if (!accountId) throw new Error("Account not available");
            await api(session, "/api/workspaces", {
              method: "POST",
              body: JSON.stringify({ accountId, name: workspaceName }),
            });
            setWorkspaceOpen(false);
            setWorkspaceName("");
            reload();
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

function SelectorMenu({
  className = "",
  search,
  close,
  children,
}: {
  className?: string;
  search: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button className="menu-scrim" aria-label="Close menu" onClick={close} />
      <div className={`menu selector-menu ${className}`}>
        <input aria-label={search} placeholder={search} />
        {children}
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
  const rows = properties.filter((p) =>
    (p.name + p.canonical_host).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <button
        className="menu-scrim"
        aria-label="Close menu"
        onClick={() => select(active)}
      />
      <div className="menu selector-menu property-menu">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find property"
          aria-label="Find property"
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
        </div>
        {add && (
          <>
            <div className="menu-divider" />
            <button onClick={add}>
              <Plus />
              Add property
            </button>
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
    [checkData, setCheckData] = useState<any>(null);
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
      const checks = Array.from({ length: 42 }, (_, i) => ({
        checked_at: new Date(Date.now() - (41 - i) * 12 * 60 * 60_000).toISOString(),
        response_ms: 168 + ((i * 37) % 190),
        success: i !== 25,
      }));
      setCheckData({
        checks,
        summary: { availability: 99.92, averageResponseMs: 246, medianResponseMs: 231, p95ResponseMs: 341 },
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
        ]
      : incidentData;
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
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Uptime"
      status={<Period />}
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
                "Last 30 days",
              ],
              [
                "Average response",
                checkData?.summary?.averageResponseMs != null
                  ? `${checkData.summary.averageResponseMs} ms`
                  : "—",
                "Successful checks",
              ],
              ["Incidents", relevant.length, "Recorded history"],
              [
                "Check interval",
                monitor ? `${monitor.interval_minutes} min` : "—",
                "Automatic schedule",
              ],
            ]}
          />
          <Panel
            title="Response time"
            actions={
              <span className="subtle">
                Median {checkData?.summary?.medianResponseMs ?? "—"} ms · P95{" "}
                {checkData?.summary?.p95ResponseMs ?? "—"} ms
              </span>
            }
          >
            <SeriesChart
              points={(checkData?.checks || []).map((x: any) => ({
                label: fmtDate(x.checked_at),
                value: x.response_ms || 0,
              }))}
              emptyTitle="No uptime checks recorded"
            />
          </Panel>
          <Panel
            title="30 day uptime"
            actions={
              <span>
                <i className="status-dot online" /> Available &nbsp;{" "}
                <i className="status-dot down" /> Incident
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
                    day.total && day.successful < day.total ? "warn" : ""
                  }
                  title={
                    day.total
                      ? `${day.day}: ${day.successful}/${day.total} checks available`
                      : `${day.day}: no checks`
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
                    <Status value={monitor?.last_status || "pending"} />,
                  ],
                  [
                    "Response",
                    monitor?.last_response_ms
                      ? `${monitor.last_response_ms} ms`
                      : "—",
                  ],
                  [
                    "Checked",
                    monitor?.last_checked_at
                      ? relative(monitor.last_checked_at)
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
              <IncidentTable incidents={relevant.slice(0, 2)} />
              <button
                className="btn panel-action"
                onClick={() => setTab("Incidents")}
              >
                View all incidents
              </button>
            </Panel>
            <Panel title="Monitor configuration">
              <KeyValues
                rows={[
                  ["Method", "GET"],
                  [
                    "Expected response",
                    `HTTP ${monitor?.expected_status_min || 200}–${monitor?.expected_status_max || 399}`,
                  ],
                  [
                    "Failure threshold",
                    `${monitor?.failure_threshold || 2} checks`,
                  ],
                  ["Execution", "Cloudflare queue worker"],
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
  const analyticsLocation = useLocation();
  const analyticsNavigate = useNavigate();
  const analyticsParams = useMemo(
    () => new URLSearchParams(analyticsLocation.search),
    [analyticsLocation.search],
  );
  const analyticsTabs = [
    "Overview",
    "Pages",
    "Sources",
    "Events",
    "Audience",
    "Engagement",
    "Performance",
  ];
  const requestedTab = analyticsParams.get("analyticsTab");
  const tab = analyticsTabs.includes(requestedTab || "") ? requestedTab! : "Overview";
  const pageFilters = analyticsPageFiltersFromParams(analyticsParams);
  const livePeriod = periodQuery(analyticsLocation.search);
  const pageFilterQuery = analyticsPageFilterQuery(pageFilters);
  const [data, setData] = useState<any>(null);
  const [pagesData, setPagesData] = useState<any>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [pagesReload, setPagesReload] = useState(0);

  const setTab = (nextTab: string) => {
    const next = new URLSearchParams(analyticsLocation.search);
    if (nextTab === "Overview") next.delete("analyticsTab");
    else next.set("analyticsTab", nextTab);
    analyticsNavigate(`${analyticsLocation.pathname}?${next.toString()}`, { replace: true });
  };
  const setPageFilters = (nextFilters: AnalyticsPageFilters) => {
    const next = new URLSearchParams(analyticsLocation.search);
    for (const key of ["pageSearch", "pathMode", "pathValue", "device", "source", "country"])
      next.delete(key);
    if (nextFilters.pageSearch) next.set("pageSearch", nextFilters.pageSearch);
    if (nextFilters.pathMode && nextFilters.pathValue) {
      next.set("pathMode", nextFilters.pathMode);
      next.set("pathValue", nextFilters.pathValue);
    }
    if (nextFilters.device) next.set("device", nextFilters.device);
    if (nextFilters.source) next.set("source", nextFilters.source);
    if (nextFilters.country) next.set("country", nextFilters.country);
    next.set("analyticsTab", "Pages");
    analyticsNavigate(`${analyticsLocation.pathname}?${next.toString()}`, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    if (session && property) {
      api<any>(
        session,
        `/api/properties/${property.id}/analytics?${livePeriod}`,
      )
        .then((next) => !cancelled && setData(next))
        .catch(() => !cancelled && setData(null));
    } else if (fixture) setData(analyticsFixtureSummary());
    return () => {
      cancelled = true;
    };
  }, [property?.id, session, fixture, livePeriod]);

  useEffect(() => {
    if (tab !== "Pages" || !property) return;
    let cancelled = false;
    setPagesLoading(true);
    setPagesError("");
    setPagesData(null);
    if (session) {
      api<any>(
        session,
        `/api/properties/${property.id}/analytics?${livePeriod}${pageFilterQuery ? `&${pageFilterQuery}` : ""}`,
      )
        .then((next) => {
          if (!cancelled) setPagesData(next);
        })
        .catch((error) => {
          if (!cancelled) setPagesError(error.message || "Page analytics could not be loaded");
        })
        .finally(() => {
          if (!cancelled) setPagesLoading(false);
        });
    } else if (fixture) {
      setPagesData(filterAnalyticsFixture(pageFilters));
      setPagesLoading(false);
    } else {
      setPagesError("Authentication is required to load page analytics.");
      setPagesLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [fixture, livePeriod, pageFilterQuery, pagesReload, property?.id, session, tab]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Analytics is property-specific."
      />
    );
  const toPageRows = (source: any[] = []) =>
    source.map((p: any) => ({
      page: typeof p === "string" ? p : p.path,
      views: typeof p === "string" ? 0 : p.pageviews || 0,
      events: typeof p === "string" ? 0 : p.events || 0,
    }));
  const pages = toPageRows(pagesData?.pages);
  const overviewPages = toPageRows(data?.pages);
  const filterOptions: AnalyticsFilterOptions = pagesData?.filterOptions ||
    data?.filterOptions || { paths: [], devices: [], sources: [], countries: [] };
  const rows = (values: any[] = []) =>
    values.map((x) => [x.name, x.count] as (string | number)[]);
  return (
    <Page title="Analytics" status={<Period />}>
      <Tabs
        labels={analyticsTabs}
        value={tab}
        onChange={setTab}
      />
      {tab === "Overview" ? (
        <>
          <Metrics
            values={[
              [
                "Pageviews",
                fmt(data?.pageviews || 0),
                fixture ? "↑ 12.4%" : "Accepted pageviews",
              ],
              [
                "Events",
                fmt(data?.events || 0),
                fixture ? "↑ 8.2%" : "All accepted events",
              ],
              [
                "Key events",
                fmt(data?.keyEvents || 0),
                "Clicks, outbound links and confirmed forms",
              ],
              ["Observed pages", overviewPages.length, "Unique paths"],
              [
                "Tracking",
                property.tracking_last_received_at
                  ? "Receiving data"
                  : "Not installed",
                property.tracking_last_received_at
                  ? relative(property.tracking_last_received_at)
                  : "Never",
              ],
            ]}
          />
          <Panel
            title="Traffic"
            actions={<ChartSwitch notify={notify} events />}
          >
            <div className="chart-legend">
              <span>Current period</span>
              <span className="previous">Previous period</span>
            </div>
            <SeriesChart
              points={(data?.series || []).map((x: any) => ({
                label: x.day,
                value: x.pageviews,
              }))}
              emptyTitle="No measured traffic yet"
            />
          </Panel>
          <div className="grid equal">
            <Panel title="Top pages">
              <AnalyticsTable pages={overviewPages} property={property} groupedLimit={5} />
            </Panel>
            <Panel title="Top sources">
              <BarRows rows={fixture ? [["Google",12480],["Direct",8410],["LinkedIn",4360],["Email",3210]] : rows(data?.sources)} />
            </Panel>
          </div>
        </>
      ) : tab === "Pages" ? (
        <Panel title="Pages">
          <AnalyticsPageFilterToolbar
            filters={pageFilters}
            options={filterOptions}
            onChange={setPageFilters}
          />
          {pagesData?.truncated && (
            <p className="analytics-data-warning" role="status">
              This result reached the 50,000-event query limit. Narrow the date range or add a filter before treating the totals as complete.
            </p>
          )}
          {pagesLoading ? (
            <Empty title="Loading page analytics…" detail="Applying the selected property, dates and filters." />
          ) : pagesError ? (
            <div className="analytics-state" role="alert">
              <Empty title="Page analytics could not be loaded" detail={pagesError} />
              <button className="btn" onClick={() => setPagesReload((value) => value + 1)}>Retry</button>
            </div>
          ) : pages.length ? (
            <AnalyticsTable pages={pages} property={property} groupedLimit={5} />
          ) : (
            <div className="analytics-state">
              <Empty
                title={hasAnalyticsPageFilters(pageFilters) ? "No matching page results" : "No pageviews in this period"}
                detail={hasAnalyticsPageFilters(pageFilters)
                  ? "No recorded pageviews or configured events match every active filter."
                  : "A genuinely tracked pageview will appear here after it is received."}
              />
              {hasAnalyticsPageFilters(pageFilters) && (
                <button className="btn" onClick={() => setPageFilters({})}>Clear all filters</button>
              )}
            </div>
          )}
        </Panel>
      ) : tab === "Sources" ? (
        <Panel title="Traffic sources">
          <BarRows rows={fixture ? [["Google",12480],["Direct",8410],["LinkedIn",4360],["Instagram",1910],["Email",1300]] : rows(data?.sources)} />
        </Panel>
      ) : tab === "Events" ? (
        <EventsPanel
          session={session}
          property={property}
          fixture={fixture}
          notify={notify}
        />
      ) : tab === "Audience" ? (
        <div className="grid equal">
          <Panel title="Countries">
            <BarRows rows={fixture ? [["United Kingdom",18440],["United States",4280],["Germany",1960],["France",1320]] : rows(data?.countries)} />
          </Panel>
          <Panel title="Devices">
            <BarRows rows={fixture ? [["Desktop",15780],["Mobile",11740],["Tablet",940]] : rows(data?.devices)} />
          </Panel>
        </div>
      ) : tab === "Engagement" ? (
        <Metrics
          values={[
            ["Engaged sessions", fixture ? "18,420" : fmt(data?.engagement?.engagedSessions || 0), "Measured sessions"],
            ["Avg active time", fixture ? "2m 18s" : data?.engagement?.averageActiveSeconds != null ? `${data.engagement.averageActiveSeconds}s` : "—", "Foreground time"],
            ["Scroll 75%", fixture ? "42%" : data?.engagement?.scroll75Rate != null ? `${data.engagement.scroll75Rate.toFixed(1)}%` : "—", "Eligible pageviews"],
            ["Key-event rate", fixture ? "1.3%" : data?.engagement?.keyEventRate != null ? `${data.engagement.keyEventRate.toFixed(1)}%` : "—", "Events per pageview"],
          ]}
        />
      ) : (
        <div className="grid equal">
          <Panel title="Core Web Vitals">
            <DataTable
              headers={["Metric", "Result", "Target", "Samples"]}
              rows={fixture ? [["LCP","2.3 s","≤ 2.5 s","1,248"],["INP","168 ms","≤ 200 ms","1,109"],["CLS","0.04","≤ 0.1","1,248"]] : (data?.vitals || []).map((x: any) => [x.name, x.name === "CLS" ? x.value : `${Math.round(x.value)} ms`, x.name === "LCP" ? "≤ 2500 ms" : x.name === "INP" ? "≤ 200 ms" : x.name === "CLS" ? "≤ 0.1" : "Observed", x.samples])}
            />
          </Panel>
          <Panel title="Browsers">
            <BarRows rows={fixture ? [["Chrome",17480],["Safari",7830],["Firefox",2130],["Edge",1020]] : rows(data?.browsers)} />
          </Panel>
        </div>
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
  const livePeriod = periodQuery(auditLocation.search);
  const [runs, setRuns] = useState<AuditRun[]>([]),
    [tab, setTab] = useState("Overview"),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("All"),
    [filterOpen, setFilterOpen] = useState(false),
    [pageMenu, setPageMenu] = useState(false),
    [addPage, setAddPage] = useState(false),
    [auditPages, setAuditPages] = useState<any[]>([]),
    [selectedPage, setSelectedPage] = useState<any>({ name: "Homepage", path: "/" }),
    [pageName, setPageName] = useState(""),
    [pagePath, setPagePath] = useState("/");
  useEffect(() => {
    if (session && property) {
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits?${livePeriod}`)
        .then(setRuns)
        .catch(() => setRuns([]));
      api<any[]>(session, `/api/properties/${property.id}/audit-pages`)
        .then((pages) => {
          const next = [{ name: "Homepage", path: "/" }, ...pages.filter((page) => page.path !== "/")];
          setAuditPages(next);
          setSelectedPage(next[0]);
        })
        .catch(() => setAuditPages([{ name: "Homepage", path: "/" }]));
    } else if (fixture) {
      setRuns([fixtureAudit(property)]);
      setAuditPages([{ name: "Homepage", path: "/" }]);
    }
  }, [property?.id, session, fixture, livePeriod]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Audit results are property-specific."
      />
    );
  const latest = runs[0],
    results = latest?.audit_results || [],
    partial = (latest?.coverage ?? 0) < 80;
  const resultCounts = {
    failed: results.filter((result: any) => result.outcome === "fail").length,
    unavailable: results.filter((result: any) => result.outcome === "unable_to_test").length,
    warnings: results.filter((result: any) => result.outcome === "warning").length,
  };
  async function run() {
    setBusy(true);
    try {
      if (session)
        await api(session, "/api/audits", {
          method: "POST",
          body: JSON.stringify({
            propertyId: property!.id,
            pageUrl: new URL(selectedPage.path, property!.url).href,
          }),
        });
      notify("Audit started");
      if (session) {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1250));
          const next = await api<AuditRun[]>(
            session,
            `/api/properties/${property!.id}/audits?${livePeriod}`,
          );
          setRuns(next);
          if (next[0] && ["completed", "partial", "failed"].includes(next[0].status)) {
            notify(
              next[0].status === "failed"
                ? "Audit failed—open History for the recorded error"
                : `Audit ${next[0].status}: ${next[0].coverage ?? 0}% catalogue coverage`,
            );
            break;
          }
        }
      }
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAuditPage() {
    try {
      if (!session) throw new Error("Authentication required");
      const saved = await api<any>(session, `/api/properties/${property!.id}/audit-pages`, {
        method: "POST",
        body: JSON.stringify({ name: pageName, path: pagePath }),
      });
      const next = [
        { name: "Homepage", path: "/" },
        ...auditPages.filter((page) => page.path !== "/" && page.path !== saved.path),
        saved,
      ];
      setAuditPages(next);
      setSelectedPage(saved);
      setAddPage(false);
      setPageName("");
      setPagePath("/");
      notify("Page added to this audit selection");
    } catch (error: any) {
      notify(error.message);
    }
  }
  const visible =
    filter === "All"
      ? results
      : results.filter(
          (x: any) =>
            (x.category || "").toLowerCase().includes(filter.toLowerCase()) ||
            String(x.outcome).includes(filter.toLowerCase()),
        );
  return (
    <Page
      title="Audit"
      status={<Period />}
      actions={
        <button className="primary" onClick={run} disabled={busy}>
          <RefreshCw />
          {busy ? "Queuing…" : "Run audit"}
        </button>
      }
    >
      <div className="audit-nav-row">
        <button className="audit-page-picker" onClick={() => setPageMenu((value) => !value)}>
          <Globe2 />
          <span>
            <b>{selectedPage.name}</b>
            <small>{selectedPage.path}</small>
          </span>
          <ChevronDown />
        </button>
        {pageMenu && (
          <div className="action-menu audit-page-menu">
            {auditPages.map((page) => (
              <button
                key={page.path}
                className={selectedPage.path === page.path ? "selected" : ""}
                onClick={() => { setSelectedPage(page); setPageMenu(false); }}
              >
                <Globe2 /> {page.name} {selectedPage.path === page.path && <Check />}
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
          onChange={setTab}
        />
      </div>
      {partial && (
        <div className="coverage-note partial">
          <b>Partial catalogue coverage</b>
          <span>
            {latest?.coverage || 0}% of the active catalogue produced evidence.
            This score must not be treated as a complete site grade.
          </span>
        </div>
      )}
      {tab === "Overview" ? (
        <>
          <AuditScore run={latest} />
          <div className="grid">
            <Panel title={`Fix these first · ${selectedPage.name}`}>
              <div className="audit-summary">
                <button className="audit-summary-item">
                  <CircleAlert />{resultCounts.failed}
                </button>
                <button className="audit-summary-item">
                  <ShieldCheck />{resultCounts.unavailable}
                </button>
                <button className="audit-summary-item">
                  <CircleAlert />{resultCounts.warnings}
                </button>
              </div>
              <AuditResults results={results.slice(0, 7)} />
            </Panel>
            <div>
              <Panel title="Desktop performance">
                <PerformanceTable mobile={false} run={latest} />
              </Panel>
              <Panel title="Mobile performance">
                <PerformanceTable mobile run={latest} />
              </Panel>
            </div>
          </div>
        </>
      ) : tab === "Findings" ? (
        <Panel
          title="Findings"
          actions={
            <>
              <button
                className="btn"
                onClick={() => setFilterOpen((value) => !value)}
              >
                <Filter />
                {filter === "All" ? "Filters" : filter}
              </button>
              {filterOpen && (
                <div className="action-menu audit-filter-actions">
                  {["All", ...auditCategories, "pass", "warning", "fail", "unable_to_test"].map((value) => (
                    <button key={value} className={filter === value ? "selected" : ""} onClick={() => { setFilter(value); setFilterOpen(false); }}>
                      {cap(value.replaceAll("_", " "))}{filter === value && <Check />}
                    </button>
                  ))}
                </div>
              )}
            </>
          }
        >
          <AuditResults results={visible} />
        </Panel>
      ) : tab === "Checks" ? (
        <Panel title="Catalogue checks">
          <DataTable
            headers={["Measure", "Count", "Meaning"]}
            rows={[
              [
                "Catalogue entries",
                latest?.catalogue_summary?.catalogueSize ?? "Pending",
                "Mapped checks in the active catalogue",
              ],
              [
                "Implemented checks",
                latest?.catalogue_summary?.implementedChecks ?? "Pending",
                "Checks with executable logic",
              ],
              [
                "Snapshot checks",
                latest?.catalogue_summary?.snapshotChecks ?? "Pending",
                "Versioned checks selected for this run",
              ],
              [
                "Attempted checks",
                latest?.catalogue_summary?.attemptedChecks ?? results.length,
                "Checks for which the runner recorded a result",
              ],
              [
                "Successfully executed",
                latest?.catalogue_summary?.successfullyExecutedChecks ??
                  results.filter((result: any) => result.outcome !== "unable_to_test").length,
                "Results backed by evidence rather than unavailable status",
              ],
              [
                "Passed",
                latest?.catalogue_summary?.passedChecks ??
                  results.filter((result: any) => result.outcome === "pass").length,
                "Successfully executed checks that passed",
              ],
            ]}
          />
        </Panel>
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
        <Panel title="Compare audit runs">
          {runs.length > 1 ? (
            <DataTable
              headers={["Metric", "Latest", "Previous", "Change"]}
              rows={[
                [
                  "Overall",
                  runs[0].score,
                  runs[1].score,
                  (runs[0].score || 0) - (runs[1].score || 0),
                ],
                [
                  "Coverage",
                  `${runs[0].coverage}%`,
                  `${runs[1].coverage}%`,
                  "—",
                ],
              ]}
            />
          ) : (
            <Empty
              title="A second completed audit is required"
              detail="Run another audit to compare results."
            />
          )}
        </Panel>
      )}
      {addPage && (
        <Modal title="Add page to audit" close={() => setAddPage(false)}>
          <label className="field">Page name<input value={pageName} onChange={(event) => setPageName(event.target.value)} placeholder="About" /></label>
          <label className="field">Path<input value={pagePath} onChange={(event) => setPagePath(event.target.value)} placeholder="/about" /></label>
          <p className="subtle">The path is resolved on {property.canonical_host}.</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setAddPage(false)}>Cancel</button>
            <button className="primary" onClick={() => void saveAuditPage()}>Add page</button>
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
  const [tab, setTab] = useState("General"),
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
    [viewers, setViewers] = useState<any[]>([]);
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
  }, [property?.id, session]);
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
        labels={[
          "General",
          "Tracking",
          "Uptime",
          "Events",
          "Sharing",
          "Advanced",
        ]}
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
              ]}
            />
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
            ]}
            rows={[
              ["Account holder", "Owner", "Allowed", "Allowed", "Allowed", "Allowed"],
              ...viewers.map((viewer) => [
                viewer.name || viewer.email,
                cap(viewer.role),
                "View only",
                "View only",
                "View only",
                "Not allowed",
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
              <button className="danger-solid" disabled>
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
    [workspaceName, setWorkspaceName] = useState(
      data.workspaces?.[0]?.workspaces?.name || "",
    ),
    [usersData, setUsersData] = useState<any>(null),
    [inviteOpen, setInviteOpen] = useState(false),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState("member");
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
    api(session, "/api/users").then(setUsersData).catch(() => setUsersData(null));
  }, [session, data.workspaces.length, role]);
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
  async function saveWorkspace() {
    const workspaceId = data.workspaces?.[0]?.workspaces?.id;
    if (!session || !workspaceId || !workspaceName.trim()) return;
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
          <label className="field">
            Workspace name
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
          </label>
          <DataTable
            headers={["Workspace", "Properties", "Access"]}
            rows={data.workspaces.map((entry: any) => [
              entry.workspaces?.name || "Workspace",
              data.properties.filter((property) => property.workspace_id === entry.workspaces?.id).length,
              cap(entry.role),
            ])}
          />
          <button
            className="primary"
            onClick={saveWorkspace}
          >
            Save workspace
          </button>
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
          <DataTable
            headers={[
              "User",
              "Seat",
              "Access level",
              "Property access",
              "Status",
              "",
            ]}
            rows={(usersData?.workspaceMemberships || []).map((membership: any) => {
              const user = usersData.users?.find((item: any) => item.id === membership.user_id);
              const workspace = usersData.workspaces?.find((item: any) => item.id === membership.workspace_id);
              return [
                user?.name || user?.email || membership.user_id,
                membership.role === "viewer" ? "Free viewer" : "Editing user",
                cap(membership.role),
                workspace?.name || "Workspace",
                user?.confirmedAt ? "Active" : "Invited",
                "",
              ];
            })}
          />
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
            const workspaceId = data.workspaces?.[0]?.workspaces?.id;
            if (!session || !workspaceId || !inviteEmail) return;
            try {
              const invited = await api<any>(session, `/api/workspaces/${workspaceId}/members`, {
                method: "POST",
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
              });
              setInviteOpen(false);
              setInviteEmail("");
              setUsersData(await api(session, "/api/users"));
              notify(invited.invitationSent ? "Invitation sent" : "Existing user granted access");
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <label className="field">Email<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label className="field">Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
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
  workspaceId,
  close,
  done,
}: {
  session: Session | null;
  workspaceId: string;
  close: () => void;
  done: () => void;
}) {
  const [name, setName] = useState(""),
    [url, setUrl] = useState("https://"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (session)
        await api(session, "/api/properties", {
          method: "POST",
          body: JSON.stringify({ workspaceId, name, url }),
        });
      done();
    } catch (e: any) {
      setError(e.message);
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
          <select>
            <option>Websi workspace</option>
          </select>
        </label>
        {error && <div className="notice danger">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Add property
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
}: {
  title: string;
  close: () => void;
  action: string;
  onSave: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <Modal title={title} close={close}>
      {children}
      <div className="dialog-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="primary" onClick={onSave}>
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
  emptyTitle,
}: {
  points: { label: string; value: number }[];
  emptyTitle: string;
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
    max = Math.max(1, ...points.map((x) => Number(x.value) || 0)),
    coords = points.map((point, i) => ({
      ...point,
      x: points.length === 1 ? width / 2 : (i / (points.length - 1)) * width,
      y: height - 18 - ((Number(point.value) || 0) / max) * (height - 42),
    })),
    polyline = coords.map((x) => `${x.x},${x.y}`).join(" ");
  return (
    <div className="live-chart-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="chart live-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label="Measured time series"
      >
        {[30, 70, 110, 150].map((y) => (
          <line className="chart-grid" x1="0" x2={width} y1={y} y2={y} key={y} />
        ))}
        <polygon
          className="series-fill"
          points={`0,${height} ${polyline} ${width},${height}`}
        />
        <polyline className="series" points={polyline} />
        {coords.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <rect
              className="chart-hit"
              x={Math.max(0, point.x - width / Math.max(points.length, 2) / 2)}
              y="0"
              width={width / Math.max(points.length, 2)}
              height={height}
              onMouseEnter={() => setHover(index)}
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
          <b>{coords[hover].value.toLocaleString()}</b>
          <small>{coords[hover].label}</small>
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
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="panel-head">
          <h2>{title}</h2>
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
function IncidentTable({ incidents }: { incidents: any[] }) {
  return (
    <Panel title="Incident history">
      {incidents.length ? (
        <DataTable
          headers={["Property", "Opened", "Cause", "Duration", "Status"]}
          rows={incidents.map((i) => [
            i.property || "Selected property",
            fmtDate(i.opened_at),
            i.cause || "Check failed",
            i.resolved_at
              ? formatDuration(new Date(i.resolved_at).valueOf() - new Date(i.opened_at).valueOf())
              : formatDuration(Date.now() - new Date(i.opened_at).valueOf()),
            i.resolved_at ? "Resolved" : "Open",
          ])}
        />
      ) : (
        <Empty
          title="No incidents recorded"
          detail="Confirmed failures and recoveries appear here."
        />
      )}
    </Panel>
  );
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
}: {
  filters: AnalyticsPageFilters;
  options: AnalyticsFilterOptions;
  onChange: (filters: AnalyticsPageFilters) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Page search");
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

  const categories = ["Page search", "Exact path / prefix", "Device", "Source", "Country"];
  const categoryOptions = category === "Device"
    ? options.devices
    : category === "Source"
      ? options.sources
      : category === "Country"
        ? options.countries
        : [];
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
  const remove = (key: keyof AnalyticsPageFilters) => {
    const next = { ...filters };
    delete next[key];
    if (key === "pathValue") delete next.pathMode;
    onChange(next);
  };
  const selectedValue = category === "Device"
    ? filters.device
    : category === "Source"
      ? filters.source
      : filters.country;
  const setDimensionValue = (value: string) => {
    const key = category === "Device" ? "device" : category === "Source" ? "source" : "country";
    onChange({ ...filters, [key]: selectedValue === value ? undefined : value });
    setOpen(false);
  };

  return (
    <div className="toolbar section-filters analytics-filter-row">
      <div className="analytics-filter-wrap" ref={menuRef}>
        <button
          className="btn"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          <Filter /> Add filter
        </button>
        {open && (
          <div className="action-menu analytics-filter-menu" role="menu">
            <b className="analytics-filter-title">Filter Pages</b>
            <label className="analytics-menu-search">
              <Search />
              <input
                aria-label="Search filter values"
                value={menuSearch}
                placeholder="Search values…"
                onChange={(event) => setMenuSearch(event.target.value)}
              />
            </label>
            <div className="two-col-menu">
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
              <div className="menu-col analytics-filter-choices">
                <b>{category}</b>
                {category === "Page search" ? (
                  <>
                    <input
                      aria-label="Page search"
                      value={pageDraft}
                      placeholder="Search page paths"
                      onChange={(event) => setPageDraft(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && applyText("page")}
                    />
                    <button className="filter-apply" onClick={() => applyText("page")}>Apply page search</button>
                  </>
                ) : category === "Exact path / prefix" ? (
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
                      {category === "Country" ? countryLabel(value) : cap(value)}
                      {selectedValue === value && <><span className="spacer" /><Check /></>}
                    </button>
                  ))
                ) : (
                  <small className="subtle analytics-no-values">No collected values for this period.</small>
                )}
              </div>
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
      <small className="subtle">Filters affect this page table.</small>
    </div>
  );
}

function AnalyticsTable({
  pages,
  property,
  groupedLimit = 5,
}: {
  pages: any[];
  property: Property;
  groupedLimit?: number;
}) {
  const [groupOpen, setGroupOpen] = useState(false);
  const groupedPages = pages.slice(groupedLimit);
  const visiblePages = pages.slice(0, groupedLimit);
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
            <tr><th>Page</th><th>Pageviews</th><th>Events</th></tr>
          </thead>
          <tbody>
            {rows.map((page) => (
              <tr key={page.page}>
                <td className="bar-cell">
                  <span
                    className="bar-bg"
                    aria-hidden="true"
                    style={{ width: `${Math.max(4, (page.views / max) * 92)}%` }}
                  />
                  {page.grouped ? (
                    <button className="table-detail-link" onClick={() => setGroupOpen(true)}>
                      Other grouped pages
                    </button>
                  ) : (
                    <span className="page-link-cell">
                      <b>{page.page}</b>
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
                </td>
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
function BarRows({ rows }: { rows: (string | number)[][] }) {
  if (!rows.length)
    return (
      <Empty
        title="No measured data"
        detail="This breakdown will populate after compatible events are received."
      />
    );
  const max = Math.max(...rows.map((r) => Number(r[1])));
  return (
    <div className="bar-rows">
      {rows.map((r) => (
        <div className="bar-row" key={String(r[0])}>
          <span
            className="bar-fill"
            style={{ width: `${(Number(r[1]) / max) * 100}%` }}
          />
          <b>{r[0]}</b>
          <span>{fmt(Number(r[1]))}</span>
        </div>
      ))}
    </div>
  );
}
function EventsPanel({
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("download-brochure");
  const [eventType, setEventType] = useState("click");
  const [events, setEvents] = useState<any[]>(
    fixture
      ? [
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
        ]
      : [],
  );
  useEffect(() => {
    if (session)
      api<any[]>(session, `/api/properties/${property.id}/events`)
        .then(setEvents)
        .catch(() => setEvents([]));
  }, [session, property.id]);
  async function saveEvent() {
    try {
      const created = session
        ? await api<any>(session, `/api/properties/${property.id}/events`, {
            method: "POST",
            body: JSON.stringify({ name, eventType }),
          })
        : { name, event_type: eventType, enabled: true };
      setEvents((current) => [...current, created]);
      setOpen(false);
      notify("Event configuration saved");
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function toggleEvent(event: any) {
    try {
      if (!session || !event.id) throw new Error("This event cannot be changed here");
      const updated = await api<any>(session, `/api/properties/${property.id}/events/${event.id}`, {
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
        title="Configured events"
        actions={
          <button className="btn" onClick={() => setOpen(true)}>
            <Plus />
            Create event
          </button>
        }
      >
        <DataTable
          headers={["Event", "Trigger", "Key event", "Received", "Status", ""]}
          rows={events.map((event) => [
            event.name,
            event.event_type === "form_success"
              ? "Confirmed success"
              : event.event_type === "pageview"
                ? "Page view"
                : "Element click",
            "Yes",
            event.received ?? "—",
            event.enabled === false ? "Paused" : "Active",
            <button className="btn" onClick={() => void toggleEvent(event)}>
              {event.enabled ? "Disable" : "Enable"}
            </button>,
          ])}
        />
        <p className="subtle">
          No form values or unrestricted button text are collected.
        </p>
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
            Trigger type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
            >
              <option value="click">Element click</option>
              <option value="pageview">Page view</option>
              <option value="form_success">Confirmed form success</option>
            </select>
          </label>
          <p className="subtle">
            Property: {property.canonical_host}. For click events, add{" "}
            <code>data-claritude-event=&quot;{name}&quot;</code> to the tracked element.
            Confirmed form successes must be emitted only after the provider reports success.
          </p>
        </SimpleDialog>
      )}
    </>
  );
}
function AuditScore({ run }: { run?: AuditRun }) {
  const score = run?.score;
  const categoryPrefixes: Record<string, string[]> = {
    SEO: ["SEO"],
    Performance: ["Performance", "Mobile"],
    Accessibility: ["Accessibility"],
    Security: ["Security"],
    Infrastructure: ["Server", "DNS", "Structured Data", "Social Sharing"],
    "AI Readiness": ["AI Readiness"],
  };
  return (
    <div className="audit-score-row">
      <div
        className={`audit-score ${(score || 0) >= 80 ? "good" : "warn"}`}
        style={{ "--score": score || 0 } as any}
      >
        <span>{score ?? "—"}</span>
      </div>
      <div className="audit-six-stats">
        {auditCategories.map((x) => {
          const categoryScore =
            run?.category_scores?.[x] ??
            auditCategoryScore(run?.audit_results, categoryPrefixes[x]);
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
function AuditResults({ results }: { results: any[] }) {
  return (
    <div>
      {results.length ? (
        results.map((x, i) => (
          <details className="audit-item" key={x.id || i}>
            <summary>
              <span
                className={`severity-icon sev-${x.severity || severity(x.outcome)}`}
              >
                <CircleAlert />
              </span>
              <span>
                <b>{x.title || x.title_snapshot || x.check_id}</b>
                <small>
                  {x.category || "General"} ·{" "}
                  {cap(x.outcome || x.status || "Recorded")}
                </small>
              </span>
            </summary>
            <div className="audit-detail">
              <p>
                {typeof x.evidence === "string"
                  ? x.evidence
                  : JSON.stringify(x.evidence || {})}
              </p>
              <button className="btn">View evidence and fix</button>
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
function fixtureAudit(property?: Property): AuditRun {
  return {
    id: "fixture-audit",
    status: "completed",
    score: property?.demo?.audit ?? 87,
    coverage: 100,
    page_url: "https://websi.com/",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    duration_ms: 2840,
    category_scores: {
      SEO: 94,
      Performance: 82,
      Accessibility: 91,
      Security: 88,
      Infrastructure: 92,
      "AI Readiness": 84,
    },
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
      implementedChecks: 16,
      snapshotChecks: 16,
      attemptedChecks: 16,
      successfullyExecutedChecks: 16,
      passedChecks: 9,
    },
    audit_results: [
      {
        id: "1",
        title: "Hero image discovered too late",
        category: "Performance",
        outcome: "fail",
        severity: "critical",
        evidence: "LCP image was not preloaded; mobile LCP 3.4s.",
      },
      {
        id: "2",
        title: "Contact form label missing",
        category: "Accessibility",
        outcome: "fail",
        severity: "critical",
        evidence: "One input on /contact has no associated label.",
      },
      {
        id: "3",
        title: "Content Security Policy missing",
        category: "Security",
        outcome: "warning",
        severity: "warning",
        evidence: "No Content-Security-Policy header was returned.",
      },
      {
        id: "4",
        title: "Unused JavaScript (71 KB)",
        category: "Performance",
        outcome: "warning",
        severity: "warning",
        evidence: "Estimated unused transfer on mobile.",
      },
      {
        id: "5",
        title: "Cache lifetime too short",
        category: "Performance",
        outcome: "warning",
        severity: "warning",
        evidence: "Three static resources have short cache lifetimes.",
      },
      {
        id: "6",
        title: "Meta description duplicated",
        category: "SEO",
        outcome: "warning",
        severity: "warning",
        evidence: "Homepage and /services share the same description.",
      },
      {
        id: "7",
        title: "Keyboard focus is hidden",
        category: "Accessibility",
        outcome: "warning",
        severity: "warning",
        evidence: "Header controls suppress their visible focus indicator.",
      },
    ],
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
      ) && result.outcome !== "unable_to_test",
  );
  if (!executed.length) return null;
  const points = executed.reduce(
    (total, result) =>
      total + (result.outcome === "pass" ? 1 : result.outcome === "warning" ? 0.5 : 0),
    0,
  );
  return Math.round((points / executed.length) * 100);
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

const ANALYTICS_FIXTURE_PAGES = [
  { path: "/", pageviews: 10840, events: 96, device: "desktop", source: "Google", country: "GB" },
  { path: "/services/", pageviews: 6320, events: 72, device: "desktop", source: "Google", country: "GB" },
  { path: "/work/", pageviews: 4610, events: 41, device: "desktop", source: "Direct", country: "GB" },
  { path: "/contact/", pageviews: 2140, events: 124, device: "mobile", source: "Google", country: "US" },
  { path: "/insights/", pageviews: 1880, events: 25, device: "mobile", source: "LinkedIn", country: "GB" },
  { path: "/privacy/", pageviews: 980, events: 0, device: "desktop", source: "Direct", country: "GB" },
  { path: "/terms/", pageviews: 720, events: 0, device: "mobile", source: "Direct", country: "US" },
  { path: "/about/", pageviews: 610, events: 0, device: "tablet", source: "Google", country: "DE" },
  { path: "/video/", pageviews: 360, events: 0, device: "mobile", source: "LinkedIn", country: "DE" },
];

function analyticsFixtureSummary() {
  return {
    pageviews: 28460,
    events: 358,
    keyEvents: 358,
    pages: ANALYTICS_FIXTURE_PAGES.map(({ path, pageviews, events }) => ({
      path,
      pageviews,
      events,
    })),
    series: Array.from({ length: 30 }, (_, index) => ({
      day: `2026-09-${String(index + 1).padStart(2, "0")}`,
      pageviews: 620 + ((index * 97) % 610),
      events: 6 + ((index * 7) % 19),
    })),
    sources: [{ name: "Google", count: 12480 }, { name: "Direct", count: 8410 }],
    countries: [{ name: "GB", count: 18440 }],
    devices: [{ name: "Desktop", count: 15780 }, { name: "Mobile", count: 11740 }],
    browsers: [{ name: "Chrome", count: 17480 }, { name: "Safari", count: 7830 }],
    engagement: {
      engagedSessions: 18420,
      averageActiveSeconds: 138,
      scroll75Rate: 42,
      keyEventRate: 1.3,
    },
    vitals: [
      { name: "LCP", value: 2300, samples: 1248 },
      { name: "INP", value: 168, samples: 1109 },
      { name: "CLS", value: 0.04, samples: 1248 },
    ],
    filterOptions: {
      paths: ANALYTICS_FIXTURE_PAGES.map((page) => page.path),
      devices: ["desktop", "mobile", "tablet"],
      sources: ["Direct", "Google", "LinkedIn"],
      countries: ["DE", "GB", "US"],
    },
  };
}

function filterAnalyticsFixture(filters: AnalyticsPageFilters) {
  const pageSearch = filters.pageSearch?.trim().toLocaleLowerCase();
  const pathValue = filters.pathValue
    ? normalisePagePath(filters.pathValue).toLocaleLowerCase()
    : "";
  const rows = ANALYTICS_FIXTURE_PAGES.filter((page) => {
    const path = page.path.toLocaleLowerCase();
    if (pageSearch && !path.includes(pageSearch)) return false;
    if (pathValue && filters.pathMode === "exact" && path !== pathValue) return false;
    if (pathValue && filters.pathMode === "prefix" && !path.startsWith(pathValue)) return false;
    if (filters.device && page.device !== filters.device.toLocaleLowerCase()) return false;
    if (filters.source && page.source !== filters.source) return false;
    if (filters.country && page.country !== filters.country) return false;
    return true;
  });
  return {
    ...analyticsFixtureSummary(),
    pageviews: rows.reduce((sum, page) => sum + page.pageviews, 0),
    events: rows.reduce((sum, page) => sum + page.events, 0),
    keyEvents: rows.reduce((sum, page) => sum + page.events, 0),
    pages: rows.map(({ path, pageviews, events }) => ({ path, pageviews, events })),
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
  return params.toString();
}

function hasAnalyticsPageFilters(filters: AnalyticsPageFilters) {
  return Boolean(
    filters.pageSearch ||
      filters.pathValue ||
      filters.device ||
      filters.source ||
      filters.country,
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
