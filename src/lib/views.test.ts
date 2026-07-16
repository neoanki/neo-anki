import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { emptyViewFilter, filterItems, goalUrgency, goalsForItem, itemMatchesFilter } from './views'

describe('saved views and goals', () => {
  const data = createSeedData()
  it('filters across text, collections, and tags', () => {
    const item = data.items[0]
    expect(itemMatchesFilter(item, data.cards, { ...emptyViewFilter(), collections: [item.collection] })).toBe(true)
    expect(itemMatchesFilter(item, data.cards, { ...emptyViewFilter(), tags: ['definitely-missing'] })).toBe(false)
    expect(filterItems(data.items, data.cards, { ...emptyViewFilter(), query: item.answer.slice(0, 6) }, 'updated')).toContain(item)
  })
  it('makes near deadlines more urgent', () => {
    const now = new Date('2026-07-16T00:00:00Z')
    const base = data.goals[0]
    expect(goalUrgency({ ...base, deadline: '2026-07-17', priority: 3 }, now)).toBeGreaterThan(goalUrgency({ ...base, deadline: '2027-07-17', priority: 1 }, now))
  })
  it('filters by card state, sorts, and matches active goals', () => {
    const item = data.items[0]
    const cards = data.cards.filter((card) => card.itemId === item.id)
    expect(itemMatchesFilter(item, data.cards, { ...emptyViewFilter(), states: ['new'] })).toBe(cards.some((card) => card.fsrs.state === 0))
    expect(filterItems(data.items, data.cards, emptyViewFilter(), 'created')).toHaveLength(data.items.length)
    expect(filterItems(data.items, data.cards, emptyViewFilter(), 'due')).toHaveLength(data.items.length)
    expect(filterItems(data.items, data.cards, emptyViewFilter(), 'difficulty')).toHaveLength(data.items.length)
    const goal = { ...data.goals[0], filter: { ...emptyViewFilter(), collections: [item.collection] }, active: true }
    expect(goalsForItem(item, data.cards, [goal], new Date())).toContainEqual(goal)
    expect(goalsForItem(item, data.cards, [{ ...goal, active: false }], new Date())).toEqual([])
  })
})
