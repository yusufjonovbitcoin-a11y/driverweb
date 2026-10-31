import { defineConfig } from '@playwright/test';
import { browserOptions } from './playwright.browser.js';
export default defineConfig({
  testDir: './tests', testMatch: 'document-workspace.spec.js', fullyParallel: true,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:5187' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'vite --config tests/ui/document-workspace.vite.config.js --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187/tests/ui/document-workspace.html', reuseExistingServer: !process.env.CI },
});
