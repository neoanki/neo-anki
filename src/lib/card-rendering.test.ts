import { describe, expect, it } from 'vitest'
import type { Card, CardTemplate, Note } from '../../packages/compatibility-domain/src'
import { plainTextAnswer, renderWorkspaceCard } from './card-rendering'

const now = '2026-01-01T00:00:00.000Z'
const base = { revision: 1, createdAt: now, updatedAt: now }
const note: Note = { ...base, id: 'note', profileId: 'profile', noteTypeId: 'type', fields: { prompt: 'Capital?', answer: '<b>Paris</b>', context: 'France' }, tags: ['geo'], marked: false }
const template: CardTemplate = { ...base, id: 'template', noteTypeId: 'type', name: 'Recall', ordinal: 0, promptFieldId: 'prompt', answerFieldId: 'answer', supportingFieldIds: ['context'], responseMode: 'type' }
const card: Card = { ...base, id: 'card', profileId: 'profile', noteId: note.id, templateId: template.id, deckId: 'deck', presetId: 'preset', ordinal: 0, flags: 0, suspended: false, scheduling: { strategy: 'neo-fsrs', queue: 'new', dueAt: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 } }

describe('native card rendering', () => {
  it('resolves template field roles into structured native content', () => {
    expect(renderWorkspaceCard(card, note, template, [{ id: 'prompt', name: 'Prompt' }, { id: 'answer', name: 'Answer' }, { id: 'context', name: 'Context' }])).toEqual({
      templateId: 'template',
      templateName: 'Recall',
      prompt: { id: 'prompt', label: 'Prompt', value: 'Capital?' },
      answer: { id: 'answer', label: 'Answer', value: 'Paris' },
      supporting: [{ id: 'context', label: 'Context', value: 'France' }],
      responseMode: 'type',
    })
  })

  it('converts legacy markup to safe text rather than presentation HTML', () => {
    expect(plainTextAnswer('<p>Hello<br><strong>world</strong></p>[sound:voice.mp3]')).toBe('Hello\nworld\nAudio: voice.mp3')
    expect(plainTextAnswer('[SOUND:folder\\\\voice.mp3]')).toBe('Audio: folder\\\\voice.mp3')
    expect(plainTextAnswer(`[sound:${'\\'.repeat(10_000)}`)).toHaveLength(10_007)
  })

  it('rejects inconsistent card references', () => {
    expect(() => renderWorkspaceCard({ ...card, templateId: 'other' }, note, template, [])).toThrow(/inconsistent/i)
  })
})
