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

test('onboarding establishes a daily time contract', async ({ page }) => {
  await page.goto('/')
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

test('production shell is accessible and reloads offline', async ({ page, context }) => {
  await startWith(page)
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await expect.poll(() => page.evaluate(async () => {
    const requests = await (await caches.open('neo-anki-v5')).keys()
    return requests.some((request) => request.url.endsWith('.js'))
  })).toBe(true)
  await context.setOffline(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
})
