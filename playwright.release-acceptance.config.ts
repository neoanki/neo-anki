import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /release-acceptance\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/release-acceptance', open: 'never' }]],
  outputDir: 'test-results/release-acceptance',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
