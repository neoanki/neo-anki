import { describe, expect, it } from 'vitest'
import { analyzeCardHealth, compareTypedAnswer, findDuplicateItems, normalizeAnswer, renderCard } from './content'
import { createSeedData } from '../data/seed'

describe('content rendering and diagnostics', () => {
  const data = createSeedData()
  const item = data.items[0]
  const card = data.cards.find((candidate) => candidate.itemId === item.id)!

  it('renders forward and reverse prompts from one item', () => {
    expect(renderCard(item, card).prompt).toBe(item.prompt)
    expect(renderCard(item, { ...card, variant: 'reverse' }).prompt).toBe(item.answer)
  })

  it('renders cloze answers', () => {
    const rendered = renderCard({ ...item, prompt: 'Paris is the {{c1::capital}} of France.' }, { ...card, variant: 'cloze' })
    expect(rendered.prompt).toContain('[ … ]')
    expect(rendered.answer).toBe('capital')
  })

  it('compares typed answers with normalization and typo tolerance', () => {
    expect(normalizeAnswer('  Café! ')).toBe('cafe')
    expect(compareTypedAnswer('spaced repetiton', 'spaced repetition').result).toBe('close')
    expect(compareTypedAnswer('banana', 'spaced repetition').result).toBe('incorrect')
  })

  it('reports actionable health findings and exact duplicates', () => {
    expect(analyzeCardHealth('x', 'x').map((finding) => finding.code)).toEqual(expect.arrayContaining(['vague-prompt', 'answer-leak']))
    expect(findDuplicateItems(item.prompt.toUpperCase(), data.items)).toContainEqual(item)
  })
})
