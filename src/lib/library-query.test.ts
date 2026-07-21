import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { matchesLibraryQuery, sortLibraryItems } from './library-query'

describe('Library query syntax', () => {
  it('supports text, deck, tag, state, quoting, and negation', () => {
    const data = createSeedData(); const item = data.items[4]; const cards = data.cards.filter((card) => card.itemId === item.id)
    cards[0].leech = true
    expect(matchesLibraryQuery(item, cards, `deck:"${item.collection}" tag:${item.tags[0]} is:leech`)).toBe(true)
    expect(matchesLibraryQuery(item, cards, `-tag:${item.tags[0]}`)).toBe(false)
    expect(matchesLibraryQuery(item, cards, 'is:suspended')).toBe(false)
    cards[0].suspended = true; cards[0].buriedUntil = '2099-01-01T00:00:00.000Z'
    expect(matchesLibraryQuery(item, cards, 'is:suspended is:buried')).toBe(true)
    cards[0].suspended = false; cards[0].fsrs.state = 0; expect(matchesLibraryQuery(item, cards, 'is:new')).toBe(true)
    cards[0].fsrs.state = 2; cards[0].fsrs.due = '2020-01-01T00:00:00.000Z'; cards[0].buriedUntil = undefined; expect(matchesLibraryQuery(item, cards, 'is:due')).toBe(true)
    cards[0].buriedUntil = '2099-01-01T00:00:00.000Z'; expect(matchesLibraryQuery(item, cards, 'is:due', new Date('2026-07-18T12:00:00.000Z'))).toBe(false)
  })

  it('supports common flag, card, note-type, media, date, wildcard, and due-property operators', () => {
    const data = createSeedData(); const item = data.items[0]; const cards = data.cards.filter((card) => card.itemId === item.id)
    item.noteModel = { noteTypeId: 'type', noteTypeName: 'Migration Custom', fields: [] }
    cards[0].flags = 4; cards[0].variant = 'typed'; cards[0].fsrs.due = '2026-07-17T12:00:00.000Z'; cards[0].fsrs.last_review = '2026-07-17T12:00:00.000Z'
    expect(matchesLibraryQuery(item, cards, 'flag:4 card:typ* note:"Migration Custom" prop:due<=0 rated:2', new Date('2026-07-18T12:00:00.000Z'))).toBe(true)
    cards[0].deckName = 'Migration Corpus::Core'
    expect(matchesLibraryQuery(item, cards, 'deck:"Migration Corpus::Core"')).toBe(true)
    expect(matchesLibraryQuery(item, cards, 'flag:none')).toBe(false)
    item.mediaIds = ['media']; expect(matchesLibraryQuery(item, cards, 'has:media')).toBe(true)
    expect(matchesLibraryQuery(item, cards, 'added:99999 edited:99999', new Date('2026-07-18T12:00:00.000Z'))).toBe(true)
  })

  it('matches every card-level deck represented by a multi-card note', () => {
    const data = createSeedData()
    const item = data.items[0]
    const first = { ...data.cards[0], itemId: item.id, deckName: 'Languages::Spanish' }
    const second = { ...data.cards[0], id: 'second-deck-card', itemId: item.id, deckName: 'Languages::Japanese' }

    expect(matchesLibraryQuery(item, [first, second], 'deck:"Languages::Japanese"')).toBe(true)
  })

  it('sorts deterministically by due, difficulty, deck, creation, and edit time', () => {
    const data = createSeedData(); const items = data.items.slice(0, 3)
    const cardsByItem = new Map(items.map((item) => [item.id, data.cards.filter((card) => card.itemId === item.id)]))
    expect(sortLibraryItems(items, cardsByItem, 'due-asc')[0].id).toBe(items.slice().sort((left, right) => Math.min(...cardsByItem.get(left.id)!.map((card) => Date.parse(card.fsrs.due))) - Math.min(...cardsByItem.get(right.id)!.map((card) => Date.parse(card.fsrs.due))))[0].id)
    expect(sortLibraryItems(items, cardsByItem, 'difficulty-desc')).toHaveLength(3)
    expect(sortLibraryItems(items, cardsByItem, 'deck-asc').map((item) => item.collection)).toEqual(items.map((item) => item.collection).sort())
    expect(sortLibraryItems(items, cardsByItem, 'created-desc')).toHaveLength(3)
    expect(sortLibraryItems(items, cardsByItem, 'updated-desc')).toHaveLength(3)
  })
})
