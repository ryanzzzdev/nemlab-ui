import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import {
  RequestAccessPage,
  RequestStatusPage,
  SignInPage,
  VerifyPage,
  WelcomePage,
} from "./pages/AuthPages";
import { AccessPage } from "./pages/AccessPage";
import { CoveragePage } from "./pages/CoveragePage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { JobsPage } from "./pages/JobsPage";
import { LoadPage } from "./pages/LoadPage";
import { PublicationsPage } from "./pages/PublicationsPage";

function NotFound() {
  return (
    <>
      <h1 tabIndex={-1}>Page not found</h1>
      <p className="intro">This Admin page does not exist.</p>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<CoveragePage />} />
          <Route path="load" element={<LoadPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="publications" element={<PublicationsPage />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
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
