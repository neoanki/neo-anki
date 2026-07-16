import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { zipSync } from 'fflate'
import initSqlJs from 'sql.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    const firstWindow = await firstRun.firstWindow()
    expect(firstWindow.url()).toBe('neoanki://app/index.html')
    expect(await firstWindow.evaluate(() => window.neoAnkiDesktop?.isDesktop)).toBe(true)
    await expect(firstWindow.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
    await firstWindow.getByRole('button', { name: /45 minutes/i }).click()
    await firstWindow.getByRole('button', { name: /build my first plan/i }).click()
    await expect(firstWindow.getByRole('heading', { name: 'Today' })).toBeVisible()
    await firstRun.close()

    const stored = JSON.parse(await readFile(join(userData, 'neo-anki-data.json'), 'utf8')) as { settings: { dailyMinutes: number; onboardingComplete: boolean } }
    expect(stored.settings.dailyMinutes).toBe(45)
    expect(stored.settings.onboardingComplete).toBe(true)

    const secondRun = await launch()
    const secondWindow = await secondRun.firstWindow()
    await expect(secondWindow.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(secondWindow.getByRole('heading', { name: /45 min available/i })).toBeVisible()
    await secondRun.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('installs, loads, and disables a third-party extension package', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-extension-'))
  const extensionPackage = join(process.cwd(), 'examples/study-pulse-extension/build/org.neoanki.examples.study-pulse-1.0.0.neoanki-extension')
  try {
    const desktop = await electron.launch({ args: ['.', `--install-extension=${extensionPackage}`], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
    const window = await desktop.firstWindow()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await expect(window.getByRole('button', { name: /study pulse/i }).first()).toBeVisible()
    await window.getByRole('button', { name: /study pulse/i }).first().click()
    await expect(window.getByRole('heading', { name: 'Study Pulse' })).toBeVisible()

    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(window.getByText(/local package · neo anki sdk examples/i)).toBeVisible()
    await window.getByText('Study Pulse', { exact: true }).last().click()
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

test('desktop security policy permits the WebAssembly Anki importer', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-wasm-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData } })
  try {
    const window = await app.firstWindow()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await window.getByRole('button', { name: /open settings/i }).click()
    await window.locator('input[type=file][accept=".json,.csv,.apkg,.colpkg"]').setInputFiles({ name: 'csp.apkg', mimeType: 'application/octet-stream', buffer: await createAnkiPackage() })
    await expect(window.locator('.inline-message')).toContainText('Imported 1 item')
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
