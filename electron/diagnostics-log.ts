import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  .replace(/(?:file:\/\/)?(?:[A-Za-z]:\\|\/(?:Users|home|private|var|tmp)\/)[^\s)]+/g, '<local-path>')
  .replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, '<remote-url>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
  .replace(/\b(?:bearer\s+|sk-[A-Za-z0-9_-]{12,}|api[_-]?key[=: ]+)[A-Za-z0-9._~+/-]+/gi, '<credential>')
  .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, '<embedded-data>')
  .replace(/(["']?(?:prompt|answer|content|text|secret|token)["']?\s*[:=]\s*)["'][^"']*["']/gi, '$1<redacted>')
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
      if (info.size >= MAX_LOG_BYTES) {
        await rm(this.previousPath, { force: true })
        await rename(this.path, this.previousPath)
      }
    } catch { /* The first record creates the file. */ }
    const record: DiagnosticRecord = {
      ...input,
      code: clean(input.code, 80).replace(/[^a-z0-9._-]/gi, '-'),
      message: clean(input.message, 1000),
      stack: input.stack ? clean(input.stack, 1200) : undefined,
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
