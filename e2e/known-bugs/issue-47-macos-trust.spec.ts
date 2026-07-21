import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const app = process.env.NEO_ANKI_KNOWN_BUG_MACOS_APP || ''

test('issue #47: a downloaded macOS artifact passes strict signature and Gatekeeper checks', () => {
  test.skip(process.platform !== 'darwin' || !app || !existsSync(app), 'Set NEO_ANKI_KNOWN_BUG_MACOS_APP to an extracted published .app on macOS.')
  const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { encoding: 'utf8' })
  const gatekeeper = spawnSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { encoding: 'utf8' })
  expect(signature.status, `https://github.com/neoanki/neo-anki/issues/47\n${signature.stderr}`).toBe(0)
  expect(gatekeeper.status, `https://github.com/neoanki/neo-anki/issues/47\n${gatekeeper.stderr}`).toBe(0)
})
