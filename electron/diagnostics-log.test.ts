// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsLog } from './diagnostics-log'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('DiagnosticsLog', () => {
  it('redacts local paths and exports privacy-limited records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-diagnostics-'))
    roots.push(root)
    const log = new DiagnosticsLog(root, '1.2.3')
    await log.record({ source: 'renderer', level: 'error', code: 'render-failed', message: 'Failed at /Users/alice/private/file.ts', stack: 'at /home/alice/app.ts:1' })
    const destination = join(root, 'export.jsonl')
    await log.export(destination)
    const contents = await readFile(destination, 'utf8')
    expect(contents).toContain('<local-path>')
    expect(contents).not.toContain('alice')
    expect(JSON.parse(contents)).toMatchObject({ appVersion: '1.2.3', source: 'renderer', code: 'render-failed' })
  })
})
