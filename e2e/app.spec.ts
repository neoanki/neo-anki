import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSeedData } from '../src/data/seed'
import { observeRuntimeFailures } from './support/qa'

const onboarded = () => {
  const data = createSeedData()
  data.settings.onboardingComplete = true
  return data
}

const startWith = async (page: Parameters<typeof test>[0] extends never ? never : any, data = onboarded()) => {
  await page.addInitScript((seed: unknown) => { if (window.top === window) localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)) }, data)
  await page.goto('/')
}

const navigateWithVisiblePrimaryButton = async (page: Parameters<typeof test>[0] extends never ? never : any, label: string) => {
  await page.locator('nav[aria-label="Primary navigation"] button:visible').filter({ hasText: label }).click()
}

test('onboarding establishes a daily time contract', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
  await page.getByRole('button', { name: /start fresh/i }).click()
  await expect(page.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeVisible()
  await page.getByRole('button', { name: /45 minutes/i }).click()
  await page.getByRole('button', { name: /create workspace/i }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /add something you want to remember/i })).toBeVisible()
  await expect(page.getByLabel('Daily target')).toHaveValue('45')
})

test('daily time changes the automatically planned workload', async ({ page }) => {
  await startWith(page)
  await page.getByLabel('Daily target').selectOption('10')
  const ten = await page.locator('.study-launcher-copy').textContent()
  await page.getByLabel('Daily target').selectOption('60')
  const sixty = await page.locator('.study-launcher-copy').textContent()
  const count = (text: string | null) => Number(text?.match(/(\d+) new practice prompts?/)?.[1] || 0)
  expect(count(sixty)).toBeGreaterThan(count(ten))
})

test('creates core forward prompts without optional extensions', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: /new item/i }).click()
  await page.getByLabel('Prompt').fill('What is the stable core prompt?')
  await page.getByLabel('Answer').fill('Forward recall')
  await page.getByRole('button', { name: /add knowledge/i }).click()
  await expect(page.getByRole('status')).toContainText('safe new-material queue')
  await page.getByRole('button', { name: 'Library' }).first().click()
  const created = page.locator('.library-row').filter({ hasText: 'What is the stable core prompt?' })
  await expect(created).toBeVisible()
  await expect(created.getByRole('button', { name: 'Basic' })).toBeVisible()
})

test('preserves an unfinished knowledge draft across an automatic reload', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: /new item/i }).click()
  await page.getByLabel('Prompt', { exact: true }).fill('Draft retained across extension reload?')
  await page.getByLabel('Answer', { exact: true }).fill('Yes, in session-scoped draft storage.')
  await page.getByLabel('Extra context').fill('Do not lose this context either.')
  await page.getByLabel('Collection').fill('Reload acceptance')
  await page.getByLabel('Tags').fill('draft, reload')

  await page.reload()

  await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('Draft retained across extension reload?')
  await expect(page.getByLabel('Answer', { exact: true })).toHaveValue('Yes, in session-scoped draft storage.')
  await expect(page.getByLabel('Extra context')).toHaveValue('Do not lose this context either.')
  await expect(page.getByLabel('Collection')).toHaveValue('Reload acceptance')
  await expect(page.getByLabel('Tags')).toHaveValue('draft, reload')

  await page.getByRole('button', { name: 'Add knowledge item' }).click()
  await expect(page.getByRole('status')).toContainText('safe new-material queue')
  await page.reload()
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Answer', { exact: true })).toHaveValue('')
})

test('reload preserves a failed extension retry checkpoint without enabling a duplicate item', async ({ page }) => {
  const data = onboarded()
  await page.addInitScript(({ workspace, failedDraft }) => {
    if (window.top !== window) return
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(workspace))
    sessionStorage.setItem('neoanki:create-draft:v1', JSON.stringify(failedDraft))
  }, {
    workspace: data,
    failedDraft: {
      variants: ['forward'], prompt: 'Saved prompt?', answer: 'Saved answer', context: '', collection: 'QA', tags: '', citations: [{ title: '', url: '' }], assets: [], occlusions: [], selectedActions: ['org.example.audio:generate'],
      failedAction: { extensionId: 'org.example.audio', actionId: 'generate', itemId: data.items[0].id, idempotencyKey: `${data.items[0].id}:org.example.audio:generate`, draft: { prompt: 'Saved prompt?', answer: 'Saved answer', context: '', collection: 'QA', tags: [], selectedPromptTypes: ['forward'], mediaIds: [] } },
    },
  })
  await page.goto('/#/create')

  await expect(page.getByRole('alert')).toContainText(/extension action was interrupted/i)
  await expect(page.getByRole('button', { name: /retry extension action/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^add knowledge item$/i })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: /retry extension action/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^add knowledge item$/i })).toBeDisabled()
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
  const completionHeading = page.getByRole('heading', { name: /enough for this session/i })
  await expect(completionHeading).toBeVisible()
  await expect(completionHeading).toBeFocused()
})

test('sandboxed imported templates resize without CSP or renderer errors', async ({ page }) => {
  const failures = observeRuntimeFailures(page)
  const data = onboarded()
  data.items = [data.items[0]]
  data.cards = [{
    ...data.cards[0],
    itemId: data.items[0].id,
    rendering: {
      questionHtml: '<div style="height:420px">Tall imported question</div>',
      answerHtml: '<div style="height:460px">Tall imported answer</div>',
      css: '.card { padding: 8px; }',
      source: 'anki-template',
    },
  }]
  data.reviews = []
  await startWith(page, data)

  await page.locator('button.study-button').click()
  const frame = page.locator('.sandboxed-card-frame')
  await expect(frame).toBeVisible()
  await expect.poll(() => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(400)
  expect(failures).toEqual([])
})

test('sandboxed imported templates cannot navigate away from the reviewed card', async ({ page }) => {
  const data = onboarded()
  data.items = [data.items[0]]
  data.cards = [{
    ...data.cards[0],
    itemId: data.items[0].id,
    rendering: {
      questionHtml: '<meta http-equiv="refresh" content="0;url=data:text/html,escaped-card"><p>Expected prompt</p><img src="neoanki-media://asset/local-image">',
      answerHtml: '<p>Expected answer</p>',
      css: '</style><meta http-equiv="refresh" content="0;url=data:text/html,escaped-css"><style>',
      source: 'anki-template',
    },
  }]
  data.reviews = []
  await startWith(page, data)
  await page.locator('button.study-button').click()

  const cardFrame = page.locator('.sandboxed-card-frame')
  await expect(cardFrame).toBeVisible()
  await page.waitForTimeout(250)
  expect(await cardFrame.contentFrame().locator('body').textContent()).toContain('Expected prompt')
  await expect(cardFrame.contentFrame().locator('img')).toHaveAttribute('src', 'neoanki-media://asset/local-image')
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

test('undo returns to the reviewed card when sibling burying skipped queue entries', async ({ page }) => {
  const data = onboarded()
  const item = data.items[0]
  const first = { ...data.cards[0], id: 'reviewed-sibling', itemId: item.id, variant: 'forward' }
  const skipped = { ...data.cards[0], id: 'skipped-sibling', itemId: item.id, variant: 'qa-missing-prompt-type' }
  data.items = [item]
  data.cards = [first, skipped]
  data.reviews = []
  await startWith(page, data)

  await page.locator('button.study-button').click()
  await page.getByRole('button', { name: /reveal answer/i }).click()
  await page.locator('button.grade-button.recalled').click()
  await expect(page.getByRole('heading', { name: /enough for this session/i })).toBeVisible()
  await page.getByRole('button', { name: /undo last answer/i }).click()

  await expect(page.getByText(/extension for “qa-missing-prompt-type” is unavailable/i)).toHaveCount(0)
  await expect(page.locator('.answer-content')).toBeVisible()
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
  await expect(page.getByText('Showing 100 of 205 matching knowledge items.')).toBeVisible()
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
  const firstBlockCount = Number(firstBlockText?.match(/(\d+) practice prompts?/)?.[1] || 0)
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
  await expect(page.getByRole('button', { name: 'Plans' })).toHaveCount(0)
  await navigateWithVisiblePrimaryButton(page, 'Extensions')
  await expect(page.getByRole('heading', { name: 'Extensions' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Configure 0' })).toBeVisible()
})

test('extensions are managed outside core settings', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /browse|installed|configure/i })).toHaveCount(0)
  await expect(page.locator('.extension-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close settings' }).click()
  await navigateWithVisiblePrimaryButton(page, 'Extensions')
  await expect(page.getByRole('tab', { name: 'Browse' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /installed 0/i })).toBeVisible()
})

test('browser directs migration to the full-screen extensions hub', async ({ page }) => {
  await startWith(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('input[type=file][accept*=".apkg"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close settings' }).click()
  await navigateWithVisiblePrimaryButton(page, 'Extensions')
  await expect(page.getByRole('heading', { name: 'Extensions' })).toBeVisible()
  await expect(page.getByText(/get Neo Anki desktop/i)).toBeVisible()
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
    const cacheNames = (await caches.keys()).filter((name) => name.startsWith('neo-anki-v'))
    const requests = (await Promise.all(cacheNames.map(async (name) => (await caches.open(name)).keys()))).flat()
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
