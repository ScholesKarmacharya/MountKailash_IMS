import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  VERIFY_DRIVER_E2E: "1",
  OFFLINE_E2E: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:17779",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
};
for (const args of [
  ["node_modules/next/dist/bin/next", "build"],
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config=playwright.driver-verification.config.ts",
    ...process.argv.slice(2),
  ],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
