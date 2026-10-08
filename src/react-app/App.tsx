import { type Session } from "@supabase/supabase-js";
import { Check } from "lucide-react";
import { type FormEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { apiRequest as api } from "./api";
import { supabase } from "./supabase";
import { ALERT_BANNER_SNOOZE_KEY } from "../shared/notifications";

const ClaritudeApplication = lazy(() =>
  import("./RecoveryDashboard").then((module) => ({ default: module.ClaritudeApplication })),
);

function DashboardBoundary({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Splash />}>{children}</Suspense>;
}
type Bootstrap = {
  superadmin: boolean;
  staff: {
    role: "owner" | "support" | "finance" | "engineering";
    status: "active" | "suspended";
    displayName: string | null;
    permissions: string[];
    aal: "aal1" | "aal2";
  } | null;
  profile: any;
  accounts: any[];
  workspaces: any[];
  properties: any[];
  incidents: any[];
  notifications: any[];
};
const fixtureData: Bootstrap = {
  superadmin: true,
  staff: { role: "owner", status: "active", displayName: "Adam Jordan", permissions: [], aal: "aal2" },
  profile: { full_name: "Adam Jordan", timezone: "Europe/London" },
  accounts: [{ role: "owner", accounts: { name: "Websi" } }],
  workspaces: [
    {
      role: "owner",
      workspaces: { id: "fixture-workspace", name: "Websi workspace" },
    },
  ],
  properties: [
    fixtureProperty("fixture-property", "Websi", "websi.com", "online", 28460, 358, 87, 96),
    fixtureProperty("north", "North Commerce", "northcommerce.example", "offline", 12480, 168, 72, 89),
    fixtureProperty("atlas", "Atlas Studio", "atlas.example", "online", 8410, 121, 91, 97),
    fixtureProperty("cedar", "Cedar Finance", "cedar.example", "online", 7190, 104, 89, 94),
    fixtureProperty("river", "River Health", "river.example", "online", 6630, 93, 94, 98),
    fixtureProperty("lumen", "Lumen Labs", "lumen.example", "online", 5910, 81, 85, 92),
    fixtureProperty("oak", "Oak & Co", "oak.example", "online", 4890, 70, 90, 95),
    fixtureProperty("harbour", "Harbour Homes", "harbour.example", "online", 4030, 62, 86, 91),
    fixtureProperty("willow", "Willow Legal", "willow.example", "online", 3570, 48, 79, 88),
    fixtureProperty("field", "Field Notes", "field.example", "online", 2980, 41, 93, 96),
    fixtureProperty("studio", "Studio North", "studio.example", "online", 2670, 32, 84, 90),
    fixtureProperty("new", "New project", "uninstalled.example", "paused", 0, 0, 0, 0),
  ],
  incidents: [],
  notifications: [
    {
      title: "Five unresolved audit issues",
      body: "Critical and warning checks remain unresolved since the latest scan.",
    },
  ],
};

function fixtureProperty(
  id: string,
  name: string,
  host: string,
  status: string,
  pageviews: number,
  events: number,
  audit: number,
  performance: number,
) {
  return {
    id,
    workspace_id: "fixture-workspace",
    name,
    url: `https://${host}`,
    canonical_host: host,
    verification_status: "verified",
    tracking_id: `fixture_${id}`,
    settings: {
      timezone: "Europe/London",
      ...(id === "fixture-property" ? {
        ai_visibility: {
          business_name: "Websi",
          industry: "web-design",
          industry_custom: "",
          location: "Cambridge",
          country: "GB",
        },
      } : {}),
    },
    tracking_last_received_at: pageviews
      ? new Date(Date.now() - 42000).toISOString()
      : undefined,
    demo: {
      pageviews,
      events,
      audit,
      performance,
      visitors: Math.round(pageviews / 60),
      uptime:
        status === "offline" ? "99.61%" : status === "paused" ? "—" : "99.92%",
      status,
    },
    uptime_monitors: [
      {
        id: `fixture-monitor-${id}`,
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
            id: `fixture-audit-${id}`,
            status: "completed",
            score: audit,
            coverage: 100,
            created_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ]
      : [],
  };
}

export function App() {
  const [fixture] = useState(
    () =>
      new URLSearchParams(location.search).has("fixture") &&
      (import.meta.env.DEV || location.hostname.endsWith(".workers.dev")),
  );
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(fixture);
  useEffect(() => {
    if (fixture) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession((current) => current?.access_token === next?.access_token && current?.user.id === next?.user.id ? current : next);
    });
    return () => data.subscription.unsubscribe();
  }, [fixture]);
  if (!ready) return <Splash />;
  if (fixture)
    return (
      <DashboardBoundary>
        <ClaritudeApplication
          session={null}
          data={fixtureData}
          reload={() => undefined}
          fixture
          onSignOut={() => undefined}
        />
      </DashboardBoundary>
    );
  return (
    <Routes>
      <Route
        path="/auth/*"
        element={session ? <Navigate to="/" /> : <Auth />}
      />
      <Route
        path="/*"
        element={
          session ? (
            <Workspace session={session} />
          ) : (
            <Navigate to="/auth/sign-in" />
          )
        }
      />
    </Routes>
  );
}

function Workspace({ session }: { session: Session }) {
  const [data, setData] = useState<Bootstrap | null>(null),
    [error, setError] = useState("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      setData(await api<Bootstrap>(sessionRef.current, "/api/bootstrap", { signal }));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Workspace could not be loaded");
    }
  }, [session.user.id]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  if (error)
    return (
      <main className="state">
        <h1>We could not load your workspace</h1>
        <p>{error}</p>
        <button className="btn" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  if (!data) return <Splash />;
  if (!data.superadmin && !data.accounts?.length && !data.properties?.length)
    return <Onboarding session={session} done={load} />;
  return (
    <DashboardBoundary>
      <ClaritudeApplication
        session={session}
        data={data}
        reload={load}
        onSignOut={() => {
          sessionStorage.removeItem(ALERT_BANNER_SNOOZE_KEY);
          void supabase.auth.signOut();
        }}
      />
    </DashboardBoundary>
  );
}

function Auth() {
  const navigate = useNavigate(),
    mode = useLocation().pathname.split("/").pop() || "sign-in";
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const title =
    mode === "register"
      ? "Create your account"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "update-password"
          ? "Choose a new password"
          : "Welcome back";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/confirmed` },
        });
        if (error) throw error;
        setMessage("Check your email to confirm your account.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/update-password`,
        });
        if (error) throw error;
        setMessage("If an account exists, a reset link has been sent.");
      } else if (mode === "update-password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        navigate("/");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        sessionStorage.removeItem(ALERT_BANNER_SNOOZE_KEY);
        navigate("/");
      }
    } catch (reason: any) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-preview">
      <header className="auth-top">
        <img src="/assets/claritude-logo.svg" alt="Claritude" />
        <span>Privacy · Terms · Help</span>
      </header>
      <section className="login-card">
        <div className="login-heading">
          <img
            className="login-mark"
            src="/assets/claritude-favicon.svg"
            alt=""
          />
          <h1>{title}</h1>
          <p>
            {mode === "register"
              ? "Start monitoring your first property."
              : mode === "forgot"
                ? "We will send a secure recovery link."
                : "Sign in to manage your websites."}
          </p>
        </div>
        <form onSubmit={submit}>
          {mode !== "update-password" && (
            <label className="field">
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="field">
              {mode === "update-password" ? "New password" : "Password"}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
              />
            </label>
          )}
          <button className="primary login-submit" disabled={busy}>
            {busy ? "Please wait…" : title}
          </button>
          {message && <div className="notice">{message}</div>}
        </form>
        <div className="login-options">
          {mode === "sign-in" ? (
            <>
              <Link to="/auth/forgot">Forgot password?</Link>
              <Link to="/auth/register">Create account</Link>
            </>
          ) : (
            <Link to="/auth/sign-in">Back to sign in</Link>
          )}
        </div>
      </section>
    </main>
  );
}

function Onboarding({ session, done }: { session: Session; done: () => void }) {
  const [step, setStep] = useState(1),
    [accountName, setAccountName] = useState(""),
    [workspaceName, setWorkspaceName] = useState(""),
    [propertyName, setPropertyName] = useState(""),
    [url, setUrl] = useState("https://"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    try {
      await api(session, "/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          accountName,
          workspaceName,
          propertyName,
          url: url === "https://" ? "" : url,
        }),
      });
      done();
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-preview">
      <header className="auth-top">
        <img src="/assets/claritude-logo.svg" alt="Claritude" />
      </header>
      <div className="onboarding-shell">
        <aside className="onboarding-side">
          <h2>Get started</h2>
          {["Create account", "Create workspace", "Add property"].map(
            (label, index) => (
              <div
                className={`onboarding-progress ${step === index + 1 ? "active" : ""} ${step > index + 1 ? "complete" : ""}`}
                key={label}
              >
                <span>{step > index + 1 ? <Check /> : index + 1}</span>
                <b>{label}</b>
              </div>
            ),
          )}
        </aside>
        <section className="onboarding-card">
          <div className="onboarding-copy">
            <small className="eyebrow">Step {step} of 3</small>
            {step === 1 ? (
              <>
                <h1>Name your account</h1>
                <p>
                  The account owns access and future billing. New accounts
                  start on the Free plan.
                </p>
                <label className="field">
                  Account name
                  <input
                    autoFocus
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Your company"
                  />
                </label>
              </>
            ) : step === 2 ? (
              <>
                <h1>Create your workspace</h1>
                <p>A workspace keeps related properties and people together.</p>
                <label className="field">
                  Workspace name
                  <input
                    autoFocus
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Main workspace"
                  />
                </label>
              </>
            ) : (
              <>
                <h1>Add your first property</h1>
                <p>
                  Use a public website you control. You can finish without
                  adding one.
                </p>
                <label className="field">
                  Property name
                  <input
                    value={propertyName}
                    onChange={(e) => setPropertyName(e.target.value)}
                  />
                </label>
                <label className="field">
                  Website URL
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          {error && <div className="notice danger">{error}</div>}
          <div className="onboarding-actions">
            {step > 1 && (
              <button className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <span className="spacer" />
            <button
              className="primary"
              disabled={
                busy ||
                (step === 1 && !accountName) ||
                (step === 2 && !workspaceName)
              }
              onClick={() => (step < 3 ? setStep(step + 1) : void finish())}
            >
              {step < 3 ? "Continue" : busy ? "Creating…" : "Finish setup"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Splash() {
  return (
    <main className="splash">
      <img src="/assets/claritude-favicon.svg" alt="" />
      <span />
    </main>
  );
}
