import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: ['settlement-inline.check.js', 'accounting-live.check.js'],
  use: { baseURL: 'http://127.0.0.1:5187', ...browserOptions, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1466, height: 892 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npx vite --config tests/ui/settlement-inline.vite.config.js --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187/tests/ui/settlement-inline.html', reuseExistingServer: !process.env.CI },
});
