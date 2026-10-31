import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'financial-center.check.js',
  outputDir: './test-results/financial-center',
  use: { baseURL: 'http://127.0.0.1:5188', ...browserOptions, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1536, height: 1024 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: { command: 'npx vite --config tests/ui/settlement-inline.vite.config.js --host 127.0.0.1 --port 5188 --strictPort', url: 'http://127.0.0.1:5188/tests/ui/financial-center.html', reuseExistingServer: !process.env.CI },
});
