import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

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
await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && target.extensions.some((extension) => entry.name.endsWith(extension)))
  .map((entry) => entry.name)
  .sort()

for (const extension of target.extensions) {
  if (!sourceFiles.some((file) => file.endsWith(extension))) throw new Error(`No ${extension} artifact was produced for ${targetName}.`)
}
for (const file of sourceFiles) await copyFile(join(sourceDirectory, file), join(destinationDirectory, file))
await copyFile(resolve(target.instructions), join(destinationDirectory, `INSTALL-${targetName}.md`))

process.stdout.write(`Staged ${sourceFiles.join(', ')} for ${targetName}.\n`)
