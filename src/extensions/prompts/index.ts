import type { NeoAnkiExtension, PortableRenderedCard, PromptTypeContribution } from '../sdk'
import type { KnowledgeItem, PracticeCard } from '../../types'

const base = (item: KnowledgeItem): PortableRenderedCard => ({
  prompt: item.prompt,
  answer: item.answer,
  context: item.context,
  typed: false,
  mediaId: item.mediaIds[0],
  citations: item.citations,
})

const normalizeAnswer = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const levenshtein = (left: string, right: string) => {
  const matrix = Array.from({ length: left.length + 1 }, (_, row) => Array.from({ length: right.length + 1 }, (_, col) => row === 0 ? col : col === 0 ? row : 0))
  for (let row = 1; row <= left.length; row += 1) for (let col = 1; col <= right.length; col += 1) {
    const cost = left[row - 1] === right[col - 1] ? 0 : 1
    matrix[row][col] = Math.min(matrix[row - 1][col] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col - 1] + cost)
  }
  return matrix[left.length][right.length]
}

const compareAnswer = (attempt: string, expected: string) => {
  const actual = normalizeAnswer(attempt)
  const target = normalizeAnswer(expected)
  if (!target) return { result: 'incorrect' as const, similarity: 0 }
  if (actual === target) return { result: 'exact' as const, similarity: 1 }
  const similarity = Math.max(0, 1 - levenshtein(actual, target) / Math.max(actual.length, target.length, 1))
  return { result: similarity >= 0.82 ? 'close' as const : 'incorrect' as const, similarity }
}

const simple = (id: string, label: string, estimatedSeconds: number, render: (item: KnowledgeItem, card: PracticeCard) => PortableRenderedCard, comparator?: PromptTypeContribution['compareAnswer']): PromptTypeContribution => ({
  id,
  label,
  createCards: () => [{ promptType: id, estimatedSeconds }],
  render,
  compareAnswer: comparator,
})

export const promptTypesExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.prompt-types',
    name: 'Prompt Types',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['prompts:contribute'],
  },
  promptTypes: [
    simple('reverse', 'Reverse', 14, (item) => ({ ...base(item), prompt: item.answer, answer: item.prompt })),
    simple('cloze', 'Cloze', 16, (item) => {
      const answers: string[] = []
      const prompt = item.prompt.replace(/{{c\d+::(.*?)(?:::.*?)?}}/g, (_, answer: string) => { answers.push(answer); return '[ … ]' })
      return { ...base(item), prompt, answer: answers.join(' · ') || item.answer }
    }),
    simple('typed', 'Typed answer', 20, (item) => ({ ...base(item), typed: true }), compareAnswer),
    simple('audio', 'Audio', 18, (item) => ({ ...base(item), prompt: item.prompt || 'Listen and recall the answer.', mediaId: item.mediaIds[0] })),
  ],
}

export { compareAnswer as compareTypedAnswer, normalizeAnswer }
