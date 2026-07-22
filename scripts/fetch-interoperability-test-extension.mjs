import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

const filename = 'org.neoanki.interoperability-2.0.7.neoanki-extension'
const destination = join(process.cwd(), 'test-extensions', filename)
const expected = 'a31a04e128195b5e08784193e25e96ee2e0291762c4cb67d615315dc4de12417'
const url = `https://github.com/neoanki/neoanki-interoperability/releases/download/v2.0.7/${filename}`
const response = await globalThis.fetch(url)
if (!response.ok) throw new Error(`Could not download immutable interoperability test extension: HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== expected) throw new Error(`Interoperability package checksum mismatch: expected ${expected}, received ${actual}`)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, bytes)
console.log(`Verified ${filename} (${bytes.length} bytes).`)
