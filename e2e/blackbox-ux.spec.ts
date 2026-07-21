import { expect, test } from '@playwright/test'
import axe from 'axe-core'
import { _electron as electron, type ElectronApplication, type Frame, type Page } from 'playwright'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.env.NEO_ANKI_PACKAGED_APP || ''
const ttsPackage = process.env.NEO_ANKI_TTS_PACKAGE || ''
const evidenceDir = join(process.cwd(), '.audit-results', 'blackbox-ux')

const firstReadyWindow = async (application: ElectronApplication) => {
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
  }, { timeout: 30_000 }).toBe(true)
  return ready!
}

const launchReleasedApp = async (userData: string, args: string[] = []) => {
  const application = await electron.launch({
    executablePath,
    args,
    env: {
      ...process.env,
      NEO_ANKI_E2E_HEADLESS: '1',
      NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
      NEO_ANKI_USER_DATA_DIR: userData,
    },
  })
  return { application, window: await firstReadyWindow(application) }
}

const onboard = async (window: Page) => {
  await window.getByRole('button', { name: /start fresh/i }).click()
  await window.getByRole('button', { name: /30 minutes/i }).click()
  await window.getByRole('button', { name: /create workspace/i }).click()
  await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
}

const seriousAxeViolations = async (page: Page | Frame) => {
  await page.evaluate(axe.source)
  const results = await page.evaluate(async () => {
    const checker = (window as unknown as { axe: { run: () => Promise<{ violations: Array<{ impact: string | null; id: string; nodes: unknown[] }> }> } }).axe
    return checker.run()
  })
  return results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))
}

const conciseViolations = (violations: Awaited<ReturnType<typeof seriousAxeViolations>>) => violations.map((violation) => ({
  id: violation.id,
  impact: violation.impact,
  targets: violation.nodes.slice(0, 5).map((node) => (node as { target?: unknown }).target),
}))

const expectNoPageOverflow = async (page: Page) => {
  expect(await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({ viewport: expect.any(Number), content: expect.any(Number) }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

test.beforeAll(async () => { await mkdir(evidenceDir, { recursive: true }) })

test('released core is reachable, reflows, and exposes keyboard focus in both themes', async () => {
  test.skip(!executablePath, 'Set NEO_ANKI_PACKAGED_APP to opt into packaged-artifact UI verification.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-blackbox-core-'))
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReleasedApp(userData)
    application = launched.application
    const window = launched.window
    await onboard(window)

    for (const width of [375, 768, 1440]) {
      await window.setViewportSize({ width, height: 900 })
      await expect(window.getByRole('heading', { name: 'Today' })).toBeVisible()
      await expectNoPageOverflow(window)
      await window.screenshot({ path: join(evidenceDir, `released-today-light-${width}.png`), fullPage: true })
    }

    await window.setViewportSize({ width: 375, height: 900 })
    const mobileNavigation = window.getByRole('navigation', { name: 'Primary navigation' }).filter({ visible: true })
    await expect(mobileNavigation.getByRole('button', { name: 'Today' })).toBeVisible()
    await expect(mobileNavigation.getByRole('button', { name: 'Library' })).toBeVisible()
    await expect(mobileNavigation.getByRole('button', { name: 'Extensions' })).toBeVisible()
    await mobileNavigation.getByText('More', { exact: true }).click()
    await expect(window.getByRole('button', { name: 'Add knowledge' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Settings' })).toBeVisible()

    await window.keyboard.press('Escape')
    await window.keyboard.press('Tab')
    const focusIndicator = await window.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      if (!active) return null
      const style = getComputedStyle(active)
      return { text: active.textContent?.trim(), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    expect(focusIndicator).not.toBeNull()
    expect(focusIndicator?.outlineStyle).not.toBe('none')
    expect(Number.parseFloat(focusIndicator?.outlineWidth || '0')).toBeGreaterThanOrEqual(2)

    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('button', { name: 'Dark', exact: true }).click()
    await window.getByRole('button', { name: 'Close settings' }).click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect.soft(conciseViolations(await seriousAxeViolations(window))).toEqual([])
    await window.screenshot({ path: join(evidenceDir, 'released-today-dark-375.png'), fullPage: true })

    await window.emulateMedia({ reducedMotion: 'reduce' })
    expect(await window.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await window.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expectNoPageOverflow(window)
    await mobileNavigation.getByRole('button', { name: 'Library' }).click()
    await expect(window.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    await expectNoPageOverflow(window)
    await mobileNavigation.getByRole('button', { name: 'Extensions' }).click()
    await expect(window.getByRole('heading', { name: 'Extensions', exact: true })).toBeVisible()
    await expectNoPageOverflow(window)
    expect.soft(conciseViolations(await seriousAxeViolations(window))).toEqual([])
    await window.screenshot({ path: join(evidenceDir, 'released-extensions-dark-375-text-200.png'), fullPage: true })
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('released TTS configuration owns one scroll surface and remains usable responsively', async () => {
  test.skip(!executablePath || !ttsPackage, 'Set NEO_ANKI_PACKAGED_APP and NEO_ANKI_TTS_PACKAGE to opt into extension UI verification.')
  const userData = await mkdtemp(join(tmpdir(), 'neo-anki-blackbox-tts-'))
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReleasedApp(userData, [`--install-extension=${ttsPackage}`])
    application = launched.application
    const window = launched.window
    await onboard(window)
    await window.getByRole('button', { name: 'Extensions' }).first().click()
    await window.getByRole('tab', { name: /Configure/ }).click()
    const iframe = window.locator('iframe[title^="Text to Speech:"]')
    const frame = iframe.contentFrame()
    await expect(frame.getByRole('heading', { name: /Enable audio from knowledge creation/i })).toBeVisible({ timeout: 15_000 })

    for (const width of [375, 768, 1440]) {
      await window.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(window)
      const dimensions = await iframe.evaluate((element: HTMLIFrameElement) => ({
        width: element.getBoundingClientRect().width,
        parentWidth: element.parentElement?.getBoundingClientRect().width || 0,
        height: element.getBoundingClientRect().height,
      }))
      const frameLayout = await frame.locator('body').evaluate((body) => ({
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        documentClientHeight: document.documentElement.clientHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
        labels: [...document.querySelectorAll('label')].map((label) => ({ text: label.textContent?.trim().slice(0, 40), top: label.getBoundingClientRect().top, bottom: label.getBoundingClientRect().bottom })),
      }))
      expect(dimensions.height).toBeGreaterThanOrEqual(Math.min(frameLayout.bodyScrollHeight, 24_000) - 2)
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.parentWidth + 1)
      expect.soft(conciseViolations(await seriousAxeViolations(window))).toEqual([])
      const elementHandle = await iframe.elementHandle()
      const content = await elementHandle?.contentFrame()
      expect(content).toBeTruthy()
      expect.soft(conciseViolations(await seriousAxeViolations(content!))).toEqual([])
      await window.screenshot({ path: join(evidenceDir, `released-tts-config-light-${width}.png`), fullPage: true })
    }

    const scrollSurfaces = await frame.locator('body').evaluate((body) => {
      const candidates = [body, ...body.querySelectorAll<HTMLElement>('*')]
      return candidates.filter((element) => {
        const style = getComputedStyle(element)
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
      }).map((element) => ({ tag: element.tagName, className: element.className, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
    })
    expect(scrollSurfaces).toEqual([])
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
