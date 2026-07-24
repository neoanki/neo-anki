import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type DesktopApplication = Awaited<ReturnType<typeof electron.launch>>
type DesktopWindow = ReturnType<DesktopApplication['windows']>[number]

const executablePath = process.env.NEO_ANKI_AUDIT_APP || ''
const evidenceDir = process.env.NEO_ANKI_AUDIT_EVIDENCE
  || join(process.cwd(), '.audit-results', 'installed-core-audit')

const firstReadyWindow = async (application: DesktopApplication) => {
  let readyWindow: DesktopWindow | undefined
  await expect.poll(async () => {
    for (const candidate of [...application.windows()].reverse()) {
      if (candidate.isClosed()) continue
      if (await candidate.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null) === 'true') {
        readyWindow = candidate
        return true
      }
    }
    return false
  }, { timeout: 30_000 }).toBe(true)
  return readyWindow!
}

test('released desktop artifact supports the blank core journey', async () => {
  test.skip(!executablePath, 'Set NEO_ANKI_AUDIT_APP to the exact release artifact executable.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-installed-core-audit-'))
  await mkdir(evidenceDir, { recursive: true })
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  let application: DesktopApplication | undefined

  const launch = async () => {
    const app = await electron.launch({
      executablePath,
      env: {
        ...process.env,
        NEO_ANKI_E2E_HEADLESS: '1',
        NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
        NEO_ANKI_USER_DATA_DIR: userData,
      },
    })
    const window = await firstReadyWindow(app)
    window.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    window.on('pageerror', (error) => pageErrors.push(error.message))
    return { app, window }
  }

  try {
    let launched = await launch()
    application = launched.app
    let window = launched.window
    await window.setViewportSize({ width: 1440, height: 960 })

    await expect(window.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '01-first-launch.png'), fullPage: true })
    await window.getByRole('button', { name: /start fresh/i }).click()
    await expect(window.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '02-daily-target.png'), fullPage: true })
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /create workspace/i }).click()

    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(window.getByRole('heading', { name: /add something you want to remember/i })).toBeVisible()
    const initial = await window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      return {
        notes: document.workspace.notes.length,
        cards: document.workspace.cards.length,
        reviews: document.workspace.reviews.length,
        media: document.workspace.media.length,
      }
    })
    expect(initial).toEqual({ notes: 0, cards: 0, reviews: 0, media: 0 })
    await window.screenshot({ path: join(evidenceDir, '03-empty-today.png'), fullPage: true })

    await window.getByRole('button', { name: 'Library' }).first().click()
    await expect(window.getByRole('heading', { name: /your library is empty/i })).toBeVisible()
    await expect(window.getByRole('button', { name: /add your first knowledge item/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '03b-empty-library.png'), fullPage: true })
    await window.getByRole('button', { name: 'Today' }).first().click()

    await window.getByRole('button', { name: /add your first knowledge item/i }).click()
    await expect(window.getByRole('heading', { name: /new knowledge/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '04-empty-authoring.png'), fullPage: true })
    await window.getByLabel('Prompt', { exact: true }).fill('What is the release artifact audit phrase?')
    await window.getByLabel('Answer', { exact: true }).fill('Packaged journey verified')
    await window.getByRole('button', { name: /add knowledge/i }).click()
    await expect(window.getByRole('status')).toContainText(/added|queue/i)
    await window.screenshot({ path: join(evidenceDir, '05-created.png'), fullPage: true })

    await window.getByRole('button', { name: 'Library' }).first().click()
    await expect(window.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    const row = window.locator('.library-row').filter({ hasText: 'What is the release artifact audit phrase?' })
    await expect(row).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '06-library.png'), fullPage: true })
    await window.getByPlaceholder(/search prompts/i).fill('definitely-not-a-match')
    await expect(window.getByRole('heading', { name: /no matching knowledge items/i })).toBeVisible()
    await window.getByRole('button', { name: /clear filters/i }).click()
    await expect(row).toBeVisible()

    await application.close()
    application = undefined
    launched = await launch()
    application = launched.app
    window = launched.window
    await window.setViewportSize({ width: 1440, height: 960 })
    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
    const persisted = await window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      return { notes: document.workspace.notes.length, cards: document.workspace.cards.length }
    })
    expect(persisted).toEqual({ notes: 1, cards: 1 })

    const startPractice = window.locator('button.study-button')
    await expect(startPractice).toBeEnabled()
    await startPractice.click()
    await expect(window.getByText('What is the release artifact audit phrase?', { exact: true })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '07-review-prompt.png'), fullPage: true })

    const editButton = window.getByRole('button', { name: /edit/i })
    await expect(editButton).toBeVisible()
    await editButton.click()
    await expect(window.getByRole('dialog')).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '08-edit-during-review.png'), fullPage: true })
    await expect(window.getByLabel('Prompt', { exact: true })).toHaveValue('What is the release artifact audit phrase?')
    await window.getByLabel('Answer', { exact: true }).fill('Packaged journey verified after editing')
    await window.getByRole('button', { name: /save changes/i }).click()
    await expect(window.getByRole('dialog')).toHaveCount(0)
    await expect(window.getByText('What is the release artifact audit phrase?', { exact: true })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '09-review-resumed-after-edit.png'), fullPage: true })

    await window.getByRole('button', { name: /reveal answer/i }).click()
    await expect(window.getByText('Packaged journey verified after editing', { exact: true })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '10-review-answer.png'), fullPage: true })
    await window.locator('button.grade-button.recalled').click()
    await expect(window.getByRole('heading', { name: /enough for this session/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '11-complete.png'), fullPage: true })
    await window.getByRole('button', { name: /(?:back|return) to today/i }).click()
    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(window.getByText(/caught up/i)).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '12-caught-up.png'), fullPage: true })

    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(window.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '13-settings.png'), fullPage: true })

    const reset = window.getByRole('button', { name: /erase and start empty/i })
    await expect(reset).toBeVisible()
    window.once('dialog', (dialog) => dialog.accept())
    await reset.click()
    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(window.getByRole('heading', { name: /add something you want to remember/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '14-after-reset.png'), fullPage: true })
    const resetWorkspace = await window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      return {
        notes: document.workspace.notes.length,
        cards: document.workspace.cards.length,
        reviews: document.workspace.reviews.length,
        media: document.workspace.media.length,
      }
    })
    expect(resetWorkspace).toEqual({ notes: 0, cards: 0, reviews: 0, media: 0 })
    await expect.poll(async () => readdir(join(userData, 'backups')).catch(() => [])).toContainEqual(expect.stringMatching(/^auto-.*-before-reset\.neoanki-backup$/))

    expect(pageErrors).toEqual([])
    expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([])
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('released desktop artifact blocks writes and preserves a corrupt workspace', async () => {
  test.skip(!executablePath, 'Set NEO_ANKI_AUDIT_APP to the exact release artifact executable.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-installed-recovery-audit-'))
  await mkdir(evidenceDir, { recursive: true })
  let application: DesktopApplication | undefined
  const launch = () => electron.launch({
    executablePath,
    env: {
      ...process.env,
      NEO_ANKI_E2E_HEADLESS: '1',
      NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
      NEO_ANKI_USER_DATA_DIR: userData,
    },
  })

  try {
    application = await launch()
    let window = await firstReadyWindow(application)
    await window.getByRole('button', { name: /start fresh/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /create workspace/i }).click()
    await window.getByRole('button', { name: /add your first knowledge item/i }).click()
    await window.getByLabel('Prompt', { exact: true }).fill('This content must survive as preserved corrupt source')
    await window.getByLabel('Answer', { exact: true }).fill('Preserved')
    await window.getByRole('button', { name: /add knowledge/i }).click()
    await expect(window.getByRole('status')).toContainText(/added|queue/i)
    await application.close()
    application = undefined

    const databasePath = join(userData, 'neo-anki.sqlite')
    const database = new DatabaseSync(databasePath)
    database.prepare('UPDATE workspace_v4 SET json = ? WHERE id = 1').run('{"format":"neo-anki-workspace","schemaVersion":4,"workspace":BROKEN')
    database.close()

    application = await launch()
    window = await firstReadyWindow(application)
    await window.setViewportSize({ width: 1440, height: 960 })
    await expect(window.getByRole('heading', { name: /workspace needs attention/i })).toBeVisible()
    await expect(window.getByText(/editing and automatic saving are paused/i)).toBeVisible()
    await expect(window.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(window.getByRole('button', { name: /export original data/i })).toBeEnabled()
    await expect(window.getByRole('button', { name: /restore backup/i })).toBeVisible()
    await expect(window.getByRole('button', { name: /start empty/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '15-corrupt-workspace-recovery.png'), fullPage: true })

    await window.waitForTimeout(1_000)
    const replacement = new DatabaseSync(databasePath, { readOnly: true })
    const persistedWorkspace = replacement.prepare('SELECT COUNT(*) AS count FROM workspace_v4').get() as { count: number }
    replacement.close()
    expect(persistedWorkspace.count).toBe(0)
    const preservedNames = await readdir(userData)
    expect(preservedNames).toContainEqual(expect.stringMatching(/^neo-anki\.corrupt-.*\.sqlite$/))

    window.once('dialog', (dialog) => dialog.accept())
    await window.getByRole('button', { name: /start empty/i }).click()
    await expect(window.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
    await window.screenshot({ path: join(evidenceDir, '16-recovery-start-empty.png'), fullPage: true })
    expect(await readdir(userData)).toContainEqual(expect.stringMatching(/^neo-anki\.corrupt-.*\.sqlite$/))
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
