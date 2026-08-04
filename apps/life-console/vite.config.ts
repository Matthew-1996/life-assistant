import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://127.0.0.1:47321/",
      },
    },
  },
});
