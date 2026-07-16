import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { strToU8, zipSync } from 'fflate'
import { decodeModernMediaNames, importAnkiPackage } from './importers/anki'

const fromBase64 = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))

describe('Anki package import', () => {
  it('imports notes, cards, decks, tags, and media from a classic apkg', async () => {
    const testWasm = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
    const SQL = await initSqlJs({ locateFile: () => testWasm })
    const db = new SQL.Database()
    db.run('CREATE TABLE col (decks text, models text)')
    db.run('CREATE TABLE notes (id integer, guid text, mid integer, tags text, flds text)')
    db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer)')
    db.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify({ 10: { name: 'Languages::Spanish' } }), JSON.stringify({ 20: { tmpls: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}' }] } })])
    db.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?)', [1, 'guid-1', 20, ' verb common ', 'hola<img src="picture.png">\u001fhello'])
    db.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [2, 1, 10, 0, 2, -1, 0, 10, 2500, 4])
    const bytes = zipSync({ 'collection.anki2': db.export(), media: strToU8(JSON.stringify({ 0: 'picture.png' })), 0: new Uint8Array([137, 80, 78, 71]) })
    db.close()
    const result = await importAnkiPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, () => testWasm)
    expect(result.items[0]).toMatchObject({ prompt: 'hola', answer: 'hello', collection: 'Languages / Spanish', tags: ['verb', 'common'] })
    expect(result.cards[0].suspended).toBe(true)
    expect(result.assets[0].filename).toBe('picture.png')
    expect(result.items[0].mediaIds).toEqual([result.assets[0].id])
    expect(result.warnings[0]).toMatch(/future reviews with FSRS/)
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
  })
})
