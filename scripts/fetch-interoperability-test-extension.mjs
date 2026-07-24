import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const filename = 'org.neoanki.interoperability-2.0.7.neoanki-extension'
const destination = join(process.cwd(), 'test-extensions', filename)
const expected = 'a31a04e128195b5e08784193e25e96ee2e0291762c4cb67d615315dc4de12417'
const url = `https://github.com/neoanki/neoanki-interoperability/releases/download/v2.0.7/${filename}`
const download = async () => {
  let failure = new Error('The interoperability test extension download did not start.')
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await globalThis.fetch(url)
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      failure = new Error(`Could not download immutable interoperability test extension: HTTP ${response.status}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt < 4) await delay(attempt * 1_000)
  }
  throw failure
}
const bytes = await download()
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== expected) throw new Error(`Interoperability package checksum mismatch: expected ${expected}, received ${actual}`)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, bytes)
console.log(`Verified ${filename} (${bytes.length} bytes).`)
