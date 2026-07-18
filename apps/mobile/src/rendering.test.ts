import { describe, expect, it } from 'vitest'
import { cachedTtsAudioHtml } from './rendering'
import { addBasicNote, createEmptyWorkspace } from './workspace'

describe('mobile cached TTS rendering', () => {
  it('offers only valid cached tracks for the visible card side', () => {
    const document = addBasicNote(createEmptyWorkspace(), 'Question', 'Answer')
    const note = document.workspace.notes[0]
    if (!note) throw new Error('Expected the fixture to create a note.')
    const profileId = note.profileId; const now = new Date().toISOString()
    document.workspace.media.push({ id: 'audio-prompt', revision: 1, createdAt: now, updatedAt: now, profileId, filename: 'prompt.mp3', mimeType: 'audio/mpeg', byteLength: 1, sha256: '0'.repeat(64), storageKey: '0'.repeat(64) })
    document.workspace.extensionRecords.push({ id: 'tts-record', revision: 1, createdAt: now, updatedAt: now, profileId, extensionId: 'org.neoanki.tts', targetKind: 'note', targetId: note.id, value: { version: 1, tracks: { prompt: { assetId: 'audio-prompt', side: 'prompt', provider: 'openai' }, missing: { assetId: 'missing-audio', side: 'answer', provider: '<unsafe>' } } } })
    const urls = new Map([['audio-prompt', 'data:audio/mpeg;base64,YQ==']])
    expect(cachedTtsAudioHtml(document, note.id, 'prompt', urls)).toContain('Play openai TTS audio')
    expect(cachedTtsAudioHtml(document, note.id, 'prompt', urls)).toContain('data:audio/mpeg;base64,YQ==')
    expect(cachedTtsAudioHtml(document, note.id, 'answer', urls)).toBe('')
  })
})
