import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = {
  "/api/v1/prices": { target: process.env.NEMLAB_API_TARGET ?? "http://127.0.0.1:8080" },
  "/api/v1/simulations": { target: process.env.NEMLAB_API_TARGET ?? "http://127.0.0.1:8080" },
};

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
});
