import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import console from 'node:console'

const root = process.cwd()
const failures = []
const read = (path) => readFile(join(root, path), 'utf8')

const rootEntries = await readdir(root)
const configPaths = rootEntries.filter((name) => /^playwright(?:\..+)?\.config\.ts$/.test(name)).sort()
if (!configPaths.length) failures.push('No Playwright configuration files were found.')

for (const path of configPaths) {
  const source = await read(path)
  if (!/headlessEvidenceUse|headless\s*:\s*true/.test(source)) failures.push(`${path} does not explicitly enable headless execution.`)
  if (/headless\s*:\s*false|--headed\b/.test(source)) failures.push(`${path} enables headed execution.`)
}

const shared = await read('e2e/support/playwright.ts')
if (!/headless\s*:\s*true/.test(shared)) failures.push('The shared Playwright policy does not set headless: true.')

const e2eEntries = (await readdir(join(root, 'e2e'), { recursive: true }))
  .filter((name) => name.endsWith('.ts'))
for (const relative of e2eEntries) {
  const path = join('e2e', relative)
  const source = await read(path)
  if (/headless\s*:\s*false|--headed\b/.test(source)) failures.push(`${path} requests headed execution.`)
  if (/electron\.launch\s*\(/.test(source) && !/NEO_ANKI_E2E_HEADLESS|isolatedElectronEnv/.test(source)) {
    failures.push(`${path} launches Electron without the hidden-window contract.`)
  }
}

const packageJson = JSON.parse(await read('package.json'))
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/playwright|maestro/.test(command) && /--headed\b|headless=false/.test(command)) failures.push(`npm script ${name} requests headed execution.`)
}

const mobileRunner = await read('scripts/run-mobile-e2e.mjs')
for (const required of ['-no-window', "'simctl', 'boot'", 'NEO_ANKI_MOBILE_APP']) {
  if (!mobileRunner.includes(required)) failures.push(`Native mobile E2E runner is missing its headless contract: ${required}`)
}
if (/open\s+-a\s+Simulator/.test(mobileRunner)) failures.push('Native mobile E2E opens the Simulator UI.')
for (const flow of ['core-journey.yaml', 'orientation-and-safe-area.yaml']) {
  const source = await read(`apps/mobile/.maestro/${flow}`).catch(() => '')
  if (!source.includes('appId: app.neoanki.mobile')) failures.push(`Native Maestro flow is missing or invalid: ${flow}`)
}

if (failures.length) {
  console.error(`Headless E2E policy failed:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`Headless E2E policy verified across ${configPaths.length} Playwright configurations.`)
}
