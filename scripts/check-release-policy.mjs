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
  if (workflow.includes(variable)) throw new Error(`Release workflow must not require ${variable}.`)
}
if (workflow.includes('secrets.')) throw new Error('Release workflow must not depend on repository secrets.')
if (workflow.includes('Get-AuthenticodeSignature')) throw new Error('Release workflow must not require Authenticode signing.')
if (/\b(codesign|spctl|stapler)\b/.test(workflow)) throw new Error('Release workflow must not require macOS signing or notarization.')
if (packageJson.build?.mac?.notarize !== false) throw new Error('macOS notarization must remain optional for release builds.')
if (!workflow.includes("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")) throw new Error('Release builds must disable implicit signing discovery.')

process.stdout.write('Release workflow builds and validates unsigned artifacts without signing credentials.\n')
