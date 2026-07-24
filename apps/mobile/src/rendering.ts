import { renderWorkspaceCard, type CardRenderingProjection } from '@neo-anki/card-rendering'
import type { Card, WorkspaceDocumentV4 } from '@neo-anki/compatibility-domain'
import type { MobileDatabase } from './database'

export type MobileCardRendering = CardRenderingProjection

export const buildMobileCardRendering = async (
  _database: MobileDatabase,
  document: WorkspaceDocumentV4,
  card: Card,
): Promise<MobileCardRendering> => {
  const note = document.workspace.notes.find((value) => value.id === card.noteId)
  const contentType = note && document.workspace.noteTypes.find((value) => value.id === note.noteTypeId)
  const template = document.workspace.templates.find((value) => value.id === card.templateId)
  if (!note || !contentType || !template) throw new Error('Card template references are incomplete.')
  return renderWorkspaceCard(card, note, template, contentType.fieldIds.map((fieldId) => ({
    id: fieldId,
    name: document.workspace.fields.find((value) => value.id === fieldId)?.name || fieldId,
  })))
}
