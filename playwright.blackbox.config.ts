import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /blackbox-ux\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
