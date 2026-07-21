import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSeedData } from '../src/data/seed'

const onboarded = () => {
  const data = createSeedData()
  data.settings.onboardingComplete = true
  return data
}

const startWith = async (page: Parameters<typeof test>[0] extends never ? never : any, data = onboarded()) => {
  await page.addInitScript((seed: unknown) => localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)), data)
  await page.goto('/')
}

const navigateWithVisiblePrimaryButton = async (page: Parameters<typeof test>[0] extends never ? never : any, label: string) => {
  await page.locator('nav[aria-label="Primary navigation"] button:visible').filter({ hasText: label }).click()
}

test('onboarding establishes a daily time contract', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /what are you bringing/i })).toBeVisible()
  await page.getByRole('button', { name: /create a fresh workspace/i }).click()
  await expect(page.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
  await page.getByRole('button', { name: /45 minutes/i }).click()
  await page.getByRole('button', { name: /build my first plan/i }).click()
  await expect(page.getByRole('heading', { name: /45 min available/i })).toBeVisible()
})

test('daily time changes the automatically planned workload', async ({ page }) => {
  await startWith(page)
  await page.getByLabel('Daily target').selectOption('10')
  const ten = await page.locator('.study-launcher-copy').textContent()
  await page.getByLabel('Daily target').selectOption('60')
  const sixty = await page.locator('.study-launcher-copy').textContent()
  const count = (text: string | null) => Number(text?.match(/(\d+) new prompts/)?.[1] || 0)
  expect(count(sixty)).toBeGreaterThan(count(ten))
})

test('creates core forward prompts without optional extensions', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: /new item/i }).click()
  await page.getByLabel('Prompt or cloze sentence').fill('What is the stable core prompt?')
  await page.getByLabel('Answer').fill('Forward recall')
  await page.getByRole('button', { name: /add knowledge/i }).click()
  await expect(page.getByRole('status')).toContainText('safe new-material queue')
  await page.getByRole('button', { name: 'Library' }).first().click()
  const created = page.locator('.library-row').filter({ hasText: 'What is the stable core prompt?' })
  await expect(created).toBeVisible()
  await expect(created.getByRole('button', { name: 'forward' })).toBeVisible()
})

test('core forward review reveals the answer before grading', async ({ page }) => {
  const data = onboarded()
  data.items = [data.items[0]]
  data.cards = [{ ...data.cards[0], itemId: data.items[0].id, variant: 'forward' }]
  data.reviews = []
  await startWith(page, data)
  await page.locator('button.study-button').click()
  await page.getByRole('button', { name: /reveal answer/i }).click()
  await expect(page.getByText(data.items[0].answer, { exact: true })).toBeVisible()
  await page.locator('button.grade-button.recalled').click()
  await expect(page.getByRole('heading', { name: /enough for this session/i })).toBeVisible()
})

test('undo restores the previous review exactly enough to grade again', async ({ page }) => {
  const data = onboarded()
  data.items = data.items.slice(0, 2)
  const itemIds = new Set(data.items.map((item) => item.id))
  data.cards = data.cards.filter((card) => itemIds.has(card.itemId)).slice(0, 2)
  data.reviews = []
  await startWith(page, data)
  await page.locator('button.study-button').click()
  const firstPrompt = await page.locator('.prompt-content h1').textContent()
  await page.getByRole('button', { name: /reveal answer/i }).click()
  await page.locator('button.grade-button.recalled').click()
  await page.getByRole('button', { name: /^undo$/i }).click()
  await expect(page.locator('.prompt-content h1')).toHaveText(firstPrompt || '')
  await expect(page.locator('.answer-content')).toBeVisible()
  await expect(page.locator('button.grade-button.recalled')).toBeVisible()
})

test('trash keeps knowledge recoverable after deletion', async ({ page }) => {
  const data = onboarded()
  const item = data.items[0]
  await startWith(page, data)
  await page.getByRole('button', { name: 'Library' }).first().click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: `Move ${item.prompt} to Trash` }).click()
  await expect(page.getByRole('status')).toContainText('Moved to Trash')
  await expect(page.locator('.library-list article').filter({ hasText: item.prompt })).toHaveCount(0)
  await page.getByRole('button', { name: /^undo$/i }).click()
  await expect(page.locator('.library-list article').filter({ hasText: item.prompt })).toBeVisible()
})

test('large libraries render in bounded accessible pages', async ({ page }) => {
  const data = onboarded()
  const itemTemplate = data.items[0]
  const cardTemplate = data.cards[0]
  data.items = Array.from({ length: 205 }, (_, index) => ({ ...itemTemplate, id: `large-item-${index}`, prompt: `Large library item ${index}` }))
  data.cards = data.items.map((item, index) => ({ ...cardTemplate, id: `large-card-${index}`, itemId: item.id }))
  await startWith(page, data)
  await page.getByRole('button', { name: 'Library' }).first().click()
  await expect(page.locator('.library-list article')).toHaveCount(100)
  await expect(page.getByText('Showing 100 of 205 matching notes.')).toBeVisible()
  await page.getByRole('button', { name: 'Show 100 more' }).click()
  await expect(page.locator('.library-list article')).toHaveCount(200)
  await page.getByRole('button', { name: 'Show 5 more' }).click()
  await expect(page.locator('.library-list article')).toHaveCount(205)
})

test('large-workspace planning completes off the UI thread', async ({ page }) => {
  const data = onboarded()
  const item = data.items[0]
  const card = data.cards.find((value) => value.itemId === item.id) || data.cards[0]
  data.items = [item]
  data.cards = Array.from({ length: 5_001 }, (_, index) => ({ ...card, id: `background-card-${index}`, itemId: item.id }))
  data.reviews = []
  await page.addInitScript(() => {
    const target = window as unknown as { plannerHeartbeats: number; plannerWorkerProbe: { starts: number; completions: number } }
    const NativeWorker = window.Worker
    target.plannerHeartbeats = 0
    target.plannerWorkerProbe = { starts: 0, completions: 0 }
    window.Worker = class extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        if (!String(scriptURL).includes('planner.worker')) return
        target.plannerWorkerProbe.starts += 1
        this.addEventListener('message', () => { target.plannerWorkerProbe.completions += 1 }, { once: true })
      }
    }
    window.setInterval(() => { target.plannerHeartbeats += 1 }, 10)
  })
  await startWith(page, data)
  await expect.poll(() => page.evaluate(() => (window as unknown as { plannerWorkerProbe: { starts: number } }).plannerWorkerProbe.starts)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { plannerWorkerProbe: { completions: number } }).plannerWorkerProbe.completions), { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(page.locator('button.study-button')).not.toHaveText('Planning…', { timeout: 15_000 })
  expect(await page.evaluate(() => (window as unknown as { plannerHeartbeats: number }).plannerHeartbeats)).toBeGreaterThan(0)
})

test('switches unrelated categories at an explicit block boundary', async ({ page }) => {
  const data = onboarded()
  data.cards = data.cards.slice(0, 6)
  const itemIds = new Set(data.cards.map((card) => card.itemId))
  data.items = data.items.filter((item) => itemIds.has(item.id)).map((item, index) => ({ ...item, collection: index < 3 ? 'Spanish' : 'Japanese' }))
  await startWith(page, data)
  const firstBlockText = await page.locator('.block-preview-row').first().textContent()
  const firstBlockCount = Number(firstBlockText?.match(/(\d+) prompts/)?.[1] || 0)
  expect(firstBlockCount).toBeGreaterThan(0)
  await page.locator('button.study-button').click()
  for (let index = 0; index < firstBlockCount; index += 1) {
    await page.getByRole('button', { name: /reveal answer/i }).click()
    await page.locator('button.grade-button.recalled').click()
  }
  await expect(page.getByText(/context switch/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /begin (spanish|japanese)/i })).toBeVisible()
})

test('browser shell keeps extracted workspace tools out of core', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Plans' }).first().click()
  await expect(page.getByRole('heading', { name: 'No workspace tools installed' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /saved searches|learning packs/i })).toHaveCount(0)
})

test('settings presents only isolated SDK 2 packages as extensions', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Extensions', { exact: true })).toBeVisible()
  await expect(page.getByText(/every extension shown here is a signed, installable package/i)).toBeVisible()
  await expect(page.locator('.extension-row')).toHaveCount(0)
  await expect(page.getByText('Built-in modules', { exact: true })).toHaveCount(0)
})

test('browser settings directs migration to installable extensions', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('input[type=file][accept*=".apkg"]')).toHaveCount(0)
  await expect(page.getByText(/installable package/i)).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
})

test('production shell is accessible and cached for offline use', async ({ page, context, browserName }) => {
  await startWith(page)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const darkResults = await new AxeBuilder({ page }).analyze()
  expect(darkResults.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await expect.poll(() => page.evaluate(async () => {
    const requests = await (await caches.open('neo-anki-v5')).keys()
    return requests.some((request) => request.url.endsWith('.js'))
  })).toBe(true)
  await context.setOffline(true)
  if (browserName === 'webkit') {
    // Playwright WebKit rejects all requests after setOffline before its service
    // worker can answer. Read CacheStorage directly to prove the controlled
    // shell is complete; Chromium and Firefox exercise the actual reload below.
    await expect(page.evaluate(async () => {
      const response = await caches.match('/')
      return Boolean(response?.ok) && (await response!.text()).includes('<div id="root"></div>')
    })).resolves.toBe(true)
  } else {
    await page.evaluate(() => { Reflect.set(window, '__neoAnkiOfflineReloadMarker', true); window.location.reload() }).catch(() => undefined)
    await expect.poll(() => page.evaluate(() => !Reflect.has(window, '__neoAnkiOfflineReloadMarker')).catch(() => false)).toBe(true)
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  }
})

test('core workflows reflow across launch widths, text scaling, and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startWith(page)
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await navigateWithVisiblePrimaryButton(page, 'Library')
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await navigateWithVisiblePrimaryButton(page, 'Today')
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }

  await page.setViewportSize({ width: 375, height: 900 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await navigateWithVisiblePrimaryButton(page, 'Library')
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const motionIsBounded = await page.locator('.page').evaluate((element) => {
    const style = getComputedStyle(element)
    const atMostOneMillisecond = (value: string) => value.split(',').every((part) => {
      const duration = Number.parseFloat(part)
      return part.trim().endsWith('ms') ? duration <= 1 : duration <= 0.001
    })
    return atMostOneMillisecond(style.animationDuration) && atMostOneMillisecond(style.transitionDuration)
  })
  expect(motionIsBounded).toBe(true)
})
