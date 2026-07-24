import type { KnowledgeItemProjection, WorkspaceV4 } from './types.js'

const fieldText = (workspace: WorkspaceV4, noteId: string) => {
  const note = workspace.notes.find((value) => value.id === noteId)
  if (!note) return { prompt: '', answer: '', tags: [] as string[] }
  const noteType = workspace.noteTypes.find((value) => value.id === note.noteTypeId)
  const ordered = (noteType?.fieldIds || []).map((id) => note.fields[id] || '')
  return { prompt: ordered[0] || '', answer: ordered.slice(1).find(Boolean) || '', tags: note.tags }
}

/** A deliberately lossy study view. It is generated and must never be persisted as authority. */
export const projectKnowledgeItems = (workspace: WorkspaceV4): KnowledgeItemProjection[] => workspace.cards.map((card) => {
  const text = fieldText(workspace, card.noteId)
  return {
    noteId: card.noteId,
    cardId: card.id,
    prompt: text.prompt,
    answer: text.answer,
    deckName: workspace.decks.find((deck) => deck.id === card.deckId)?.name || 'Missing deck',
    tags: [...text.tags],
    suspended: card.suspended,
    dueAt: card.scheduling.dueAt,
  }
})
