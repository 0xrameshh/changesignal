import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 10_000,
  expect: { timeout: 2_500 },
  fullyParallel: true,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm dev --hostname 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "NEXT_DIST_DIR=.next-live BRIGHTDATA_COLLECTOR_ID=c_mt03abix22hd4vf273 CHANGESIGNAL_OPERATOR_KEY=test-operator-key-12345 pnpm dev --hostname 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
