import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../public/src/components/Theme";
import { App } from "./App";
import "../../public/src/styles.css";
import "./admin.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("The application root is missing.");
}

const queryClient = new QueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
