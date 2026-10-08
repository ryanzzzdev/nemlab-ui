import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { ThemePicker } from "../../../public/src/components/Theme";
import type { SessionView } from "../api";
import { useSession, useSignOut } from "../session";
import { Loading } from "./States";

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
    <div className="account">
      <span className="account-name" title={session.role}>
        {session.name}
      </span>
      {session.role === "viewer" && <span className="badge badge-readonly">Read-only access</span>}
      <span className="hint">until {expires}</span>
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut(session.csrfToken).finally(() => setBusy(false));
        }}
      >
        Sign out
      </button>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Coverage", end: true },
  { to: "/jobs", label: "Jobs" },
  { to: "/publications", label: "Publications" },
  { to: "/how-it-works", label: "How it works" },
] as const;

const PUBLIC_ROUTES = new Set(["/welcome", "/request-access", "/sign-in", "/verify"]);

export function Shell() {
  const session = useSession();
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      main.current?.querySelector("h1")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  const role = session.data?.role;
  let content: ReactNode;
  if (PUBLIC_ROUTES.has(pathname) || pathname === "/request-status") {
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

  const signedIn = role === "owner" || role === "viewer";
  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          <Link className="wordmark" to="/" aria-label="NEMLab Admin home">
            <span className="brand-symbol" aria-hidden="true">
              N
            </span>{" "}
            NEMLab Admin
          </Link>
        </div>
        {signedIn && (
          <nav aria-label="Admin navigation">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={"end" in item}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="header-right">
          {signedIn && session.data && <Account session={session.data} />}
          <ThemePicker />
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {content}
      </main>
      <footer className="site-footer">
        <p>Owner and approved-visitor console. Read access only for visitors.</p>
        <a href="/">Back to NEMLab</a>
      </footer>
    </div>
  );
}
