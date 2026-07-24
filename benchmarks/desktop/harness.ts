import { expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { performance } from 'node:perf_hooks'
import type { ChildProcess } from 'node:child_process'
import type { BenchmarkDataset, BenchmarkSample, BenchmarkTier, ProcessSnapshot, RendererProbeSnapshot } from './types'
import { recordSample } from './collector'

export interface BenchmarkApplication {
  application: ElectronApplication
  page: Page
  lifecycleMarks: Array<Record<string, unknown>>
  runtimeFailures: string[]
}

const processSnapshot = async (application: ElectronApplication): Promise<ProcessSnapshot> => application.evaluate(({ app }) => {
  const metrics = app.getAppMetrics()
  return metrics.reduce((total, metric) => ({
    residentSetBytes: total.residentSetBytes + (metric.memory?.workingSetSize || 0) * 1024,
    privateBytes: total.privateBytes + (metric.memory?.privateBytes || 0) * 1024,
    cpuPercent: total.cpuPercent + (metric.cpu?.percentCPUUsage || 0),
  }), { residentSetBytes: 0, privateBytes: 0, cpuPercent: 0 })
})

const attachProcessLog = (child: ChildProcess, marks: Array<Record<string, unknown>>) => {
  let buffer = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>
        if (value.type === 'neo-anki-benchmark') marks.push(value)
      } catch { /* Non-benchmark stderr remains available to Playwright. */ }
    }
  })
}

const installRendererProbe = (page: Page) => page.evaluate(() => {
  const target = window as unknown as {
    __neoAnkiBenchmarkProbe?: {
      reset(): void
      snapshot(): Promise<RendererProbeSnapshot>
    }
  }
  if (target.__neoAnkiBenchmarkProbe) return
  let eventAt = 0
  let paintedAt = 0
  let longTasks: number[] = []
  let frameGaps: number[] = []
  let lastFrame = performance.now()
  const frame = (now: number) => {
    frameGaps.push(now - lastFrame)
    if (frameGaps.length > 2_000) frameGaps.shift()
    lastFrame = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  const event = () => {
    eventAt = performance.now()
    paintedAt = 0
    requestAnimationFrame(() => requestAnimationFrame(() => { paintedAt = performance.now() }))
  }
  for (const name of ['click', 'keydown', 'input', 'change']) document.addEventListener(name, event, true)
  try {
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) longTasks.push(entry.duration)
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* Chromium versions without Long Tasks still provide frame gaps. */ }
  target.__neoAnkiBenchmarkProbe = {
    reset() {
      eventAt = 0
      paintedAt = 0
      longTasks = []
      frameGaps = []
      lastFrame = performance.now()
    },
    async snapshot() {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const orderedGaps = [...frameGaps].sort((left, right) => left - right)
      const p95 = orderedGaps[Math.min(orderedGaps.length - 1, Math.floor(orderedGaps.length * 0.95))] || 0
      return {
        eventToPaintMs: eventAt && paintedAt ? paintedAt - eventAt : undefined,
        longTaskCount: longTasks.length,
        longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
        longestTaskMs: Math.max(0, ...longTasks),
        frameGapP95Ms: p95,
        worstFrameGapMs: Math.max(0, ...frameGaps),
      }
    },
  }
})

const rendererSnapshot = (page: Page) => page.evaluate(async () => {
  const probe = (window as unknown as { __neoAnkiBenchmarkProbe: { snapshot(): Promise<RendererProbeSnapshot> } }).__neoAnkiBenchmarkProbe
  return probe.snapshot()
})

const resetProbe = async (page: Page) => {
  // A full renderer reload replaces `window`, so reinstall the probe outside
  // the measured interval before every operation.
  await installRendererProbe(page)
  await page.evaluate(() => {
    (window as unknown as { __neoAnkiBenchmarkProbe: { reset(): void } }).__neoAnkiBenchmarkProbe.reset()
  })
}

export const launchBenchmarkApplication = async (options: {
  executablePath: string
  userData: string
  ready?: (page: Page) => Promise<void>
}) => {
  const lifecycleMarks: Array<Record<string, unknown>> = []
  const started = performance.now()
  const application = await electron.launch({
    executablePath: options.executablePath,
    env: {
      ...process.env,
      NEO_ANKI_USER_DATA_DIR: options.userData,
      NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
      NEO_ANKI_E2E_HEADLESS: '1',
      NEO_ANKI_BENCHMARK: '1',
    },
  })
  attachProcessLog(application.process(), lifecycleMarks)
  let page: Page | undefined
  await expect.poll(async () => {
    for (const candidate of [...application.windows()].reverse()) {
      if (candidate.isClosed()) continue
      if (await candidate.locator('html').getAttribute('data-neo-anki-renderer-ready').catch(() => null) === 'true') {
        page = candidate
        return true
      }
    }
    return false
  }, { timeout: 45_000, intervals: [50, 100, 250, 500] }).toBe(true)
  if (options.ready) await options.ready(page!)
  await installRendererProbe(page!)
  const runtimeFailures: string[] = []
  page!.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`))
  page!.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) runtimeFailures.push(`console: ${message.text()}`)
  })
  return {
    application,
    page: page!,
    lifecycleMarks,
    runtimeFailures,
    launchMs: performance.now() - started,
  }
}

export const measureLifecycle = (operationId: string, iteration: number, dataset: BenchmarkDataset, tier: BenchmarkTier, lifecycleMs: number) => {
  recordSample({
    operationId,
    iteration,
    dataset,
    tier,
    lifecycleMs,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longestTaskMs: 0,
    frameGapP95Ms: 0,
    worstFrameGapMs: 0,
    success: true,
    measuredAt: new Date().toISOString(),
  })
}

export const measureObservation = async (options: {
  operationId: string
  iteration: number
  dataset: BenchmarkDataset
  tier: BenchmarkTier
  application: ElectronApplication
  page: Page
  ready: () => Promise<unknown>
}) => {
  await resetProbe(options.page)
  const beforeProcess = await processSnapshot(options.application)
  const started = performance.now()
  let success = false
  let error: string | undefined
  let settledMs: number | undefined
  try {
    await options.ready()
    settledMs = performance.now() - started
    success = true
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason)
    throw reason
  } finally {
    const probe = await rendererSnapshot(options.page).catch((): RendererProbeSnapshot => ({
      longTaskCount: 0, longTaskTotalMs: 0, longestTaskMs: 0, frameGapP95Ms: 0, worstFrameGapMs: 0,
    }))
    const afterProcess = await processSnapshot(options.application).catch(() => beforeProcess)
    recordSample({
      operationId: options.operationId,
      iteration: options.iteration,
      dataset: options.dataset,
      tier: options.tier,
      settledMs,
      ...probe,
      beforeProcess,
      afterProcess,
      success,
      error,
      measuredAt: new Date().toISOString(),
    })
  }
}

export const measureInteraction = async (options: {
  operationId: string
  iteration: number
  dataset: BenchmarkDataset
  tier: BenchmarkTier
  application: ElectronApplication
  page: Page
  action: () => Promise<unknown>
  ready: () => Promise<unknown>
  durable?: () => Promise<unknown>
}) => {
  await resetProbe(options.page)
  const beforeProcess = await processSnapshot(options.application)
  const started = performance.now()
  let success = false
  let error: string | undefined
  let settledMs: number | undefined
  let durableMs: number | undefined
  try {
    await options.action()
    await options.ready()
    settledMs = performance.now() - started
    if (options.durable) {
      await options.durable()
      durableMs = performance.now() - started
    }
    success = true
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason)
    throw reason
  } finally {
    const probe = await rendererSnapshot(options.page).catch((): RendererProbeSnapshot => ({
      longTaskCount: 0, longTaskTotalMs: 0, longestTaskMs: 0, frameGapP95Ms: 0, worstFrameGapMs: 0,
    }))
    const afterProcess = await processSnapshot(options.application).catch(() => beforeProcess)
    const sample: BenchmarkSample = {
      operationId: options.operationId,
      iteration: options.iteration,
      dataset: options.dataset,
      tier: options.tier,
      feedbackMs: probe.eventToPaintMs,
      settledMs,
      durableMs,
      ...probe,
      beforeProcess,
      afterProcess,
      success,
      error,
      measuredAt: new Date().toISOString(),
    }
    recordSample(sample)
  }
}

export const clickAndMeasure = (options: Omit<Parameters<typeof measureInteraction>[0], 'action'> & { locator: Locator }) =>
  measureInteraction({ ...options, action: () => options.locator.click() })

export const durableCounts = (page: Page) => page.evaluate(async () => {
  const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
  return {
    notes: document.workspace.notes.length,
    cards: document.workspace.cards.length,
    reviews: document.workspace.reviews.length,
    media: document.workspace.media.length,
    trash: document.clientState.trash.length,
  }
})

export const closeAndMeasure = async (application: ElectronApplication) => {
  const child = application.process()
  const started = performance.now()
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await application.close().catch(() => undefined)
  await Promise.race([exited, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Packaged app did not exit within 10 seconds.')), 10_000))])
  return performance.now() - started
}
