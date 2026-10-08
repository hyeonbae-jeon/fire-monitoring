import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5081",
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: "python3 ../tests/serve_e2e.py",
    url: "http://127.0.0.1:5081/health",
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
