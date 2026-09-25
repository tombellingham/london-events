import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Browser tests for the static site:
 *  - "fixture": the page built from tests/e2e/fixture.ts with the clock
 *    pinned, so every filter result is exact;
 *  - "smoke": whatever `npm run site:build` produced in _site from the real
 *    scrape (run only when _site exists) — loads, renders, no JS errors.
 *
 * CHROMIUM_PATH lets you point at a preinstalled Chromium.
 */

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const hasRealSite = existsSync("_site/index.html");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { timezoneId: "Europe/London", locale: "en-GB", launchOptions },
  projects: [
    { name: "fixture", testMatch: /site\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173", launchOptions } },
    { name: "fixture-mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4173", launchOptions } },
    ...(hasRealSite ? [{ name: "smoke", testMatch: /smoke\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174", launchOptions } }] : []),
  ],
  webServer: [
    { command: "node tests/e2e/serve.mjs .e2e/site 4173", port: 4173, reuseExistingServer: !process.env.CI },
    ...(hasRealSite ? [{ command: "node tests/e2e/serve.mjs _site 4174", port: 4174, reuseExistingServer: !process.env.CI }] : []),
  ],
});
