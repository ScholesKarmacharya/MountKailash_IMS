import { defineConfig } from "@playwright/test";
import base from "./playwright.operations.config";
export default defineConfig({
  ...base,
  webServer: [],
  projects: [
    ...base.projects!,
    {
      name: "iphone-sized",
      testMatch: /admin-navigation\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    { name: "laptop", use: { viewport: { width: 1024, height: 768 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "small-mobile", use: { viewport: { width: 360, height: 800 } } },
  ],
});
