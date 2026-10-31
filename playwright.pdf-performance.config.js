import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'pdf-performance.check.js', outputDir: './test-results/pdf-performance', workers: 2,
  use: { baseURL: 'http://127.0.0.1:5190', ...browserOptions, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1466, height: 892 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npx vite --config tests/ui/pdf-performance.vite.config.js --host 127.0.0.1 --port 5190 --strictPort', url: 'http://127.0.0.1:5190/tests/ui/pdf-performance.html', reuseExistingServer: !process.env.CI },
});
