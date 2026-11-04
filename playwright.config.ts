import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4319', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve-static.mjs', url: 'http://127.0.0.1:4319', reuseExistingServer: false },
});
