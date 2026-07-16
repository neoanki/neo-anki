import { State } from 'ts-fsrs'
import type { KnowledgeItem, LearningGoal, PracticeCard, SavedViewFilter, ViewSort } from '../types'
import { endOfDay } from './date'

const includesEvery = (haystack: string[], needles: string[]) => needles.every((needle) => haystack.includes(needle))

export const itemMatchesFilter = (
  item: KnowledgeItem,
  cards: PracticeCard[],
  filter: SavedViewFilter,
  now = new Date(),
) => {
  const itemCards = cards.filter((card) => card.itemId === item.id)
  const query = filter.query.trim().toLocaleLowerCase()
  if (query) {
    const haystack = `${item.prompt} ${item.answer} ${item.context} ${item.collection} ${item.tags.join(' ')}`.toLocaleLowerCase()
    if (!haystack.includes(query)) return false
  }
  if (filter.collections.length && !filter.collections.includes(item.collection)) return false
  if (filter.tags.length && !includesEvery(item.tags, filter.tags)) return false
  if (filter.states.length) {
    const matchesState = filter.states.some((state) => {
      if (state === 'suspended') return itemCards.length > 0 && itemCards.every((card) => card.suspended)
      if (state === 'new') return itemCards.some((card) => !card.suspended && card.fsrs.state === State.New)
      if (state === 'due') return itemCards.some((card) => !card.suspended && card.fsrs.state !== State.New && new Date(card.fsrs.due) <= endOfDay(now))
      return itemCards.some((card) => !card.suspended && card.fsrs.state === State.Review)
    })
    if (!matchesState) return false
  }
  return true
}

export const filterItems = (
  items: KnowledgeItem[],
  cards: PracticeCard[],
  filter: SavedViewFilter,
  sort: ViewSort = 'updated',
  now = new Date(),
) => {
  const result = items.filter((item) => itemMatchesFilter(item, cards, filter, now))
  return result.sort((left, right) => {
    if (sort === 'created') return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    if (sort === 'due') {
      const due = (item: KnowledgeItem) => Math.min(...cards.filter((card) => card.itemId === item.id).map((card) => new Date(card.fsrs.due).getTime()), Number.MAX_SAFE_INTEGER)
      return due(left) - due(right)
    }
    if (sort === 'difficulty') {
      const difficulty = (item: KnowledgeItem) => Math.max(0, ...cards.filter((card) => card.itemId === item.id).map((card) => card.fsrs.difficulty))
      return difficulty(right) - difficulty(left)
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

export const goalsForItem = (item: KnowledgeItem, cards: PracticeCard[], goals: LearningGoal[], now = new Date()) => goals
  .filter((goal) => goal.active && itemMatchesFilter(item, cards, goal.filter, now))

export const goalUrgency = (goal: LearningGoal, now = new Date()) => {
  const priorityWeight = goal.priority * 0.55
  if (!goal.deadline) return priorityWeight
  const days = Math.max(0, (new Date(goal.deadline).getTime() - now.getTime()) / 86_400_000)
  return priorityWeight + (days <= 1 ? 2 : days <= 7 ? 1 : days <= 30 ? 0.35 : 0)
}

export const emptyViewFilter = (): SavedViewFilter => ({ query: '', collections: [], tags: [], states: [] })
