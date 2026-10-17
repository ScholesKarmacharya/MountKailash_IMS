import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-offline-e2e/**",
    ".next-driver-verification/**",
    ".next-sprint2-e2e/**",
    ".next-scaffold-e2e/**",
    ".next-auth-e2e/**",
    ".next-build-check/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);
