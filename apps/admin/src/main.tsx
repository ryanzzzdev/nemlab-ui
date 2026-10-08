import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LayoutPrefsProvider } from "./prefs";
import "./admin.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("The application root is missing.");
}

const queryClient = new QueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LayoutPrefsProvider>
        <App />
      </LayoutPrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
