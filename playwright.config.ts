/**
 * Browser tests (e2e/): the built shop served by scripts/e2e-server.mjs with its own throwaway
 * database. Run: `npm run build`, then `npm run test:e2e`. Uses the installed Google Chrome
 * (present on GitHub's runners), so no browser download.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE = "http://127.0.0.1:8799";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // one retry everywhere: a test that fails twice is a real failure (the report keeps both runs)
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${BASE}/api/health`,
    timeout: 240_000,
    // always a fresh server and database: a server left from an earlier run (or another run in
    // progress) would mix results; a busy port is reported instead
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
