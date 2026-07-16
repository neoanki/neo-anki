import { expect, test } from '@playwright/test'
import { createSeedData } from '../src/data/seed'

test('mobile navigation and content fit a phone viewport', async ({ page }) => {
  const data = createSeedData(); data.settings.onboardingComplete = true
  await page.addInitScript((seed) => localStorage.setItem('neo-anki:data:v1', JSON.stringify(seed)), data)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Library' }).last().click()
  await expect(page.getByRole('heading', { name: /ideas, .* ways to practice/i })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
