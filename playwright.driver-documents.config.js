import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'driver-documents.check.js', outputDir: './test-results/driver-documents', workers: 2,
  use: { baseURL: 'http://127.0.0.1:5189', ...browserOptions, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1520, height: 892 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npx vite --config tests/ui/driver-documents.vite.config.js --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189/tests/ui/driver-documents.html', reuseExistingServer: !process.env.CI },
});
