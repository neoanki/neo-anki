import type { NeoAnkiCoreModule, PortableRenderedCard, PromptTypeContribution } from '../core-module'
import type { KnowledgeItem, PracticeCard } from '../../types'

const base = (item: KnowledgeItem): PortableRenderedCard => ({
  prompt: item.prompt,
  answer: item.answer,
  context: item.context,
  typed: false,
  mediaId: item.mediaIds[0],
  citations: item.citations,
})

const CLOZE_PATTERN = /{{c(\d+)::([^{}]*?)(?:::([^{}]*?))?}}/gi

export const clozeOrdinals = (value: string) => [...new Set([...value.matchAll(CLOZE_PATTERN)].map((match) => Number(match[1])).filter((ordinal) => Number.isInteger(ordinal) && ordinal > 0))].sort((left, right) => left - right)

const renderCloze = (item: KnowledgeItem, card: PracticeCard): PortableRenderedCard => {
  const target = Number(card.promptData?.clozeOrdinal) || clozeOrdinals(item.prompt)[0] || 1
  const answers: string[] = []
  const prompt = item.prompt.replace(CLOZE_PATTERN, (whole, ordinalText: string, answer: string, hint?: string) => {
    const ordinal = Number(ordinalText)
    if (ordinal !== target) return answer
    answers.push(answer)
    return hint ? `[${hint}]` : '[ … ]'
  })
  return { ...base(item), prompt, answer: answers.join(' · ') || item.answer }
}

const normalizeAnswer = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const MAX_TYPED_ANSWER_LENGTH = 512

const boundedLevenshtein = (left: string, right: string, maximum: number) => {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = new Array<number>(right.length + 1).fill(maximum + 1)
    current[0] = row
    const start = Math.max(1, row - maximum)
    const end = Math.min(right.length, row + maximum)
    let rowMinimum = maximum + 1
    for (let col = start; col <= end; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      current[col] = Math.min(previous[col] + 1, current[col - 1] + 1, previous[col - 1] + cost)
      rowMinimum = Math.min(rowMinimum, current[col])
    }
    if (rowMinimum > maximum) return maximum + 1
    previous = current
  }
  return previous[right.length]
}

const compareAnswer = (attempt: string, expected: string) => {
  const actual = normalizeAnswer(attempt)
  const target = normalizeAnswer(expected)
  if (!target) return { result: 'incorrect' as const, similarity: 0 }
  if (actual.length > MAX_TYPED_ANSWER_LENGTH || target.length > MAX_TYPED_ANSWER_LENGTH) return { result: 'incorrect' as const, similarity: 0 }
  if (actual === target) return { result: 'exact' as const, similarity: 1 }
  const maximum = Math.max(1, Math.ceil(Math.max(actual.length, target.length) * 0.18))
  const distance = boundedLevenshtein(actual, target, maximum)
  const similarity = Math.max(0, 1 - distance / Math.max(actual.length, target.length, 1))
  return { result: similarity >= 0.82 ? 'close' as const : 'incorrect' as const, similarity }
}

const simple = (id: string, label: string, estimatedSeconds: number, render: (item: KnowledgeItem, card: PracticeCard) => PortableRenderedCard, comparator?: PromptTypeContribution['compareAnswer']): PromptTypeContribution => ({
  id,
  label,
  createCards: () => [{ promptType: id, estimatedSeconds }],
  render,
  compareAnswer: comparator,
})

export const promptTypesExtension: NeoAnkiCoreModule = {
  manifest: {
    id: 'neo-anki.prompt-types',
    name: 'Prompt Types',
    version: '1.1.0',
    runtime: 'core',
    publisher: 'Neo Anki',
    permissions: ['prompts:contribute'],
  },
  promptTypes: [
    simple('reverse', 'Reverse', 14, (item) => ({ ...base(item), prompt: item.answer, answer: item.prompt })),
    {
      id: 'cloze',
      label: 'Cloze',
      createCards: (input) => clozeOrdinals(input.prompt).map((clozeOrdinal) => ({ promptType: 'cloze', estimatedSeconds: 16, extensionData: { clozeOrdinal } })),
      render: renderCloze,
    },
    simple('typed', 'Typed answer', 20, (item) => ({ ...base(item), typed: true }), compareAnswer),
    simple('audio', 'Audio', 18, (item) => ({ ...base(item), prompt: item.prompt || 'Listen and recall the answer.', mediaId: item.mediaIds[0] })),
  ],
}

export { compareAnswer as compareTypedAnswer, normalizeAnswer }
