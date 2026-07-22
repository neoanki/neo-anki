import { expect, test, _electron as electron } from '@playwright/test'
import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { isolatedElectronEnv, observeRuntimeFailures, readyElectronWindow, stopElectron } from './support/qa'

const packagePath = process.env.NEO_ANKI_INTEROPERABILITY_PACKAGE
const ankiPath = process.env.NEO_ANKI_LARGE_APKG

test('a large Anki package reports activity and commits durably', async () => {
  test.skip(!packagePath || !ankiPath, 'Set NEO_ANKI_INTEROPERABILITY_PACKAGE and NEO_ANKI_LARGE_APKG to run the large-package regression.')
  test.setTimeout(12 * 60_000)
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-large-import-'))
  let application = await electron.launch({
    args: ['.', `--install-extension=${packagePath}`],
    env: isolatedElectronEnv(userData),
  })
  let window = await readyElectronWindow(application)
  let failures = observeRuntimeFailures(window)
  let stopped = false

  try {
    await window.getByRole('button', { name: /start fresh/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /create workspace/i }).click()
    await window.getByRole('button', { name: 'Extensions' }).first().click()
    await window.getByRole('tab', { name: /Configure/ }).click()
    const frame = window.locator('iframe[title^="Anki & CSV"]').contentFrame()
    const input = frame.getByLabel('Choose Anki or CSV file')
    await expect(input).toBeVisible()

    const importStarted = performance.now()
    await input.setInputFiles(ankiPath!)
    await expect(frame.locator('.activity')).toBeVisible()
    await expect(frame.locator('.activity progress')).toBeVisible()
    await expect(frame.getByRole('status')).toHaveText(new RegExp(`Reading and checking ${basename(ankiPath!)}|Inspecting file in the isolated extension worker`))
    await expect(frame.locator('.report')).toBeVisible({ timeout: 3 * 60_000 })
    await expect(frame.getByRole('status')).toContainText('Preview ready')

    await expect(frame.locator('.activity')).toBeHidden()
    await frame.getByRole('button', { name: 'Import this file' }).click()
    await expect(frame.getByRole('status')).toContainText('Creating a rollback checkpoint')
    await expect(frame.locator('.activity')).toContainText('Keep Neo Anki open')
    await expect(input).toBeDisabled()
    await expect(window.getByText(/Import complete\. .*notes and .*cards are now available/)).toBeVisible({ timeout: 10 * 60_000 })
    const importDuration = performance.now() - importStarted
    if (/^jpgram-premium-.*\.apkg$/i.test(basename(ankiPath!))) expect(importDuration).toBeLessThan(5_000)
    expect(failures).toEqual([])

    await stopElectron(application)
    stopped = true
    application = await electron.launch({ args: ['.'], env: isolatedElectronEnv(userData) })
    window = await readyElectronWindow(application)
    failures = observeRuntimeFailures(window)
    stopped = false
    await window.getByRole('button', { name: /^Today/ }).first().click()
    await expect(window.getByRole('button', { name: /^Study / })).toBeEnabled({ timeout: 30_000 })
    await expect(window.getByText(/No practice prompts match/i)).toHaveCount(0)
    if (/^jpgram-premium-.*\.apkg$/i.test(basename(ankiPath!))) {
      await window.getByLabel('Study for').selectOption('20')
      const blocks = window.locator('.block-preview-row')
      await expect(window.getByText('16 practice prompts in 1 subject block')).toBeVisible()
      await expect(blocks).toHaveCount(1)
      await expect(blocks.first()).toContainText('Japanese Grammar')
      await expect(blocks.first()).toContainText('16 practice prompts')
      await expect(window.locator('.session-list-pane > header > span')).toHaveText('5 min left for later')
    }
    expect(failures).toEqual([])

    await stopElectron(application)
    stopped = true
    const database = new DatabaseSync(join(userData, 'neo-anki.sqlite'), { readOnly: true })
    const count = (table: string) => Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
    expect(count('items')).toBeGreaterThan(0)
    expect(count('cards')).toBeGreaterThan(0)
    expect(count('assets')).toBeGreaterThan(0)
    expect(Number((database.prepare("SELECT COUNT(*) AS count FROM assets WHERE length(data) = 0 AND metadata_json LIKE '%archivedMedia%'").get() as { count: number }).count)).toBe(count('assets'))
    database.close()

    expect((await readdir(join(userData, 'backups'))).some((name) => name.startsWith('import-checkpoint-'))).toBe(true)
    const archives = await readdir(join(userData, 'import-archives'))
    expect(archives).toHaveLength(1)
    expect((await stat(join(userData, 'import-archives', archives[0]))).size).toBe((await stat(ankiPath!)).size)
  } finally {
    if (!stopped) await stopElectron(application)
    await rm(userData, { recursive: true, force: true })
  }
})
