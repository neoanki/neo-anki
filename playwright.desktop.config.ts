import { defineConfig } from '@playwright/test'

process.env.NEO_ANKI_E2E_HEADLESS = '1'

export default defineConfig({
  testDir: './e2e',
  testMatch: /desktop\.spec\.ts/,
  timeout: 75_000,
  workers: 1,
  reporter: [['list']],
})
