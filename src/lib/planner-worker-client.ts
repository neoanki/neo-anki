import type { PlanningSignal } from '../extensions/core-module'
import type { DailyPlan, KnowledgeItem, PracticeCard, ReviewEvent, UserSettings } from '../types'

export interface PlannerWorkerPayload {
  requestId: string
  now: string
  cards: PracticeCard[]
  reviews: ReviewEvent[]
  settings: UserSettings
  items: KnowledgeItem[]
  signalsByItem: Array<[string, PlanningSignal[]]>
  queueScoresByCard: Array<[string, number]>
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<{ requestId: string; ok: boolean; plan?: DailyPlan; error?: string }>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(value: PlannerWorkerPayload): void
  terminate(): void
}

type WorkerFactory = () => WorkerLike

export const buildDailyPlanInWorker = (payload: PlannerWorkerPayload, signal: AbortSignal, factory: WorkerFactory = () => new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike) => new Promise<DailyPlan>((resolve, reject) => {
  const worker = factory()
  let settled = false
  const finish = (complete: () => void) => {
    if (settled) return
    settled = true
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    worker.terminate()
    complete()
  }
  const abort = () => finish(() => reject(new DOMException('Background planning was canceled.', 'AbortError')))
  const timeout = window.setTimeout(() => finish(() => reject(new Error('Background planning exceeded the 30-second limit.'))), 30_000)
  signal.addEventListener('abort', abort, { once: true })
  worker.onmessage = (event) => {
    if (event.data.requestId !== payload.requestId) return
    finish(() => event.data.ok && event.data.plan ? resolve(event.data.plan) : reject(new Error(event.data.error || 'Background planning failed.')))
  }
  worker.onerror = () => finish(() => reject(new Error('The background planner worker failed.')))
  if (signal.aborted) abort()
  else worker.postMessage(payload)
})
