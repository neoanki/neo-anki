import { performance } from 'node:perf_hooks'
import { createSeedData } from '../src/data/seed.ts'
import { buildDailyPlan } from '../src/lib/planner.ts'
import type { KnowledgeItem, PracticeCard } from '../src/types.ts'

const CARD_COUNT = 50_000
const LIMIT_MS = 5_000
const now = new Date('2026-07-17T10:00:00.000Z')
const seed = createSeedData()
const cardTemplate = seed.cards[0]
const itemTemplate = seed.items[0]

const items: KnowledgeItem[] = Array.from({ length: CARD_COUNT }, (_, index) => ({
  ...itemTemplate,
  id: `benchmark-item-${index}`,
  prompt: `Benchmark prompt ${index}`,
  collection: `Collection ${index % 20}`,
}))
const cards: PracticeCard[] = items.map((item, index) => ({
  ...cardTemplate,
  id: `benchmark-card-${index}`,
  itemId: item.id,
  fsrs: {
    ...cardTemplate.fsrs,
    state: 2,
    due: new Date(now.getTime() - (index % 365) * 86_400_000).toISOString(),
    stability: 1 + (index % 30),
    difficulty: 1 + (index % 9),
  },
}))

const started = performance.now()
const plan = buildDailyPlan(cards, [], { ...seed.settings, onboardingComplete: true, dailyMinutes: 30 }, now, items)
const elapsedMs = performance.now() - started
const result = { cards: CARD_COUNT, elapsedMs: Math.round(elapsedMs), queue: plan.queue.length, deferred: plan.deferred, forecastDays: plan.forecast.length }

console.log(JSON.stringify(result))
if (elapsedMs > LIMIT_MS || plan.forecast.length !== 7 || plan.queue.length === 0) {
  console.error(`Planner benchmark failed its ${LIMIT_MS} ms / correctness budget.`)
  process.exitCode = 1
}
