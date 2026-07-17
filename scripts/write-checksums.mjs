import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const directory = resolve(process.argv[2] || '')
const outputName = process.argv[3]
if (!process.argv[2] || !outputName || !outputName.startsWith('SHA256SUMS-')) throw new Error('Usage: write-checksums.mjs <directory> <SHA256SUMS-name>')

const files = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && !entry.name.startsWith('SHA256SUMS-'))
  .map((entry) => entry.name)
  .sort()
if (files.length === 0) throw new Error(`No release files found in ${directory}.`)

const lines = []
for (const file of files) {
  const digest = createHash('sha256').update(await readFile(join(directory, file))).digest('hex')
  lines.push(`${digest}  ${file}`)
}
await writeFile(join(directory, outputName), `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
process.stdout.write(`Wrote ${outputName} for ${files.length} release files.\n`)
