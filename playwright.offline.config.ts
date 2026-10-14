import { defineConfig, devices } from "@playwright/test";
// Independent loopback database from the online browser suite.
process.env.OFFLINE_E2E = "1";
export default defineConfig({
  testDir: "./tests/offline-e2e",
  outputDir: "./test-results/offline",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: "http://127.0.0.1:3004",
    trace: "off",
    video: "off",
    screenshot: "off",
    channel: "chromium",
  },
  projects: [
    { name: "desktop-offline", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-offline", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/helpers/operations-provider.mjs",
      url: "http://127.0.0.1:17778/health",
      env: { OFFLINE_E2E: "1" },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3004",
      url: "http://127.0.0.1:3004",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        OFFLINE_E2E: "1",
        OFFLINE_DEVICE_RECOVERY_KEY: "c".repeat(64),
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17778",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      },
    },
  ],
});
