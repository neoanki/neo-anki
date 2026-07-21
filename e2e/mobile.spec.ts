import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSeedData } from '../src/data/seed'

test('mobile navigation and content fit a phone viewport', async ({ page }) => {
  const data = createSeedData(); data.settings.onboardingComplete = true
  await page.addInitScript((seed) => localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)), data)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Library' }).last().click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('dark mobile navigation remains reachable and accessible at 200% text size', async ({ page }) => {
  const data = createSeedData(); data.settings.onboardingComplete = true; data.settings.theme = 'dark'
  await page.addInitScript((seed) => localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)), data)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' }).last()
  for (const label of ['Today', 'Library', 'Extensions']) {
    const item = navigation.getByRole('button', { name: label })
    await expect(item).toBeVisible()
    expect((await item.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
  await navigation.getByText('More', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add knowledge' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  await navigation.getByRole('button', { name: 'Extensions' }).click()
  await expect(page.getByRole('heading', { name: 'Extensions', exact: true })).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
})

test('mobile authoring keeps every visible control touch-sized at 200% text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch-target geometry requires the coarse-pointer mobile project.')
  const data = createSeedData(); data.settings.onboardingComplete = true
  await page.addInitScript((seed) => localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)), data)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: 'Add knowledge' }).click()
  await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const undersized = await page.locator('button:visible, input:visible, textarea:visible, select:visible').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height }
  }).filter((control) => control.height < 44 || control.width < 44))
  expect(undersized).toEqual([])
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
})
