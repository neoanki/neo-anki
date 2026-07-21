import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /installed-core-audit\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '.audit-results/playwright',
  use: { trace: 'retain-on-failure' },
})
