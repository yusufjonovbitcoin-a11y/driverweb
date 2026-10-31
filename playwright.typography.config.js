import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
  ...base,
  testMatch: ['workspace.spec.js', 'profile-settings.spec.js', 'import-review.spec.js'],
  outputDir: './test-results/typography',
  workers: 2,
  use: { ...base.use, ...browserOptions },
});
