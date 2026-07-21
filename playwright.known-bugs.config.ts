import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

export default defineConfig({
  testDir: './e2e/known-bugs',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  passWithNoTests: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/known-bugs', open: 'never' }]],
  outputDir: 'test-results/known-bugs',
  use: headlessEvidenceUse,
})
