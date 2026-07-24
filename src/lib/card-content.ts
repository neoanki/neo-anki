import type { CardRenderingProjection, KnowledgeItem, PracticeCard } from '../types'
import { renderCardFields } from './card-rendering'

/** The only UI-facing card presentation resolver. */
export const resolveCardContent = (item: KnowledgeItem, card: PracticeCard): CardRenderingProjection => {
  if (card.rendering) return card.rendering
  const fields = item.contentModel?.fields.slice().sort((left, right) => left.ordinal - right.ordinal) || []
  const prompt = fields[0]
  const answer = fields[1] || fields[0]
  const presentationFields = fields.length ? fields : [
    { id: 'prompt', name: 'Prompt', ordinal: 0, value: item.prompt },
    { id: 'answer', name: 'Answer', ordinal: 1, value: item.answer },
    { id: 'context', name: 'Context', ordinal: 2, value: item.context },
  ]
  return renderCardFields({
    id: 'template:basic',
    name: 'Recall',
    promptFieldId: prompt?.id || 'prompt',
    answerFieldId: answer?.id || 'answer',
    supportingFieldIds: presentationFields.slice(2).map((field) => field.id),
    responseMode: card.variant === 'typed' ? 'type' : 'reveal',
  }, Object.fromEntries(presentationFields.map((field) => [field.id, field.value])), presentationFields.map((field) => ({ id: field.id, name: field.name })))
}
