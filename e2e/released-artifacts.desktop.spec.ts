import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.env.NEO_ANKI_RELEASED_APP
const artifacts = process.env.NEO_ANKI_RELEASED_ARTIFACTS || join(process.cwd(), 'test-results', 'released-blackbox')

const readyWindow = async (application: ElectronApplication) => {
  let page: Page | undefined
  await expect.poll(async () => {
    page = [...application.windows()].reverse().find((candidate) => !candidate.isClosed() && candidate.url().startsWith('neoanki://'))
    return page ? await page.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null) : null
  }, { timeout: 30_000 }).toBe('true')
  return page!
}

const completeOnboarding = async (page: Page) => {
  await page.getByRole('button', { name: 'Start fresh' }).click()
  await page.getByRole('button', { name: '45 minutes' }).click()
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

const installSelectedMarketplaceExtension = async (page: Page, name: string) => {
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Installing…' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-neo-anki-renderer-ready', 'true', { timeout: 60_000 })
}

test('released Homebrew app completes the signed extension journey', async () => {
  test.skip(!executablePath, 'Set NEO_ANKI_RELEASED_APP to the installed Homebrew executable.')
  test.setTimeout(300_000)
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-released-blackbox-'))
  await mkdir(artifacts, { recursive: true })
  const runtimeErrors: string[] = []
  const launch = () => electron.launch({
    executablePath,
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1', NEO_ANKI_E2E_HEADLESS: '1' },
  })
  let app = await launch()

  try {
    const collectRuntimeErrors = (current: Page) => {
      current.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`) })
      current.on('pageerror', (error) => runtimeErrors.push(`page: ${error.message}`))
    }
    let page = await readyWindow(app)
    collectRuntimeErrors(page)
    await completeOnboarding(page)
    await expect(page.getByLabel('Daily target')).toHaveValue('45')
    const initialDocument = await page.evaluate(() => window.neoAnkiDesktop!.loadWorkspaceV4Document())
    expect(initialDocument.workspace.notes).toHaveLength(0)
    expect(initialDocument.workspace.cards).toHaveLength(0)

    // The empty-state import action must install when absent and open import when present.
    await page.getByRole('button', { name: 'Import from Anki' }).click()
    await installSelectedMarketplaceExtension(page, 'Anki & CSV Import/Export')
    await expect(page.getByRole('tab', { name: /Configure/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.frameLocator('iframe[title$=": migration"]').getByLabel('Choose Anki or CSV file')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Today' }).first().click()
    await page.getByRole('button', { name: 'Import from Anki' }).click()
    await expect(page.frameLocator('iframe[title$=": migration"]').getByLabel('Choose Anki or CSV file')).toBeVisible()

    // Preserve an unfinished draft across marketplace installation and its automatic reload.
    await page.getByRole('button', { name: 'Library' }).first().click()
    await page.getByRole('button', { name: 'Add knowledge item' }).click()
    await page.getByLabel('Prompt', { exact: true }).fill('Released artifact draft prompt')
    await page.getByLabel('Answer', { exact: true }).fill('Released artifact draft answer')
    await page.getByRole('button', { name: /^Extensions/ }).first().click()
    await page.getByRole('tab', { name: 'Browse' }).click()
    await page.getByPlaceholder('Search extensions').fill('Text to Speech')
    const tts = page.locator('.marketplace-card').filter({ hasText: 'Text to Speech' })
    await tts.getByRole('button', { name: 'View details' }).click()
    await installSelectedMarketplaceExtension(page, 'Text to Speech')
    await expect(page.getByText('Text to Speech is installed and ready.')).toBeVisible()
    await page.getByRole('button', { name: 'Library' }).first().click()
    await page.getByRole('button', { name: 'Add knowledge item' }).click()
    const restoredPrompt = page.getByLabel('Prompt', { exact: true })
    const restoredAnswer = page.getByLabel('Answer', { exact: true })
    await expect.soft(restoredPrompt, 'automatic extension reload must retain the unfinished prompt').toHaveValue('Released artifact draft prompt')
    await expect.soft(restoredAnswer, 'automatic extension reload must retain the unfinished answer').toHaveValue('Released artifact draft answer')
    if (!await restoredPrompt.inputValue()) await restoredPrompt.fill('Released artifact draft prompt')
    if (!await restoredAnswer.inputValue()) await restoredAnswer.fill('Released artifact draft answer')
    if (process.env.NEO_ANKI_RELEASED_DRAFT_ONLY === '1') return

    const unavailable = page.locator('.authoring-action').filter({ hasText: 'Generate offline audio after adding knowledge' })
    await expect(unavailable.getByRole('checkbox')).toBeDisabled()
    await expect(unavailable).toContainText(/has no generated cloud track/i)
    await page.screenshot({ path: join(artifacts, '01-tts-needs-setup.png'), fullPage: true })
    await page.getByRole('button', { name: 'Add knowledge item' }).click()
    await expect(page.getByRole('status')).toContainText('safe new-material queue')
    await page.screenshot({ path: join(artifacts, '02-core-item-after-extension-install.png'), fullPage: true })

    // The same signed packages and workspace must survive a process restart. Credential
    // behavior is covered by the non-packaged TTS E2E with its disposable secret protector.
    await app.close()
    app = await launch()
    page = await readyWindow(app)
    collectRuntimeErrors(page)
    await page.getByRole('button', { name: /^Extensions/ }).first().click()
    await page.getByRole('tab', { name: /Installed/ }).click()
    const ttsRow = page.locator('.extension-row').filter({ hasText: 'Text to Speech' })
    await ttsRow.locator('summary').click()
    await ttsRow.getByRole('button', { name: 'Disable' }).click()
    await expect(page.getByRole('status')).toContainText('Text to Speech is disabled.')
    await expect(page.getByRole('button', { name: /Text to Speech/ })).toHaveCount(0)
    const disabledRow = page.locator('.extension-row').filter({ hasText: 'Text to Speech' })
    await disabledRow.locator('summary').click()
    await disabledRow.getByRole('button', { name: 'Enable' }).click()
    await expect(page.getByRole('status')).toContainText('Text to Speech is enabled.')
    const enabledRow = page.locator('.extension-row').filter({ hasText: 'Text to Speech' })
    await enabledRow.locator('summary').click()
    await enabledRow.getByRole('button', { name: 'Uninstall' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Uninstall and keep credentials' }).click()
    await expect(page.getByRole('status')).toContainText(/Text to Speech was uninstalled; its device-local credentials were retained/)
    await expect(page.getByRole('tab', { name: /Installed 1/ })).toBeVisible()

    await expect(page.getByLabel('Daily target')).toHaveCount(0)
    const document = await page.evaluate(() => window.neoAnkiDesktop!.loadWorkspaceV4Document())
    expect(document.clientState.settings.dailyMinutes).toBe(45)
    expect(document.workspace.notes).toHaveLength(1)
    expect(document.workspace.media).toHaveLength(0)
    expect(runtimeErrors).toEqual([])
    const diagnostics = await readFile(join(userData, 'diagnostics', 'diagnostics.jsonl'), 'utf8').catch(() => '')
    expect(diagnostics).not.toMatch(/"level":"error"/)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
