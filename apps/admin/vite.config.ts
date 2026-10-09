import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.NEMLAB_API_TARGET ?? "http://127.0.0.1:8080";
// Same-origin development proxy: the admin bundle talks only to /api/* and
// the backend enforces every capability server-side.
const proxy = {
  "/api/admin": { target },
  "/api/auth": { target },
  "/api/access": { target },
};

// React Router emits the workspace index as `/admin?…` (basename without the
// trailing slash). Static hosts redirect `/admin` → `/admin/`; Vite's strict
// base check instead 404s on refresh — mirror the static-host behaviour.
const redirect: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? "";
  if (url === "/admin" || url.startsWith("/admin?")) {
    res.writeHead(302, { Location: `/admin/${url.slice("/admin".length)}` });
    res.end();
    return;
  }
  next();
};

const baseRedirect: Plugin = {
  name: "admin-base-redirect",
  configureServer: (server) => {
    server.middlewares.use(redirect);
  },
  configurePreviewServer: (server) => {
    server.middlewares.use(redirect);
  },
};

export default defineConfig({
  base: "/admin/",
  plugins: [react(), baseRedirect],
  server: { host: "127.0.0.1", port: 5274, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4274, strictPort: true, proxy },
});
