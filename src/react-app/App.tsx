import { createClient, type Session } from "@supabase/supabase-js";
import { Check } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { RecoveryDashboard } from "./RecoveryDashboard";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ||
    "https://dfaxmxschvzmlozxjaxf.supabase.co",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_zNc8TQjoFQ-OI2nKbiNOPA_5ukCoCY6",
);
type Bootstrap = {
  profile: any;
  accounts: any[];
  workspaces: any[];
  properties: any[];
  incidents: any[];
  notifications: any[];
};
async function api<T>(session: Session, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body as T;
}

const fixtureData: Bootstrap = {
  profile: { full_name: "Adam Jordan", timezone: "Europe/London" },
  accounts: [{ role: "owner", accounts: { name: "Websi" } }],
  workspaces: [
    {
      role: "owner",
      workspaces: { id: "fixture-workspace", name: "Websi workspace" },
    },
  ],
  properties: [
    {
      id: "fixture-property",
      workspace_id: "fixture-workspace",
      name: "Websi",
      url: "https://websi.com",
      canonical_host: "websi.com",
      verification_status: "verified",
      tracking_id: "cl_fixture_websi_7K4M2",
      tracking_last_received_at: new Date(Date.now() - 42000).toISOString(),
      uptime_monitors: [
        {
          id: "fixture-monitor",
          enabled: true,
          interval_minutes: 5,
          timeout_ms: 10000,
          failure_threshold: 2,
          expected_status_min: 200,
          expected_status_max: 399,
          last_status: "online",
          last_response_ms: 218,
          last_checked_at: new Date(Date.now() - 45000).toISOString(),
        },
      ],
      audit_runs: [
        {
          id: "fixture-audit",
          status: "completed",
          score: 87,
          coverage: 100,
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
    },
  ],
  incidents: [],
  notifications: [
    {
      title: "Five unresolved audit issues",
      body: "Critical and warning checks remain unresolved since the latest scan.",
    },
  ],
};

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
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => data.subscription.unsubscribe();
  }, [fixture]);
  if (!ready) return <Splash />;
  if (fixture)
    return <ReferenceFixture />;
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

/**
 * The supplied reference pack is the design contract for the deterministic
 * demo. Keep it isolated from authenticated/live data so the connected app
 * remains available while fixture reviews render the exact approved product
 * surface, routes and interactions.
 */
function ReferenceFixture() {
  const { pathname } = useLocation();
  const destination =
    pathname === "/notifications"
      ? "/notifications"
      : pathname === "/overview"
        ? "/websi/overview"
        : pathname === "/uptime"
          ? "/websi/uptime"
          : pathname === "/analytics"
            ? "/websi/analytics"
            : pathname === "/audit"
              ? "/websi/audit"
              : pathname === "/reports"
                ? "/websi/reports"
                : pathname === "/settings"
                  ? "/websi/settings/general"
                  : pathname === "/account"
                    ? "/account/profile"
                    : "/all/properties";
  return (
    <iframe
      className="reference-fixture"
      src={`/reference.html#${destination}`}
      title="Claritude interactive reference demo"
    />
  );
}

function Workspace({ session }: { session: Session }) {
  const [data, setData] = useState<Bootstrap | null>(null),
    [error, setError] = useState("");
  const load = () =>
    api<Bootstrap>(session, "/api/bootstrap")
      .then(setData)
      .catch((reason) => setError(reason.message));
  useEffect(() => void load(), []);
  if (error)
    return (
      <main className="state">
        <h1>We could not load your workspace</h1>
        <p>{error}</p>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </main>
    );
  if (!data) return <Splash />;
  if (!data.accounts?.length && !data.properties?.length)
    return <Onboarding session={session} done={load} />;
  return (
    <RecoveryDashboard
      session={session}
      data={data}
      reload={load}
      onSignOut={() => void supabase.auth.signOut()}
    />
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
                  The account owns access and future billing. Pro is included
                  during early access.
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
