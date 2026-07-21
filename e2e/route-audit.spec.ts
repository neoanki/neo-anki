import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSeedData } from '../src/data/seed'
import { observeRuntimeFailures } from './support/qa'

const seedWorkspace = async (page: import('@playwright/test').Page) => {
  const data = createSeedData()
  data.settings.onboardingComplete = true
  await page.addInitScript((workspace) => { if (window.top === window) localStorage.setItem('neo-anki:data:v1', JSON.stringify(workspace)) }, data)
}

const assertRouteQuality = async (page: import('@playwright/test').Page, route: string) => {
  await page.goto(`/#/${route}`)
  await expect(page.locator('#main-content')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const audit = await new AxeBuilder({ page }).analyze()
  expect(audit.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || '')), `serious accessibility violations on ${route}`).toEqual([])
}

test('every core route and Settings survive 200% text at a narrow viewport', async ({ page }) => {
  test.setTimeout(60_000)
  const failures = observeRuntimeFailures(page)
  await page.route('https://raw.githubusercontent.com/neoanki/extensions/main/catalog.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ format: 'neo-anki-extension-catalog', schemaVersion: 1, extensions: [] }),
  }))
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await seedWorkspace(page)
  await page.addInitScript(() => {
    if (window.top !== window) return
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }, { once: true })
  })

  for (const route of ['today', 'library', 'create', 'extensions']) await assertRouteQuality(page, route)

  await page.getByText('More', { exact: true }).last().click()
  await page.getByRole('button', { name: 'Settings', exact: true }).last().click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  const overflow = await dialog.evaluate((element) => {
    const boundary = element.getBoundingClientRect()
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      offenders: [...element.querySelectorAll<HTMLElement>('*')].filter((candidate) => candidate.getBoundingClientRect().right > boundary.right + 1).slice(0, 8).map((candidate) => ({ className: candidate.className, tag: candidate.tagName, text: candidate.textContent?.trim().slice(0, 80) })),
    }
  })
  // Overlay scrollbars can consume up to two CSS pixels without clipping content.
  expect(overflow.scrollWidth - overflow.clientWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(2)
  const audit = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  expect(audit.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  expect(failures).toEqual([])
})
