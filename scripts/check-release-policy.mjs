import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const workflow = await readFile(resolve('.github/workflows/release.yml'), 'utf8')
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const macEntitlements = await readFile(resolve('build/entitlements.mac.plist'), 'utf8')
if (workflow.includes('Get-AuthenticodeSignature')) throw new Error('Release workflow must not require Authenticode signing.')
for (const gate of ['codesign --verify', 'Signature=adhoc']) {
  if (!workflow.includes(gate)) throw new Error(`Release workflow must enforce the macOS gate: ${gate}.`)
}
if (packageJson.build?.mac?.identity !== '-') throw new Error('macOS release builds must opt in to ad-hoc signing explicitly.')
if (packageJson.build?.mac?.hardenedRuntime !== true) throw new Error('Ad-hoc macOS release builds must retain the hardened runtime.')
if (packageJson.build?.mac?.entitlements !== 'build/entitlements.mac.plist') throw new Error('Ad-hoc macOS release builds must use the reviewed entitlement set.')
if (packageJson.build?.mac?.notarize !== false) throw new Error('Interim ad-hoc macOS releases must disable unavailable notarization explicitly.')
for (const entitlement of [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
]) {
  if (!macEntitlements.includes(`<key>${entitlement}</key>`)) throw new Error(`Ad-hoc macOS releases require the entitlement: ${entitlement}.`)
}
for (const unsupportedGate of ['CSC_LINK', 'APPLE_ID', 'stapler validate', 'spctl --assess']) {
  if (workflow.includes(unsupportedGate)) throw new Error(`Interim ad-hoc release policy must not require ${unsupportedGate}.`)
}
if (!workflow.includes("runner.os != 'macOS'")) throw new Error('Unsigned build configuration must be limited to non-macOS release jobs.')

process.stdout.write('Release workflow requires a verifiable ad-hoc macOS signature, packaged launch, checksums, and provenance; Developer ID notarization is deferred.\n')
