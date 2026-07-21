import { accessSync, constants } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers'
import process from 'node:process'
import console from 'node:console'

const platform = process.argv[2]
if (!['android', 'ios'].includes(platform)) throw new Error('Usage: node scripts/run-mobile-e2e.mjs <android|ios>')

const artifact = process.env.NEO_ANKI_MOBILE_APP
if (!artifact) throw new Error('NEO_ANKI_MOBILE_APP must point to the built APK or iOS simulator .app bundle.')
accessSync(artifact, constants.R_OK)

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${result.stderr ? `\n${result.stderr}` : ''}`)
  return (result.stdout || '').trim()
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const results = join(process.cwd(), 'test-results', `native-${platform}`)
await mkdir(results, { recursive: true })
const maestro = process.env.MAESTRO_BIN || 'maestro'
const flows = join(process.cwd(), 'apps', 'mobile', '.maestro')

let device
let emulatorProcess
try {
  if (platform === 'android') {
    const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    const avd = process.env.NEO_ANKI_ANDROID_AVD
    if (!sdk || !avd) throw new Error('ANDROID_SDK_ROOT and NEO_ANKI_ANDROID_AVD are required; the runner launches its own no-window emulator.')
    const port = process.env.NEO_ANKI_ANDROID_PORT || '5554'
    device = `emulator-${port}`
    const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    const emulator = join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator')
    if (spawnSync(adb, ['-s', device, 'get-state'], { stdio: 'ignore' }).status === 0) throw new Error(`${device} is already running, so this runner cannot prove it was started with -no-window. Choose another NEO_ANKI_ANDROID_PORT.`)
    emulatorProcess = spawn(emulator, ['-avd', avd, '-port', port, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect'], { stdio: 'ignore' })
    run(adb, ['-s', device, 'wait-for-device'])
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline && run(adb, ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], { capture: true }) !== '1') await wait(1_000)
    if (Date.now() >= deadline) throw new Error('The no-window Android emulator did not finish booting within 180 seconds.')
    run(adb, ['-s', device, 'install', '-r', artifact])
  } else {
    device = process.env.NEO_ANKI_IOS_SIMULATOR_UDID
    if (!device) throw new Error('NEO_ANKI_IOS_SIMULATOR_UDID is required. The runner uses simctl and never opens the Simulator UI.')
    spawnSync('xcrun', ['simctl', 'boot', device], { stdio: 'ignore' })
    run('xcrun', ['simctl', 'bootstatus', device, '-b'])
    run('xcrun', ['simctl', 'install', device, artifact])
  }

  run(maestro, ['test', '--device', device, '--format', 'junit', '--output', join(results, 'junit.xml'), flows])
  console.log(`Native ${platform} E2E passed headlessly on ${device}. Evidence: ${results}`)
} finally {
  if (platform === 'android' && device) {
    const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    if (sdk) spawnSync(join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['-s', device, 'emu', 'kill'], { stdio: 'ignore' })
    emulatorProcess?.kill('SIGTERM')
  } else if (platform === 'ios' && device) {
    spawnSync('xcrun', ['simctl', 'shutdown', device], { stdio: 'ignore' })
  }
}
