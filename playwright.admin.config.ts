import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-admin",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4274",
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview:admin",
    url: "http://127.0.0.1:4274/admin/",
    reuseExistingServer: false,
  },
});
