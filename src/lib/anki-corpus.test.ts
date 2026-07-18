import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportAnkiWorkspaceV4, importAnkiWorkspaceV4 } from './importers/anki'
import { workspaceDocumentV4ToAppData } from './workspace-v4'

const fixtureRoot = join(process.cwd(), 'test-fixtures/anki/25.9.4')
const wasm = join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
const arrayBuffer = (bytes: Buffer) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const oraclePython = process.env.ANKI_ORACLE_PYTHON || ''

describe('generated Anki 25.9.4 migration corpus', () => {
  for (const filename of ['current-stable.apkg', 'current-stable.colpkg', 'legacy-schema.apkg']) {
    it(`preserves the compatibility graph from ${filename}`, async () => {
      const result = await importAnkiWorkspaceV4(arrayBuffer(readFileSync(join(fixtureRoot, filename))), filename, () => wasm)
      const workspace = result.document.workspace
      expect(workspace.notes).toHaveLength(4)
      expect(workspace.cards).toHaveLength(7)
      expect(workspace.reviews).toHaveLength(1)
      expect(workspace.media).toEqual([expect.objectContaining({ filename: 'migration-pixel.png', sha256: 'd1f2061aa9a6c17bb67f4f6b7ed3ebb8ec36354e76d4e0a33b1366c8bacd73f8' })])
      expect(workspace.cards.filter((card) => card.clozeOrdinal).map((card) => card.clozeOrdinal).sort()).toEqual([1, 2])
      expect(workspace.cards.some((card) => card.suspended && card.flags === 3)).toBe(true)
      expect(workspace.cards.some((card) => card.buriedUntil && card.buriedBy === 'user')).toBe(true)
      expect(workspace.decks.every((deck) => !deck.name.includes('\u001f'))).toBe(true)
      expect(workspace.decks.some((deck) => deck.name === 'Migration Corpus::Core')).toBe(true)
      expect(workspace.noteTypes.find((type) => type.name === 'Migration Custom')).toMatchObject({
        kind: 'standard', css: expect.stringContaining('#123456'),
        fieldIds: expect.arrayContaining([expect.any(String)]), templateIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      })
      expect(workspace.presets.some((preset) => preset.learningStepsMinutes.join(',') === '2,15' && preset.maximumIntervalDays === 1234 && Math.abs(preset.desiredRetention - .91) < .0001)).toBe(true)
      expect(result.projection.preflight?.fidelity.filter((record) => [
        'notes.namedFields', 'noteTypes.templatesCss.source', 'cards.scheduling', 'reviews', 'decks.presets', 'media', 'source.unknownMetadata.bytes',
      ].includes(record.path)).every((record) => record.disposition === 'preserved')).toBe(true)
      if (filename === 'current-stable.colpkg') {
        expect(result.projection.preflight?.fidelity.some((record) => record.requiresAcceptance && record.path.startsWith('templates.'))).toBe(true)
      } else {
        expect(result.projection.preflight?.fidelity.some((record) => record.requiresAcceptance)).toBe(false)
      }
      const projected = workspaceDocumentV4ToAppData(result.document)
      expect(projected.cards.some((card) => card.flags === 3)).toBe(true)
      expect(projected.cards.some((card) => card.buriedBy === 'user')).toBe(true)
      expect(projected.cards.some((card) => card.rendering?.typedAnswer?.expected === 'Paris' && card.rendering.questionHtml.includes('migration-pixel.png') === false && card.rendering.questionHtml.includes('neoanki-media://asset/'))).toBe(true)
      expect(projected.cards.filter((card) => card.rendering?.questionHtml.includes('class="cloze"'))).toHaveLength(2)
    })
  }

  it.skipIf(!oraclePython).each(['apkg', 'colpkg'] as const)('exports a %s package accepted and rendered by pinned current Anki', async (target) => {
    const imported = await importAnkiWorkspaceV4(arrayBuffer(readFileSync(join(fixtureRoot, 'current-stable.apkg'))), 'current-stable.apkg', () => wasm)
    const exported = await exportAnkiWorkspaceV4(imported.document, imported.mediaAssets, target, () => wasm)
    expect(exported.report.canExport).toBe(true)
    expect(exported.report.warnings).toEqual([expect.stringContaining('source.opaqueMetadata')])
    const directory = mkdtempSync(join(tmpdir(), 'neo-anki-anki-oracle-'))
    try {
      const packagePath = join(directory, `neo-roundtrip.${target}`)
      writeFileSync(packagePath, exported.bytes)
      const output = execFileSync(oraclePython, [join(process.cwd(), 'scripts/anki-oracle.py'), 'inspect', packagePath], { encoding: 'utf8', timeout: 60_000 })
      const oracle = JSON.parse(output) as { notes: number; cards: number; reviews: number; media: Array<{ filename: string }>; sample: Array<{ question: string; answer: string; queue: number; flags: number }> }
      expect(oracle).toMatchObject({ notes: 4, cards: 7, reviews: 1, media: [{ filename: 'migration-pixel.png' }] })
      expect(oracle.sample.some((card) => card.question.includes('Capital of <b>France</b>?') && card.answer.includes('Paris'))).toBe(true)
      expect(oracle.sample.some((card) => card.question.includes('data-ordinal="1"'))).toBe(true)
      expect(oracle.sample.some((card) => card.queue === -1 && card.flags === 3)).toBe(true)
      expect(oracle.sample.some((card) => card.queue === -3)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it.skipIf(!oraclePython)('preserves a disposable current-Anki collection with many large media entries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'neo-anki-large-media-oracle-'))
    try {
      const packagePath = join(directory, 'large-media.apkg')
      execFileSync(oraclePython, [join(process.cwd(), 'scripts/anki-oracle.py'), 'generate-large', packagePath], { timeout: 60_000 })
      const imported = await importAnkiWorkspaceV4(arrayBuffer(readFileSync(packagePath)), 'large-media.apkg', () => wasm)
      const largeAssets = imported.mediaAssets.filter((asset) => asset.filename.startsWith('migration-large-'))
      expect(largeAssets).toHaveLength(32)
      expect(largeAssets.reduce((total, asset) => total + asset.byteLength, 0)).toBeGreaterThanOrEqual(8 * 1024 * 1024)
      for (const asset of largeAssets) {
        const bytes = Buffer.from(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1), 'base64')
        expect(bytes).toHaveLength(asset.byteLength)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.hash)
        expect(imported.document.workspace.media.find((descriptor) => descriptor.id === asset.id)).toMatchObject({ sha256: asset.hash, byteLength: asset.byteLength })
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 90_000)
})
