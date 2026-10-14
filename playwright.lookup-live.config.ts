import { defineConfig, devices } from "@playwright/test";
// Explicitly invoked, read-only diagnostics with existing demo credentials.
// Separate build directory and browser profile; never touches the user's tabs.
export default defineConfig({
  testDir: "./tests/live-diagnostics",
  outputDir: "./test-results/lookup-live",
  workers: 1,
  timeout: 120000,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chromium",
    baseURL: "http://127.0.0.1:3006",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3006",
    url: "http://127.0.0.1:3006",
    timeout: 120000,
    reuseExistingServer: false,
    env: { VALIDATE_BUILD: "1" },
    stdout: "pipe",
    stderr: "pipe",
  },
});
