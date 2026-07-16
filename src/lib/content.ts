import type { KnowledgeItem, MediaAsset, PracticeCard } from '../types'

const CLOZE_PATTERN = /{{c\d+::(.*?)(?:::.*?)?}}/g

export interface CardHealthFinding {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  suggestion: string
}

export interface RenderedCard {
  prompt: string
  answer: string
  context: string
  typed: boolean
  mediaId?: string
  occlusionId?: string
  citations: KnowledgeItem['citations']
}

export const renderCard = (item: KnowledgeItem, card: PracticeCard): RenderedCard => {
  if (card.variant === 'reverse') {
    return { prompt: item.answer, answer: item.prompt, context: item.context, typed: false, citations: item.citations }
  }

  if (card.variant === 'cloze') {
    const answers: string[] = []
    const prompt = item.prompt.replace(CLOZE_PATTERN, (_, answer: string) => {
      answers.push(answer)
      return '[ … ]'
    })
    return {
      prompt,
      answer: answers.join(' · ') || item.answer,
      context: item.context,
      typed: false,
      citations: item.citations,
    }
  }

  if (card.variant === 'image-occlusion') {
    return {
      prompt: item.prompt || 'Name the hidden part.',
      answer: item.occlusions.find((rect) => rect.id === card.occlusionId)?.label || item.answer,
      context: item.context,
      typed: false,
      mediaId: item.mediaIds[0],
      occlusionId: card.occlusionId,
      citations: item.citations,
    }
  }

  if (card.variant === 'audio') {
    return {
      prompt: item.prompt || 'Listen and recall the answer.',
      answer: item.answer,
      context: item.context,
      typed: false,
      mediaId: item.mediaIds[0],
      citations: item.citations,
    }
  }

  return {
    prompt: item.prompt,
    answer: item.answer,
    context: item.context,
    typed: card.variant === 'typed',
    mediaId: item.mediaIds[0],
    citations: item.citations,
  }
}

export const analyzeCardHealth = (prompt: string, answer: string, citations: KnowledgeItem['citations'] = []): CardHealthFinding[] => {
  const findings: CardHealthFinding[] = []
  const cleanPrompt = prompt.trim()
  const cleanAnswer = answer.trim()

  if (cleanPrompt.length < 5) findings.push({ code: 'vague-prompt', severity: 'error', message: 'The prompt may be too vague.', suggestion: 'Add enough context to make only one answer plausible.' })
  if (cleanPrompt.length > 180) findings.push({ code: 'long-prompt', severity: 'warning', message: 'The prompt is difficult to scan.', suggestion: 'Split it into smaller, focused prompts.' })
  if (cleanAnswer.length > 260) findings.push({ code: 'long-answer', severity: 'warning', message: 'The answer may hide multiple facts.', suggestion: 'Keep the required recall short and move explanation into context.' })
  if (/\band\b.*\band\b/i.test(cleanAnswer)) findings.push({ code: 'multi-fact', severity: 'warning', message: 'This may contain several independent facts.', suggestion: 'Create one knowledge item per independently useful fact.' })
  if (cleanPrompt && cleanPrompt.toLocaleLowerCase() === cleanAnswer.toLocaleLowerCase()) findings.push({ code: 'answer-leak', severity: 'error', message: 'The prompt reveals the answer.', suggestion: 'Rewrite the prompt so recall is necessary.' })
  if (/^(what|who|when|where|why|how)\b/i.test(cleanPrompt) === false && cleanPrompt && !cleanPrompt.includes('{{c')) findings.push({ code: 'open-form', severity: 'info', message: 'The prompt is not phrased as a direct question.', suggestion: 'Direct questions are often faster to interpret during review.' })
  if (!citations.length && cleanPrompt.length > 40) findings.push({ code: 'missing-source', severity: 'info', message: 'This substantial item has no source.', suggestion: 'Add a citation so future edits can be verified.' })
  return findings
}

export const cardHealth = (prompt: string, answer: string) => analyzeCardHealth(prompt, answer).map((finding) => finding.message)

export const findDuplicateItems = (prompt: string, items: KnowledgeItem[]) => {
  const normalized = normalizeAnswer(prompt)
  return items.filter((item) => normalizeAnswer(item.prompt) === normalized)
}

export const normalizeAnswer = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const levenshtein = (left: string, right: string) => {
  const rows = left.length + 1
  const cols = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      matrix[row][col] = Math.min(matrix[row - 1][col] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col - 1] + cost)
    }
  }
  return matrix[left.length][right.length]
}

export const compareTypedAnswer = (attempt: string, expected: string) => {
  const normalizedAttempt = normalizeAnswer(attempt)
  const normalizedExpected = normalizeAnswer(expected)
  if (!normalizedExpected) return { result: 'incorrect' as const, similarity: 0 }
  if (normalizedAttempt === normalizedExpected) return { result: 'exact' as const, similarity: 1 }
  const distance = levenshtein(normalizedAttempt, normalizedExpected)
  const similarity = Math.max(0, 1 - distance / Math.max(normalizedAttempt.length, normalizedExpected.length, 1))
  return { result: similarity >= 0.82 ? 'close' as const : 'incorrect' as const, similarity }
}

export const getAssetForCard = (item: KnowledgeItem, assets: MediaAsset[]) => assets.find((asset) => item.mediaIds.includes(asset.id))
