import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://staging.getmealrunner.app";
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  globalTeardown: "./e2e/global-teardown.js",
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: 1,
  reporter: IS_CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
