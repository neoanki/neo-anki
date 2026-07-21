import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const workflow = await readFile(resolve('.github/workflows/release.yml'), 'utf8')
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const credentialVariables = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
]

for (const variable of credentialVariables) {
  if (!workflow.includes(variable)) throw new Error(`Release workflow must require ${variable} for macOS signing and notarization.`)
}
if (workflow.includes('Get-AuthenticodeSignature')) throw new Error('Release workflow must not require Authenticode signing.')
for (const gate of ['codesign --verify', 'stapler validate', 'spctl --assess']) {
  if (!workflow.includes(gate)) throw new Error(`Release workflow must enforce the macOS gate: ${gate}.`)
}
if (packageJson.build?.mac?.notarize === false) throw new Error('macOS notarization must not be disabled for release builds.')
if (!workflow.includes("runner.os != 'macOS'")) throw new Error('Unsigned build configuration must be limited to non-macOS release jobs.')

process.stdout.write('Release workflow requires Developer ID signing, notarization, stapling, and Gatekeeper acceptance for macOS artifacts.\n')
