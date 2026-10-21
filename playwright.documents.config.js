import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'document-workspace.spec.js', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5187', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'vite --config tests/ui/document-workspace.vite.config.js --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187/tests/ui/document-workspace.html', reuseExistingServer: !process.env.CI },
});
