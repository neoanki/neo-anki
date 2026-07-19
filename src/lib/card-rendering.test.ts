import { describe, expect, it } from 'vitest'
import type { Card, CardTemplate, MediaAsset, Note, NoteType } from '../../packages/compatibility-domain/src'
import { plainTextAnswer, renderWorkspaceCard } from './card-rendering'

const now = '2026-07-18T12:00:00.000Z'
const base = { revision: 1, createdAt: now, updatedAt: now }
const media: MediaAsset = { ...base, id: 'media', profileId: 'profile', filename: 'pixel.png', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), storageKey: 'a'.repeat(64) }

describe('Workspace v4 card rendering projection', () => {
  it('decodes one layer of HTML entities without turning encoded markup into text', () => {
    expect(plainTextAnswer('&lt;b&gt;answer&lt;/b&gt; &amp;lt;script&amp;gt;')).toBe('<b>answer</b> &lt;script&gt;')
  })

  it('renders named fields, conditions, typed answers, media, and FrontSide', () => {
    const type: NoteType = { ...base, id: 'type', profileId: 'profile', name: 'Custom', fieldIds: ['front', 'back', 'hint'], templateIds: ['template'], kind: 'standard', css: '.card { color: purple; }' }
    const note: Note = { ...base, id: 'note', profileId: 'profile', noteTypeId: type.id, fields: { front: 'Capital?<img src="pixel.png">', back: '<b>Paris</b>', hint: 'Europe' }, tags: ['geo'], marked: false }
    const template: CardTemplate = { ...base, id: 'template', noteTypeId: type.id, name: 'Forward', ordinal: 0, questionFormat: '{{#Hint}}{{Prompt}}{{/Hint}}{{type:Answer}}', answerFormat: '{{FrontSide}}<hr>{{Answer}}' }
    const card: Card = { ...base, id: 'card', profileId: 'profile', noteId: note.id, templateId: template.id, deckId: 'deck', presetId: 'preset', ordinal: 0, flags: 0, suspended: false, scheduling: { strategy: 'neo-fsrs', queue: 'new', dueAt: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 } }
    const rendered = renderWorkspaceCard(card, note, type, template, [{ id: 'front', name: 'Prompt' }, { id: 'back', name: 'Answer' }, { id: 'hint', name: 'Hint' }], 'Geography', [media], () => 'data:image/png;base64,AAAA')
    expect(rendered).toMatchObject({ css: expect.stringContaining('purple'), typedAnswer: { fieldName: 'Answer', expected: 'Paris' }, source: 'anki-template' })
    expect(rendered.questionHtml).toContain('data:image/png;base64,AAAA')
    expect(rendered.answerHtml).toContain('<b>Paris</b>')
    expect(rendered.answerHtml).toContain('Capital?')
  })

  it('renders exactly one active cloze ordinal with its hint', () => {
    const type: NoteType = { ...base, id: 'type', profileId: 'profile', name: 'Cloze', fieldIds: ['text'], templateIds: ['template'], kind: 'cloze', css: '.cloze { font-weight: bold; }' }
    const note: Note = { ...base, id: 'note', profileId: 'profile', noteTypeId: type.id, fields: { text: '{{c1::retrieval::method}} and {{c2::spacing::timing}}' }, tags: [], marked: false }
    const template: CardTemplate = { ...base, id: 'template', noteTypeId: type.id, name: 'Cloze', ordinal: 0, questionFormat: '{{cloze:Text}}', answerFormat: '{{cloze:Text}}' }
    const card: Card = { ...base, id: 'card', profileId: 'profile', noteId: note.id, templateId: template.id, deckId: 'deck', presetId: 'preset', ordinal: 1, clozeOrdinal: 2, flags: 0, suspended: false, scheduling: { strategy: 'neo-fsrs', queue: 'new', dueAt: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 } }
    const rendered = renderWorkspaceCard(card, note, type, template, [{ id: 'text', name: 'Text' }], 'Learning', [], () => '')
    expect(rendered.questionHtml).toContain('retrieval')
    expect(rendered.questionHtml).toContain('[timing]')
    expect(rendered.questionHtml).not.toContain('[method]')
    expect(rendered.answerHtml).toContain('<span class="cloze" data-ordinal="2">spacing</span>')
  })
})
