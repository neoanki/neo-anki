import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { zipSync } from 'fflate'
import initSqlJs from 'sql.js'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type DesktopApplication = Awaited<ReturnType<typeof electron.launch>>
type DesktopWindow = ReturnType<DesktopApplication['windows']>[number]
const interoperabilityPackage = join(process.cwd(), 'test-extensions', 'org.neoanki.interoperability-2.0.7.neoanki-extension')
const coreArgs = ['.']
const extensionArgs = ['.', `--install-extension=${interoperabilityPackage}`]
const hiddenDesktopEnv = (overrides: NodeJS.ProcessEnv = {}) => ({ ...process.env, NEO_ANKI_E2E_HEADLESS: '1', ...overrides })
const migrationFrame = (window: DesktopWindow) => window.locator('iframe[title^="Anki & CSV"]').contentFrame()
const completeFreshOnboarding = async (window: DesktopWindow, minutes = 30) => {
  await window.getByRole('button', { name: /start fresh/i }).click()
  await window.getByRole('button', { name: new RegExp(`${minutes} minutes`, 'i') }).click()
  await window.getByRole('button', { name: /create workspace/i }).click()
  await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
}
const openMigration = async (window: DesktopWindow) => {
  await window.getByRole('button', { name: 'Extensions' }).first().click()
  await window.getByRole('tab', { name: /Configure/ }).click()
  await expect(migrationFrame(window).getByLabel('Choose Anki or CSV file')).toBeVisible()
}
const migrate = async (window: DesktopWindow, file: string | { name: string; mimeType: string; buffer: Buffer }, openSurface = true) => {
  if (openSurface) {
    if (await window.getByRole('button', { name: /start fresh/i }).count()) await completeFreshOnboarding(window)
    await openMigration(window)
  }
  const frame = migrationFrame(window)
  await frame.getByLabel('Choose Anki or CSV file').setInputFiles(file)
  await expect(frame.locator('.report')).toBeVisible()
  await frame.getByRole('button', { name: 'Import this file' }).dispatchEvent('click')
  await expect(frame.getByRole('status')).toContainText('Import complete', { timeout: 60_000 })
}
const firstReadyWindow = async (application: DesktopApplication) => {
  let readyWindow: DesktopWindow | undefined
  await expect.poll(async () => {
    readyWindow = undefined
    for (const candidate of [...application.windows()].reverse()) {
      if (candidate.isClosed()) continue
      const ready = await candidate.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null)
      if (ready === 'true') { readyWindow = candidate; break }
    }
    return Boolean(readyWindow)
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true)
  return readyWindow!
}

const createAnkiPackage = async () => {
  const SQL = await initSqlJs({ locateFile: () => join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm') })
  const database = new SQL.Database()
  database.run('CREATE TABLE col (decks text, models text)')
  database.run('CREATE TABLE notes (id integer, guid text, mid integer, tags text, flds text)')
  database.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer)')
  database.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify({ 10: { name: 'Imported::Desktop' } }), JSON.stringify({ 20: { tmpls: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}' }] } })])
  database.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?)', [1, 'desktop-import', 20, ' csp ', 'WASM import works\u001fYes'])
  database.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [2, 1, 10, 0, 0, 0, 0, 0, 2500, 0])
  const archive = zipSync({ 'collection.anki2': database.export() })
  database.close()
  return Buffer.from(archive)
}

test('desktop app persists the workspace to disk across restarts', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-desktop-'))
  const launch = () => electron.launch({
    args: coreArgs,
    env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }),
  })

  try {
    const firstRun = await launch()
    const firstWindow = await firstReadyWindow(firstRun)
    expect(firstWindow.url()).toBe('neoanki://app/index.html')
    expect(await firstWindow.evaluate(() => window.neoAnkiDesktop?.isDesktop)).toBe(true)
    await expect(firstWindow.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
    await completeFreshOnboarding(firstWindow, 45)
    await firstRun.close()

    const database = new DatabaseSync(join(userData, 'neo-anki.sqlite'), { readOnly: true })
    const stored = JSON.parse((database.prepare('SELECT settings_json FROM workspace_meta WHERE id = 1').get() as { settings_json: string }).settings_json) as { dailyMinutes: number; onboardingComplete: boolean }
    database.close()
    expect(stored.dailyMinutes).toBe(45)
    expect(stored.onboardingComplete).toBe(true)

    const secondRun = await launch()
    const secondWindow = await firstReadyWindow(secondRun)
    await expect(secondWindow.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(secondWindow.getByRole('heading', { name: /add something you want to remember/i })).toBeVisible()
    await expect(secondWindow.getByLabel('Daily target')).toHaveValue('45')
    await secondRun.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('in-place routes do not trigger renderer startup recovery', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-routes-'))
  const desktop = await electron.launch({ args: coreArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_STARTUP_TIMEOUT_MS: '3000' }) })
  try {
    const window = await firstReadyWindow(desktop)
    await completeFreshOnboarding(window)
    await window.getByRole('button', { name: 'Library' }).first().click()
    await expect(window.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    await window.waitForTimeout(3250)
    expect(window.isClosed()).toBe(false)
    await expect(window.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  } finally {
    await desktop.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('installs, loads, and disables an SDK 2 extension package', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-extension-'))
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'examples/study-pulse-extension/manifest.json'), 'utf8')) as { id: string; version: string }
  const extensionPackage = join(process.cwd(), 'examples/study-pulse-extension/build', `${manifest.id}-${manifest.version}.neoanki-extension`)
  try {
    const desktop = await electron.launch({ args: ['.', `--install-extension=${extensionPackage}`], env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
    const window = await firstReadyWindow(desktop)
    await completeFreshOnboarding(window)
    await expect.poll(async () => `${await window.getByRole('button', { name: /study pulse/i }).count()}|${await readFile(join(userData, 'diagnostics', 'diagnostics.jsonl'), 'utf8').catch(() => '')}`).toMatch(/^1\|/)
    await window.getByRole('button', { name: /study pulse/i }).first().click()
    await expect(window.getByRole('heading', { name: 'Study Pulse' })).toBeVisible()
    const studyPulseFrame = window.locator('iframe[title^="Study Pulse:"]')
    await expect(studyPulseFrame).toBeVisible()
    await expect(studyPulseFrame.contentFrame().getByRole('status')).toHaveText(/worker network:\s*blocked/i)

    await window.getByRole('button', { name: 'Extensions' }).first().click()
    await window.getByRole('tab', { name: /Installed/ }).click()
    await expect(window.getByText(/signed isolated SDK 2 package · neo anki sdk examples/i)).toBeVisible()
    const installedRow = window.locator('.extension-row').filter({ hasText: 'Study Pulse' })
    await installedRow.locator('summary').click()
    await expect(window.getByText(/source/i).last()).toBeVisible()
    await window.getByRole('button', { name: 'Disable' }).click()
    await expect(window.getByRole('heading', { name: 'Extensions' })).toBeVisible()
    await expect(window.getByRole('tab', { name: /Installed/ })).toHaveAttribute('aria-selected', 'true')
    await expect(window.getByRole('status')).toContainText('Study Pulse is disabled.')
    await expect(window.getByRole('button', { name: /study pulse/i })).toHaveCount(0)
    await desktop.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('packaged application launches without a development server', async () => {
  const executablePath = process.env.NEO_ANKI_PACKAGED_APP
  test.skip(!executablePath, 'Set NEO_ANKI_PACKAGED_APP to verify a packaged artifact.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-packaged-'))
  try {
    const packagedApp = await electron.launch({ executablePath, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1' }) })
    const window = await firstReadyWindow(packagedApp)
    expect(window.url()).toBe('neoanki://app/index.html')
    await expect(window.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
    await packagedApp.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('desktop security policy permits the WebAssembly Anki importer', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-wasm-'))
  const app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    const window = await firstReadyWindow(app)
    await completeFreshOnboarding(window)
    await window.getByRole('button', { name: 'Import from Anki' }).click()
    await expect(window.getByRole('tab', { name: /Configure/ })).toHaveAttribute('aria-selected', 'true')
    await expect(migrationFrame(window).getByLabel('Choose Anki or CSV file')).toBeVisible()
    await migrate(window, { name: 'csp.apkg', mimeType: 'application/octet-stream', buffer: await createAnkiPackage() }, false)
    await expect.poll(async () => (await readdir(join(userData, 'backups'))).some((name) => name.startsWith('import-checkpoint-'))).toBe(true)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('legacy package import becomes native typed card content with media', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-current-migration-'))
  const app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    const window = await firstReadyWindow(app)
    await completeFreshOnboarding(window)
    await openMigration(window)
    const frame = migrationFrame(window)
    await frame.getByLabel('Choose Anki or CSV file').setInputFiles(join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await expect(frame.getByText('cards.scheduling', { exact: false })).toBeVisible()
    await frame.getByRole('button', { name: 'Import this file' }).dispatchEvent('click')
    await expect(frame.getByRole('status')).toContainText('Import complete', { timeout: 60_000 })
    await window.getByRole('button', { name: 'Today' }).first().click()
    await window.locator('button.study-button').click()
    await expect(window.getByLabel('Type your answer')).toBeVisible()
    const prompt = window.locator('.native-card-face[aria-label="Practice question"]')
    await expect(prompt).toContainText(/Capital of France/i)
    await expect(window.locator('.review-card img')).toHaveAttribute('src', /neoanki-media:\/\/asset\//)
    await expect(window.locator('.review-card iframe')).toHaveCount(0)
    await expect(window.locator('.native-card-content [style]')).toHaveCount(0)
    await window.getByLabel('Type your answer').fill('Paris')
    await window.getByRole('button', { name: /check answer/i }).click()
    await expect(window.getByText('Exact match')).toBeVisible()
    await expect(window.locator('.native-card-face[aria-label="Revealed response"]')).toContainText('Paris')
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('imported named-field edits and bulk card states survive a desktop restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-library-migration-'))
  let app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    let window = await firstReadyWindow(app)
    await migrate(window, join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByPlaceholder(/Search prompts/i).fill('type:"Migration Custom"')
    const row = window.locator('.library-row').filter({ hasText: 'Capital of' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('checkbox', { name: /Select Capital of/i }).check()
    await row.getByRole('button', { name: /^Edit / }).click()
    await expect(window.getByText('Fields · Migration Custom')).toBeVisible()
    const hint = window.getByLabel('Hint')
    await hint.fill('Persisted migration hint')
    await expect(hint).toHaveValue('Persisted migration hint')
    const saveChanges = window.getByRole('button', { name: /save changes/i })
    await expect(saveChanges).toBeEnabled()
    await saveChanges.dispatchEvent('click')
    await expect(window.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => window.evaluate(async () => {
      const payload = await window.neoAnkiDesktop!.loadWorkspaceV4ExportPayload()
      const document = payload.document as { workspace: { notes: Array<{ fields: Record<string, string> }> } }
      return document.workspace.notes.some((note) => Object.values(note.fields).includes('Persisted migration hint'))
    }), { timeout: 15_000 }).toBe(true)
    await window.getByLabel('Set flag on selected practice prompts').selectOption('5')
    await window.getByRole('button', { name: /bury until tomorrow/i }).click()
    await window.getByLabel('Tag for selected knowledge items').fill('verified-migration')
    await window.getByRole('button', { name: 'Add tag' }).click()
    await window.getByPlaceholder(/Search prompts/i).fill('flag:5 is:buried tag:verified-migration type:"Migration Custom"')
    await expect(window.locator('.library-row').filter({ hasText: 'Capital of' })).toBeVisible()
    await expect.poll(() => window.evaluate(async () => {
      const payload = await window.neoAnkiDesktop!.loadWorkspaceV4ExportPayload()
      const document = payload.document as { workspace: { notes: Array<{ fields: Record<string, string>; tags: string[] }>; cards: Array<{ flags: number; buriedBy?: string }> } }
      return {
        hint: document.workspace.notes.some((note) => Object.values(note.fields).includes('Persisted migration hint') && note.tags.includes('verified-migration')),
        cardState: document.workspace.cards.some((card) => card.flags === 5 && card.buriedBy === 'user'),
      }
    }), { timeout: 15_000 }).toEqual({ hint: true, cardState: true })
    await app.close()

    app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByPlaceholder(/Search prompts/i).fill('flag:5 is:buried tag:verified-migration type:"Migration Custom"')
    const restored = window.locator('.library-row').filter({ hasText: 'Capital of' }).first()
    await expect(restored).toBeVisible()
    await restored.getByRole('button', { name: /^Edit / }).click()
    await expect(window.getByLabel('Hint')).toHaveValue('Persisted migration hint')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('imported fields, native templates, and deck presets are editable and survive restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-compatibility-editor-'))
  let app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    let window = await firstReadyWindow(app)
    await migrate(window, join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    const structure = window.locator('.template-manager details').filter({ hasText: 'Fields and card layouts' })
    await structure.locator('summary').dispatchEvent('click')
    await structure.getByLabel('Content type', { exact: true }).selectOption({ label: 'Migration Custom' })
    await structure.getByLabel('Field 3 name').fill('Migration hint')
    await structure.getByLabel('Template name').fill('Direct recall')
    await structure.getByLabel('Prompt field').selectOption({ label: 'Prompt' })
    await structure.getByLabel('Answer field').selectOption({ label: 'Answer' })
    await structure.getByLabel('Answer interaction').selectOption({ label: 'Type, then compare' })
    await structure.getByLabel('Migration hint supporting field').check()
    const saveTemplate = structure.getByRole('button', { name: /save fields and templates/i })
    await expect(saveTemplate).toBeEnabled()
    await saveTemplate.dispatchEvent('click')
    await expect(window.getByText('Content type and template saved atomically.')).toBeVisible()

    const presets = window.locator('details').filter({ hasText: 'Deck presets and scheduling limits' })
    await presets.locator('summary').dispatchEvent('click')
    await presets.getByLabel('Deck', { exact: true }).selectOption({ label: 'Migration Corpus' })
    await presets.getByLabel('Desired retention').fill('0.91')
    await presets.getByLabel('Learning steps (minutes)', { exact: true }).fill('2, 12')
    const saveDeckPreset = presets.getByRole('button', { name: /save deck and preset/i })
    await expect(saveDeckPreset).toBeEnabled()
    await saveDeckPreset.dispatchEvent('click')
    await expect(window.getByText('Deck and preset saved atomically.')).toBeVisible()
    await expect.poll(() => window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const type = document.workspace.noteTypes.find((value) => value.name === 'Migration Custom')!
      const template = document.workspace.templates.find((value) => value.noteTypeId === type.id)!
      const field = document.workspace.fields.find((value) => value.noteTypeId === type.id && value.ordinal === 2)!
      const deck = document.workspace.decks.find((value) => value.name === 'Migration Corpus')!
      const preset = document.workspace.presets.find((value) => value.id === deck.presetId)!
      const fieldName = (id: string) => document.workspace.fields.find((value) => value.id === id)?.name
      return {
        field: field.name,
        template: template.name,
        prompt: fieldName(template.promptFieldId),
        answer: fieldName(template.answerFieldId),
        supporting: template.supportingFieldIds.map(fieldName),
        responseMode: template.responseMode,
        legacyPresentation: 'questionFormat' in template || 'answerFormat' in template || 'css' in type,
        retention: preset.desiredRetention,
        steps: preset.learningStepsMinutes,
      }
    })).toEqual({ field: 'Migration hint', template: 'Direct recall', prompt: 'Prompt', answer: 'Answer', supporting: ['Migration hint'], responseMode: 'type', legacyPresentation: false, retention: 0.91, steps: [2, 12] })
    await app.close()

    app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    const restored = window.locator('.template-manager details').filter({ hasText: 'Fields and card layouts' })
    await restored.locator('summary').dispatchEvent('click')
    await restored.getByLabel('Content type', { exact: true }).selectOption({ label: 'Migration Custom' })
    await expect(restored.getByLabel('Field 3 name')).toHaveValue('Migration hint')
    await expect(restored.getByLabel('Template name')).toHaveValue('Direct recall')
    await expect(restored.getByLabel('Prompt field').locator('option:checked')).toHaveText('Prompt')
    await expect(restored.getByLabel('Answer field').locator('option:checked')).toHaveText('Answer')
    await expect(restored.getByLabel('Migration hint supporting field')).toBeChecked()
    await expect(restored.getByLabel('Question template')).toHaveCount(0)
    await expect(restored.getByLabel('Card CSS')).toHaveCount(0)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('card browser preserves per-card deck ownership and native due-date edits', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-card-browser-'))
  let app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    let window = await firstReadyWindow(app)
    await migrate(window, join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Practice prompts', exact: true }).click()
    await window.getByPlaceholder(/Search prompts/i).fill('is:learn type:"Migration Custom"')
    const row = window.locator('.card-browser-row').filter({ hasText: 'Capital of' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('checkbox', { name: /Select practice prompt Capital of/i }).check()
    await window.getByLabel('Move selected practice prompts to collection').selectOption({ label: 'Migration Corpus::Core' })
    await window.getByLabel('Due date for selected practice prompts').fill('2026-08-15')
    await window.getByRole('button', { name: 'Set due' }).click()
    await expect(window.getByText(/Rescheduled 1 selected practice prompt/)).toBeVisible()
    await expect.poll(() => window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const noteType = document.workspace.noteTypes.find((value) => value.name === 'Migration Custom')!
      const note = document.workspace.notes.find((value) => value.noteTypeId === noteType.id && Object.values(value.fields).some((field) => field.includes('Capital of')))!
      const card = document.workspace.cards.find((value) => value.noteId === note.id && value.scheduling.queue === 'learn')!
      return { deck: document.workspace.decks.find((value) => value.id === card.deckId)?.name, dueAt: card.scheduling.dueAt }
    })).toEqual({ deck: 'Migration Corpus::Core', dueAt: new Date('2026-08-15T00:00:00').toISOString() })
    await app.close()

    app = await electron.launch({ args: extensionArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Practice prompts', exact: true }).click()
    await window.getByPlaceholder(/Search prompts/i).fill('is:learn deck:"Migration Corpus::Core"')
    await expect(window.locator('.card-browser-row').filter({ hasText: 'Capital of' })).toContainText('Migration Corpus::Core')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('custom preview records retrieval practice without changing the selected card schedule', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-custom-preview-'))
  const app = await electron.launch({ args: coreArgs, env: hiddenDesktopEnv({ NEO_ANKI_USER_DATA_DIR: userData }) })
  try {
    const window = await firstReadyWindow(app)
    await completeFreshOnboarding(window)
    window.once('dialog', (dialog) => dialog.accept())
    await window.getByRole('button', { name: /load sample workspace/i }).click()
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Practice prompts', exact: true }).click()
    await window.getByPlaceholder(/Search prompts/i).fill('retrieval practice strengthen')
    const row = window.locator('.card-browser-row').filter({ hasText: 'What does retrieval practice strengthen?' })
    await row.getByRole('checkbox', { name: /Select practice prompt/ }).check()
    const before = await window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const note = document.workspace.notes.find((value) => Object.values(value.fields).some((field) => field.includes('retrieval practice strengthen')))!
      const card = document.workspace.cards.find((value) => value.noteId === note.id)!
      return { cardId: card.id, scheduling: JSON.stringify(card.scheduling), reviews: document.workspace.reviews.length }
    })
    await window.getByRole('button', { name: 'Preview only' }).click()
    await expect(window.getByText(/Preview only · ratings are recorded/i)).toBeVisible()
    await window.getByRole('button', { name: 'Reveal answer' }).click()
    await window.locator('.grade-button.recalled').click()
    await expect(window.getByRole('heading', { name: /enough for this session/i })).toBeVisible()
    await expect(window.getByText(/due dates and intervals were not changed/i)).toBeVisible()
    await expect.poll(() => window.evaluate(async ({ cardId }) => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const card = document.workspace.cards.find((value) => value.id === cardId)!
      return { scheduling: JSON.stringify(card.scheduling), reviews: document.workspace.reviews.length }
    }, { cardId: before.cardId })).toEqual({ scheduling: before.scheduling, reviews: before.reviews + 1 })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
