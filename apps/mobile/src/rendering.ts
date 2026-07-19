import { fromByteArray } from 'base64-js'
import { renderWorkspaceCard, type CardRenderingProjection } from '@neo-anki/card-rendering'
import type { Card, WorkspaceDocumentV4 } from '@neo-anki/compatibility-domain'
import type { MobileDatabase } from './database'

export interface MobileCardRendering extends CardRenderingProjection { questionDocument: string; answerDocument: string }
const documentHtml = (body: string, css: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=2"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>:root{color-scheme:light dark}html,body{margin:0;background:transparent;color:#172033;font:20px/1.5 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}.card{padding:8px}img{max-width:100%;height:auto}audio{width:100%}.cloze{color:#514dcf;font-weight:700}.media-missing{color:#9b1c31}@media(prefers-color-scheme:dark){html,body{color:#f1f5f9}.cloze{color:#aaa7ff}}${css}</style></head><body><main class="card">${body}</main></body></html>`
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export const cachedTtsAudioHtml = (document: WorkspaceDocumentV4, noteId: string, side: 'prompt' | 'answer', urls: ReadonlyMap<string, string>) => {
  const record = document.workspace.extensionRecords.find((value) => value.extensionId === 'org.neoanki.tts' && value.targetKind === 'note' && value.targetId === noteId)
  const metadata = record?.value as { version?: unknown; tracks?: unknown } | undefined
  if (metadata?.version !== 1 || !metadata.tracks || typeof metadata.tracks !== 'object' || Array.isArray(metadata.tracks)) return ''
  const assets = new Set(document.workspace.media.map((value) => value.id)); const seen = new Set<string>(); const controls: string[] = []
  for (const value of Object.values(metadata.tracks as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const track = value as Record<string, unknown>; const assetId = typeof track.assetId === 'string' ? track.assetId : ''; const provider = typeof track.provider === 'string' ? track.provider : 'generated'
    if (track.side !== side || !assetId || seen.has(assetId) || !assets.has(assetId) || !urls.has(assetId)) continue
    seen.add(assetId); controls.push(`<div class="tts-track"><small>${escapeHtml(provider)} TTS</small><audio controls preload="metadata" aria-label="Play ${escapeHtml(provider)} TTS audio"><source src="${escapeHtml(urls.get(assetId)!)}"></audio></div>`)
  }
  return controls.length ? `<section class="tts-audio" aria-label="Cached NeoAnki TTS audio">${controls.join('')}</section>` : ''
}

export const buildMobileCardRendering = async (database: MobileDatabase, document: WorkspaceDocumentV4, card: Card): Promise<MobileCardRendering> => {
  const note = document.workspace.notes.find((value) => value.id === card.noteId); const noteType = note && document.workspace.noteTypes.find((value) => value.id === note.noteTypeId); const template = document.workspace.templates.find((value) => value.id === card.templateId); const deck = document.workspace.decks.find((value) => value.id === card.deckId)
  if (!note || !noteType || !template) throw new Error('Card template references are incomplete.')
  const urls = new Map<string, string>()
  await Promise.all(document.workspace.media.map(async (asset) => { const bytes = await database.getMedia(asset.id); if (bytes) urls.set(asset.id, `data:${asset.mimeType};base64,${fromByteArray(bytes)}`) }))
  const rendering = renderWorkspaceCard(card, note, noteType, template, noteType.fieldIds.map((fieldId) => ({ id: fieldId, name: document.workspace.fields.find((value) => value.id === fieldId)?.name || fieldId })), deck?.name || 'Default', document.workspace.media, (asset) => urls.get(asset.id) || '')
  const promptTts = cachedTtsAudioHtml(document, note.id, 'prompt', urls); const answerTts = cachedTtsAudioHtml(document, note.id, 'answer', urls)
  return { ...rendering, questionDocument: documentHtml(`${rendering.questionHtml}${promptTts}`, rendering.css), answerDocument: documentHtml(`${rendering.answerHtml}${answerTts}`, rendering.css) }
}
