import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

const require = createRequire(import.meta.url)
const electronDirectory = dirname(require.resolve('electron/package.json'))
const electronPackage = JSON.parse(await readFile(join(electronDirectory, 'package.json'), 'utf8'))
const installScript = join(electronDirectory, 'install.js')
const maximumAttempts = 3

const runtimeIsInstalled = async () => {
  try {
    const [executablePath, installedVersion] = await Promise.all([
      readFile(join(electronDirectory, 'path.txt'), 'utf8'),
      readFile(join(electronDirectory, 'dist', 'version'), 'utf8'),
    ])
    return installedVersion.trim().replace(/^v/, '') === electronPackage.version
      && existsSync(join(electronDirectory, 'dist', executablePath.trim()))
  } catch {
    return false
  }
}

if (await runtimeIsInstalled()) {
  process.stdout.write(`Electron ${electronPackage.version} runtime is ready.\n`)
  process.exit(0)
}

for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  process.stdout.write(`Provisioning Electron ${electronPackage.version} runtime (attempt ${attempt}/${maximumAttempts})...\n`)
  const result = spawnSync(process.execPath, [installScript], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.status === 0 && await runtimeIsInstalled()) {
    process.stdout.write(`Electron ${electronPackage.version} runtime is ready.\n`)
    process.exit(0)
  }

  if (attempt < maximumAttempts) {
    await delay(attempt * 1_000)
  }
}

throw new Error(`Unable to provision and validate Electron ${electronPackage.version} after ${maximumAttempts} attempts.`)
