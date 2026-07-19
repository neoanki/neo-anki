import { describe, expect, it, vi } from 'vitest'
import { createSeedData } from '../data/seed'
import type { DailyPlan } from '../types'
import { buildDailyPlan } from './planner'
import { buildDailyPlanInWorker, type PlannerWorkerPayload } from './planner-worker-client'

class FakeWorker {
  onmessage: ((event: MessageEvent<{ requestId: string; ok: boolean; plan?: DailyPlan; error?: string }>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  postMessage(payload: PlannerWorkerPayload) { queueMicrotask(() => this.onmessage?.({ data: { requestId: payload.requestId, ok: false, error: 'fixture failure' } } as MessageEvent)) }
  terminate() { this.terminated = true }
}

class SuccessWorker extends FakeWorker {
  override postMessage(payload: PlannerWorkerPayload) {
    const plan = buildDailyPlan(payload.cards, payload.reviews, payload.settings, new Date(payload.now), payload.items)
    queueMicrotask(() => this.onmessage?.({ data: { requestId: 'stale-request', ok: true, plan } } as MessageEvent))
    queueMicrotask(() => this.onmessage?.({ data: { requestId: payload.requestId, ok: true, plan } } as MessageEvent))
  }
}

class PendingWorker extends FakeWorker { override postMessage() {} }

describe('background planner lifecycle', () => {
  it('returns only the matching successful plan and closes the worker', async () => {
    const data = createSeedData(); const worker = new SuccessWorker(); const controller = new AbortController()
    const payload: PlannerWorkerPayload = { requestId: 'plan-success', now: new Date().toISOString(), cards: data.cards, reviews: data.reviews, settings: data.settings, items: data.items, signalsByItem: [], queueScoresByCard: [] }
    await expect(buildDailyPlanInWorker(payload, controller.signal, () => worker)).resolves.toMatchObject({ dueTotal: expect.any(Number), forecast: expect.any(Array) })
    expect(worker.terminated).toBe(true)
  })

  it('returns worker failures and always terminates the isolated runtime', async () => {
    const data = createSeedData(); const worker = new FakeWorker(); const controller = new AbortController()
    const payload: PlannerWorkerPayload = { requestId: 'plan-1', now: new Date().toISOString(), cards: data.cards, reviews: data.reviews, settings: data.settings, items: data.items, signalsByItem: [], queueScoresByCard: [] }
    await expect(buildDailyPlanInWorker(payload, controller.signal, () => worker)).rejects.toThrow('fixture failure')
    expect(worker.terminated).toBe(true)
  })

  it('cancels promptly without posting stale work', async () => {
    vi.useFakeTimers()
    try {
      const data = createSeedData(); const worker = new FakeWorker(); const controller = new AbortController(); controller.abort()
      const payload: PlannerWorkerPayload = { requestId: 'plan-2', now: new Date().toISOString(), cards: data.cards, reviews: data.reviews, settings: data.settings, items: data.items, signalsByItem: [], queueScoresByCard: [] }
      await expect(buildDailyPlanInWorker(payload, controller.signal, () => worker)).rejects.toMatchObject({ name: 'AbortError' })
      expect(worker.terminated).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('times out and terminates a worker that never responds', async () => {
    vi.useFakeTimers()
    try {
      const data = createSeedData(); const worker = new PendingWorker(); const controller = new AbortController()
      const payload: PlannerWorkerPayload = { requestId: 'plan-timeout', now: new Date().toISOString(), cards: data.cards, reviews: data.reviews, settings: data.settings, items: data.items, signalsByItem: [], queueScoresByCard: [] }
      const pending = buildDailyPlanInWorker(payload, controller.signal, () => worker)
      const assertion = expect(pending).rejects.toThrow('30-second')
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(worker.terminated).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
