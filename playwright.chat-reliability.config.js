import { defineConfig } from '@playwright/test';
import { browserOptions } from './playwright.browser.js';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'chat-reliability.check.js', fullyParallel: false,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:5199', viewport: { width: 1100, height: 800 } },
  webServer: { command: 'vite --config tests/ui/chat-reliability.vite.config.js --host 127.0.0.1 --port 5199 --strictPort', url: 'http://127.0.0.1:5199/tests/ui/chat-reliability.html', reuseExistingServer: !process.env.CI },
});
