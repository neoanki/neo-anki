import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'

const targetName = process.argv[2]
const targets = {
  'macos-universal': { extensions: ['.dmg', '.zip'], instructions: 'docs/install-macos.md' },
  'windows-x64': { extensions: ['.exe'], instructions: 'docs/install-windows.md' },
  'linux-x64': { extensions: ['.AppImage'], instructions: 'docs/install-linux.md' },
}
const target = targets[targetName]
if (!target) throw new Error(`Unknown release target: ${targetName || '(missing)'}`)

const sourceDirectory = resolve('release')
const destinationDirectory = resolve('release-artifacts', targetName)
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const artifactPrefix = `${packageJson.productName}-${packageJson.version}-`
await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.startsWith(artifactPrefix) && target.extensions.some((extension) => entry.name.endsWith(extension)))
  .map((entry) => entry.name)
  .sort()

for (const extension of target.extensions) {
  if (!sourceFiles.some((file) => file.endsWith(extension))) throw new Error(`No ${extension} artifact was produced for ${targetName}.`)
}
const stagedFiles = sourceFiles.map((file) => ({ source: file, destination: file.replace(/\s+/g, '-') }))
if (new Set(stagedFiles.map(({ destination }) => destination)).size !== stagedFiles.length) throw new Error(`Normalized artifact names collide for ${targetName}.`)
for (const file of stagedFiles) await copyFile(join(sourceDirectory, file.source), join(destinationDirectory, file.destination))
await copyFile(resolve(target.instructions), join(destinationDirectory, `INSTALL-${targetName}.md`))
const artifacts = await Promise.all(stagedFiles.map(async ({ destination }) => ({
  filename: destination,
  sha256: createHash('sha256').update(await readFile(join(destinationDirectory, destination))).digest('hex'),
})))
const evidence = {
  schemaVersion: 1,
  version: `v${packageJson.version}`,
  commit: process.env.GITHUB_SHA || 'local',
  platform: targetName,
  workflowRun: process.env.GITHUB_RUN_ID || 'local',
  node: process.version,
  headless: true,
  artifacts,
  gates: ['lint', 'typecheck', 'unit-coverage', 'timezone', 'anki-oracle-25.9.4', 'browser-chromium-firefox-webkit', 'desktop-durability', 'mobile-export', 'packaged-launch'],
}
await writeFile(join(destinationDirectory, `RELEASE-EVIDENCE-${targetName}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

process.stdout.write(`Staged ${stagedFiles.map(({ destination }) => destination).join(', ')} for ${targetName}.\n`)
