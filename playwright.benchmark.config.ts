import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

process.env.NEO_ANKI_E2E_HEADLESS = '1'

export default defineConfig({
  testDir: './benchmarks/desktop',
  testMatch: /desktop\.benchmark\.spec\.ts/,
  timeout: 30 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/desktop-benchmark', open: 'never' }]],
  outputDir: 'test-results/desktop-benchmark',
  use: {
    ...headlessEvidenceUse,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },
})
