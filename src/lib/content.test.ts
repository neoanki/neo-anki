import { describe, expect, it } from 'vitest'
import { analyzeCardHealth, cardHealth, compareTypedAnswer, findDuplicateItems, getAssetForCard, normalizeAnswer } from './content'
import { createSeedData } from '../data/seed'

describe('content rendering and diagnostics', () => {
  const data = createSeedData()
  const item = data.items[0]

  it('compares typed answers with normalization and typo tolerance', () => {
    expect(normalizeAnswer('  Café! ')).toBe('café')
    expect(compareTypedAnswer('cafe', 'café').result).not.toBe('exact')
    expect(compareTypedAnswer('spaced repetiton', 'spaced repetition').result).toBe('close')
    expect(compareTypedAnswer('banana', 'spaced repetition').result).toBe('incorrect')
    expect(compareTypedAnswer('x'.repeat(600), 'x'.repeat(600)).result).toBe('incorrect')
    expect(compareTypedAnswer('C', 'C++').result).not.toBe('exact')
    expect(compareTypedAnswer('Na', 'Na+').result).not.toBe('exact')
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

  it('does not mislabel multilingual questions as open-form prompts', () => {
    for (const prompt of ['Що зміцнює практика пригадування?', '記憶を強化するものは何ですか？', 'ما الذي يقوي الذاكرة؟']) {
      expect(analyzeCardHealth(prompt, 'Retrieval practice').map((finding) => finding.code)).not.toContain('open-form')
    }
  })
})
