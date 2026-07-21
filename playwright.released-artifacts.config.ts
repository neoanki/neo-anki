import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

export default defineConfig({
  testDir: './e2e',
  testMatch: /released-artifacts\.desktop\.spec\.ts/,
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.audit-results/released-artifacts',
  use: headlessEvidenceUse,
})
