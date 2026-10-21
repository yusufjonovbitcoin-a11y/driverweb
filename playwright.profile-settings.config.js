import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'profile-settings.spec.js', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5188', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome' } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1223, height: 701 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'vite --config tests/ui/profile-settings.vite.config.js --host 127.0.0.1 --port 5188 --strictPort', url: 'http://127.0.0.1:5188/tests/ui/profile-settings.html', reuseExistingServer: !process.env.CI },
});
