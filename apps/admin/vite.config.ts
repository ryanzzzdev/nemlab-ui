import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.NEMLAB_API_TARGET ?? "http://127.0.0.1:8080";
// Same-origin development proxy: the admin bundle talks only to /api/* and
// the backend enforces every capability server-side.
const proxy = {
  "/api/admin": { target },
  "/api/auth": { target },
  "/api/access": { target },
};

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5274, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4274, strictPort: true, proxy },
});
