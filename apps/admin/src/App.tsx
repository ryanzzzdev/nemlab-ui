import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Shell } from "./components/Shell";
import {
  RequestAccessPage,
  RequestStatusPage,
  SignInPage,
  VerifyPage,
  WelcomePage,
} from "./pages/AuthPages";
import { AccessPage } from "./workspace/AccessPage";
import { DataOpsPage } from "./workspace/DataOpsPage";

function NotFound() {
  return (
    <>
      <h1 tabIndex={-1}>Page not found</h1>
      <p className="intro">This Admin page does not exist.</p>
    </>
  );
}

/** Pre-workspace paths fold into the canonical workspace URL — the incoming
 * query is translated (`start`/`end` → `from`/`to`) and preserved. */
function LegacyRedirect({ view }: { view: "coverage" | "jobs" | "publications" }) {
  const { search } = useLocation();
  const next = new URLSearchParams(search);
  next.delete("view");
  const start = next.get("start");
  const end = next.get("end");
  next.delete("start");
  next.delete("end");
  if (start && !next.get("from")) next.set("from", start);
  if (end && !next.get("to")) next.set("to", end);
  next.set("view", view);
  return <Navigate to={`/?${next}`} replace />;
}

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DataOpsPage />} />
          <Route path="load" element={<LegacyRedirect view="jobs" />} />
          <Route path="jobs" element={<LegacyRedirect view="jobs" />} />
          <Route path="publications" element={<LegacyRedirect view="publications" />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="how-it-works" element={<Navigate to="/?help=1" replace />} />
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="request-access" element={<RequestAccessPage />} />
          <Route path="request-status" element={<RequestStatusPage />} />
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="verify" element={<VerifyPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
