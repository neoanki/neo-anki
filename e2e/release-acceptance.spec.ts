import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256File, writeQaEvidence } from './support/qa'

const executablePath = process.env.NEO_ANKI_RELEASE_APP || ''
const ttsPackage = process.env.NEO_ANKI_RELEASE_TTS_PACKAGE || ''
const evidenceDirectory = process.env.NEO_ANKI_ACCEPTANCE_EVIDENCE_DIR || join(process.cwd(), '.audit-results', 'release-acceptance')
let artifactSha256 = ''

type WorkspaceCounts = {
  notes: number
  cards: number
  reviews: number
  media: number
  goals: number
  views: number
}

const launch = async (userData: string, extensionPackage?: string) => electron.launch({
  executablePath,
  args: extensionPackage ? [`--install-extension=${extensionPackage}`] : [],
  env: {
    ...process.env,
    NEO_ANKI_USER_DATA_DIR: userData,
    NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
    NEO_ANKI_E2E_HEADLESS: '1',
  },
})

const readyWindow = async (application: ElectronApplication) => {
  let ready: Page | undefined
  await expect.poll(async () => {
    for (const candidate of [...application.windows()].reverse()) {
      if (candidate.isClosed()) continue
      if (await candidate.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null) === 'true') {
        ready = candidate
        return true
      }
    }
    return false
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true)
  return ready!
}

const stop = async (application: ElectronApplication | undefined) => {
  if (!application) return
  const process = application.process()
  if (process.exitCode !== null) return
  process.kill('SIGKILL')
  await new Promise<void>((resolve) => process.once('exit', () => resolve()))
}

const observeRendererFailures = (page: Page) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  return failures
}

const onboardFresh = async (page: Page) => {
  await expect(page.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start fresh' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore Neo Anki backup' })).toBeVisible()
  await expect(page.getByText(/import from anki/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Start fresh' }).click()
  await page.getByRole('button', { name: /30 minutes/i }).click()
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

const workspaceCounts = (page: Page) => page.evaluate(async (): Promise<WorkspaceCounts> => {
  const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
  return {
    notes: document.workspace.notes.length,
    cards: document.workspace.cards.length,
    reviews: document.workspace.reviews.length,
    media: document.workspace.media.length,
    goals: document.clientState.goals.length,
    views: document.clientState.views.length,
  }
})

const openCreate = async (page: Page) => {
  const firstItem = page.getByRole('button', { name: 'Add your first knowledge item' })
  if (await firstItem.count()) await firstItem.click()
  else await page.getByRole('button', { name: /new item/i }).click()
  await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
}

const captureScreenshotEvidence = async (page: Page, filename: string) => {
  const path = join(evidenceDirectory, filename)
  try {
    await page.screenshot({ path, animations: 'disabled', timeout: 10_000 })
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    await writeFile(`${path}.error.txt`, `Packaged-window screenshot capture was unavailable. Functional assertions and trace capture remain authoritative.\n\n${message}\n`, 'utf8')
  }
}

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
  if (executablePath && existsSync(executablePath)) artifactSha256 = await sha256File(executablePath)
})

test('released app completes and persists the clean core journey', async () => {
  test.setTimeout(180_000)
  test.skip(!executablePath || !existsSync(executablePath), 'Set NEO_ANKI_RELEASE_APP to a packaged Neo Anki executable.')
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-release-core-'))
  let application: ElectronApplication | undefined
  try {
    application = await launch(userData)
    let page = await readyWindow(application)
    const failures = observeRendererFailures(page)
    await onboardFresh(page)
    await expect(page.getByRole('heading', { name: /add something you want to remember/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import from Anki' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse extensions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load sample workspace' })).toBeVisible()
    await expect.poll(() => workspaceCounts(page)).toEqual({ notes: 0, cards: 0, reviews: 0, media: 0, goals: 0, views: 0 })
    await captureScreenshotEvidence(page, 'core-empty-today.png')

    await openCreate(page)
    await expect(page.getByLabel('Prompt', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Answer', { exact: true })).toBeVisible()
    await expect(page.getByText(/prompt or cloze sentence/i)).toHaveCount(0)
    await expect(page.getByText(/learning science/i)).toHaveCount(0)
    await page.getByLabel('Prompt', { exact: true }).fill('What does the released application preserve?')
    await page.getByLabel('Answer', { exact: true }).fill('A clean knowledge item across review and restart.')
    await page.getByRole('button', { name: /^add knowledge item$/i }).click()
    await expect(page.getByRole('status')).toContainText(/safe new-material queue/i)
    await expect.poll(() => workspaceCounts(page)).toMatchObject({ notes: 1, cards: 1, reviews: 0, media: 0 })

    await page.getByRole('button', { name: 'Today' }).first().click()
    await page.locator('button.study-button').click()
    await expect(page.getByRole('progressbar', { name: 'Review session progress' })).toHaveAttribute('aria-valuenow', '1')
    await page.getByRole('button', { name: 'Edit this knowledge item' }).click()
    await page.getByLabel('Prompt', { exact: true }).fill('What does the packaged application preserve?')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit content' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'What does the packaged application preserve?' })).toBeVisible()
    await page.getByRole('button', { name: /reveal answer/i }).click()
    await expect(page.getByText('A clean knowledge item across review and restart.', { exact: true })).toBeVisible()
    await page.locator('button.grade-button.recalled').click()
    await expect(page.getByRole('heading', { name: /enough for this session/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Return to Today' })).toBeVisible()
    await expect.poll(() => workspaceCounts(page)).toMatchObject({ notes: 1, cards: 1, reviews: 1 })
    await captureScreenshotEvidence(page, 'core-review-complete.png')
    expect(failures).toEqual([])

    await stop(application)
    application = await launch(userData)
    page = await readyWindow(application)
    const restartFailures = observeRendererFailures(page)
    await page.getByRole('button', { name: 'Library' }).first().click()
    await expect(page.getByText('What does the packaged application preserve?', { exact: true })).toBeVisible()
    const durableCounts = await expect.poll(() => workspaceCounts(page)).toEqual({ notes: 1, cards: 1, reviews: 1, media: 0, goals: 0, views: 0 }).then(() => workspaceCounts(page))
    expect(restartFailures).toEqual([])
    await writeQaEvidence(join(evidenceDirectory, 'core-manifest.json'), {
      scenario: 'released app clean core journey with restart',
      target: 'packaged',
      version: process.env.NEO_ANKI_RELEASE_VERSION,
      commit: process.env.GITHUB_SHA,
      artifactPath: executablePath,
      artifactSha256,
      viewport: page.viewportSize() || undefined,
      durableCounts,
      runtimeFailures: [...failures, ...restartFailures],
    })
  } finally {
    await stop(application)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
})

test('released TTS package exposes setup from authoring without losing the draft', async () => {
  test.setTimeout(180_000)
  test.skip(!executablePath || !existsSync(executablePath), 'Set NEO_ANKI_RELEASE_APP to a packaged Neo Anki executable.')
  test.skip(!ttsPackage || !existsSync(ttsPackage), 'Set NEO_ANKI_RELEASE_TTS_PACKAGE to the signed released TTS package.')
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-release-tts-'))
  let application: ElectronApplication | undefined
  try {
    application = await launch(userData, ttsPackage)
    const page = await readyWindow(application)
    const failures = observeRendererFailures(page)
    await onboardFresh(page)
    await openCreate(page)
    await page.getByLabel('Prompt', { exact: true }).fill('Can released TTS create portable audio?')
    await page.getByLabel('Answer', { exact: true }).fill('Yes, after explicit provider setup.')
    const action = page.locator('.authoring-action').filter({ hasText: 'Generate offline audio after adding knowledge' })
    await expect(action.getByRole('checkbox')).toBeDisabled()
    await expect(action).toContainText(/no generated cloud track/i)
    await action.getByRole('button', { name: 'Set up Text to Speech' }).click()
    const settings = page.frameLocator('iframe[title="Text to Speech: settings"]')
    await expect(settings.getByRole('button', { name: 'Enable offline audio' })).toBeVisible({ timeout: 30_000 })
    await captureScreenshotEvidence(page, 'tts-setup.png')
    await page.getByRole('button', { name: 'Back to new knowledge' }).click()
    await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('Can released TTS create portable audio?')
    await expect(page.getByLabel('Answer', { exact: true })).toHaveValue('Yes, after explicit provider setup.')
    await expect(action.getByRole('checkbox')).toBeDisabled()
    await expect.poll(() => workspaceCounts(page)).toMatchObject({ notes: 0, cards: 0, media: 0 })
    expect(failures).toEqual([])
    await writeQaEvidence(join(evidenceDirectory, 'tts-manifest.json'), {
      scenario: 'released TTS setup preserves authoring draft',
      target: 'released',
      version: process.env.NEO_ANKI_RELEASE_VERSION,
      commit: process.env.GITHUB_SHA,
      artifactPath: executablePath,
      artifactSha256,
      viewport: page.viewportSize() || undefined,
      durableCounts: await workspaceCounts(page),
      runtimeFailures: failures,
    })
  } finally {
    await stop(application)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
})
