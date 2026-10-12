import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DEMO_ADMIN_PASSWORD",
  "DEMO_DRIVER_PASSWORD",
]) {
  if (!process.env[key])
    throw new Error(
      `Authenticated E2E requires ${key} in .env.local and a migrated Supabase project with provisioned demo accounts.`,
    );
}
const baseURL = process.env.AUTH_E2E_BASE_URL ?? "http://127.0.0.1:3001";
export default defineConfig({
  testDir: "./tests/auth-e2e",
  outputDir: "./test-results/auth",
  use: {
    channel: "chromium",
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "desktop-auth", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-auth", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3001",
    url: baseURL,
    reuseExistingServer: !!process.env.AUTH_E2E_BASE_URL,
    env: { AUTH_E2E: "1" },
  },
});
