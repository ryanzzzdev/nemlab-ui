import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ThemePicker } from "../../../public/src/components/Theme";
import type { SessionView } from "../api";
import { useSession, useSignOut } from "../session";
import { Loading, Panel } from "./States";

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

  let content: ReactNode;
  if (session.isPending) {
    content = <Loading label="Checking your session…" />;
  } else if (session.isError || session.data.role === "applicant") {
    content = (
      <Panel title="Sign in required">
        <p>
          The Admin console needs an active owner or viewer session. Sign in with the single-use
          link NEMLab emailed you — it stays valid for 15 minutes.
        </p>
        <p className="hint">
          No link yet? Access is granted by the site owner; request it from the person who runs this
          deployment.
        </p>
      </Panel>
    );
  } else {
    content = <Outlet context={session.data} />;
  }

  const signedIn = session.data && session.data.role !== "applicant";
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
          {signedIn && <Account session={session.data} />}
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
