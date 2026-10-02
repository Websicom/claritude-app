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
  demo?: DemoMetrics;
};
type Bootstrap = {
  profile: any;
  accounts: any[];
  workspaces: any[];
  properties: Property[];
  incidents: any[];
  notifications: any[];
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

const fixtureProjects: Property[] = [
  project(
    "fixture-property",
    "Websi",
    "websi.com",
    "online",
    28460,
    358,
    87,
    96,
  ),
  project(
    "north",
    "North Commerce",
    "northcommerce.example",
    "offline",
    12480,
    168,
    72,
    89,
  ),
  project(
    "atlas",
    "Atlas Studio",
    "atlas.example",
    "online",
    8410,
    121,
    91,
    97,
  ),
  project(
    "cedar",
    "Cedar Finance",
    "cedar.example",
    "online",
    7190,
    104,
    89,
    94,
  ),
  project("river", "River Health", "river.example", "online", 6630, 93, 94, 98),
  project("lumen", "Lumen Labs", "lumen.example", "online", 5910, 81, 85, 92),
  project("oak", "Oak & Co", "oak.example", "online", 4890, 70, 90, 95),
  project(
    "harbour",
    "Harbour Homes",
    "harbour.example",
    "online",
    4030,
    62,
    86,
    91,
  ),
  project(
    "willow",
    "Willow Legal",
    "willow.example",
    "online",
    3570,
    48,
    79,
    88,
  ),
  project("field", "Field Notes", "field.example", "online", 2980, 41, 93, 96),
  project(
    "studio",
    "Studio North",
    "studio.example",
    "online",
    2670,
    32,
    84,
    90,
  ),
  project("new", "New project", "uninstalled.example", "paused", 0, 0, 0, 0),
];
function project(
  id: string,
  name: string,
  host: string,
  status: string,
  pageviews: number,
  events: number,
  audit: number,
  performance: number,
): Property {
  return {
    id,
    name,
    url: `https://${host}`,
    canonical_host: host,
    verification_status: "verified",
    tracking_id: `fixture_${id}`,
    tracking_last_received_at: pageviews
      ? new Date(Date.now() - 42000).toISOString()
      : undefined,
    demo: {
      pageviews,
      events,
      audit,
      performance,
      uptime:
        status === "offline" ? "99.61%" : status === "paused" ? "—" : "99.92%",
      visitors: Math.round(pageviews / 60),
      status,
    },
    uptime_monitors: [
      {
        id: `m-${id}`,
        enabled: status !== "paused",
        interval_minutes: 5,
        timeout_ms: 10000,
        failure_threshold: 2,
        expected_status_min: 200,
        expected_status_max: 399,
        last_status: status,
        last_response_ms: 218,
        last_checked_at: new Date(Date.now() - 45000).toISOString(),
      },
    ],
    audit_runs: audit
      ? [
          {
            id: `a-${id}`,
            status: "completed",
            score: audit,
            coverage: 100,
            created_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ]
      : [],
  };
}

export function RecoveryDashboard({
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
    [helpOpen, setHelpOpen] = useState(false);
  const properties = fixture ? fixtureProjects : data.properties;
  const requested = new URLSearchParams(loc.search).get("property");
  const property =
    properties.find((p) => p.id === requested) ||
    (loc.pathname !== "/" && loc.pathname !== "/notifications"
      ? properties[0]
      : undefined);
  const workspace: any = data.workspaces?.[0]?.workspaces || {
    name: "Websi workspace",
  };
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
  const warning = fixture
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
  return (
    <div className="app reference-app">
      <header className="top">
        <button
          className="workspace top-selector"
          onClick={() => setWorkspaceMenu((v) => !v)}
        >
          <Menu className="mobile-toggle" />
          <span className="avatar">
            <img src="/assets/websi-mark.svg" alt="" />
          </span>
          <b>{fixture ? "Websi workspace" : workspace.name}</b>
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
          <button className="selector-option">
            <span className="avatar">
              <img src="/assets/websi-mark.svg" alt="" />
            </span>
            <span>
              <b>{fixture ? "Websi workspace" : workspace.name}</b>
              <small>{properties.length} properties</small>
            </span>
            <Check />
          </button>
          <button
            className="selector-option"
            onClick={() =>
              notify("Workspace creation is not enabled for this preview")
            }
          >
            <Plus />
            <span>
              <b>Add new workspace</b>
              <small>Create another workspace</small>
            </span>
          </button>
        </SelectorMenu>
      )}
      {propertyMenu && (
        <PropertyMenu
          properties={properties}
          active={property?.id}
          select={selectProperty}
          add={() => {
            setPropertyMenu(false);
            setAddOpen(true);
          }}
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
              {!workspaceContext && property && (
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
                {fixture && <i className="notif-count">5</i>}
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
                  onClick={() => notify("Alerts snoozed for one hour")}
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
                  properties={properties}
                  data={data}
                  fixture={fixture}
                  openAdd={() => setAddOpen(true)}
                  notify={notify}
                />
              }
            />
            <Route
              path="/notifications"
              element={
                <Notifications data={data} fixture={fixture} notify={notify} />
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
      {addOpen && (
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
  add: () => void;
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
        <div className="menu-divider" />
        <button onClick={add}>
          <Plus />
          Add property
        </button>
      </div>
    </>
  );
}

function WorkspaceOverview({
  properties,
  data,
  fixture,
  openAdd,
  notify,
}: {
  properties: Property[];
  data: Bootstrap;
  fixture: boolean;
  openAdd: () => void;
  notify: Notify;
}) {
  const [tab, setTab] = useState("Properties"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [page, setPage] = useState(1);
  const filtered = properties.filter(
    (p) =>
      (p.name + p.canonical_host).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" || p.uptime_monitors?.[0]?.last_status === filter),
  );
  const shown = filtered.slice((page - 1) * 7, page * 7);
  const totals = properties.reduce(
    (a, p) => ({
      views: a.views + (p.demo?.pageviews || 0),
      events: a.events + (p.demo?.events || 0),
    }),
    { views: 0, events: 0 },
  );
  return (
    <Page
      title="Your properties"
      status={<Period />}
      actions={
        <button className="primary" onClick={openAdd}>
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
                fixture ? fmt(totals.views) : "—",
                fixture ? "↗ 12.8%" : "Measured data is property-scoped",
              ],
              [
                "Key events",
                fixture ? fmt(totals.events) : "—",
                fixture ? "↗ 8.2%" : "Measured data is property-scoped",
              ],
            ]}
          />
          <Panel>
            <div className="toolbar">
              <button
                className="btn"
                onClick={() =>
                  setFilter(
                    filter === "All"
                      ? "online"
                      : filter === "online"
                        ? "offline"
                        : "All",
                  )
                }
              >
                <Filter />
                Add filter
              </button>
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
                p.demo?.uptime || "—",
                p.demo ? fmt(p.demo.pageviews) : "—",
                p.demo ? fmt(p.demo.events) : "—",
                p.audit_runs?.[0]?.score
                  ? `${p.audit_runs[0].score} / 100`
                  : "—",
                p.demo?.performance || "—",
                p.tracking_last_received_at
                  ? "Receiving data"
                  : "Not installed",
                <button
                  className="iconbtn"
                  onClick={() => notify(`${p.name} actions opened`)}
                >
                  <MoreHorizontal />
                </button>,
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
            <Chart empty={!fixture} />
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
                fixture ? fmt(totals.views) : "—",
                "Current period",
              ],
              [
                "Key events",
                fixture ? fmt(totals.events) : "—",
                "Current period",
              ],
              [
                "Properties receiving",
                properties.filter((p) => p.tracking_last_received_at).length,
                "Active tracking",
              ],
              ["Period", "30 days", "1–30 Sep 2026"],
            ]}
          />
          <Chart empty={!fixture} />
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
  data,
  fixture,
  notify,
}: {
  data: Bootstrap;
  fixture: boolean;
  notify: Notify;
}) {
  const [scope, setScope] = useState("All notifications");
  const items = fixture
    ? [
        [
          "Monitor alert",
          "North Commerce returned HTTP 503 and is currently unavailable.",
          "North Commerce",
          "6 minutes ago",
        ],
        [
          "Audit issues",
          "Five unresolved audit findings need review.",
          "Websi",
          "1 hour ago",
        ],
        [
          "Recovery confirmed",
          "Atlas Studio recovered after one failed check.",
          "Atlas Studio",
          "Yesterday",
        ],
        [
          "Tracking inactive",
          "New project has not sent analytics data.",
          "New project",
          "2 days ago",
        ],
      ]
    : data.notifications.map((n: any) => [
        n.title,
        n.body,
        "Workspace",
        relative(n.created_at),
      ]);
  return (
    <Page
      title="Notifications"
      actions={
        <button
          className="btn"
          onClick={() => notify("All visible notifications marked as read")}
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
            <select>
              <option>All statuses</option>
              <option>Unread</option>
              <option>Read</option>
            </select>
          </label>
          <small className="subtle">{items.length} notifications</small>
        </div>
        {items.length ? (
          items.map((x, i) => (
            <div className="notification-card" key={i}>
              <CircleAlert />
              <span>
                <b>{x[0]}</b>
                <small>
                  {x[1]} <i className="notification-property-tag">{x[2]}</i>
                </small>
                <small>{x[3]}</small>
              </span>
              <button
                className="btn"
                onClick={() => notify("Notification marked as read")}
              >
                Mark read
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
  const [tab, setTab] = useState("Overview"),
    [analytics, setAnalytics] = useState<any>(null);
  useEffect(() => {
    if (session && property)
      api<any>(session, `/api/properties/${property.id}/analytics?days=30`)
        .then(setAnalytics)
        .catch(() => setAnalytics(null));
    else if (property && fixture)
      setAnalytics({
        pageviews: property.demo?.pageviews || 28460,
        events: property.demo?.events || 358,
        pages: ["/", "/services/", "/work/", "/contact/"],
      });
  }, [property?.id, session, fixture]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Choose a property to open its overview."
      />
    );
  const monitor = property.uptime_monitors?.[0],
    audit = property.audit_runs?.[0],
    views = analytics?.pageviews || 0;
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
                <div className="chart-legend">
                  <span>Current period</span>
                  <span className="previous">Previous period</span>
                </div>
                <Chart empty={!views} />
              </Panel>
              <Panel title="Website health">
                <div className="health-metrics">
                  <Metric
                    label="Overall"
                    value={audit?.score ? `${audit.score} / 100` : "—"}
                  />
                  <Metric label="Mobile" value={fixture ? "82" : "—"} />
                  <Metric label="Desktop" value={fixture ? "96" : "—"} />
                  <Metric label="SEO" value={fixture ? "94" : "—"} />
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
                {fixture ? (
                  <DataTable
                    headers={["Metric", "Result"]}
                    rows={[
                      ["LCP", "2.3 s"],
                      ["INP", "168 ms"],
                      ["CLS", "0.04"],
                      ["Samples", "1,248"],
                    ]}
                  />
                ) : (
                  <EmptyCompact
                    title="No Core Web Vitals samples"
                    detail="Performance appears after compatible browsers send measurements."
                  />
                )}
              </Panel>
              <Panel title="Top pages">
                {analytics?.pages?.length ? (
                  <DataTable
                    headers={["Page", "Views"]}
                    rows={analytics.pages
                      .slice(0, 5)
                      .map((p: string, i: number) => [
                        p,
                        fixture
                          ? fmt([10840, 6320, 4610, 2140][i] || 0)
                          : "Observed",
                      ])}
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
  const [tab, setTab] = useState("Overview"),
    [busy, setBusy] = useState(false),
    [maintenance, setMaintenance] = useState<any[]>([]),
    [dialog, setDialog] = useState(false);
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
      : incidents.filter((i) => i.property_id === property.id);
  async function check() {
    if (!monitor) return;
    setBusy(true);
    try {
      if (session)
        await api(session, `/api/monitors/${monitor.id}/check`, {
          method: "POST",
        });
      notify("Uptime check queued");
      setTimeout(reload, 1500);
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
                fixture ? "99.92%" : cap(monitor?.last_status || "Pending"),
                "Last 30 days",
              ],
              [
                "Latest response",
                monitor?.last_response_ms
                  ? `${monitor.last_response_ms} ms`
                  : "—",
                "HTTP response",
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
            title="30 day uptime"
            actions={
              <span>
                <i className="status-dot online" /> Available &nbsp;{" "}
                <i className="status-dot down" /> Incident
              </span>
            }
          >
            <div className="checkstrip">
              {Array.from({ length: 30 }, (_, i) => (
                <button
                  key={i}
                  className={i === 22 ? "warn" : ""}
                  title={i === 22 ? "Recorded incident" : "Available"}
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
                  startsAt: "2026-10-05T20:00:00+01:00",
                  reason: "Planned update",
                }),
              });
            }
            setMaintenance([
              [
                "Planned update",
                "5 Oct 2026, 20:00",
                "Europe/London",
                "Suppressed",
              ],
            ]);
            setDialog(false);
            notify("Maintenance window saved");
          }}
        >
          <label className="field">
            Name
            <input defaultValue="Planned update" />
          </label>
          <label className="field">
            Start
            <input type="datetime-local" defaultValue="2026-10-05T20:00" />
          </label>
          <label className="field">
            Timezone
            <select>
              <option>Europe/London</option>
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
  const [tab, setTab] = useState("Overview"),
    [data, setData] = useState<any>(null),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (session && property)
      api<any>(session, `/api/properties/${property.id}/analytics?days=30`)
        .then(setData)
        .catch(() => setData(null));
    else if (fixture)
      setData({
        pageviews: 28460,
        events: 358,
        pages: ["/", "/services/", "/work/", "/contact/", "/insights/"],
      });
  }, [property?.id, session, fixture]);
  if (!property)
    return (
      <Empty
        title="Select a property"
        detail="Analytics is property-specific."
      />
    );
  const pages = (data?.pages || [])
    .map((p: string, i: number) => ({
      page: p,
      views: fixture ? [10840, 6320, 4610, 2140, 1880][i] || 0 : 0,
      events: fixture ? [96, 72, 41, 124, 25][i] || 0 : 0,
    }))
    .filter((p: any) => p.page.includes(filter));
  return (
    <Page title="Analytics" status={<Period />}>
      <Tabs
        labels={[
          "Overview",
          "Pages",
          "Sources",
          "Events",
          "Audience",
          "Engagement",
          "Performance",
        ]}
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
              ["Observed pages", pages.length, "Unique paths"],
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
            <Chart empty={!data?.pageviews} />
          </Panel>
          <div className="grid equal">
            <Panel title="Top pages">
              <AnalyticsTable pages={pages} />
            </Panel>
            <Panel title="Top sources">
              <BarRows
                rows={
                  fixture
                    ? [
                        ["Google", 12480],
                        ["Direct", 8410],
                        ["LinkedIn", 4360],
                        ["Email", 3210],
                      ]
                    : []
                }
              />
            </Panel>
          </div>
        </>
      ) : tab === "Pages" ? (
        <Panel title="Pages">
          <div className="analytics-filter-row">
            <button
              className="btn"
              onClick={() => notify("Page filters opened")}
            >
              <Filter />
              Add filter
            </button>
            <div className="search">
              <Search />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter pages"
              />
            </div>
            <span className="spacer" />
            <small className="subtle">Filters affect this page table.</small>
          </div>
          <AnalyticsTable pages={pages} />
        </Panel>
      ) : tab === "Sources" ? (
        <Panel title="Traffic sources">
          <BarRows
            rows={
              fixture
                ? [
                    ["Google", 12480],
                    ["Direct", 8410],
                    ["LinkedIn", 4360],
                    ["Instagram", 1910],
                    ["Email", 1300],
                  ]
                : []
            }
          />
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
            <BarRows
              rows={
                fixture
                  ? [
                      ["United Kingdom", 18440],
                      ["United States", 4280],
                      ["Germany", 1960],
                      ["France", 1320],
                    ]
                  : []
              }
            />
          </Panel>
          <Panel title="Devices">
            <BarRows
              rows={
                fixture
                  ? [
                      ["Desktop", 15780],
                      ["Mobile", 11740],
                      ["Tablet", 940],
                    ]
                  : []
              }
            />
          </Panel>
        </div>
      ) : tab === "Engagement" ? (
        <Metrics
          values={[
            ["Engaged sessions", fixture ? "18,420" : "—", "Measured sessions"],
            ["Avg active time", fixture ? "2m 18s" : "—", "Foreground time"],
            ["Scroll 75%", fixture ? "42%" : "—", "Eligible pageviews"],
            ["Key-event rate", fixture ? "1.3%" : "—", "Events per pageview"],
          ]}
        />
      ) : (
        <div className="grid equal">
          <Panel title="Core Web Vitals">
            <DataTable
              headers={["Metric", "Result", "Target", "Samples"]}
              rows={
                fixture
                  ? [
                      ["LCP", "2.3 s", "≤ 2.5 s", "1,248"],
                      ["INP", "168 ms", "≤ 200 ms", "1,109"],
                      ["CLS", "0.04", "≤ 0.1", "1,248"],
                    ]
                  : []
              }
            />
          </Panel>
          <Panel title="Browsers">
            <BarRows
              rows={
                fixture
                  ? [
                      ["Chrome", 17480],
                      ["Safari", 7830],
                      ["Firefox", 2130],
                      ["Edge", 1020],
                    ]
                  : []
              }
            />
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
  const [runs, setRuns] = useState<AuditRun[]>([]),
    [tab, setTab] = useState("Overview"),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("All");
  useEffect(() => {
    if (session && property)
      api<AuditRun[]>(session, `/api/properties/${property.id}/audits`)
        .then(setRuns)
        .catch(() => setRuns([]));
    else if (fixture) setRuns([fixtureAudit()]);
  }, [property?.id, session, fixture]);
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
  async function run() {
    setBusy(true);
    try {
      if (session)
        await api(session, "/api/audits", {
          method: "POST",
          body: JSON.stringify({ propertyId: property!.id }),
        });
      notify("Audit queued");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
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
        <button className="audit-page-picker">
          <Globe2 />
          <span>
            <b>Homepage</b>
            <small>/</small>
          </span>
          <ChevronDown />
        </button>
        <button className="iconbtn">
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
          <AuditScore run={latest} fixture={fixture} />
          <div className="grid">
            <Panel title="Fix these first · Homepage">
              <div className="audit-summary">
                <button className="audit-summary-item">
                  <CircleAlert />2
                </button>
                <button className="audit-summary-item">
                  <ShieldCheck />0
                </button>
                <button className="audit-summary-item">
                  <CircleAlert />5
                </button>
              </div>
              <AuditResults results={results.slice(0, 7)} />
            </Panel>
            <div>
              <Panel title="Desktop performance">
                <PerformanceTable mobile={false} fixture={fixture} />
              </Panel>
              <Panel title="Mobile performance">
                <PerformanceTable mobile fixture={fixture} />
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
                onClick={() =>
                  setFilter(filter === "All" ? "Performance" : "All")
                }
              >
                <Filter />
                {filter === "All" ? "Filters" : filter}
              </button>
            </>
          }
        >
          <AuditResults results={visible} />
        </Panel>
      ) : tab === "Checks" ? (
        <Panel title="Catalogue checks">
          <DataTable
            headers={["Category", "Checks", "Executed", "Passed", "Coverage"]}
            rows={auditCategories.map((x, i) => [
              x,
              fixture ? [52, 48, 61, 44, 38, 35][i] : "Registry",
              results.filter((r: any) => (r.category || "") === x).length,
              results.filter(
                (r: any) => (r.category || "") === x && r.outcome === "pass",
              ).length,
              latest?.coverage != null ? `${latest.coverage}%` : "—",
            ])}
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
  const [tab, setTab] = useState("Quick reports"),
    [preview, setPreview] = useState<any>(),
    [scheduleOpen, setScheduleOpen] = useState(false),
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
  async function create(name: string) {
    if (!property) return;
    setPreview(
      session
        ? await api(session, `/api/properties/${property.id}/report`)
        : {
            property,
            period: "1–30 Sep 2026",
            generatedAt: new Date().toISOString(),
          },
    );
    notify(`${name} preview generated`);
  }
  return (
    <Page
      title="Reports"
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
          {preview ? (
            <DataTable
              headers={["Report", "Property", "Period", "Generated", ""]}
              rows={[
                [
                  "Websi September overview",
                  property?.canonical_host,
                  preview.period,
                  fmtDate(preview.generatedAt),
                  <button
                    className="btn"
                    onClick={() => notify("Report preview opened")}
                  >
                    View
                  </button>,
                ],
              ]}
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
              headers={["Template", "Frequency", "Recipient", "Status"]}
              rows={schedules}
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
              <input defaultValue="Websi workspace" />
            </label>
            <label className="field">
              Accent colour
              <input type="color" defaultValue="#111111" />
            </label>
            <label className="field">
              Footer note
              <input defaultValue="Prepared by Websi" />
            </label>
            <button
              className="primary"
              onClick={() => notify("Branding preview updated")}
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
              <b>Prepared by Websi</b>
            </div>
          </Panel>
        </div>
      )}
      {preview && (
        <ReportPreview
          report={preview}
          close={() => setPreview(undefined)}
          fixture={fixture}
        />
      )}{" "}
      {scheduleOpen && (
        <SimpleDialog
          title="Add schedule"
          close={() => setScheduleOpen(false)}
          action="Add schedule"
          onSave={() => {
            setSchedules((v) => [
              ...v,
              ["Monthly overview", "Monthly", "client@example.com", "Active"],
            ]);
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
            <select>
              <option>Monthly</option>
              <option>Weekly</option>
            </select>
          </label>
          <label className="field">
            Recipient
            <input type="email" defaultValue="client@example.com" />
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
    [busy, setBusy] = useState(false);
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
          body: JSON.stringify({ name }),
        });
      notify("Property settings saved");
      reload();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const snippet = `<script defer src="${location.origin}/tracker.js" data-property="${property.tracking_id}"></script>`;
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
              <select>
                <option>Europe/London</option>
              </select>
            </label>
            <label className="field">
              Reporting currency
              <select>
                <option>GBP (£)</option>
              </select>
            </label>
          </div>
          <div className="settings-actions right">
            <button
              className="primary"
              disabled={busy || !name || name === property.name}
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
              [
                "Account holder",
                "Owner",
                "Allowed",
                "Allowed",
                "Allowed",
                "Allowed",
              ],
            ]}
          />
          <button className="btn">
            <Plus />
            Invite viewer
          </button>
        </Panel>
      ) : (
        <Panel title="Advanced">
          <AdvancedRow
            title="Property verification"
            detail="Check the public site for this property’s tracking identifier."
            action={
              <button
                className="btn"
                onClick={() => notify("Verification check queued")}
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
    );
  const role = data.accounts?.[0]?.role || "owner";
  const tabs = [
    "Profile",
    "Workspace",
    "Billing & plan",
    "Users",
    "Notification preferences",
    "Activity logs",
    "Security",
    "Data & privacy",
  ];
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
              defaultValue={
                data.workspaces?.[0]?.workspaces?.name || "Websi workspace"
              }
            />
          </label>
          <DataTable
            headers={["Workspace", "Properties", "Access"]}
            rows={[
              [
                data.workspaces?.[0]?.workspaces?.name || "Websi workspace",
                fixture ? 12 : data.properties.length,
                cap(role),
              ],
            ]}
          />
          <button
            className="primary"
            onClick={() => notify("Workspace settings saved")}
          >
            Save workspace
          </button>
        </Panel>
      ) : tab === "Billing & plan" ? (
        <Billing fixture={fixture} />
      ) : tab === "Users" ? (
        <Panel
          title="Workspace users"
          actions={
            <button
              className="btn"
              onClick={() => notify("Invitation dialog opened")}
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
            rows={[
              [
                data.profile?.full_name || "Current user",
                "Included editing user",
                "Owner",
                "All properties",
                "Active",
                <button className="iconbtn">
                  <MoreHorizontal />
                </button>,
              ],
              [
                fixture ? "Sam Davies" : "—",
                fixture ? "Included editing user" : "—",
                fixture ? "Administrator" : "—",
                fixture ? "All properties" : "—",
                fixture ? "Active" : "—",
                "",
              ],
            ]}
          />
        </Panel>
      ) : tab === "Notification preferences" ? (
        <Preferences notify={notify} />
      ) : tab === "Activity logs" ? (
        <Panel title="Account activity logs">
          <DataTable
            headers={["Time", "Actor", "Action", "Target", "Result"]}
            rows={
              fixture
                ? [
                    [
                      "Today, 09:42",
                      data.profile?.full_name || "Adam Jordan",
                      "Ran audit",
                      "websi.com",
                      "Completed",
                    ],
                    [
                      "Yesterday, 16:10",
                      data.profile?.full_name || "Adam Jordan",
                      "Updated monitor",
                      "websi.com",
                      "Saved",
                    ],
                  ]
                : []
            }
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
            <button
              className="btn"
              onClick={() =>
                notify("Session sign-out is available from the user menu")
              }
            >
              Review sessions
            </button>
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
              <button className="btn" disabled>
                Not available
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
    </Page>
  );
}

function Billing({ fixture }: { fixture: boolean }) {
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
              <button className="btn">Change plan</button>{" "}
              <button className="btn">Manage billing</button>
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
              <button className="btn">Update</button>
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
                  <button className="btn">Download</button>,
                ],
                [
                  "30 Sep 2025",
                  "Annual Scale",
                  "£468 excl. VAT",
                  "● Paid",
                  <button className="btn">Download</button>,
                ],
              ]}
            />
          </Panel>
        </div>
      )}
      <Panel title="Choose a plan">
        <div className="plans">
          {[
            ["Free", "£0 / mo", "2 properties · 15-minute monitoring"],
            ["Essentials", "£9 / mo", "5 properties · 5-minute monitoring"],
            ["Scale", "£39 / mo", "50 properties · 5-minute monitoring"],
            ["Pro", "£99 / mo", "200 properties · branded reports"],
          ].map((x) => (
            <div
              className={`plan ${(fixture ? x[0] === "Scale" : x[0] === "Pro") ? "current" : ""}`}
              key={x[0]}
            >
              <h2>{x[0]}</h2>
              <div className="price">{x[1]}</div>
              <p>{x[2]}</p>
              <button className="btn" disabled={!fixture}>
                {(fixture ? x[0] === "Scale" : x[0] === "Pro")
                  ? "Current plan"
                  : "Choose"}
              </button>
            </div>
          ))}
        </div>
      </Panel>
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
  fixture,
}: {
  report: any;
  close: () => void;
  fixture: boolean;
}) {
  return (
    <Modal title={`${report.property.name} · ${report.period}`} close={close}>
      <div className="report-preview">
        <Metrics
          values={[
            ["Uptime", fixture ? "99.92%" : "Measured"],
            ["Pageviews", fixture ? "28,460" : "Measured"],
            ["Key events", fixture ? "358" : "Measured"],
            ["Audit", fixture ? "87 / 100" : "Measured"],
          ]}
        />
        <h2>Traffic</h2>
        <Chart empty={!fixture} />
        <h2>Recommendations</h2>
        <ol>
          <li>Resolve critical accessibility findings.</li>
          <li>Prioritise the hero image for mobile LCP.</li>
          <li>Review event trends next month.</li>
        </ol>
        <div className="dialog-actions">
          <button className="btn">Export CSV</button>
          <button className="btn">Print / Save as PDF</button>
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
  return (
    <div className="content">
      <div className="title-row">
        <h1>{title}</h1>
        {status}
        <span className="spacer" />
        {actions}
        <button className="iconbtn" aria-label="Page options">
          <MoreHorizontal />
        </button>
      </div>
      {children}
    </div>
  );
}
function Period() {
  return (
    <span className="period-chip">
      <CalendarDays />
      1–30 Sep 2026
    </span>
  );
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
function Chart({ empty = false }: { empty?: boolean }) {
  if (empty)
    return (
      <Empty
        title="No measured traffic yet"
        detail="The chart populates after pageviews are received."
      />
    );
  const points =
    "0,160 55,132 110,141 165,103 220,115 275,78 330,91 385,54 440,69 495,37 550,47 605,22 660,35 715,14 770,26 825,8";
  return (
    <svg
      className="chart"
      viewBox="0 0 825 190"
      preserveAspectRatio="none"
      aria-label="Traffic chart"
    >
      <defs>
        <linearGradient id="recoveryFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00c989" stopOpacity=".25" />
          <stop offset="1" stopColor="#00c989" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 70, 110, 150].map((y) => (
        <line className="chart-grid" x1="0" x2="825" y1={y} y2={y} key={y} />
      ))}
      <polyline
        className="compare"
        points="0,170 55,155 110,137 165,126 220,117 275,108 330,97 385,87 440,77 495,67 550,57 605,49 660,41 715,33 770,25 825,19"
      />
      <polygon fill="url(#recoveryFade)" points={`0,190 ${points} 825,190`} />
      <polyline className="series" points={points} />
    </svg>
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
      <section className="dialog" role="dialog" aria-modal="true">
        <div className="panel-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="iconbtn" onClick={close}>
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
            i.resolved_at ? "20 min" : "Ongoing",
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
  const [email, setEmail] = useState("");
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
  return (
    <div className="grid equal">
      <Panel title="Recipients">
        <DataTable
          headers={["Email", "Down", "Recovery", ""]}
          rows={recipients.map((recipient) => [
            recipient.email,
            recipient.enabled ? "On" : "Off",
            recipient.enabled ? "On" : "Off",
            <button
              className="iconbtn"
              onClick={() => notify(`${recipient.email} actions opened`)}
            >
              <MoreHorizontal />
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
        <button className="btn" onClick={() => notify("Test alert queued")}>
          Send test alert
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
function AnalyticsTable({ pages }: { pages: any[] }) {
  return (
    <DataTable
      headers={["Page", "Pageviews", "Events", ""]}
      rows={pages.map((p) => [
        <span className="page-link-cell">
          <b>{p.page}</b>
          <ExternalLink />
        </span>,
        p.views ? fmt(p.views) : "Observed",
        p.events || "—",
        <button className="iconbtn">
          <MoreHorizontal />
        </button>,
      ])}
    />
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
            <button
              className="iconbtn"
              onClick={() => notify(`${event.name} actions opened`)}
            >
              <MoreHorizontal />
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
          <label className="field">
            Match value
            <input placeholder="[data-claritude-event='download-brochure']" />
          </label>
          <label>
            <input type="checkbox" defaultChecked /> Mark as a key event
          </label>
          <p className="subtle">Property: {property.canonical_host}</p>
        </SimpleDialog>
      )}
    </>
  );
}
function AuditScore({ run, fixture }: { run?: AuditRun; fixture: boolean }) {
  const score = run?.score;
  const vals = fixture ? [94, 82, 91, 88, 92, 84] : Array(6).fill("—");
  return (
    <div className="audit-score-row">
      <div
        className={`audit-score ${(score || 0) >= 80 ? "good" : "warn"}`}
        style={{ "--score": score || 0 } as any}
      >
        <span>{score ?? "—"}</span>
      </div>
      <div className="audit-six-stats">
        {auditCategories.map((x, i) => (
          <div className="audit-six-stat" key={x}>
            <small>{x}</small>
            <b>{vals[i]}</b>
            <span className="trend-up">
              {fixture ? `↗ +${[4, 8, 5, 3, 6, 7][i]}` : "No category score"}
            </span>
          </div>
        ))}
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
  fixture,
}: {
  mobile: boolean;
  fixture: boolean;
}) {
  return (
    <DataTable
      headers={["Metric", "Value", "Target"]}
      rows={
        fixture
          ? mobile
            ? [
                ["LCP", "3.4 s", "≤ 2.5 s ●"],
                ["TBT", "196 ms", "≤ 200 ms ●"],
                ["CLS", "0.03", "≤ 0.1 ●"],
                ["FCP", "1.9 s", "≤ 1.8 s ●"],
              ]
            : [
                ["LCP", "2.1 s", "≤ 2.5 s ●"],
                ["TBT", "142 ms", "≤ 200 ms ●"],
                ["CLS", "0.02", "≤ 0.1 ●"],
                ["FCP", "1.4 s", "≤ 1.8 s ●"],
              ]
          : []
      }
    />
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
function Preferences({ notify }: { notify: Notify }) {
  return (
    <Panel title="Notification preferences">
      {[
        "Monitor incidents",
        "Recoveries",
        "Tracking problems",
        "Audit issues",
        "Billing & subscription",
        "Account security",
      ].map((x) => (
        <label className="pref-row" key={x}>
          <input
            type="checkbox"
            defaultChecked
            onChange={() => notify(`${x} preference updated`)}
          />
          <span>
            <b>{x}</b>
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
function fixtureAudit(): AuditRun {
  return {
    id: "fixture-audit",
    status: "completed",
    score: 87,
    coverage: 100,
    page_url: "https://websi.com/",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    duration_ms: 2840,
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
function fmt(x: number) {
  return new Intl.NumberFormat("en-GB").format(x || 0);
}
function fmtDate(x: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(x));
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
