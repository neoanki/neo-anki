import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { strToU8, zipSync } from 'fflate'
import { decodeModernMediaNames, exportAnkiWorkspaceV4, importAnkiPackage, importAnkiWorkspaceV4 } from './importers/anki'
import { refreshWorkspaceDocumentV4FromProjection, workspaceDocumentV4ToAppData } from './workspace-v4'

const fromBase64 = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))

describe('Anki package import', () => {
  it('imports notes, cards, decks, tags, and media from a classic apkg', async () => {
    const testWasm = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
    const SQL = await initSqlJs({ locateFile: () => testWasm })
    const db = new SQL.Database()
    db.run('CREATE TABLE col (decks text, models text)')
    db.run('CREATE TABLE notes (id integer, guid text, mid integer, tags text, flds text)')
    db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer, mod integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text)')
    db.run('CREATE TABLE revlog (id integer, cid integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer)')
    db.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify({ 10: { name: 'Languages::Spanish' } }), JSON.stringify({ 20: { tmpls: [{ ord: 0, name: 'Card 1', qfmt: '{{furigana:Front}}<script>fetch("https://example.test")</script>[latex]x[/latex]', afmt: '{{Back}}' }] } })])
    db.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?)', [1, 'guid-1', 20, ' verb common ', 'hola<img src="picture.png">\u001fhello'])
    db.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [2, 1, 10, 0, 1_700_000_000, 2, -1, 0, 10, 2500, 4, 1, 0, 0, 0, 2, JSON.stringify({ s: 12.5, d: 4.2, dr: .91, lrt: 1_699_000_000 })])
    db.run('INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [1_699_000_000_000, 2, 3, 10, 5, 2500, 8_000, 1])
    const bytes = zipSync({ 'collection.anki2': db.export(), media: strToU8(JSON.stringify({ 0: 'picture.png' })), 0: new Uint8Array([137, 80, 78, 71]) })
    db.close()
    const result = await importAnkiPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, () => testWasm)
    expect(result.items[0]).toMatchObject({ prompt: 'hola', answer: 'hello', collection: 'Languages / Spanish', tags: ['verb', 'common'] })
    expect(result.cards[0].suspended).toBe(true)
    expect(result.assets[0].filename).toBe('picture.png')
    expect(result.items[0].mediaIds).toEqual([result.assets[0].id])
    expect(result.warnings[0]).toMatch(/future reviews with FSRS/)

    const v4 = await importAnkiWorkspaceV4(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'fixture.apkg', () => testWasm)
    expect(v4.document.workspace).toMatchObject({ version: 4, notes: [{ tags: ['verb', 'common'] }], cards: [{ suspended: true, scheduling: { strategy: 'anki', intervalDays: 10, easeFactor: 2500, repetitions: 4, stability: 12.5, difficulty: 4.2, desiredRetention: .91 } }] })
    expect(v4.document.workspace.noteTypes[0]).toMatchObject({ sourceEnvelopeId: expect.any(String) })
    expect(v4.projection.preflight?.fidelity).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'templates.unsupportedFilters', disposition: 'unsupported', requiresAcceptance: true }),
      expect.objectContaining({ path: 'templates.latex', disposition: 'unsupported', requiresAcceptance: true }),
      expect.objectContaining({ path: 'templates.sandboxedScripts', disposition: 'unsupported', requiresAcceptance: true }),
      expect.objectContaining({ path: 'templates.blockedNetwork', disposition: 'unsupported', requiresAcceptance: true }),
    ]))
    expect(v4.document.workspace.sourceEnvelopes.some((value) => value.sourceId === '2' && value.opaque.row)).toBe(true)
    const projected = workspaceDocumentV4ToAppData(v4.document)
    expect(projected.cards[0]).toMatchObject({ scheduling: { strategy: 'anki', intervalDays: 10, stability: 12.5 }, fsrs: { due: v4.document.workspace.cards[0].scheduling.dueAt, stability: 12.5, difficulty: 4.2 } })
    projected.settings.dailyMinutes = 45
    const afterUnrelatedSave = refreshWorkspaceDocumentV4FromProjection(projected, v4.document)
    expect(afterUnrelatedSave.workspace.cards[0].scheduling).toEqual(v4.document.workspace.cards[0].scheduling)
    const exported = await exportAnkiWorkspaceV4(v4.document, v4.mediaAssets, 'apkg', () => testWasm)
    const oracle = await importAnkiWorkspaceV4(exported.bytes.buffer.slice(exported.bytes.byteOffset, exported.bytes.byteOffset + exported.bytes.byteLength) as ArrayBuffer, 'roundtrip.apkg', () => testWasm)
    expect(exported.report.canExport).toBe(true)
    expect(exported.report.warnings).toEqual([expect.stringContaining('source.opaqueMetadata')])
    expect(oracle.document.workspace).toMatchObject({ notes: [{ tags: ['verb', 'common'] }], cards: [{ suspended: true, scheduling: { intervalDays: 10, easeFactor: 2500, repetitions: 4, stability: 12.5, difficulty: 4.2, desiredRetention: .91 } }], media: [{ filename: 'picture.png' }] })

    const reversed = structuredClone(v4.document)
    const originalReview = reversed.workspace.reviews[0]
    reversed.workspace.reviews.push({
      id: 'neo-reversal-1', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      profileId: originalReview.profileId, cardId: originalReview.cardId, kind: 'reversal', rating: originalReview.rating,
      reviewedAt: new Date().toISOString(), durationMilliseconds: 0, intervalBefore: originalReview.intervalAfter,
      intervalAfter: originalReview.intervalBefore, scheduler: 'neo-fsrs', reversesReviewId: originalReview.id,
    })
    const reversedExport = await exportAnkiWorkspaceV4(reversed, v4.mediaAssets, 'apkg', () => testWasm)
    const reversedOracle = await importAnkiWorkspaceV4(reversedExport.bytes.buffer.slice(reversedExport.bytes.byteOffset, reversedExport.bytes.byteOffset + reversedExport.bytes.byteLength) as ArrayBuffer, 'reversed.apkg', () => testWasm)
    expect(reversedExport.report.counts.reviews).toBe(0)
    expect(reversedOracle.document.workspace.reviews).toHaveLength(0)
    await expect(exportAnkiWorkspaceV4(v4.document, [{ ...v4.mediaAssets[0], dataUrl: 'data:image/png;base64,AAAA' }], 'apkg', () => testWasm)).rejects.toThrow(/media would be lost or corrupted/i)
  })

  it('imports current zstd/protobuf packages and prefers them over the legacy dummy collection', async () => {
    const collection = 'KLUv/QRYPQwANlJFOFClOAfAmZlZyZuVm5nvqiBULNEkKbO0bOX2TiF11j+NgCJQznbaRm22CTni3wdv8ptk8W0EIzulNAA0ADcA1M7tR6F5OSCNYViA5VAyVTQJQLKpYjHzwCUkw1dbHGHmi5ndKbibCfjB7/QsyPnfqm1wBH+d1rGzxL/gt1Cq6EUM31rwbpMbeVQ6/tjxIelakH6Osd/9/arTyuCeaRWbj2efTebhRMQQJ8kn0fYWGs1nn4IdBbYoMiU5Jfu9+TkGlGE4yLPpXHg0vBJF21NSYxh2tXahI07s5vUccz8CkQATSlVRqq5a0i3pSQt0AUoyaoYQJizdF2bejneroUVis6J3Xo24H2g5dwNax67ByzjohMnVAS0gkAIhNZtqAymB7cETDEDvwaHRPu2xfXhyAMI2d1YhEGDhx5Ovz5MAHFfEZtIGirvopznajsNjKyPCuUSClQC3vwtPR8M3xQggBLjL2wD8CobEm2RgjoW4NmoKjMAYDj0IhDG0YYihL27uLFsgA/EKnf4='
    const media = 'KLUv/QRYeQAACg0KC3BpY3R1cmUucG5nd2FynA=='
    const file = 'KLUv/QRYIQAAiVBORwzkcMY='
    const bytes = zipSync({ 'collection.anki21b': fromBase64(collection), 'collection.anki2': new Uint8Array([0]), media: fromBase64(media), 0: fromBase64(file) })
    const testWasm = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
    const result = await importAnkiPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, () => testWasm)
    expect(result.items[0]).toMatchObject({ prompt: 'front', answer: 'back', collection: 'Modern / Deck', tags: ['modern'] })
    expect(result.assets[0].filename).toBe('picture.png')
    expect(result.assets[0].byteLength).toBe(4)
    expect(decodeModernMediaNames(Uint8Array.from([10, 13, 10, 11, ...new TextEncoder().encode('picture.png')]))).toEqual(['picture.png'])
    const v4 = await importAnkiWorkspaceV4(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'modern.colpkg', () => testWasm)
    expect(v4.sourceFormat).toBe('anki-colpkg')
    expect(v4.document.workspace).toMatchObject({ notes: [{ tags: ['modern'] }], media: [{ byteLength: 4 }] })
  })
})
