import { chromium } from "@playwright/test";

// No test artifacts, traces, screenshots, session files or secret-bearing errors.
// Reuses an existing dev server instead of starting a second Next dev process.
const baseURL = process.argv[2] || "http://localhost:3000";
const target = new URL(baseURL);
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
) {
  throw new Error(
    "Browser verification is restricted to a loopback development server.",
  );
}
for (const role of ["ADMIN", "DRIVER"]) {
  if (!process.env[`DEMO_${role}_PASSWORD`])
    throw new Error(`${role} demo password is missing from .env.local.`);
}

let stage = "browser launch";
let browser;
try {
  browser = await chromium.launch({ channel: "chromium" });
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 393, height: 851 },
  ]) {
    for (const role of ["ADMIN", "DRIVER"]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        stage = `${role} ${viewport.name} sign-in page`;
        await page.goto(`${baseURL}/sign-in`);
        await page
          .getByLabel("Email address")
          .fill(`${role.toLowerCase()}@mount-kailash.example`);
        await page
          .getByLabel("Password", { exact: true })
          .fill(process.env[`DEMO_${role}_PASSWORD`]);
        stage = `${role} ${viewport.name} sign-in redirect`;
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        const home = role === "ADMIN" ? "/admin/dashboard" : "/driver/home";
        await page.waitForURL((url) => url.pathname === home);
        stage = `${role} ${viewport.name} dashboard`;
        await page
          .getByRole("heading", {
            name: role === "ADMIN" ? "Operations dashboard" : "My day",
            exact: true,
          })
          .waitFor();
        await page.getByRole("navigation").waitFor();
        if (
          !(await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ))
        )
          throw new Error("Layout overflows.");
        if (role === "DRIVER") {
          stage = `DRIVER ${viewport.name} admin-route exclusion`;
          await page.goto(`${baseURL}/admin/dashboard`);
          await page.waitForURL((url) => url.pathname === "/driver/home");
          for (const route of [
            "/admin/products",
            "/admin/inventory",
            "/admin/customers",
            "/admin/vehicles",
            "/admin/drivers",
            "/admin/trips",
          ]) {
            await page.goto(`${baseURL}${route}`);
            await page.waitForURL((url) => url.pathname === "/driver/home");
          }
        } else {
          for (const [route, heading] of [
            ["/admin/products", "Products"],
            ["/admin/inventory", "Warehouse inventory"],
            ["/admin/customers", "Customers"],
            ["/admin/vehicles", "Vehicles"],
            ["/admin/drivers", "Drivers"],
            ["/admin/trips", "Trips"],
          ]) {
            stage = `ADMIN ${viewport.name} ${heading} screen`;
            await page.goto(`${baseURL}${route}`);
            await page
              .getByRole("heading", { name: heading, exact: true })
              .waitFor();
            if (
              !(await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ))
            )
              throw new Error("Layout overflows.");
          }
        }
        stage = `${role} ${viewport.name} sign-out`;
        await page
          .getByRole("button", { name: "Sign Out", exact: true })
          .click();
        await page.waitForURL((url) => url.pathname === "/sign-in");
        await page.goto(`${baseURL}${home}`);
        await page.waitForURL((url) => url.pathname === "/sign-in");
        console.log(
          `${role} ${viewport.name}: Cloud login, correct dashboard, responsive navigation and sign-out passed${role === "DRIVER" ? "; admin route denied" : ""}.`,
        );
      } finally {
        await context.close();
      }
    }
  }
} catch {
  console.error(
    `Browser verification failed at: ${stage}. No credentials or page contents were printed.`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
