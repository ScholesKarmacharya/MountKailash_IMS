import { defineConfig, devices } from "@playwright/test";
// Separate build, database and HTTP ports allow verification beside another
// editor's normal offline test run without sharing or deleting their artifacts.
process.env.VERIFY_DRIVER_E2E = "1";
process.env.OFFLINE_E2E = "1";
const env = {
  VERIFY_DRIVER_E2E: "1",
  OFFLINE_E2E: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17779",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
};
export default defineConfig({
  testDir: "./tests/offline-e2e",
  testMatch: [
    "automatic-offline.spec.ts",
    "ownership-recovery.spec.ts",
    "customer-review.spec.ts",
    "current-trip.spec.ts",
    "invoice-receipt.spec.ts",
    "mobile-workflow.spec.ts",
    "preparation-readiness.spec.ts",
    "responsive-driver.spec.ts",
  ],
  outputDir: "./test-results/driver-verification",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: "http://127.0.0.1:3005",
    trace: "off",
    video: "off",
    screenshot: "off",
    channel: "chromium",
  },
  projects: [
    {
      name: "desktop-driver-verification",
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "mobile-driver-verification", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/helpers/operations-provider.mjs",
      url: "http://127.0.0.1:17779/health",
      env,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3005",
      url: "http://127.0.0.1:3005",
      env,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
