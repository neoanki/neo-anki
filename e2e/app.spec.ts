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

test('creates typed and image-occlusion prompts from the visual builder', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: /new item/i }).click()
  await page.getByRole('button', { name: 'Typed answer' }).click()
  await page.getByLabel('Prompt or cloze sentence').fill('What shape is highlighted?')
  await page.getByLabel('Answer').fill('A square')
  await page.locator('input[type=file][accept="image/*,audio/*"]').setInputFiles({ name: 'diagram.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="white"/><rect x="60" y="20" width="60" height="60" fill="blue"/></svg>') })
  const stage = page.getByRole('button', { name: 'Choose first mask corner' })
  await stage.click({ position: { x: 45, y: 20 } })
  await page.getByRole('button', { name: 'Choose second mask corner' }).click({ position: { x: 125, y: 80 } })
  await expect(page.getByLabel('Mask 1 label')).toBeVisible()
  await page.getByLabel('Mask 1 label').fill('Blue square')
  await page.getByRole('button', { name: /add knowledge/i }).click()
  await expect(page.getByRole('status')).toContainText('safe new-material queue')
  await page.getByRole('button', { name: 'Library' }).first().click()
  await expect(page.getByText('What shape is highlighted?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'typed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'image-occlusion' })).toBeVisible()
})

test('typed review compares the answer before grading', async ({ page }) => {
  const data = onboarded()
  data.items = [data.items[0]]
  data.cards = [{ ...data.cards[0], itemId: data.items[0].id, variant: 'typed' }]
  data.reviews = []
  await startWith(page, data)
  await page.locator('button.study-button').click()
  await page.getByLabel('Type your answer').fill(data.items[0].answer)
  await page.getByRole('button', { name: /check answer/i }).click()
  await expect(page.getByText('Exact match')).toBeVisible()
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
    ;(window as unknown as { plannerHeartbeats: number }).plannerHeartbeats = 0
    window.setInterval(() => { (window as unknown as { plannerHeartbeats: number }).plannerHeartbeats += 1 }, 10)
  })
  await startWith(page, data)
  await expect(page.getByRole('status')).toContainText(/planning this large workspace/i)
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

test('goals, saved views, and pack updates are manageable', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Plans' }).first().click()
  await page.getByLabel('Name').fill('Spanish exam')
  await page.getByLabel(/search terms/i).fill('spanish')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Spanish exam')).toBeVisible()
  await page.getByRole('tab', { name: /saved views/i }).click()
  await page.getByLabel('Name').fill('Only Spanish')
  await page.getByLabel(/search terms/i).fill('spanish')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Only Spanish')).toBeVisible()
  await page.getByRole('tab', { name: /shared packs/i }).click()
  const manifest = { format: 'neo-anki-pack', schemaVersion: 1, id: 'demo', name: 'Demo pack', description: '', author: 'Neo', version: '1.0.0', license: 'CC0', items: [{ sourceId: 'one', prompt: 'Pack prompt?', answer: 'Pack answer', context: '', collection: 'Demo', tags: [] }] }
  await page.locator('input[type=file][accept="application/json"]').setInputFiles({ name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) })
  await expect(page.getByText('Demo pack')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('scheduling was preserved')
})

test('settings distinguishes trusted built-in modules from isolated SDK 2 packages', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Extensions', { exact: true })).toBeVisible()
  await expect(page.getByText(/every installable package uses the signed, isolated SDK 2/i)).toBeVisible()
  const timerToggle = page.getByRole('checkbox', { name: 'Disabled' })
  await expect(timerToggle).not.toBeChecked()
  await timerToggle.check()
  await expect(page.getByLabel('Seconds per card')).toHaveValue('20')
  await expect(page.locator('.extension-row')).toHaveCount(8)
  await page.getByText('Built-in modules', { exact: true }).click()
  await expect(page.getByText(/trusted app module/i).first()).toBeVisible()
  await page.getByText('Card Timer', { exact: true }).click()
  await expect(page.getByText('Observe reviews and submit ratings', { exact: true })).toBeVisible()
  await page.getByText('Image Occlusion', { exact: true }).click()
  await expect(page.getByText('Add authoring controls', { exact: true })).toBeVisible()
})

test('malformed migration failures are announced as errors without changing the workspace', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('input[type=file][accept=".json,.csv,.apkg,.colpkg"]').setInputFiles({ name: 'broken.apkg', mimeType: 'application/zip', buffer: Buffer.from('not a complete package') })
  await expect(page.getByRole('alert')).toContainText(/complete ZIP package/i)
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
