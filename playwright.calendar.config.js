import { browserOptions } from './playwright.browser.js';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, testMatch: 'calendar.check.js', outputDir: './test-results/calendar', workers: 2,
  use: { ...base.use, ...browserOptions },
});
