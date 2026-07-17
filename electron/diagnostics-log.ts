import { appendFile, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024

export interface DiagnosticRecord {
  timestamp: string
  source: 'main' | 'renderer' | 'extension-host'
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  stack?: string
  appVersion: string
  platform: string
}

const clean = (value: unknown, limit: number) => String(value ?? '')
  .replace(/(?:file:\/\/)?(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s)]+/g, '<local-path>')
  .replace(/[\r\n\t]+/g, ' ')
  .slice(0, limit)

export class DiagnosticsLog {
  readonly path: string
  private readonly previousPath: string

  constructor(private readonly root: string, private readonly appVersion: string) {
    this.path = join(root, 'diagnostics.jsonl')
    this.previousPath = join(root, 'diagnostics.previous.jsonl')
  }

  async record(input: Omit<DiagnosticRecord, 'timestamp' | 'appVersion' | 'platform'>) {
    await mkdir(this.root, { recursive: true })
    try {
      const info = await stat(this.path)
      if (info.size >= MAX_LOG_BYTES) await rename(this.path, this.previousPath)
    } catch { /* The first record creates the file. */ }
    const record: DiagnosticRecord = {
      ...input,
      code: clean(input.code, 80),
      message: clean(input.message, 1000),
      stack: input.stack ? clean(input.stack, 4000) : undefined,
      timestamp: new Date().toISOString(),
      appVersion: this.appVersion,
      platform: `${process.platform}-${process.arch}`,
    }
    await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async export(destination: string) {
    await mkdir(this.root, { recursive: true })
    try { await copyFile(this.path, destination) }
    catch { await writeFile(destination, '', { encoding: 'utf8', mode: 0o600 }) }
  }

  async read() {
    try { return await readFile(this.path, 'utf8') }
    catch { return '' }
  }
}
