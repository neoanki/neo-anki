import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyWorkspaceData } from '../src/data/seed'
import { observeRuntimeFailures } from './support/qa'

const storageKey = 'neo-anki:data:v1'

const emptyOnboardedWorkspace = () => {
  const data = createEmptyWorkspaceData()
  data.deviceId = 'qa-device'
  data.settings.onboardingComplete = true
  data.updatedAt = '2026-07-21T12:00:00.000Z'
  return data
}

const startWith = async (page: Page, data = emptyOnboardedWorkspace()) => {
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('__neoAnkiQaSeeded') === '1') return
    localStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem('__neoAnkiQaSeeded', '1')
  }, { key: storageKey, value: data })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

const openCreate = async (page: Page) => {
  const emptyAction = page.getByRole('button', { name: /add your first knowledge item/i })
  if (await emptyAction.count()) await emptyAction.click()
  else await page.getByRole('button', { name: /new item/i }).click()
  await expect(page.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
}

test('browser recovery blocks editing for malformed persisted data and offers a safe exit', async ({ page }) => {
  const failures = observeRuntimeFailures(page)
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('__neoAnkiQaSeeded') === '1') return
    localStorage.setItem(key, '{"version":3,"items":BROKEN')
    sessionStorage.setItem('__neoAnkiQaSeeded', '1')
  }, storageKey)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /workspace needs attention/i })).toBeVisible()
  await expect(page.getByText(/editing and automatic saving are paused/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /export original data/i })).toBeEnabled()
  await expect(page.getByRole('button', { name: /restore backup/i })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /start empty/i }).click()
  await expect(page.getByRole('heading', { name: /how would you like to begin/i })).toBeVisible()
  expect(failures).toEqual([])
})

test('authoring preserves multilingual Unicode and semantic validation across reload', async ({ page }) => {
  const failures = observeRuntimeFailures(page)
  await startWith(page)
  await openCreate(page)

  const submit = page.getByRole('button', { name: /^add knowledge item$/i })
  await expect(submit).toBeDisabled()
  const prompt = 'Що означає 記憶? 🧠 — café — مرحبًا'
  const answer = 'Пам’ять · memory · الذاكرة · e\u0301'
  await page.getByLabel('Prompt', { exact: true }).fill(prompt)
  await expect(submit).toBeDisabled()
  await page.getByLabel('Answer', { exact: true }).fill(answer)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole('status')).toContainText(/queue|added/i)

  await page.reload()
  await page.getByRole('button', { name: 'Library' }).first().click()
  await expect(page.getByText(prompt, { exact: true })).toBeVisible()
  await page.getByPlaceholder(/search prompts/i).fill('記憶')
  await expect(page.getByText(prompt, { exact: true })).toBeVisible()
  await page.getByPlaceholder(/search prompts/i).fill('الذاكرة')
  await expect(page.getByText(prompt, { exact: true })).toBeVisible()
  expect(failures).toEqual([])
})

test('persistence failure is visible, blocks false success, and recovers through retry', async ({ page }) => {
  const data = emptyOnboardedWorkspace()
  await page.addInitScript(({ key, value }) => {
    const firstLoad = sessionStorage.getItem('__neoAnkiQaSeeded') !== '1'
    if (firstLoad) {
      localStorage.setItem(key, JSON.stringify(value))
      sessionStorage.setItem('__neoAnkiQaSeeded', '1')
    }
    const nativeSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (storageKey, storageValue) {
      if (storageKey === key && Reflect.get(window, '__qaFailWrites') === true) throw new DOMException('QA simulated quota exhaustion', 'QuotaExceededError')
      return nativeSetItem.call(this, storageKey, storageValue)
    }
    Reflect.set(window, '__qaFailWrites', firstLoad)
  }, { key: storageKey, value: data })
  const failures = observeRuntimeFailures(page)
  await page.goto('/')
  await openCreate(page)
  await page.getByLabel('Prompt', { exact: true }).fill('Will a failed local save look successful?')
  await page.getByLabel('Answer', { exact: true }).fill('It must not.')
  await page.getByRole('button', { name: /^add knowledge item$/i }).click()

  const alert = page.locator('.persistence-status.failed')
  await expect(alert).toContainText(/changes are not saved/i)
  await expect(alert).toContainText(/quota|save|storage/i)
  await page.evaluate(() => Reflect.set(window, '__qaFailWrites', false))
  await page.getByRole('button', { name: /retry save/i }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText(/quota exhaustion/i)
  await page.getByRole('button', { name: /^add knowledge item$/i }).click()
  await expect(page.getByRole('status')).toContainText(/queue|added/i)
  await page.reload()
  await page.getByRole('button', { name: 'Library' }).first().click()
  await expect(page.getByText('Will a failed local save look successful?', { exact: true })).toBeVisible()
  expect(failures).toEqual([])
})

test('keyboard users can enter content, open settings, dismiss it, and retain route focus', async ({ page }, testInfo) => {
  const failures = observeRuntimeFailures(page)
  await startWith(page)
  const skipLink = page.getByRole('link', { name: /skip to content/i })
  if (testInfo.project.name === 'webkit') await skipLink.focus()
  else await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#main-content')).toBeFocused()

  await page.keyboard.press('Control+2')
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  await expect(page.locator('#main-content')).toBeFocused()
  expect(failures).toEqual([])
})

test('critical empty and authoring states remain accessible at the smallest supported width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  const failures = observeRuntimeFailures(page)
  await startWith(page)
  await openCreate(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  expect(failures).toEqual([])
})
