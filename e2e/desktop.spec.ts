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
    args: ['.'],
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData },
  })

  try {
    const firstRun = await launch()
    const firstWindow = await firstReadyWindow(firstRun)
    expect(firstWindow.url()).toBe('neoanki://app/index.html')
    expect(await firstWindow.evaluate(() => window.neoAnkiDesktop?.isDesktop)).toBe(true)
    await expect(firstWindow.getByRole('heading', { name: /what are you bringing/i })).toBeVisible()
    await firstWindow.getByRole('button', { name: /create a fresh workspace/i }).click()
    await expect(firstWindow.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
    await firstWindow.getByRole('button', { name: /45 minutes/i }).click()
    await firstWindow.getByRole('button', { name: /build my first plan/i }).click()
    await expect(firstWindow.getByRole('heading', { name: 'Today' })).toBeVisible()
    await firstRun.close()

    const database = new DatabaseSync(join(userData, 'neo-anki.sqlite'), { readOnly: true })
    const stored = JSON.parse((database.prepare('SELECT settings_json FROM workspace_meta WHERE id = 1').get() as { settings_json: string }).settings_json) as { dailyMinutes: number; onboardingComplete: boolean }
    database.close()
    expect(stored.dailyMinutes).toBe(45)
    expect(stored.onboardingComplete).toBe(true)

    const secondRun = await launch()
    const secondWindow = await firstReadyWindow(secondRun)
    await expect(secondWindow.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(secondWindow.getByRole('heading', { name: /45 min available/i })).toBeVisible()
    await secondRun.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('in-place routes do not trigger renderer startup recovery', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-routes-'))
  const desktop = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_STARTUP_TIMEOUT_MS: '3000' } })
  try {
    const window = await firstReadyWindow(desktop)
    await window.getByRole('button', { name: /create a fresh workspace/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await window.getByRole('button', { name: 'Library' }).first().click()
    await expect(window.getByRole('heading', { name: 'Library' })).toBeVisible()
    await window.waitForTimeout(3250)
    expect(window.isClosed()).toBe(false)
    await expect(window.getByRole('heading', { name: 'Library' })).toBeVisible()
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
    const desktop = await electron.launch({ args: ['.', `--install-extension=${extensionPackage}`], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    const window = await firstReadyWindow(desktop)
    await window.getByRole('button', { name: /create a fresh workspace/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await expect.poll(async () => `${await window.getByRole('button', { name: /study pulse/i }).count()}|${await readFile(join(userData, 'diagnostics', 'diagnostics.jsonl'), 'utf8').catch(() => '')}`).toMatch(/^1\|/)
    await window.getByRole('button', { name: /study pulse/i }).first().click()
    await expect(window.getByRole('heading', { name: 'Study Pulse' })).toBeVisible()
    const studyPulseFrame = window.locator('iframe[title^="Study Pulse:"]')
    await expect(studyPulseFrame).toBeVisible()
    await expect(studyPulseFrame.contentFrame().getByRole('status')).toHaveText(/worker network:\s*blocked/i)

    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(window.getByText(/updates are installed manually/i)).toBeVisible()
    await expect(window.getByText(/signed isolated SDK 2 package · neo anki sdk examples/i)).toBeVisible()
    await window.getByText('Study Pulse', { exact: true }).last().click()
    await expect(window.getByText(/source/i).last()).toBeVisible()
    await window.getByRole('button', { name: 'Disable' }).click()
    await expect(window.getByText(/will be disabled after reload/i)).toBeVisible()
    await window.getByRole('button', { name: 'Reload now' }).click()
    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
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
    const packagedApp = await electron.launch({ executablePath, env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1' } })
    const window = await firstReadyWindow(packagedApp)
    expect(window.url()).toBe('neoanki://app/index.html')
    await expect(window.getByRole('heading', { name: /what are you bringing/i })).toBeVisible()
    await packagedApp.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('desktop security policy permits the WebAssembly Anki importer', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-wasm-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    const window = await firstReadyWindow(app)
    await window.getByRole('button', { name: /create a fresh workspace/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await window.getByRole('button', { name: /open settings/i }).click()
    await window.locator('input[type=file][accept=".json,.csv,.apkg,.colpkg"]').setInputFiles({ name: 'csp.apkg', mimeType: 'application/octet-stream', buffer: await createAnkiPackage() })
    await expect(window.getByRole('heading', { name: /review exactly what will migrate/i })).toBeVisible()
    await window.getByRole('button', { name: /create checkpoint and migrate/i }).click()
    await expect(window.locator('.inline-message')).toContainText('Imported 1 item')
    await expect.poll(async () => (await readdir(join(userData, 'backups'))).some((name) => name.startsWith('import-checkpoint-'))).toBe(true)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('current Anki migration renders custom CSS, typed fields, and media in a sandbox', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-current-migration-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    const window = await firstReadyWindow(app)
    await window.getByRole('button', { name: /migrate from anki/i }).click()
    await window.locator('input[type=file][accept=".apkg,.colpkg"]').setInputFiles(join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await expect(window.getByRole('heading', { name: /review exactly what will migrate/i })).toBeVisible()
    await expect(window.getByText('cards.scheduling', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: /create checkpoint and migrate/i }).click()
    await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
    await window.locator('button.study-button').click()
    await expect(window.getByLabel('Type your answer')).toBeVisible()
    const prompt = window.locator('iframe[title^="Prompt for"]')
    await expect(prompt).toBeVisible()
    await expect(prompt.contentFrame().getByText(/Capital of France/i)).toBeVisible()
    await expect(prompt.contentFrame().locator('img')).toHaveAttribute('src', /neoanki-media:\/\/asset\//)
    await window.getByLabel('Type your answer').fill('Paris')
    await window.getByRole('button', { name: /check answer/i }).click()
    await expect(window.getByText('Exact match')).toBeVisible()
    const answer = window.locator('iframe[title^="Answer for"]')
    await expect(answer.contentFrame().getByText('Paris', { exact: true })).toBeVisible()
    await expect.poll(() => answer.contentFrame().locator('body').evaluate((body) => getComputedStyle(body).color)).toBe('rgb(18, 52, 86)')
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('imported named-field edits and bulk card states survive a desktop restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-library-migration-'))
  let app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    let window = await firstReadyWindow(app)
    const migrationPackage = window.locator('input[type=file][accept=".apkg,.colpkg"]')
    await expect(window.getByRole('button', { name: /migrate from anki/i })).toBeVisible()
    await window.getByRole('button', { name: /migrate from anki/i }).dispatchEvent('click')
    await migrationPackage.setInputFiles(join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: /create checkpoint and migrate/i }).click()
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByPlaceholder(/Search questions/i).fill('note:"Migration Custom"')
    const row = window.locator('.library-row').filter({ hasText: 'Capital of' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('checkbox', { name: /Select Capital of/i }).check()
    await row.getByRole('button', { name: /^Edit / }).click()
    await expect(window.getByText('Named fields · Migration Custom')).toBeVisible()
    await window.getByLabel('Hint').fill('Persisted migration hint')
    const saveChanges = window.getByRole('button', { name: /save changes/i })
    await expect(saveChanges).toBeEnabled()
    await saveChanges.click()
    await expect(window.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => window.evaluate(async () => {
      const payload = await window.neoAnkiDesktop!.loadWorkspaceV4ExportPayload()
      const document = payload.document as { workspace: { notes: Array<{ fields: Record<string, string> }> } }
      return document.workspace.notes.some((note) => Object.values(note.fields).includes('Persisted migration hint'))
    }), { timeout: 15_000 }).toBe(true)
    await window.getByLabel('Set flag on selected cards').selectOption('5')
    await window.getByRole('button', { name: /bury until tomorrow/i }).click()
    await window.getByLabel('Tag for selected notes').fill('verified-migration')
    await window.getByRole('button', { name: 'Add tag' }).click()
    await window.getByPlaceholder(/Search questions/i).fill('flag:5 is:buried tag:verified-migration note:"Migration Custom"')
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

    app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByPlaceholder(/Search questions/i).fill('flag:5 is:buried tag:verified-migration note:"Migration Custom"')
    const restored = window.locator('.library-row').filter({ hasText: 'Capital of' }).first()
    await expect(restored).toBeVisible()
    await restored.getByRole('button', { name: /^Edit / }).click()
    await expect(window.getByLabel('Hint')).toHaveValue('Persisted migration hint')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('imported templates, CSS, fields, and deck presets are editable without flattening and survive restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-compatibility-editor-'))
  let app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    let window = await firstReadyWindow(app)
    await window.getByRole('button', { name: /migrate from anki/i }).click()
    await window.locator('input[type=file][accept=".apkg,.colpkg"]').setInputFiles(join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: /create checkpoint and migrate/i }).click()
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    const structure = window.locator('details').filter({ hasText: 'Note types, fields, templates, and CSS' })
    await structure.locator('summary').click()
    await structure.getByLabel('Note type').selectOption({ label: 'Migration Custom' })
    await structure.getByLabel('Field 3 name').fill('Migration hint')
    await structure.getByLabel('Question template').fill('<section class="edited-card">{{Front}}<small>{{Migration hint}}</small></section>')
    await structure.getByLabel('Card CSS').fill('.card { color: rgb(68, 34, 136); } .edited-card { font-weight: 600; }')
    await structure.getByRole('button', { name: /save note type/i }).click()
    await expect(window.getByText('Note type and template saved atomically.')).toBeVisible()

    const presets = window.locator('details').filter({ hasText: 'Deck presets and scheduling limits' })
    await presets.locator('summary').click()
    await presets.getByLabel('Deck', { exact: true }).selectOption({ label: 'Migration Corpus' })
    await presets.getByLabel('Desired retention').fill('0.91')
    await presets.getByLabel('Learning steps (minutes)', { exact: true }).fill('2, 12')
    await presets.getByRole('button', { name: /save deck and preset/i }).click()
    await expect(window.getByText('Deck and preset saved atomically.')).toBeVisible()
    await expect.poll(() => window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const type = document.workspace.noteTypes.find((value) => value.name === 'Migration Custom')!
      const template = document.workspace.templates.find((value) => value.noteTypeId === type.id)!
      const field = document.workspace.fields.find((value) => value.noteTypeId === type.id && value.ordinal === 2)!
      const deck = document.workspace.decks.find((value) => value.name === 'Migration Corpus')!
      const preset = document.workspace.presets.find((value) => value.id === deck.presetId)!
      return { field: field.name, question: template.questionFormat, css: type.css, retention: preset.desiredRetention, steps: preset.learningStepsMinutes }
    })).toEqual({ field: 'Migration hint', question: '<section class="edited-card">{{Front}}<small>{{Migration hint}}</small></section>', css: '.card { color: rgb(68, 34, 136); } .edited-card { font-weight: 600; }', retention: 0.91, steps: [2, 12] })
    await app.close()

    app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    const restored = window.locator('details').filter({ hasText: 'Note types, fields, templates, and CSS' })
    await restored.locator('summary').click()
    await restored.getByLabel('Note type').selectOption({ label: 'Migration Custom' })
    await expect(restored.getByLabel('Field 3 name')).toHaveValue('Migration hint')
    await expect(restored.getByLabel('Question template')).toContainText('{{Migration hint}}')
    await expect(restored.getByLabel('Card CSS')).toContainText('rgb(68, 34, 136)')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('card browser preserves per-card deck ownership and explicit Anki due-date edits', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-card-browser-'))
  let app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    let window = await firstReadyWindow(app)
    await window.getByRole('button', { name: /migrate from anki/i }).click()
    await window.locator('input[type=file][accept=".apkg,.colpkg"]').setInputFiles(join(process.cwd(), 'test-fixtures/anki/25.9.4/current-stable.apkg'))
    await window.getByRole('button', { name: /create checkpoint and migrate/i }).click()
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Cards', exact: true }).click()
    await window.getByPlaceholder(/Search questions/i).fill('is:learn note:"Migration Custom"')
    const row = window.locator('.card-browser-row').filter({ hasText: 'Capital of' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('checkbox', { name: /Select card Capital of/i }).check()
    await window.getByLabel('Move selected cards to deck').selectOption({ label: 'Migration Corpus::Core' })
    await window.getByLabel('Due date for selected cards').fill('2026-08-15')
    await window.getByRole('button', { name: 'Set due' }).click()
    await expect(window.getByText(/Rescheduled 1 selected card/)).toBeVisible()
    await expect.poll(() => window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      const noteType = document.workspace.noteTypes.find((value) => value.name === 'Migration Custom')!
      const note = document.workspace.notes.find((value) => value.noteTypeId === noteType.id && Object.values(value.fields).some((field) => field.includes('Capital of')))!
      const card = document.workspace.cards.find((value) => value.noteId === note.id && value.scheduling.queue === 'learn')!
      return { deck: document.workspace.decks.find((value) => value.id === card.deckId)?.name, dueAt: card.scheduling.dueAt }
    })).toEqual({ deck: 'Migration Corpus::Core', dueAt: new Date('2026-08-15T00:00:00').toISOString() })
    await app.close()

    app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    window = await firstReadyWindow(app)
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Cards', exact: true }).click()
    await window.getByPlaceholder(/Search questions/i).fill('is:learn deck:"Migration Corpus::Core"')
    await expect(window.locator('.card-browser-row').filter({ hasText: 'Capital of' })).toContainText('Migration Corpus::Core')
  } finally {
    await app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('custom preview records retrieval practice without changing the selected card schedule', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-custom-preview-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    const window = await firstReadyWindow(app)
    await window.getByRole('button', { name: /create a fresh workspace/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.getByRole('button', { name: 'Cards', exact: true }).click()
    await window.getByPlaceholder(/Search questions/i).fill('retrieval practice strengthen')
    const row = window.locator('.card-browser-row').filter({ hasText: 'What does retrieval practice strengthen?' })
    await row.getByRole('checkbox', { name: /Select card/ }).check()
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
