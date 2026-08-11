import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const macChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:47821",
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
    trace: "on",
  },
  webServer: {
    command: "npm run start:e2e:synthetic",
    url: "http://127.0.0.1:47821",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
