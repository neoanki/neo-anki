import type { Card, CardTemplate, Note } from '@neo-anki/compatibility-domain'

export interface RenderedCardField {
  id: string
  label: string
  value: string
}

export interface CardRenderingProjection {
  templateId: string
  templateName: string
  prompt: RenderedCardField
  answer: RenderedCardField
  supporting: RenderedCardField[]
  responseMode: 'reveal' | 'type'
}

const entities: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

const replaceSoundReferences = (value: string) => {
  const lowerValue = value.toLowerCase()
  let cursor = 0
  let output = ''
  while (cursor < value.length) {
    const start = lowerValue.indexOf('[sound:', cursor)
    if (start < 0) return output + value.slice(cursor)
    const end = value.indexOf(']', start + 7)
    if (end < 0) return output + value.slice(cursor)
    output += value.slice(cursor, start)
    output += `Audio: ${value.slice(start + 7, end)}`
    cursor = end + 1
  }
  return output
}

export const plainTextAnswer = (value: string) => replaceSoundReferences(value)
  .replace(/<br[\s/]*>/gi, '\n')
  .replace(/<\/(?:div|p|li|tr|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match)
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

export const renderCardFields = (
  template: Pick<CardTemplate, 'id' | 'name' | 'promptFieldId' | 'answerFieldId' | 'supportingFieldIds' | 'responseMode'>,
  values: Record<string, string>,
  fields: Array<{ id: string; name: string }>,
): CardRenderingProjection => {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const promptField = byId.get(template.promptFieldId)
  const answerField = byId.get(template.answerFieldId)
  if (!promptField || !answerField) throw new Error('Card template fields are incomplete.')
  const fieldValue = (field: { id: string; name: string }): RenderedCardField => ({
    id: field.id,
    label: field.name,
    value: plainTextAnswer(values[field.id] || ''),
  })
  return {
    templateId: template.id,
    templateName: template.name,
    prompt: fieldValue(promptField),
    answer: fieldValue(answerField),
    supporting: template.supportingFieldIds.map((id) => byId.get(id)).filter((field): field is { id: string; name: string } => Boolean(field)).map(fieldValue).filter((field) => field.value.length > 0),
    responseMode: template.responseMode,
  }
}

export const renderWorkspaceCard = (
  card: Card,
  note: Note,
  template: CardTemplate,
  fields: Array<{ id: string; name: string }>,
): CardRenderingProjection => {
  if (card.noteId !== note.id || card.templateId !== template.id) throw new Error('Card rendering references are inconsistent.')
  return renderCardFields(template, note.fields, fields)
}
