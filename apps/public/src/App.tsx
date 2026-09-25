import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { Home, BatteryLab, Prices, GridReplay, Methodology, NotFound } from "./pages";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="batterylab" element={<BatteryLab />} />
          <Route path="prices" element={<Prices />} />
          <Route path="gridreplay" element={<GridReplay />} />
          <Route path="methodology" element={<Methodology />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
