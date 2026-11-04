import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/pages',outputDir:'test-results-pages',workers:1,
  use:{baseURL:'http://127.0.0.1:5082/fire-monitoring/',headless:true,
    launchOptions:process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}},
  webServer:{command:'python3 ../tests/serve_map_preview.py',url:'http://127.0.0.1:5082/fire-monitoring/',timeout:15000,reuseExistingServer:false},
});
