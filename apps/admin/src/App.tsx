import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { CoveragePage } from "./pages/CoveragePage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { JobsPage } from "./pages/JobsPage";
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
          <Route path="jobs" element={<JobsPage />} />
          <Route path="publications" element={<PublicationsPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
