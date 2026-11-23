import { defineConfig } from '@playwright/test';

// Set PW_CHANNEL=msedge to use an installed browser instead of Playwright's Chromium.
const channel = process.env.PW_CHANNEL;
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 150_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 360, height: 740 },
    locale: 'tr-TR',
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter realtime start',
          url: 'http://127.0.0.1:4000/health',
          reuseExistingServer: !process.env.CI,
          env: { NODE_ENV: 'test' },
        },
        {
          command: 'pnpm --filter web start',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      ],
});
