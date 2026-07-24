import { describe, expect, it } from 'vitest'
import type { MobileDatabase } from './database'
import { buildMobileCardRendering } from './rendering'
import { addBasicNote, createEmptyWorkspace } from './workspace'

describe('mobile native card rendering', () => {
  it('projects the same structured fields and template behavior as desktop', async () => {
    const document = addBasicNote(createEmptyWorkspace(), 'Question', 'Answer')
    const card = document.workspace.cards[0]
    if (!card) throw new Error('Expected the fixture to create a card.')

    const rendering = await buildMobileCardRendering({} as MobileDatabase, document, card)

    expect(rendering).toEqual({
      templateId: document.workspace.templates[0]?.id,
      templateName: 'Recall',
      prompt: expect.objectContaining({ label: 'Front', value: 'Question' }),
      answer: expect.objectContaining({ label: 'Back', value: 'Answer' }),
      supporting: [],
      responseMode: 'reveal',
    })
  })
})
