import { describe, expect, it } from 'vitest'
import { analyzeCardHealth, cardHealth, compareTypedAnswer, findDuplicateItems, getAssetForCard, normalizeAnswer, renderCard } from './content'
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
    const rendered = renderCard({ ...item, prompt: 'Paris is the {{c1::capital}} of France.' }, { ...card, variant: 'cloze', promptData: { clozeOrdinal: 1 } })
    expect(rendered.prompt).toContain('[ … ]')
    expect(rendered.answer).toBe('capital')
  })

  it('hides only the target cloze ordinal and preserves siblings as context', () => {
    const clozeItem = { ...item, prompt: '{{c1::Paris::city}} is in {{c2::France}} and {{c1::Lyon}} is too.' }
    const first = renderCard(clozeItem, { ...card, variant: 'cloze', promptData: { clozeOrdinal: 1 } })
    const second = renderCard(clozeItem, { ...card, variant: 'cloze', promptData: { clozeOrdinal: 2 } })
    expect(first.prompt).toBe('[city] is in France and [ … ] is too.')
    expect(first.answer).toBe('Paris · Lyon')
    expect(second.prompt).toBe('Paris is in [ … ] and Lyon is too.')
    expect(second.answer).toBe('France')
  })

  it('compares typed answers with normalization and typo tolerance', () => {
    expect(normalizeAnswer('  Café! ')).toBe('café')
    expect(compareTypedAnswer('cafe', 'café').result).not.toBe('exact')
    expect(compareTypedAnswer('spaced repetiton', 'spaced repetition').result).toBe('close')
    expect(compareTypedAnswer('banana', 'spaced repetition').result).toBe('incorrect')
    expect(compareTypedAnswer('x'.repeat(600), 'x'.repeat(600)).result).toBe('incorrect')
  })

  it('reports actionable health findings and exact duplicates', () => {
    expect(analyzeCardHealth('x', 'x').map((finding) => finding.code)).toEqual(expect.arrayContaining(['vague-prompt', 'answer-leak']))
    expect(findDuplicateItems(item.prompt.toUpperCase(), data.items)).toContainEqual(item)
    expect(findDuplicateItems('not present anywhere', data.items)).toEqual([])
  })

  it('reports long, compound, unsourced content and resolves card media', () => {
    const prompt = 'Statement '.repeat(25)
    const answer = `alpha and beta and ${'detail '.repeat(50)}`
    expect(analyzeCardHealth(prompt, answer).map((finding) => finding.code)).toEqual(expect.arrayContaining(['long-prompt', 'long-answer', 'multi-fact', 'open-form', 'missing-source']))
    expect(analyzeCardHealth(prompt, answer, [{ id: 'source-1', title: 'Source', url: 'https://example.com' }]).map((finding) => finding.code)).not.toContain('missing-source')
    expect(cardHealth('What is this?', 'That')).toEqual([])
    const itemWithMedia = { ...item, mediaIds: ['asset-1'] }
    expect(getAssetForCard(itemWithMedia, [{ id: 'asset-1', filename: 'image.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', byteLength: 1, hash: 'a'.repeat(64), altText: 'Fixture', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }])).toMatchObject({ id: 'asset-1' })
    expect(getAssetForCard(itemWithMedia, [])).toBeUndefined()
  })
})
