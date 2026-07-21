import { State } from 'ts-fsrs'
import type { KnowledgeItem, PracticeCard } from '../types'

const tokenize = (query: string) => query.match(/(?:[^\s"]+|"[^"]*")+/g) || []
const clean = (value: string) => value.replace(/^"|"$/g, '').toLowerCase()
const deckName = (value: string) => value.replaceAll('\u001f', '::').replace(/\s+\/\s+/g, '::').toLowerCase()
const wildcard = (value: string, candidate: string) => {
  if (!value.includes('*')) return candidate.includes(value)
  const pattern = value.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}$`, 'i').test(candidate)
}
const withinDays = (timestamp: string | undefined, days: number, now: Date) => Boolean(timestamp && Number.isFinite(days) && days >= 0 && now.getTime() - new Date(timestamp).getTime() <= days * 86_400_000)

/** A bounded mainstream subset of Anki search syntax; unknown operators match as text. */
export const matchesLibraryQuery = (item: KnowledgeItem, cards: PracticeCard[], query: string, now = new Date()) => {
  const tokens = tokenize(query).slice(0, 50)
  const haystack = `${item.prompt} ${item.answer} ${item.context} ${item.collection} ${item.tags.join(' ')}`.toLowerCase()
  return tokens.every((raw) => {
    const negative = raw.startsWith('-')
    const token = negative ? raw.slice(1) : raw
    const separator = token.indexOf(':')
    const operator = separator > 0 ? token.slice(0, separator).toLowerCase() : ''
    const value = clean(separator > 0 ? token.slice(separator + 1) : token)
    let matches: boolean
    if (operator === 'deck') matches = cards.length
      ? cards.some((card) => wildcard(deckName(value), deckName(card.deckName || item.collection)))
      : wildcard(deckName(value), deckName(item.collection))
    else if (operator === 'tag' && value === 'none') matches = item.tags.length === 0
    else if (operator === 'tag') matches = item.tags.some((tag) => wildcard(value, tag.toLowerCase()) || tag.toLowerCase().startsWith(`${value}::`))
    else if (operator === 'is' && value === 'suspended') matches = cards.some((card) => card.suspended)
    else if (operator === 'is' && value === 'buried') matches = cards.some((card) => Boolean(card.buriedUntil && new Date(card.buriedUntil) > now))
    else if (operator === 'is' && value === 'leech') matches = cards.some((card) => card.leech)
    else if (operator === 'is' && value === 'new') matches = cards.some((card) => card.fsrs.state === State.New)
    else if (operator === 'is' && value === 'due') matches = cards.some((card) => !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil) <= now) && card.fsrs.state !== State.New && new Date(card.fsrs.due) <= now)
    else if (operator === 'is' && value === 'review') matches = cards.some((card) => card.fsrs.state === State.Review)
    else if (operator === 'is' && (value === 'learn' || value === 'learning')) matches = cards.some((card) => card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning)
    else if (operator === 'flag') matches = value === 'any' ? cards.some((card) => Boolean(card.flags)) : value === 'none' || value === '0' ? cards.every((card) => !card.flags) : cards.some((card) => card.flags === Number(value))
    else if (operator === 'card') matches = cards.some((card) => wildcard(value, card.variant.toLowerCase()))
    else if (operator === 'note') matches = wildcard(value, (item.noteModel?.noteTypeName || 'neo basic').toLowerCase())
    else if (operator === 'has' && value === 'media') matches = item.mediaIds.length > 0 || cards.some((card) => /<(?:img|audio|video)\b|\[sound:/i.test(`${card.rendering?.questionHtml || ''}${card.rendering?.answerHtml || ''}`))
    else if (operator === 'added') matches = withinDays(item.createdAt, Number(value), now)
    else if (operator === 'edited') matches = withinDays(item.updatedAt, Number(value), now)
    else if (operator === 'rated') matches = cards.some((card) => withinDays(card.fsrs.last_review, Number(value.split(':')[0]), now))
    else if (operator === 'nid') matches = item.id === value
    else if (operator === 'cid') matches = cards.some((card) => card.id === value)
    else if (operator === 'prop' && /^due(?:<=|>=|=|<|>)-?\d+$/.test(value)) {
      const comparison = /^due(<=|>=|=|<|>)(-?\d+)$/.exec(value)!
      const target = Number(comparison[2])
      matches = cards.some((card) => {
        const days = Math.ceil((new Date(card.fsrs.due).getTime() - now.getTime()) / 86_400_000)
        return comparison[1] === '<=' ? days <= target : comparison[1] === '>=' ? days >= target : comparison[1] === '<' ? days < target : comparison[1] === '>' ? days > target : days === target
      })
    }
    else matches = haystack.includes(clean(token))
    return negative ? !matches : matches
  })
}

export type LibrarySort = 'updated-desc' | 'created-desc' | 'due-asc' | 'difficulty-desc' | 'deck-asc'
export const sortLibraryItems = (items: KnowledgeItem[], cardsByItem: Map<string, PracticeCard[]>, sort: LibrarySort) => [...items].sort((left, right) => {
  if (sort === 'updated-desc') return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  if (sort === 'created-desc') return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
  if (sort === 'deck-asc') return left.collection.localeCompare(right.collection) || left.prompt.localeCompare(right.prompt)
  const leftCards = cardsByItem.get(left.id) || []
  const rightCards = cardsByItem.get(right.id) || []
  if (sort === 'difficulty-desc') return Math.max(0, ...rightCards.map((card) => card.fsrs.difficulty)) - Math.max(0, ...leftCards.map((card) => card.fsrs.difficulty)) || left.id.localeCompare(right.id)
  const nextDue = (cards: PracticeCard[]) => Math.min(Number.POSITIVE_INFINITY, ...cards.map((card) => new Date(card.fsrs.due).getTime()))
  return nextDue(leftCards) - nextDue(rightCards) || left.id.localeCompare(right.id)
})
