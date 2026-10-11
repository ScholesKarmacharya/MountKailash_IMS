import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  ...(process.env.SPRINT2_E2E === "1" ? { distDir: ".next-sprint2-e2e" } : {}),
};
export default config;
