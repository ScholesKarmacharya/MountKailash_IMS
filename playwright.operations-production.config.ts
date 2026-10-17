import { defineConfig } from "@playwright/test";
import operations from "./playwright.operations.config";

export default defineConfig({
  ...operations,
  outputDir: "./test-results/operations-production",
  webServer: [
    {
      command: "node tests/helpers/operations-provider.mjs",
      url: "http://127.0.0.1:17777/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3002",
      url: "http://127.0.0.1:3002",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        SPRINT2_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17777",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
        OFFLINE_DEVICE_RECOVERY_KEY: "c".repeat(64),
      },
    },
  ],
});
