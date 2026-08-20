import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    maxWorkers: 3,
    env: {
      TZ: "Asia/Shanghai",
    },
    environment: "node",
    exclude: ["tests/playwright/**", "node_modules/**", "dist/**"],
    environmentOptions: {
      jsdom: {
        url: "http://127.0.0.1:47321/",
      },
    },
  },
});
