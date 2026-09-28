import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: "fitness-plan.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: join(tmpdir(), "life-console-fitness-browser-results"),
  use: {
    baseURL: "http://127.0.0.1:47823",
    browserName: "chromium",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        (existsSync(macChrome) ? macChrome : undefined),
    },
    trace: "off",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js build --mode candidate-preview --outDir dist/fitness-preview && node node_modules/vite/bin/vite.js preview --outDir dist/fitness-preview --host 127.0.0.1 --port 47823",
    url: "http://127.0.0.1:47823",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
