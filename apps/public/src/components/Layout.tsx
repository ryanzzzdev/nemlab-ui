import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ThemePicker } from "./Theme";

export function Layout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    // Keep normal initial-load focus; announce a new page after client navigation.
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      main.current?.querySelector("h1")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  return (
    <div
      className={`site ${pathname === "/gridreplay" ? "site-grid" : pathname === "/batterylab" ? "site-battery" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          <Link className="wordmark" to="/" aria-label="NEMLab home">
            <span className="brand-symbol" aria-hidden="true">
              N
            </span>{" "}
            NEMLab
          </Link>
          <span className="badge">In development</span>
        </div>
        <nav aria-label="Main navigation">
          <NavLink to="/batterylab" end>
            BatteryLab
          </NavLink>
          <NavLink to="/prices" end>
            Prices
          </NavLink>
          <NavLink to="/gridreplay" end>
            GridReplay
          </NavLink>
          <NavLink to="/methodology" end>
            Methodology
          </NavLink>
        </nav>
        <ThemePicker />
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>Historical analysis and experiments. No live trading.</p>
        <Link to="/methodology">How to read the results</Link>
        {/* Admin is a separate bundle on the same origin — a plain link, so
            following it never leaks session state or loads private data. */}
        <a href="/admin/">Admin</a>
      </footer>
    </div>
  );
}
