import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

export default defineConfig({
  testDir: './e2e',
  testMatch: /installed-core-audit\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '.audit-results/playwright',
  use: headlessEvidenceUse,
})
