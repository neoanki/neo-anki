import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

export default defineConfig({
  testDir: './e2e',
  testMatch: /release-acceptance\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/release-acceptance', open: 'never' }]],
  outputDir: 'test-results/release-acceptance',
  use: headlessEvidenceUse,
})
