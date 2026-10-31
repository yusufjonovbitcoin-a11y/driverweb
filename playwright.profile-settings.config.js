import { defineConfig } from '@playwright/test';
import { browserOptions } from './playwright.browser.js';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'profile-settings.spec.js', fullyParallel: true,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:5188' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1223, height: 701 } } },
    { name: 'wide-desktop', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: { command: 'vite --config tests/ui/profile-settings.vite.config.js --host 127.0.0.1 --port 5188 --strictPort', url: 'http://127.0.0.1:5188/tests/ui/profile-settings.html', reuseExistingServer: !process.env.CI },
});
