import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'fleet-driver-picker.spec.js', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5186', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome' } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1223, height: 701 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npm run dev:ui-test', url: 'http://127.0.0.1:5186/tests/ui/fleet-driver-picker.html', reuseExistingServer: !process.env.CI },
});
