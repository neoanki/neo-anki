import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /desktop\.spec\.ts/,
  timeout: 45_000,
  workers: 1,
  reporter: [['list']],
})

