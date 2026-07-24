import type { PlanningSignal } from './planner'
import type { DailyPlan, KnowledgeItem, PracticeCard, ReviewEvent, UserSettings } from '../types'

export interface PlannerWorkerPayload {
  requestId: string
  now: string
  cards: PracticeCard[]
  reviews: ReviewEvent[]
  settings: Pick<UserSettings, 'dailyMinutes' | 'recoveryStrategy'>
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

const defaultWorkerFactory: WorkerFactory = () => new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
let sharedWorker: WorkerLike | null = null
let sharedWorkerConstructor: typeof Worker | undefined
const sharedRequests = new Map<string, { resolve(plan: DailyPlan): void; reject(error: Error): void }>()

const getSharedWorker = () => {
  if (sharedWorker && sharedWorkerConstructor === globalThis.Worker) return sharedWorker
  if (sharedWorker) {
    sharedWorker.terminate()
    sharedRequests.forEach((request) => request.reject(new Error('The background planner worker changed.')))
    sharedRequests.clear()
  }
  const worker = defaultWorkerFactory()
  sharedWorkerConstructor = globalThis.Worker
  worker.onmessage = (event) => {
    const request = sharedRequests.get(event.data.requestId)
    if (!request) return
    sharedRequests.delete(event.data.requestId)
    if (event.data.ok && event.data.plan) request.resolve(event.data.plan)
    else request.reject(new Error(event.data.error || 'Background planning failed.'))
  }
  worker.onerror = () => {
    const error = new Error('The background planner worker failed.')
    sharedRequests.forEach((request) => request.reject(error))
    sharedRequests.clear()
    worker.terminate()
    if (sharedWorker === worker) {
      sharedWorker = null
      sharedWorkerConstructor = undefined
    }
  }
  sharedWorker = worker
  return worker
}

export const prewarmPlannerWorker = () => { getSharedWorker() }

export const buildDailyPlanInWorker = (payload: PlannerWorkerPayload, signal: AbortSignal, factory?: WorkerFactory) => new Promise<DailyPlan>((resolve, reject) => {
  const worker = factory ? factory() : getSharedWorker()
  let settled = false
  const finish = (complete: () => void) => {
    if (settled) return
    settled = true
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    if (factory) worker.terminate()
    else sharedRequests.delete(payload.requestId)
    complete()
  }
  const abort = () => finish(() => reject(new DOMException('Background planning was canceled.', 'AbortError')))
  const timeout = window.setTimeout(() => finish(() => reject(new Error('Background planning exceeded the 30-second limit.'))), 30_000)
  signal.addEventListener('abort', abort, { once: true })
  if (factory) {
    worker.onmessage = (event) => {
      if (event.data.requestId !== payload.requestId) return
      finish(() => event.data.ok && event.data.plan ? resolve(event.data.plan) : reject(new Error(event.data.error || 'Background planning failed.')))
    }
    worker.onerror = () => finish(() => reject(new Error('The background planner worker failed.')))
  } else {
    sharedRequests.set(payload.requestId, {
      resolve: (plan) => finish(() => resolve(plan)),
      reject: (error) => finish(() => reject(error)),
    })
  }
  if (signal.aborted) abort()
  else worker.postMessage(payload)
})
