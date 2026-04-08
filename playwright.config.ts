import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 600_000, // 10 min per test
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: false, // Show browser for visual debugging
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
