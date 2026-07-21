import { defineConfig } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

process.env.NEO_ANKI_E2E_HEADLESS = '1'

export default defineConfig({
  testDir: './e2e',
  testMatch: /desktop\.spec\.ts/,
  testIgnore: /released-artifacts\.desktop\.spec\.ts/,
  timeout: 75_000,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/desktop', open: 'never' }]],
  use: headlessEvidenceUse,
})
