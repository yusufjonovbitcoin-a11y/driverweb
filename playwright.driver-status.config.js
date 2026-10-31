import { defineConfig } from '@playwright/test';
import { browserOptions } from './playwright.browser.js';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'driver-roster-status.check.js', fullyParallel: true,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:5198', viewport: { width: 1389, height: 892 } },
  webServer: { command: 'vite --config tests/ui/driver-roster-status.vite.config.js --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198/tests/ui/driver-roster-status.html', reuseExistingServer: !process.env.CI },
});
