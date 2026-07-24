import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn, type ChildProcess } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { resetSamples, setBenchmarkRecording, writeBenchmarkReport } from './collector'
import { prepareBenchmarkProfile } from './fixtures'
import {
  clickAndMeasure,
  closeAndMeasure,
  durableCounts,
  launchBenchmarkApplication,
  measureInteraction,
  measureLifecycle,
  measureObservation,
} from './harness'
import type { BenchmarkDataset, BenchmarkRunMetadata, BenchmarkTier } from './types'

const executablePath = process.env.NEO_ANKI_BENCHMARK_APP || join(process.cwd(), 'release', 'mac-arm64', 'Neo Anki.app', 'Contents', 'MacOS', 'Neo Anki')
const mode = (process.env.NEO_ANKI_BENCHMARK_MODE || 'smoke') as BenchmarkRunMetadata['mode']
const tier: BenchmarkTier = mode === 'smoke' ? 'smoke' : mode === 'endurance' ? 'endurance' : 'full'
const iterations = Math.max(1, Number(process.env.NEO_ANKI_BENCHMARK_ITERATIONS || (mode === 'calibrate' ? 20 : 1)))
const outputDirectory = process.env.NEO_ANKI_BENCHMARK_OUTPUT || join(process.cwd(), 'test-results', 'desktop-benchmark', 'results')
const requireCompleteCatalog = process.env.NEO_ANKI_BENCHMARK_REQUIRE_CATALOG === '1'
const scenarioIterations = (count: number) => Array.from(
  { length: count + (mode === 'calibrate' ? 1 : 0) },
  (_, index) => index - (mode === 'calibrate' ? 1 : 0),
)

const operation = (operationId: string, iteration: number, dataset: BenchmarkDataset, application: ElectronApplication, page: Page) => ({
  operationId,
  iteration,
  dataset,
  tier,
  application,
  page,
})

const firstNavigationButton = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).first()
const waitForSaved = async (page: Page) => {
  await expect.poll(async () => page.locator('.persistence-status').count()).toBe(0)
}
const availablePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close((error) => error ? reject(error) : resolve(port))
  })
})
const startSyncService = async (port: number, database: string) => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/sync-service/src/server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        NEO_ANKI_SYNC_DATABASE: database,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hermetic sync service did not start.')), 15_000)
    child.once('error', reject)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Hermetic sync service exited with code ${code}.`))
    })
  })
  return child
}
const stopSyncService = async (child: ChildProcess | undefined) => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Desktop benchmarks require macOS arm64.')
  resetSamples()
})

test.afterAll(async () => {
  await writeBenchmarkReport({
    appPath: executablePath,
    outputDirectory,
    mode,
    iterations,
    tier,
    requireCompleteCatalog,
  })
})

test('fresh create-review-edit-restart journey', async () => {
  for (const iteration of scenarioIterations(iterations)) {
    setBenchmarkRecording(iteration >= 0)
    const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-fresh-'))
    let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
    try {
      await prepareBenchmarkProfile(userData, 'fresh')
      launched = await launchBenchmarkApplication({
        executablePath,
        userData,
        ready: async (page) => expect(page.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible(),
      })
      let { application, page } = launched
      measureLifecycle('lifecycle.launch.fresh', iteration, 'fresh', tier, launched.launchMs)

      await clickAndMeasure({
        ...operation('navigation.onboarding.start-fresh', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Start fresh' }),
        ready: () => expect(page.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible(),
      })
      await page.getByRole('button', { name: /30 minutes/i }).click()
      await clickAndMeasure({
        ...operation('navigation.onboarding.complete', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Create workspace' }),
        ready: () => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
        durable: async () => expect.poll(() => durableCounts(page)).toMatchObject({ notes: 0, cards: 0 }),
      })

      for (const route of ['Library', 'Extensions', 'Today']) {
        await clickAndMeasure({
          ...operation('navigation.routes.cold', iteration, 'fresh', application, page),
          locator: firstNavigationButton(page, route),
          ready: () => expect(page.getByRole('heading', { name: route, exact: true })).toBeVisible(),
        })
      }
      await measureInteraction({
        ...operation('navigation.routes.warm', iteration, 'fresh', application, page),
        action: () => firstNavigationButton(page, 'Library').click(),
        ready: () => expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible(),
      })
      await measureInteraction({
        ...operation('navigation.shortcuts', iteration, 'fresh', application, page),
        action: () => page.keyboard.press('Meta+1'),
        ready: () => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      })
      await measureInteraction({
        ...operation('navigation.history', iteration, 'fresh', application, page),
        action: () => page.goBack(),
        ready: () => expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible(),
      })
      await page.goForward()
      await measureInteraction({
        ...operation('navigation.window.resize', iteration, 'fresh', application, page),
        action: () =>
          application.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0]?.setSize(960, 720)
          }),
        ready: () => expect(page.locator('#main-content')).toBeVisible(),
      })
      await measureInteraction({
        ...operation('today.daily-target', iteration, 'fresh', application, page),
        action: () => page.getByLabel('Daily target').selectOption('45'),
        ready: () => waitForSaved(page),
        durable: () => waitForSaved(page),
      })
      const firstItem = page.getByRole('button', { name: /add your first knowledge item/i })
      await clickAndMeasure({
        ...operation('authoring.route-ready', iteration, 'fresh', application, page),
        locator: firstItem,
        ready: async () => {
          await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
          await expect(page.getByLabel('Prompt', { exact: true })).toBeVisible()
        },
      })
      await measureInteraction({
        ...operation('authoring.content-type', iteration, 'fresh', application, page),
        action: async () => {
          const select = page.getByLabel('Content type')
          await select.selectOption(await select.inputValue())
        },
        ready: () => expect(page.locator('.template-summary')).toContainText(/will be created/i),
      })
      await measureInteraction({
        ...operation('authoring.input-preview', iteration, 'fresh', application, page),
        action: async () => {
          await page.getByLabel('Prompt', { exact: true }).fill(`Benchmark prompt ${iteration}`)
          await page.getByLabel('Answer', { exact: true }).fill(`Benchmark answer ${iteration}`)
          await page.getByLabel('Collection', { exact: false }).fill('Benchmark collection')
          await page.getByLabel('Tags', { exact: false }).fill('benchmark, smoke')
        },
        ready: () => expect(page.locator('.create-preview')).toContainText(`Benchmark prompt ${iteration}`),
      })
      await measureInteraction({
        ...operation('authoring.citations', iteration, 'fresh', application, page),
        action: async () => {
          await page.getByRole('button', { name: 'Add citation' }).click()
          await page.getByLabel('Citation 1 title').fill('Benchmark source')
          await page.getByLabel('Citation 1 URL').fill('https://example.com/benchmark')
        },
        ready: () => expect(page.getByLabel('Citation 1 title')).toHaveValue('Benchmark source'),
      })
      await measureInteraction({
        ...operation('authoring.draft-reload', iteration, 'fresh', application, page),
        action: () => page.reload(),
        ready: async () => {
          await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
          await expect(page.locator('.content-fields textarea').first()).toHaveValue(
            `Benchmark prompt ${iteration}`,
            { timeout: 45_000 },
          )
          await expect(page.locator('input[aria-label="Citation 1 title"]')).toHaveValue(
            'Benchmark source',
          )
        },
      })
      await clickAndMeasure({
        ...operation('authoring.create', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: /^add knowledge item$/i }),
        ready: () => expect(page.locator('.save-toast')).toContainText(/safe new-material queue/i),
        durable: async () => expect.poll(() => durableCounts(page)).toMatchObject({ notes: 1, cards: 1 }),
      })

      await clickAndMeasure({
        ...operation('today.render.available', iteration, 'fresh', application, page),
        locator: firstNavigationButton(page, 'Today'),
        ready: () => expect(page.locator('button.study-button')).toBeEnabled(),
      })
      await measureInteraction({
        ...operation('today.session-options', iteration, 'fresh', application, page),
        action: async () => {
          await page.getByLabel('Study for').selectOption({ index: 0 })
          await page.getByLabel('Mode').selectOption('focus')
        },
        ready: () => expect(page.locator('#focus-collection')).toBeVisible(),
      })
      await measureInteraction({
        ...operation('today.planning-details', iteration, 'fresh', application, page),
        action: () => page.getByText('Planning details', { exact: true }).click(),
        ready: () => expect(page.getByText('Seven-day estimate', { exact: true })).toBeVisible(),
      })
      await clickAndMeasure({
        ...operation('today.session.start', iteration, 'fresh', application, page),
        locator: page.locator('button.study-button'),
        ready: () => expect(page.getByRole('progressbar', { name: 'Review session progress' })).toBeVisible(),
      })
      await measureObservation({
        ...operation('review.prompt', iteration, 'fresh', application, page),
        ready: () => expect(page.getByText(`Benchmark prompt ${iteration}`, { exact: true })).toBeVisible(),
      })
      await clickAndMeasure({
        ...operation('review.reveal', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: /reveal answer/i }),
        ready: () => expect(page.getByText(`Benchmark answer ${iteration}`, { exact: true })).toBeVisible(),
      })
      await clickAndMeasure({
        ...operation('review.grade', iteration, 'fresh', application, page),
        locator: page.locator('button.grade-button.recalled'),
        ready: () => expect(page.getByRole('heading', { name: /enough for this session/i })).toBeVisible(),
        durable: async () => expect.poll(() => durableCounts(page)).toMatchObject({ reviews: 1 }),
      })
      await clickAndMeasure({
        ...operation('review.end-complete', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Return to Today' }),
        ready: () => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      })

      await clickAndMeasure({
        ...operation('library.render.small', iteration, 'fresh', application, page),
        locator: firstNavigationButton(page, 'Library'),
        ready: () => expect(page.getByText(`Benchmark prompt ${iteration}`, { exact: true })).toBeVisible(),
      })
      await measureInteraction({
        ...operation('library.search', iteration, 'fresh', application, page),
        action: () => page.getByPlaceholder(/search prompts/i).fill('no-such-benchmark-result'),
        ready: () => expect(page.getByRole('heading', { name: /no matching knowledge items/i })).toBeVisible(),
      })
      await page.getByRole('button', { name: /clear filters/i }).click()
      await clickAndMeasure({
        ...operation('library.edit', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: `Edit Benchmark prompt ${iteration}` }),
        ready: () => expect(page.getByRole('dialog', { name: 'Edit content' })).toBeVisible(),
      })
      await page.getByLabel('Answer', { exact: true }).fill(`Edited benchmark answer ${iteration}`)
      await clickAndMeasure({
        ...operation('library.edit', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Save changes' }),
        ready: () => expect(page.getByRole('dialog', { name: 'Edit content' })).toHaveCount(0),
        durable: async () => expect.poll(async () => {
          const document = await page.evaluate(() => window.neoAnkiDesktop!.loadWorkspaceV4Document())
          return Object.values(document.workspace.notes[0]?.fields || {}).some((value) => value === `Edited benchmark answer ${iteration}`)
        }).toBe(true),
      })
      await page.evaluate(() => { window.confirm = () => true })
      await clickAndMeasure({
        ...operation('library.trash', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: `Move Benchmark prompt ${iteration} to Trash` }),
        ready: () => expect(page.locator('.undo-banner')).toContainText(/moved to trash/i),
        durable: async () => expect.poll(async () => {
          const document = await page.evaluate(() => window.neoAnkiDesktop!.loadWorkspaceV4Document())
          return document.clientState.trash.length
        }).toBe(1),
      })
      await clickAndMeasure({
        ...operation('library.trash', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Undo' }),
        ready: () => expect(page.getByText(`Benchmark prompt ${iteration}`, { exact: true })).toBeVisible(),
        durable: async () => expect.poll(async () => {
          const document = await page.evaluate(() => window.neoAnkiDesktop!.loadWorkspaceV4Document())
          return document.clientState.trash.length
        }).toBe(0),
      })

      await clickAndMeasure({
        ...operation('navigation.settings.open-close', iteration, 'fresh', application, page),
        locator: firstNavigationButton(page, 'Settings'),
        ready: () => expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible(),
      })
      await clickAndMeasure({
        ...operation('settings.theme', iteration, 'fresh', application, page),
        locator: page.getByRole('button', { name: 'Dark' }),
        ready: () => expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark'),
        durable: () => waitForSaved(page),
      })
      await measureInteraction({
        ...operation('navigation.settings.open-close', iteration, 'fresh', application, page),
        action: () => page.keyboard.press('Escape'),
        ready: () => expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0),
      })

      const idleQuitMs = await closeAndMeasure(application)
      measureLifecycle('lifecycle.quit.idle', iteration, 'small', tier, idleQuitMs)
      launched = await launchBenchmarkApplication({
        executablePath,
        userData,
        ready: async (candidate) => expect(candidate.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      })
      application = launched.application
      page = launched.page
      measureLifecycle('lifecycle.relaunch.warm', iteration, 'small', tier, launched.launchMs)
      await measureObservation({
        ...operation('lifecycle.restart.durable', iteration, 'small', application, page),
        ready: async () => {
          await expect.poll(() => durableCounts(page)).toMatchObject({ notes: 1, cards: 1, reviews: 1 })
          await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark')
        },
      })
      const windowCloseStarted = performance.now()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      await expect.poll(() =>
        application.windows().filter((candidate) => !candidate.isClosed()).length).toBe(0)
      measureLifecycle(
        'lifecycle.window.close',
        iteration,
        'small',
        tier,
        performance.now() - windowCloseStarted,
      )
      const windowReopenStarted = performance.now()
      await application.evaluate(({ app }) => app.emit('activate'))
      let reopenedPage: Page | undefined
      await expect.poll(async () => {
        for (const candidate of [...application.windows()].reverse()) {
          if (candidate.isClosed()) continue
          if (await candidate.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null) === 'true') {
            reopenedPage = candidate
            return true
          }
        }
        return false
      }, { timeout: 45_000 }).toBe(true)
      page = reopenedPage!
      measureLifecycle(
        'lifecycle.window.reopen',
        iteration,
        'small',
        tier,
        performance.now() - windowReopenStarted,
      )
      await firstNavigationButton(page, 'Settings').click()
      page.once('dialog', (dialog) => void dialog.accept())
      await clickAndMeasure({
        ...operation('settings.workspace.erase', iteration, 'small', application, page),
        locator: page.getByRole('button', { name: 'Erase and start empty' }),
        ready: () =>
          expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
        durable: async () =>
          expect.poll(() => durableCounts(page).catch(() => null)).toMatchObject({
            notes: 0,
            cards: 0,
            reviews: 0,
          }),
      })
      expect(launched.runtimeFailures).toEqual([])
      await closeAndMeasure(application)
      launched = undefined
    } finally {
      if (launched) await launched.application.close().catch(() => undefined)
      await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      setBenchmarkRecording(true)
    }
  }
})

test('established library, settings, and pending-save journey', async () => {
  test.skip(tier === 'smoke', 'Full and calibration modes exercise established workspaces.')
  for (const iteration of scenarioIterations(iterations)) {
    setBenchmarkRecording(iteration >= 0)
    const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-typical-'))
    let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
    try {
      await prepareBenchmarkProfile(userData, 'typical')
      launched = await launchBenchmarkApplication({
        executablePath,
        userData,
        ready: async (page) => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      })
      const { application, page } = launched
      measureLifecycle('lifecycle.launch.established', iteration, 'typical', tier, launched.launchMs)

      await clickAndMeasure({
        ...operation('library.render.typical', iteration, 'typical', application, page),
        locator: firstNavigationButton(page, 'Library'),
        ready: async () => {
          await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
          await expect(page.locator('.library-row')).toHaveCount(100)
        },
      })
      await clickAndMeasure({
        ...operation('library.mode', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Practice prompts' }),
        ready: () => expect(page.locator('.card-browser-row')).toHaveCount(100),
      })
      await page.getByRole('button', { name: 'Knowledge items' }).click()

      for (const query of ['Benchmark prompt 42', 'tag:tag-2', 'deck:Collection*', '-tag:tag-9', 'definitely-no-result']) {
        await measureInteraction({
          ...operation('library.search', iteration, 'typical', application, page),
          action: () => page.getByPlaceholder(/search prompts/i).fill(query),
          ready: async () => {
            if (query === 'definitely-no-result') await expect(page.getByRole('heading', { name: /no matching knowledge items/i })).toBeVisible()
            else await expect(page.locator('.library-row').first()).toBeVisible()
          },
        })
      }
      await page.getByRole('button', { name: /clear filters/i }).click()
      for (const option of ['created-desc', 'due-asc', 'difficulty-desc', 'deck-asc']) {
        await measureInteraction({
          ...operation('library.filters-sorts', iteration, 'typical', application, page),
          action: () => page.getByLabel('Sort Library').selectOption(option),
          ready: () => expect(page.locator('.library-row').first()).toBeVisible(),
        })
      }
      await clickAndMeasure({
        ...operation('library.pagination', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: /show 100 more/i }),
        ready: () => expect(page.locator('.library-row')).toHaveCount(200),
      })
      await measureInteraction({
        ...operation('library.selection', iteration, 'typical', application, page),
        action: () => page.getByLabel('Select all visible knowledge items').check(),
        ready: () => expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toContainText('200 selected'),
      })
      await clickAndMeasure({
        ...operation('library.custom-study', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Preview only' }),
        ready: () => expect(page.getByRole('progressbar', { name: 'Review session progress' })).toBeVisible(),
      })
      await clickAndMeasure({
        ...operation('review.edit', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Edit this knowledge item' }),
        ready: () => expect(page.getByRole('dialog', { name: 'Edit content' })).toBeVisible(),
      })
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: /reveal answer/i }).click()
      await clickAndMeasure({
        ...operation('review.block-transition', iteration, 'typical', application, page),
        locator: page.locator('button.grade-button.recalled'),
        ready: () => expect(page.getByText('Practice prompt ready.', { exact: true })).toBeAttached(),
        durable: () => waitForSaved(page),
      })
      await measureInteraction({
        ...operation('review.undo', iteration, 'typical', application, page),
        action: () => page.keyboard.press('Meta+z'),
        ready: () => expect(page.locator('button.grade-button.recalled')).toBeVisible(),
        durable: () => waitForSaved(page),
      })
      await page.getByRole('button', { name: 'End session' }).click()
      await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
      await page.getByLabel('Select all visible knowledge items').check()
      await clickAndMeasure({
        ...operation('library.bulk-state', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Suspend practice prompts' }),
        ready: () => expect(page.getByRole('button', { name: 'Study + reschedule' })).toBeDisabled(),
        durable: () => waitForSaved(page),
      })
      await page.getByRole('button', { name: 'Resume practice prompts' }).click()
      await page.getByLabel('Tag for selected knowledge items').fill('bulk-benchmark')
      await clickAndMeasure({
        ...operation('library.bulk-metadata', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Add tag' }),
        ready: () => expect(page.getByLabel('Tag for selected knowledge items')).toHaveValue(''),
        durable: () => waitForSaved(page),
      })
      await page.getByRole('button', { name: 'Clear' }).click()

      const firstVariant = page.locator('.variant-pill').first()
      await clickAndMeasure({
        ...operation('library.single-suspend', iteration, 'typical', application, page),
        locator: firstVariant,
        ready: () => expect(firstVariant).toContainText(/suspended/i),
        durable: () => waitForSaved(page),
      })
      await firstVariant.click()

      await clickAndMeasure({
        ...operation('navigation.settings.open-close', iteration, 'typical', application, page),
        locator: firstNavigationButton(page, 'Settings'),
        ready: () => expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible(),
      })
      await measureObservation({
        ...operation('sync.status', iteration, 'typical', application, page),
        ready: () => expect(page.locator('.sync-panel')).not.toContainText('Reading sync status'),
      })
      await measureInteraction({
        ...operation('settings.learning', iteration, 'typical', application, page),
        action: async () => {
          await page.getByLabel('Bury siblings for the rest of the day').uncheck()
          await page.getByLabel('Leech lapse threshold').fill('9')
        },
        ready: () => waitForSaved(page),
        durable: () => waitForSaved(page),
      })
      await page.getByRole('button', { name: 'Close settings' }).click()
      await firstNavigationButton(page, 'Settings').click()
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
      await clickAndMeasure({
        ...operation('settings.templates.load', iteration, 'typical', application, page),
        locator: page.getByText('Fields and card layouts', { exact: true }),
        ready: () => expect(page.locator('.template-editor').first()).toBeVisible(),
      })
      const typeName = page.getByLabel('Content type name')
      await typeName.fill(`Basic ${iteration}`)
      await clickAndMeasure({
        ...operation('settings.templates.save', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: /save fields and templates/i }),
        ready: () =>
          expect(page.locator('.template-manager .inline-message')).toContainText(
            /saved atomically/i,
          ),
        durable: () => waitForSaved(page),
      })
      await clickAndMeasure({
        ...operation('settings.templates.load', iteration, 'typical', application, page),
        locator: page.getByText('Deck presets and scheduling limits', { exact: true }),
        ready: () => expect(page.getByLabel('Preset name')).toBeVisible(),
      })
      const presetName = page.getByLabel('Preset name')
      await presetName.fill(`Default benchmark ${iteration}`)
      await clickAndMeasure({
        ...operation('settings.presets.save', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: /save deck and preset/i }),
        ready: () =>
          expect(page.locator('.template-manager .inline-message')).toContainText(
            /saved atomically/i,
          ),
        durable: () => waitForSaved(page),
      })
      const backupPath = join(userData, `benchmark-${iteration}.neoanki-backup`)
      await application.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      }, backupPath)
      await clickAndMeasure({
        ...operation('settings.backup.export', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Export backup' }),
        ready: () =>
          expect(page.getByRole('status').filter({ hasText: /backup saved/i })).toBeVisible(),
      })
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, backupPath)
      await page.evaluate(() => { window.confirm = () => true })
      await clickAndMeasure({
        ...operation('settings.backup.restore', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Restore backup' }),
        ready: () => expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible(),
        durable: async () => expect.poll(() => durableCounts(page)).toMatchObject({ notes: 5_000 }),
      })
      await firstNavigationButton(page, 'Settings').click()
      const diagnosticsPath = join(userData, `benchmark-diagnostics-${iteration}.jsonl`)
      await application.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      }, diagnosticsPath)
      await clickAndMeasure({
        ...operation('settings.diagnostics.export', iteration, 'typical', application, page),
        locator: page.getByRole('button', { name: 'Export diagnostics' }),
        ready: () =>
          expect(page.getByRole('status').filter({ hasText: /diagnostics saved/i })).toBeVisible(),
      })

      await page.getByLabel('Leech lapse threshold').fill('10')
      const pendingStarted = performance.now()
      await page.getByRole('button', { name: 'Close settings' }).click()
      await closeAndMeasure(application)
      measureLifecycle(
        'lifecycle.quit.pending-save',
        iteration,
        'typical',
        tier,
        performance.now() - pendingStarted,
      )
      launched = undefined
    } finally {
      if (launched) await launched.application.close().catch(() => undefined)
      await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      setBenchmarkRecording(true)
    }
  }
})

test('hermetic encrypted sync account, roundtrip, failure, retry, and disconnect', async () => {
  test.skip(tier === 'smoke', 'Credentialed sync is part of the full packaged catalog.')
  test.skip(
    process.env.NEO_ANKI_BENCHMARK_SYNC_CREDENTIALS !== '1',
    'Credentialed sync is opt-in because macOS may show a Keychain authorization prompt.',
  )
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-sync-'))
  const database = join(userData, 'sync-service.sqlite')
  const port = await availablePort()
  let service: ChildProcess | undefined
  let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
  try {
    service = await startSyncService(port, database)
    await prepareBenchmarkProfile(userData, 'small')
    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (page) =>
        expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
    })
    const { application, page } = launched
    await firstNavigationButton(page, 'Settings').click()
    await expect(page.locator('.sync-panel')).not.toContainText('Reading sync status')
    await page.getByLabel('Sync service URL').fill(`http://127.0.0.1:${port}`)
    await clickAndMeasure({
      ...operation('sync.account', 0, 'small', application, page),
      locator: page.getByRole('button', { name: 'Create encrypted sync account' }),
      ready: () => expect(page.getByLabel('Neo Anki recovery key')).toBeVisible(),
      durable: async () => {
        await expect.poll(async () =>
          page.evaluate(() => window.neoAnkiDesktop!.syncStatus())).toMatchObject({
          configured: true,
        })
        await access(join(userData, 'sync', 'config.json'))
      },
    })
    await clickAndMeasure({
      ...operation('sync.roundtrip', 0, 'small', application, page),
      locator: page.getByRole('button', { name: 'Sync now' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /sync complete/i })).toBeVisible(),
      durable: () => waitForSaved(page),
    })
    await clickAndMeasure({
      ...operation('sync.devices', 0, 'small', application, page),
      locator: page.getByRole('button', { name: 'Replace recovery key' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /replacement key/i })).toBeVisible(),
    })
    await stopSyncService(service)
    service = undefined
    await clickAndMeasure({
      ...operation('sync.failure-retry', 0, 'small', application, page),
      locator: page.getByRole('button', { name: 'Sync now' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /fetch|failed|refused/i })).toBeVisible(),
    })
    service = await startSyncService(port, database)
    await clickAndMeasure({
      ...operation('sync.failure-retry', 1, 'small', application, page),
      locator: page.getByRole('button', { name: 'Sync now' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /sync complete/i })).toBeVisible(),
      durable: () => waitForSaved(page),
    })
    await clickAndMeasure({
      ...operation('sync.devices', 1, 'small', application, page),
      locator: page.getByRole('button', { name: 'Disconnect this device' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /disconnected/i })).toBeVisible(),
      durable: async () =>
        expect.poll(async () =>
          page.evaluate(() => window.neoAnkiDesktop!.syncStatus())).toMatchObject({
          configured: false,
        }),
    })
    await closeAndMeasure(application)
    launched = undefined
  } finally {
    if (launched) await launched.application.close().catch(() => undefined)
    await stopSyncService(service)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('typed-answer review interaction', async () => {
  test.skip(tier === 'smoke', 'Typed templates are exercised by the full catalog.')
  const typedIterations = mode === 'calibrate' ? iterations : 1
  for (const typedIteration of scenarioIterations(typedIterations)) {
  setBenchmarkRecording(typedIteration >= 0)
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-typed-'))
  let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
  try {
    await prepareBenchmarkProfile(userData, 'small')
    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (page) =>
        expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
    })
    const { application, page } = launched
    await firstNavigationButton(page, 'Settings').click()
    await page.getByText('Fields and card layouts', { exact: true }).click()
    await page.getByLabel('Answer interaction').selectOption('type')
    await page.getByRole('button', { name: /save fields and templates/i }).click()
    await expect(page.getByRole('status').filter({ hasText: /saved atomically/i })).toBeVisible()
    await page.getByRole('button', { name: 'Close settings' }).click()
    await page.locator('button.study-button').click()
    await expect(page.getByLabel('Type your answer')).toBeVisible()
    await measureInteraction({
      ...operation('review.typed-input', typedIteration, 'small', application, page),
      action: () => page.getByLabel('Type your answer').fill('Benchmark answer 0'),
      ready: () => expect(page.getByLabel('Type your answer')).toHaveValue('Benchmark answer 0'),
    })
    await measureInteraction({
      ...operation('review.reveal', typedIteration, 'small', application, page),
      action: () => page.getByLabel('Type your answer').press('Enter'),
      ready: () => expect(page.locator('.typed-comparison')).toBeVisible(),
    })
    await closeAndMeasure(application)
    launched = undefined
  } finally {
    if (launched) await launched.application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    setBenchmarkRecording(true)
  }
  }
})

test('corrupt-workspace recovery, retry, export, restore, and start-empty', async () => {
  test.skip(tier === 'smoke', 'Destructive recovery is part of the full catalog.')
  const recoveryIterations = mode === 'calibrate' ? iterations : 1
  for (const recoveryIteration of scenarioIterations(recoveryIterations)) {
  setBenchmarkRecording(recoveryIteration >= 0)
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-recovery-'))
  const backupPath = join(userData, 'benchmark-recovery.neoanki-backup')
  const exportedOriginalPath = join(userData, 'benchmark-preserved.sqlite')
  const databasePath = join(userData, 'neo-anki.sqlite')
  let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
  const corruptWorkspace = () => {
    const database = new DatabaseSync(databasePath)
    database.prepare('UPDATE workspace_v4 SET json = ? WHERE id = 1').run(
      '{"format":"neo-anki-workspace","schemaVersion":4,"workspace":BROKEN',
    )
    database.close()
  }
  try {
    await prepareBenchmarkProfile(userData, 'small')
    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (page) =>
        expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
    })
    await firstNavigationButton(launched.page, 'Settings').click()
    await launched.application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, backupPath)
    await launched.page.getByRole('button', { name: 'Export backup' }).click()
    await expect(launched.page.getByRole('status').filter({ hasText: /backup saved/i })).toBeVisible()
    await closeAndMeasure(launched.application)
    launched = undefined
    corruptWorkspace()

    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (page) =>
        expect(page.getByRole('heading', { name: /workspace needs attention/i })).toBeVisible(),
    })
    let { application, page } = launched
    measureLifecycle('recovery.corrupt-launch', recoveryIteration * 2, 'small', tier, launched.launchMs)
    await clickAndMeasure({
      ...operation('recovery.actions', recoveryIteration * 4, 'small', application, page),
      locator: page.getByRole('button', { name: 'Retry' }),
      ready: () =>
        expect(page.getByRole('heading', { name: /workspace needs attention/i })).toBeVisible(),
    })
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, exportedOriginalPath)
    await clickAndMeasure({
      ...operation('recovery.actions', recoveryIteration * 4 + 1, 'small', application, page),
      locator: page.getByRole('button', { name: 'Export original data' }),
      ready: () =>
        expect(page.getByRole('status').filter({ hasText: /original workspace saved/i })).toBeVisible(),
    })
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, backupPath)
    await clickAndMeasure({
      ...operation('recovery.actions', recoveryIteration * 4 + 2, 'small', application, page),
      locator: page.getByRole('button', { name: 'Restore backup' }),
      ready: () => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      durable: async () =>
        expect.poll(() => durableCounts(page).catch(() => null)).toMatchObject({
          notes: 120,
          cards: 120,
        }),
    })
    await closeAndMeasure(application)
    launched = undefined
    corruptWorkspace()

    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (candidate) =>
        expect(candidate.getByRole('heading', { name: /workspace needs attention/i })).toBeVisible(),
    })
    application = launched.application
    page = launched.page
    measureLifecycle('recovery.corrupt-launch', recoveryIteration * 2 + 1, 'small', tier, launched.launchMs)
    page.once('dialog', (dialog) => void dialog.accept())
    await clickAndMeasure({
      ...operation('recovery.actions', recoveryIteration * 4 + 3, 'small', application, page),
      locator: page.getByRole('button', { name: 'Start empty' }),
      ready: () =>
        expect(page.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible(),
      durable: async () =>
        expect.poll(() => durableCounts(page).catch(() => null)).toMatchObject({
          notes: 0,
          cards: 0,
          reviews: 0,
        }),
    })
    await closeAndMeasure(application)
    launched = undefined
  } finally {
    if (launched) await launched.application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    setBenchmarkRecording(true)
  }
  }
})

test('100-operation retained-memory endurance loop', async () => {
  test.skip(tier !== 'endurance', 'Only the endurance command runs the 100-operation loop.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-endurance-'))
  let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
  try {
    await prepareBenchmarkProfile(userData, 'small')
    launched = await launchBenchmarkApplication({
      executablePath,
      userData,
      ready: async (page) =>
        expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
    })
    const { application, page } = launched
    await firstNavigationButton(page, 'Library').click()
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    await firstNavigationButton(page, 'Today').click()
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    await page.requestGC()
    for (let index = 0; index < 100; index += 1) {
      const destination = index % 2 === 0 ? 'Library' : 'Today'
      await clickAndMeasure({
        ...operation('navigation.routes.warm', index, 'small', application, page),
        locator: firstNavigationButton(page, destination),
        ready: () =>
          expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible(),
      })
    }
    await page.requestGC()
    await measureObservation({
      ...operation('endurance.memory.settled', 100, 'small', application, page),
      ready: () => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
    })
    await closeAndMeasure(application)
    launched = undefined
  } finally {
    if (launched) await launched.application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('large workspace launch, planning, Library render, search, and pagination', async () => {
  test.skip(tier === 'smoke', 'Full and calibration modes exercise the 50,000-card workspace.')
  const largeIterations = mode === 'calibrate' ? Math.min(iterations, 3) : 1
  for (const iteration of scenarioIterations(largeIterations)) {
    setBenchmarkRecording(iteration >= 0)
    const userData = await mkdtemp(join(tmpdir(), 'neo-anki-benchmark-large-'))
    let launched: Awaited<ReturnType<typeof launchBenchmarkApplication>> | undefined
    try {
      await prepareBenchmarkProfile(userData, 'large')
      launched = await launchBenchmarkApplication({
        executablePath,
        userData,
        ready: async (page) => expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(),
      })
      const { application, page } = launched
      measureLifecycle('lifecycle.launch.large', iteration, 'large', tier, launched.launchMs)
      await measureObservation({
        ...operation('today.planner.large', iteration, 'large', application, page),
        ready: () => expect(page.locator('button.study-button')).toBeEnabled({ timeout: 45_000 }),
      })
      await clickAndMeasure({
        ...operation('library.render.large', iteration, 'large', application, page),
        locator: firstNavigationButton(page, 'Library'),
        ready: () => expect(page.locator('.library-row')).toHaveCount(100),
      })
      await measureInteraction({
        ...operation('library.search', iteration, 'large', application, page),
        action: () => page.getByPlaceholder(/search prompts/i).fill('Benchmark prompt 49999'),
        ready: () => expect(page.getByText(/Benchmark prompt 49999/).first()).toBeVisible(),
      })
      await page.getByPlaceholder(/search prompts/i).fill('')
      await clickAndMeasure({
        ...operation('library.pagination', iteration, 'large', application, page),
        locator: page.getByRole('button', { name: /show 100 more/i }),
        ready: () => expect(page.locator('.library-row')).toHaveCount(200),
      })
      expect(launched.runtimeFailures).toEqual([])
      await closeAndMeasure(application)
      launched = undefined
    } finally {
      if (launched) await launched.application.close().catch(() => undefined)
      await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      setBenchmarkRecording(true)
    }
  }
})
