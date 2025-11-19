import { defineConfig } from '@playwright/test';
import { resolve } from 'path';

const baseURL = process.env.DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './scripts',
  timeout: 60_000,
  expect: {
    timeout: 7_000
  },
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    navigationTimeout: 20_000,
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    launchOptions: {
      args: [
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--autoplay-policy=no-user-gesture-required'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium'
      }
    }
  ],
  outputDir: resolve('.tmp', 'playwright-results'),
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
