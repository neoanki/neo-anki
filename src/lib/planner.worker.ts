/// <reference lib="webworker" />
import { buildDailyPlan } from './planner'
import type { PlannerWorkerPayload } from './planner-worker-client'

self.onmessage = (event: MessageEvent<PlannerWorkerPayload>) => {
  const input = event.data
  try {
    const signals = new Map(input.signalsByItem)
    const scores = new Map(input.queueScoresByCard)
    const plan = buildDailyPlan(input.cards, input.reviews, input.settings, new Date(input.now), input.items, {
      signalsFor: (item) => signals.get(item.id) || [],
      scoreQueuePolicy: (_strategy, candidate) => scores.get(candidate.card.id) ?? null,
    })
    self.postMessage({ requestId: input.requestId, ok: true, plan })
  } catch (error) {
    self.postMessage({ requestId: input.requestId, ok: false, error: error instanceof Error ? error.message : 'Background planning failed.' })
  }
}
