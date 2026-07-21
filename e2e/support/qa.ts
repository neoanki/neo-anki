import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

export const HEADLESS_E2E_ENV = Object.freeze({
  NEO_ANKI_E2E_HEADLESS: '1',
  NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1',
})

export const isolatedElectronEnv = (userData: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ...HEADLESS_E2E_ENV,
  NEO_ANKI_USER_DATA_DIR: userData,
  ...overrides,
})

export const readyElectronWindow = async (application: ElectronApplication): Promise<Page> => {
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
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true)
  return ready!
}

export const observeRuntimeFailures = (page: Page) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) failures.push(`console: ${message.text()}`)
  })
  return failures
}

export const stopElectron = async (application: ElectronApplication | undefined) => {
  if (!application) return
  const child = application.process()
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGKILL')
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
}

export interface QaEvidenceManifest {
  scenario: string
  target: 'source' | 'packaged' | 'released'
  version?: string
  commit?: string
  artifactPath?: string
  artifactSha256?: string
  platform: string
  arch: string
  headless: true
  viewport?: { width: number; height: number }
  theme?: 'light' | 'dark'
  seed?: number
  durableCounts?: Record<string, number>
  runtimeFailures: string[]
  capturedAt: string
}

export const writeQaEvidence = async (path: string, evidence: Omit<QaEvidenceManifest, 'platform' | 'arch' | 'headless' | 'capturedAt'>) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({
    ...evidence,
    platform: process.platform,
    arch: process.arch,
    headless: true,
    capturedAt: new Date().toISOString(),
  } satisfies QaEvidenceManifest, null, 2)}\n`, 'utf8')
}

export const sha256File = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolve(hash.digest('hex')))
})
