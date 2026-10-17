import { spawnSync } from "node:child_process";

// Freeze the application revision for regression tests; concurrent editor/HMR
// updates cannot change a running browser flow. All data stays on loopback.
const env = {
  ...process.env,
  VERIFY_DRIVER_E2E: "0",
  OFFLINE_E2E: "0",
  SPRINT2_E2E: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17777",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
  OFFLINE_DEVICE_RECOVERY_KEY: "c".repeat(64),
};
for (const args of [
  ["node_modules/next/dist/bin/next", "build"],
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config=playwright.operations-production.config.ts",
    ...process.argv.slice(2),
  ],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
