import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/operations-e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    channel: "chromium",
    baseURL: "http://127.0.0.1:3002",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "desktop-operations", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-operations", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/helpers/operations-provider.mjs",
      url: "http://127.0.0.1:17777/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3002",
      url: "http://127.0.0.1:3002",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        SPRINT2_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17777",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      },
    },
  ],
});
