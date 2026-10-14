import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/**/pdf": ["./assets/fonts/*.ttf"],
    "/api/business-days/**": ["./assets/fonts/*.ttf"],
    "/api/customer-statements/**": ["./assets/fonts/*.ttf"],
    "/api/free-supply/**": ["./assets/fonts/*.ttf"],
  },
  ...(process.env.OFFLINE_E2E === "1"
    ? { distDir: ".next-offline-e2e" }
    : process.env.SPRINT2_E2E === "1"
      ? { distDir: ".next-sprint2-e2e" }
      : process.env.SCAFFOLD_E2E === "1"
        ? { distDir: ".next-scaffold-e2e" }
        : process.env.AUTH_E2E === "1"
          ? { distDir: ".next-auth-e2e" }
          : process.env.VALIDATE_BUILD === "1"
            ? { distDir: ".next-build-check" }
            : {}),
};
export default config;
