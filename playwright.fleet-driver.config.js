import { defineConfig } from '@playwright/test';
import { browserOptions } from './playwright.browser.js';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'fleet-driver-picker.spec.js', fullyParallel: true,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:5186' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1223, height: 701 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npm run dev:ui-test', url: 'http://127.0.0.1:5186/tests/ui/fleet-driver-picker.html', reuseExistingServer: !process.env.CI },
});
