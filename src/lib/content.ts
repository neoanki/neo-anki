import type { KnowledgeItem, MediaAsset, PracticeCard } from '../types'
import type { PortableRenderedCard } from '../extensions/core-module'
import { extensionRuntime } from '../extensions/runtime'

export interface CardHealthFinding {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  suggestion: string
}

export type RenderedCard = PortableRenderedCard

export const renderCard = (item: KnowledgeItem, card: PracticeCard): RenderedCard => extensionRuntime.render(item, card)

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
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

export const compareTypedAnswer = (attempt: string, expected: string) => extensionRuntime.compareAnswer('typed', attempt, expected) || { result: 'incorrect' as const, similarity: 0 }

export const getAssetForCard = (item: KnowledgeItem, assets: MediaAsset[]) => assets.find((asset) => item.mediaIds.includes(asset.id))
