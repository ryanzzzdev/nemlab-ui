import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { PUBLIC_BASE, listAccessRequests } from "../api";
import type { SessionView } from "../api";
import { useLayoutPrefs, useThemePreference } from "../prefs";
import type { Density, Theme } from "../prefs";
import { useSession, useSignOut } from "../session";
import { HelpDrawer } from "./HelpDrawer";
import { Loading } from "./States";

const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "comfortable", label: "Comfortable" },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function Account({ session }: { session: SessionView }) {
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  const expires = new Date(session.expiresAt).toLocaleString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
  return (
    <>
      <div className="account">
        <div className="who">{session.name}</div>
        <div className="sub">
          {session.role}
          {session.role === "viewer" ? " · read-only" : ""} · session until {expires}
        </div>
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut(session.csrfToken).finally(() => setBusy(false));
        }}
      >
        Sign out
      </button>
    </>
  );
}

const NAV = [{ to: "/", label: "Data Ops", icon: "▦", end: true }] as const;

const PUBLIC_ROUTES = new Set([
  "/welcome",
  "/request-access",
  "/request-status",
  "/sign-in",
  "/verify",
]);

// Routes that own the full workspace frame — toolbar, panes, inspector —
// rather than the padded scroll page used by auth/help and legacy pages.
const WORKSPACE_ROUTES = new Set(["/", "/access"]);

export function Shell() {
  const session = useSession();
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const workspace = useRef<HTMLElement>(null);
  const { prefs, update } = useLayoutPrefs();
  const [theme, setTheme] = useThemePreference();
  const [helpOpen, setHelpOpen] = useState(false);

  const role = session.data?.role;
  const signedIn = role === "owner" || role === "viewer";

  // Owner-only pending count for the Access rail badge — the query is
  // disabled for everyone else so viewers never even attempt it.
  const pending = useQuery({
    queryKey: ["access-requests"],
    queryFn: ({ signal }) => listAccessRequests(signal),
    enabled: role === "owner",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      workspace.current?.querySelector("h1")?.focus({ preventScroll: true });
    }
  }, [pathname]);

  let content: ReactNode;
  if (PUBLIC_ROUTES.has(pathname)) {
    // Auth pages manage their own session states — welcome, request form,
    // fragment exchanges and the applicant status view must render without
    // an owner/viewer session.
    content = <Outlet context={session.data} />;
  } else if (session.isPending) {
    content = <Loading label="Checking your session…" />;
  } else if (session.isError || role === "applicant" || !role) {
    content = <Navigate to="/welcome" replace />;
  } else {
    content = <Outlet context={session.data} />;
  }

  return (
    <div className="app" data-density={prefs.density}>
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <header className="appbar">
        <Link className="brand" to="/" aria-label="NEMLab Admin home">
          NEMLab <em>Admin</em>
          {import.meta.env.DEV && <span className="env">development</span>}
        </Link>
        <div className="spacer" />
        <button type="button" className="btn appbar-link" onClick={() => setHelpOpen(true)}>
          Help
        </button>
        <label className="dim picker">
          Density
          <select
            value={prefs.density}
            onChange={(event) => update({ density: event.target.value as Density })}
          >
            {DENSITIES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dim picker">
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {signedIn && session.data && <Account session={session.data} />}
      </header>

      <div className="body">
        {signedIn && (
          <nav className="rail" aria-label="Workspaces">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item}
                className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="label">{item.label}</span>
              </NavLink>
            ))}
            {role === "owner" && (
              <NavLink
                to="/access"
                className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
              >
                <span aria-hidden="true">◔</span>
                <span className="label">Access</span>
                {(pending.data?.length ?? 0) > 0 && (
                  <span className="badge">{pending.data!.length}</span>
                )}
              </NavLink>
            )}
            <div className="rail-bottom">
              <a href={`${PUBLIC_BASE}/`}>Public site ↗</a>
            </div>
          </nav>
        )}
        <main className="workspace" id="workspace" ref={workspace} tabIndex={-1}>
          {WORKSPACE_ROUTES.has(pathname) ? content : <div className="page">{content}</div>}
        </main>
      </div>
      <HelpDrawer
        session={session.data ?? null}
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
