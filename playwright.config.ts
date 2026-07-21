import { defineConfig, devices } from '@playwright/test'
import { headlessEvidenceUse } from './e2e/support/playwright'

const installedArtifactTests = [
  /installed-core-audit\.spec\.ts/,
  /released-artifacts\.desktop\.spec\.ts/,
  /release-acceptance\.spec\.ts/,
  /blackbox-ux\.spec\.ts/,
]

export default defineConfig({
  testDir: './e2e',
  testIgnore: [
    /desktop\.spec\.ts/,
    ...installedArtifactTests,
  ],
  fullyParallel: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...headlessEvidenceUse,
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: [/desktop\.spec\.ts/, /mobile\.spec\.ts/, ...installedArtifactTests] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: [/desktop\.spec\.ts/, /mobile\.spec\.ts/, ...installedArtifactTests] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: [/desktop\.spec\.ts/, /mobile\.spec\.ts/, ...installedArtifactTests] },
    { name: 'mobile', use: { ...devices['iPhone 13'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
