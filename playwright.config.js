import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5186', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npm run dev:ui-test', url: 'http://127.0.0.1:5186/tests/ui/index.html', reuseExistingServer: !process.env.CI },
});
