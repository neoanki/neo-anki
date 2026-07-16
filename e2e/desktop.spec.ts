import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('desktop app persists the workspace to disk across restarts', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-desktop-'))
  const launch = () => electron.launch({
    args: ['.'],
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData },
  })

  try {
    const firstRun = await launch()
    const firstWindow = await firstRun.firstWindow()
    expect(firstWindow.url()).toBe('neoanki://app/index.html')
    expect(await firstWindow.evaluate(() => window.neoAnkiDesktop?.isDesktop)).toBe(true)
    await expect(firstWindow.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
    await firstWindow.getByRole('button', { name: /45 minutes/i }).click()
    await firstWindow.getByRole('button', { name: /build my first plan/i }).click()
    await expect(firstWindow.getByRole('heading', { name: /today’s study plan/i })).toBeVisible()
    await firstRun.close()

    const stored = JSON.parse(await readFile(join(userData, 'neo-anki-data.json'), 'utf8')) as { settings: { dailyMinutes: number; onboardingComplete: boolean } }
    expect(stored.settings.dailyMinutes).toBe(45)
    expect(stored.settings.onboardingComplete).toBe(true)

    const secondRun = await launch()
    const secondWindow = await secondRun.firstWindow()
    await expect(secondWindow.getByRole('heading', { name: /today’s study plan/i })).toBeVisible()
    await expect(secondWindow.getByRole('heading', { name: /45 min available/i })).toBeVisible()
    await secondRun.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('packaged macOS application launches without a development server', async () => {
  const executablePath = process.env.NEO_ANKI_PACKAGED_APP
  test.skip(!executablePath, 'Set NEO_ANKI_PACKAGED_APP to verify a packaged artifact.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-packaged-'))
  try {
    const packagedApp = await electron.launch({ executablePath, env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    const window = await packagedApp.firstWindow()
    expect(window.url()).toBe('neoanki://app/index.html')
    await expect(window.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
    await packagedApp.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})
