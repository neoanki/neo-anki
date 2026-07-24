// @refresh reset
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import type { AppData, CreateKnowledgeInput, DailyPlan, KnowledgeItem, RecoveryStrategy, ReviewRating, Route, SessionRequest, StudySession } from '../types'
import { makeEmptyFSRSCard, scheduleReview, serializeFSRSCard } from '../lib/fsrs'
import { buildCustomStudySession, buildDailyPlan, buildStudySession } from '../lib/planner'
import { adoptPersistedData, adoptTrustedDesktopData, clearStoredData, downloadBackup, exportRecoverySource, flushPendingSaves, loadWorkspaceData, reloadWorkspaceData, saveData, unlockPersistence, type WorkspaceLoadFailure } from '../lib/storage'
import { createDemoWorkspaceData, createEmptyWorkspaceData } from '../data/seed'
import { extensionRuntime } from '../extensions/runtime'
import { mergeImportGraph } from '../lib/import-merge'
import { planningSignalsForItemV2, refreshExtensionPlanningSignalsV2, scoreQueuePolicyV2 } from '../extensions/v2/registry'
import type { WorkspaceDocumentV4, WorkspacePatchV2 } from '../../packages/compatibility-domain/src/index'
import { applyWorkspacePatchV2, createWorkspaceDocumentV4 } from '../../packages/compatibility-domain/src/index'
import { appDataToWorkspaceDocumentV4, workspaceDocumentV4ToAppData } from '../lib/workspace-v4'
import { buildDailyPlanInWorker } from '../lib/planner-worker-client'
import { renderCardFields } from '../lib/card-rendering'

const LARGE_PLANNER_CARD_THRESHOLD = 5_000
const yieldPlannerPreparation = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))
const safeRouteFromLocation = (): Route => {
  try {
    const candidate = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''))
    return /^[a-z][a-z0-9._:-]{0,127}$/i.test(candidate) ? candidate : 'today'
  } catch { return 'today' }
}
const scrollToTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

const prepareLargePlannerInput = async (data: AppData, now: Date, signal: AbortSignal) => {
  const signalsByItem: Array<[string, ReturnType<typeof planningSignalsForItemV2>]> = []
  const signalBoost = new Map<string, number>()
  for (let offset = 0; offset < data.items.length; offset += 250) {
    if (signal.aborted) throw new DOMException('Background planning was canceled.', 'AbortError')
    for (const item of data.items.slice(offset, offset + 250)) {
      const signals = planningSignalsForItemV2(item).filter((value) => Boolean(value.id?.trim()) && Boolean(value.label?.trim()) && Number.isFinite(value.score))
      if (signals.length) signalsByItem.push([item.id, signals])
      signalBoost.set(item.id, signals.reduce((highest, value) => Math.max(highest, value.score), 0))
    }
    await yieldPlannerPreparation()
  }
  const queueScoresByCard: Array<[string, number]> = []
  if (data.settings.recoveryStrategy !== 'risk') {
    for (let offset = 0; offset < data.cards.length; offset += 500) {
      if (signal.aborted) throw new DOMException('Background planning was canceled.', 'AbortError')
      for (const card of data.cards.slice(offset, offset + 500)) {
        const score = scoreQueuePolicyV2(data.settings.recoveryStrategy, card.id)
        if (score != null && Number.isFinite(score)) queueScoresByCard.push([card.id, score])
      }
      await yieldPlannerPreparation()
    }
  }
  const latest = new Set([...data.reviews].sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) || left.id.localeCompare(right.id)).slice(-100).map((review) => review.id))
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const reviews = data.reviews.filter((review) => latest.has(review.id) || (Date.parse(review.reviewedAt) >= start.getTime() && Date.parse(review.reviewedAt) <= end.getTime()))
  return { signalsByItem, queueScoresByCard, reviews }
}

interface AppContextValue {
  data: AppData
  workspaceLoading: boolean
  workspaceLoadFailure: WorkspaceLoadFailure | null
  route: Route
  plan: ReturnType<typeof buildDailyPlan>
  planning: boolean
  planningError: string
  retryPlanning: () => void
  activeSession: StudySession | null
  persistenceError: string
  persistenceState: 'saving' | 'saved' | 'failed'
  retryPersistence: () => Promise<void>
  retryWorkspaceLoad: () => void
  exportWorkspaceRecoverySource: () => Promise<{ canceled: boolean; path?: string }>
  startEmptyAfterRecovery: () => Promise<void>
  loadDemoWorkspace: () => void
  navigate: (route: Route) => void
  startSession: (request: SessionRequest) => void
  startCustomSession: (cardIds: string[], reschedule: boolean) => void
  endSession: () => void
  setDailyMinutes: (minutes: number) => void
  setRetention: (retention: number) => void
  setRecoveryStrategy: (strategy: RecoveryStrategy) => void
  setLearningSafeguards: (changes: Partial<Pick<AppData['settings'], 'burySiblings' | 'leechThreshold' | 'leechAction'>>) => void
  toggleTheme: () => void
  completeOnboarding: (minutes: number) => void
  addItem: (input: CreateKnowledgeInput) => Promise<string>
  updateItem: (id: string, changes: Partial<Pick<KnowledgeItem, 'prompt' | 'answer' | 'context' | 'collection' | 'tags' | 'source' | 'citations' | 'mediaIds' | 'occlusions' | 'contentModel'>>) => Promise<void>
  updateItemsBulk: (ids: string[], changes: { collection?: string; addTags?: string[]; removeTags?: string[] }) => void
  deleteItem: (id: string) => void
  deleteItems: (ids: string[]) => void
  restoreItem: (id: string) => void
  purgeItem: (id: string) => void
  toggleSuspend: (cardId: string) => void
  setCardsSuspended: (cardIds: string[], suspended: boolean) => void
  setCardsBuried: (cardIds: string[], buried: boolean) => void
  setCardsFlag: (cardIds: string[], flag: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) => void
  setCardsDeck: (cardIds: string[], deckName: string) => Promise<void>
  setCardsDueDate: (cardIds: string[], localDate: string) => Promise<void>
  reviewCard: (cardId: string, rating: ReviewRating, durationSeconds: number, rawDurationSeconds?: number) => void
  undoLastReview: () => void
  loadWorkspaceDocument: () => Promise<WorkspaceDocumentV4>
  applyCoreWorkspacePatch: (patch: WorkspacePatchV2) => Promise<void>
  mergeImport: (imported: Pick<AppData, 'items' | 'cards' | 'assets'> & { workspaceDocumentV4?: unknown; workspaceV4Media?: AppData['assets']; workspaceV4SourceArchive?: Uint8Array; workspaceV4Operation?: 'additive' | 'replace-profile' }) => Promise<void>
  replaceData: (data: AppData) => void
  resetData: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const usesAsyncDesktopLoad = Boolean(window.neoAnkiDesktop?.loadDataAsync)
  const [initialLoad] = useState(() => usesAsyncDesktopLoad ? { ok: true as const, data: createEmptyWorkspaceData() } : loadWorkspaceData())
  const [data, setRenderedData] = useState<AppData>(() => initialLoad.ok ? initialLoad.data : createEmptyWorkspaceData())
  const [workspaceLoading, setWorkspaceLoading] = useState(usesAsyncDesktopLoad)
  const [workspaceLoadFailure, setWorkspaceLoadFailure] = useState<WorkspaceLoadFailure | null>(() => initialLoad.ok ? null : initialLoad.failure)
  const dataRef = useRef(data)
  const setData = useCallback((update: SetStateAction<AppData>) => {
    const next = typeof update === 'function' ? update(dataRef.current) : update
    dataRef.current = next
    setRenderedData(next)
  }, [])
  const [route, setRoute] = useState<Route>(() => safeRouteFromLocation())
  const [activeSession, setActiveSession] = useState<StudySession | null>(null)
  const [persistenceError, setPersistenceError] = useState('')
  const [persistenceState, setPersistenceState] = useState<'saving' | 'saved' | 'failed'>('saved')
  const [extensionSignalRevision, setExtensionSignalRevision] = useState(0)
  const [backgroundPlan, setBackgroundPlan] = useState<{ key: string; plan: DailyPlan } | null>(null)
  const [plannerFailure, setPlannerFailure] = useState<{ key: string; message: string } | null>(null)
  const [plannerAttempt, setPlannerAttempt] = useState(0)
  const corePatchQueue = useRef<Promise<void>>(Promise.resolve())
  const persistenceAttempt = useRef(0)
  const explicitPersistenceInFlight = useRef(0)
  const skipPassiveSaveFor = useRef<AppData | null>(null)

  useEffect(() => {
    if (workspaceLoading || workspaceLoadFailure) return
    if (explicitPersistenceInFlight.current > 0) return
    // An explicitly awaited mutation can advance dataRef before React runs an
    // older render's passive effect. Never let that stale render enqueue a
    // regressive desktop snapshot after the newer mutation has committed.
    if (dataRef.current !== data) return
    // An explicitly awaited mutation already reported this rollback as a
    // failure. Do not let the passive effect immediately relabel it "saved"
    // merely because the restored snapshot is already durable.
    if (skipPassiveSaveFor.current === data) {
      skipPassiveSaveFor.current = null
      return
    }
    const attempt = ++persistenceAttempt.current
    let current = true
    queueMicrotask(() => { if (current && persistenceAttempt.current === attempt) setPersistenceState('saving') })
    void saveData(data).then(() => {
      if (current && persistenceAttempt.current === attempt) { setPersistenceError(''); setPersistenceState('saved') }
    }).catch((error) => {
      if (current && persistenceAttempt.current === attempt) {
        setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not save your latest changes.')
        setPersistenceState('failed')
      }
    })
    return () => { current = false }
  }, [data, workspaceLoadFailure, workspaceLoading])

  useEffect(() => {
    const restoreRoute = () => setRoute(safeRouteFromLocation())
    window.addEventListener('popstate', restoreRoute)
    window.addEventListener('hashchange', restoreRoute)
    return () => { window.removeEventListener('popstate', restoreRoute); window.removeEventListener('hashchange', restoreRoute) }
  }, [])

  const retryPersistence = useCallback(async () => {
    const attempt = ++persistenceAttempt.current
    setPersistenceState('saving')
    try {
      await saveData(dataRef.current)
      if (persistenceAttempt.current !== attempt) return
      setPersistenceError('')
      setPersistenceState('saved')
    } catch (error) {
      if (persistenceAttempt.current !== attempt) return
      setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not save your latest changes.')
      setPersistenceState('failed')
    }
  }, [])

  const applyWorkspaceLoad = useCallback((result: ReturnType<typeof loadWorkspaceData>) => {
    if (!result.ok) { setWorkspaceLoadFailure(result.failure); return }
    dataRef.current = result.data
    setRenderedData(result.data)
    setWorkspaceLoadFailure(null)
  }, [])

  useEffect(() => {
    if (!usesAsyncDesktopLoad) return
    let current = true
    void reloadWorkspaceData()
      .then((result) => { if (current) applyWorkspaceLoad(result) })
      .catch((error) => {
        if (!current) return
        setWorkspaceLoadFailure({ code: 'read', message: error instanceof Error ? error.message : 'Neo Anki could not load the workspace.', mode: 'desktop', canExportOriginal: true })
      })
      .finally(() => { if (current) setWorkspaceLoading(false) })
    return () => { current = false }
  }, [applyWorkspaceLoad, usesAsyncDesktopLoad])

  const retryWorkspaceLoad = useCallback(() => applyWorkspaceLoad(loadWorkspaceData()), [applyWorkspaceLoad])
  const exportWorkspaceRecoverySource = useCallback(() => exportRecoverySource(), [])
  const startEmptyAfterRecovery = useCallback(async () => {
    if (!window.neoAnkiDesktop) {
      const exported = await exportRecoverySource()
      if (exported.canceled) return
    }
    await clearStoredData()
    window.location.reload()
  }, [])

  useEffect(() => {
    const update = (event: Event) => { const next = (event as CustomEvent<AppData>).detail; adoptTrustedDesktopData(next); setData(next) }
    const reload = () => { void reloadWorkspaceData().then(applyWorkspaceLoad).catch((error) => setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not refresh the imported workspace.')) }
    window.addEventListener('neo-anki:workspace-updated-v4', update)
    window.addEventListener('neo-anki:workspace-reload-requested', reload)
    const extensionsReady = () => setExtensionSignalRevision((value) => value + 1)
    window.addEventListener('neo-anki:extensions-ready', extensionsReady)
    return () => { window.removeEventListener('neo-anki:workspace-updated-v4', update); window.removeEventListener('neo-anki:workspace-reload-requested', reload); window.removeEventListener('neo-anki:extensions-ready', extensionsReady) }
  }, [applyWorkspaceLoad, setData])

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme
    localStorage.setItem('neo-anki:last-theme', data.settings.theme)
  }, [data.settings.theme])

  useEffect(() => {
    if (workspaceLoading || workspaceLoadFailure) return
    let current = true
    void refreshExtensionPlanningSignalsV2(data).then(() => { if (current) setExtensionSignalRevision((value) => value + 1) }).catch((error) => extensionRuntime.reportDiagnostic('extension-host-v2', 'planning-signals', error))
    return () => { current = false }
  }, [data, workspaceLoadFailure, workspaceLoading])

  const directPlan = useMemo(
    () => { void extensionSignalRevision; return data.cards.length < LARGE_PLANNER_CARD_THRESHOLD ? buildDailyPlan(data.cards, data.reviews, data.settings, new Date(), data.items, {
      signalsFor: (item) => planningSignalsForItemV2(item),
      scoreQueuePolicy: (strategy, candidate) => scoreQueuePolicyV2(strategy, candidate.card.id) ?? null,
    }) : null },
    [data, extensionSignalRevision],
  )
  const planKey = `${data.updatedAt}:${data.cards.length}:${data.reviews.length}:${extensionSignalRevision}`
  const fallbackPlan = useMemo(() => buildDailyPlan([], [...data.reviews].sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) || left.id.localeCompare(right.id)).slice(-100), data.settings, new Date()), [data.reviews, data.settings])
  const plan = directPlan || (backgroundPlan?.key === planKey ? backgroundPlan.plan : fallbackPlan)
  const planningError = plannerFailure?.key === planKey ? plannerFailure.message : ''
  const planning = !directPlan && backgroundPlan?.key !== planKey && !planningError
  const retryPlanning = useCallback(() => { setPlannerFailure(null); setPlannerAttempt((value) => value + 1) }, [])

  useEffect(() => {
    if (workspaceLoading || directPlan) return
    const controller = new AbortController()
    const now = new Date()
    void prepareLargePlannerInput(data, now, controller.signal)
      .then((prepared) => buildDailyPlanInWorker({ requestId: crypto.randomUUID(), now: now.toISOString(), cards: data.cards, reviews: prepared.reviews, settings: data.settings, items: data.items, signalsByItem: prepared.signalsByItem, queueScoresByCard: prepared.queueScoresByCard }, controller.signal))
      .then((next) => { if (!controller.signal.aborted) { setPlannerFailure(null); setBackgroundPlan({ key: planKey, plan: next }) } })
      .catch((error) => {
        if ((error as { name?: string }).name === 'AbortError') return
        const message = error instanceof Error ? error.message : 'The background planner failed.'
        setPlannerFailure({ key: planKey, message })
        extensionRuntime.reportDiagnostic('core.planner', 'background-plan', error)
      })
    return () => controller.abort()
  }, [data, directPlan, planKey, plannerAttempt, workspaceLoading])

  const navigate = (next: Route) => {
    if (!window.dispatchEvent(new CustomEvent('neo-anki:before-navigate', { cancelable: true, detail: { route: next } }))) return
    setRoute(next)
    const hash = `#/${encodeURIComponent(next)}`
    if (window.location.hash !== hash) window.history.pushState({ route: next }, '', hash)
    scrollToTop()
  }

  const startSession = useCallback((request: SessionRequest) => {
    const session = buildStudySession(plan, data.items, request)
    if (!session.queue.length) return
    setActiveSession(session)
    setRoute('review')
    window.history.pushState({ route: 'review' }, '', '#/review')
    scrollToTop()
  }, [data.items, plan])

  const startCustomSession = useCallback((cardIds: string[], reschedule: boolean) => {
    const selected = new Set(cardIds)
    const session = buildCustomStudySession(data.cards.filter((card) => selected.has(card.id)), data.items, reschedule)
    if (!session.queue.length) return
    setActiveSession(session); setRoute('review'); window.history.pushState({ route: 'review' }, '', '#/review'); scrollToTop()
  }, [data.cards, data.items])

  const endSession = () => {
    const destination = activeSession?.request.kind === 'custom' ? 'library' : 'today'
    setActiveSession(null)
    setRoute(destination)
    window.history.pushState({ route: destination }, '', `#/${destination}`)
    scrollToTop()
  }

  const setDailyMinutes = (dailyMinutes: number) => {
    setData((current) => ({ ...current, settings: { ...current.settings, dailyMinutes }, updatedAt: new Date().toISOString() }))
  }

  const setRetention = (retention: number) => {
    setData((current) => ({ ...current, settings: { ...current.settings, retention }, updatedAt: new Date().toISOString() }))
  }

  const setRecoveryStrategy = (recoveryStrategy: RecoveryStrategy) => {
    setData((current) => ({ ...current, settings: { ...current.settings, recoveryStrategy }, updatedAt: new Date().toISOString() }))
  }

  const setLearningSafeguards = (changes: Partial<Pick<AppData['settings'], 'burySiblings' | 'leechThreshold' | 'leechAction'>>) => {
    setData((current) => ({ ...current, settings: { ...current.settings, ...changes }, updatedAt: new Date().toISOString() }))
  }

  const toggleTheme = () => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, theme: current.settings.theme === 'light' ? 'dark' : 'light' },
      updatedAt: new Date().toISOString(),
    }))
  }

  const completeOnboarding = (minutes: number) => {
    const empty = createEmptyWorkspaceData()
    empty.settings = { ...empty.settings, theme: dataRef.current.settings.theme, dailyMinutes: minutes, onboardingComplete: true }
    empty.updatedAt = new Date().toISOString()
    setData(empty)
  }

  const loadDemoWorkspace = () => {
    if (dataRef.current.items.length || dataRef.current.cards.length || dataRef.current.reviews.length || dataRef.current.assets.length) return
    const demo = createDemoWorkspaceData()
    demo.settings = { ...demo.settings, ...dataRef.current.settings, onboardingComplete: true }
    demo.updatedAt = new Date().toISOString()
    setData(demo)
  }

  const addItem = async (input: CreateKnowledgeInput) => {
    const now = new Date().toISOString()
    const itemId = crypto.randomUUID()
    const item: KnowledgeItem = {
      id: itemId,
      prompt: input.prompt.trim(),
      answer: input.answer.trim(),
      context: input.context.trim(),
      collection: input.collection.trim() || 'Unsorted',
      tags: input.tags,
      citations: input.citations.map((citation) => ({ ...citation, id: crypto.randomUUID() })),
      mediaIds: input.assets.map((asset) => asset.id),
      occlusions: input.occlusions,
      contentModel: structuredClone(input.contentModel),
      createdAt: now,
      updatedAt: now,
    }
    const fieldValues = Object.fromEntries(input.contentModel.fields.map((field) => [field.id, field.value]))
    const current = dataRef.current
    const next: AppData = {
      ...current,
      items: [item, ...current.items],
      assets: [...input.assets, ...current.assets.filter((asset) => !input.assets.some((candidate) => candidate.id === asset.id))],
      cards: [
        ...input.templates.map((template) => ({
          id: crypto.randomUUID(),
          itemId,
          variant: template.responseMode === 'type' ? 'typed' : 'forward',
          suspended: false,
          flags: 0 as const,
          fsrs: makeEmptyFSRSCard(),
          rendering: renderCardFields(template, fieldValues, input.contentModel.fields.map((field) => ({ id: field.id, name: field.name }))),
          estimatedSeconds: 14,
          createdAt: now,
          updatedAt: now,
        })),
        ...current.cards,
      ],
      updatedAt: now,
    }
    skipPassiveSaveFor.current = next
    const attempt = ++persistenceAttempt.current
    explicitPersistenceInFlight.current += 1
    setData(next)
    setPersistenceState('saving')
    try {
      await saveData(next)
      explicitPersistenceInFlight.current -= 1
      if (persistenceAttempt.current !== attempt) return itemId
      setPersistenceError('')
      setPersistenceState('saved')
    } catch (error) {
      explicitPersistenceInFlight.current -= 1
      if (persistenceAttempt.current !== attempt) throw error
      dataRef.current = current
      skipPassiveSaveFor.current = current
      setRenderedData(current)
      persistenceAttempt.current += 1
      setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not save this knowledge item.')
      setPersistenceState('failed')
      throw error
    }
    return itemId
  }

  const updateItem: AppContextValue['updateItem'] = async (id, changes) => {
    const updatedAt = new Date().toISOString()
    const currentItem = dataRef.current.items.find((item) => item.id === id)
    if (!currentItem) throw new Error('This knowledge item no longer exists.')
    const updatedItem = { ...currentItem, ...changes, updatedAt }
    const fieldValues = updatedItem?.contentModel ? Object.fromEntries(updatedItem.contentModel.fields.map((field) => [field.id, field.value])) : null
    const fieldDefinitions = updatedItem?.contentModel?.fields.map((field) => ({ id: field.id, name: field.name })) || []
    const next = {
      ...dataRef.current,
      items: dataRef.current.items.map((item) => item.id === id ? updatedItem : item),
      cards: dataRef.current.cards.map((card) => {
        if (card.itemId !== id || !card.rendering || !fieldValues) return card
        return {
          ...card,
          rendering: renderCardFields({
            id: card.rendering.templateId,
            name: card.rendering.templateName,
            promptFieldId: card.rendering.prompt.id,
            answerFieldId: card.rendering.answer.id,
            supportingFieldIds: card.rendering.supporting.map((field) => field.id),
            responseMode: card.rendering.responseMode,
          }, fieldValues, fieldDefinitions),
          updatedAt,
        }
      }),
      updatedAt,
    }
    skipPassiveSaveFor.current = next
    const attempt = ++persistenceAttempt.current
    explicitPersistenceInFlight.current += 1
    setData(next)
    setPersistenceState('saving')
    try {
      await saveData(next)
      explicitPersistenceInFlight.current -= 1
      if (persistenceAttempt.current !== attempt) return
      setPersistenceError('')
      setPersistenceState('saved')
    } catch (error) {
      explicitPersistenceInFlight.current -= 1
      if (persistenceAttempt.current !== attempt) throw error
      persistenceAttempt.current += 1
      setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not save your latest changes.')
      setPersistenceState('failed')
      throw error
    }
  }

  const updateItemsBulk: AppContextValue['updateItemsBulk'] = (ids, changes) => {
    const selected = new Set(ids)
    setData((current) => {
      const updatedAt = new Date().toISOString()
      const add = new Set((changes.addTags || []).map((tag) => tag.trim()).filter(Boolean))
      const remove = new Set((changes.removeTags || []).map((tag) => tag.trim()).filter(Boolean))
      return {
        ...current,
        items: current.items.map((item) => {
          if (!selected.has(item.id)) return item
          const tags = [...new Set([...item.tags.filter((tag) => !remove.has(tag)), ...add])].sort((left, right) => left.localeCompare(right))
          return { ...item, collection: changes.collection?.trim() || item.collection, tags, updatedAt }
        }),
        updatedAt,
      }
    })
  }

  const deleteItem = (id: string) => {
    setData((current) => {
      const item = current.items.find((candidate) => candidate.id === id)
      if (!item) return current
      const cards = current.cards.filter((card) => card.itemId === id)
      const deletedAt = new Date().toISOString()
      return {
        ...current,
        items: current.items.filter((item) => item.id !== id),
        cards: current.cards.filter((card) => card.itemId !== id),
        trash: [{ id, item, cards, deletedAt }, ...current.trash.filter((entry) => entry.id !== id)],
        updatedAt: deletedAt,
      }
    })
  }

  const deleteItems = (ids: string[]) => {
    const selected = new Set(ids)
    setData((current) => {
      const deletedAt = new Date().toISOString()
      const entries = current.items.filter((item) => selected.has(item.id)).map((item) => ({ id: item.id, item, cards: current.cards.filter((card) => card.itemId === item.id), deletedAt }))
      if (!entries.length) return current
      return { ...current, items: current.items.filter((item) => !selected.has(item.id)), cards: current.cards.filter((card) => !selected.has(card.itemId)), trash: [...entries, ...current.trash.filter((entry) => !selected.has(entry.id))], updatedAt: deletedAt }
    })
  }

  const restoreItem = (id: string) => {
    setData((current) => {
      const entry = current.trash.find((candidate) => candidate.id === id)
      if (!entry || current.items.some((item) => item.id === entry.item.id)) return current
      const updatedAt = new Date().toISOString()
      return { ...current, items: [entry.item, ...current.items], cards: [...entry.cards, ...current.cards], trash: current.trash.filter((candidate) => candidate.id !== id), updatedAt }
    })
  }

  const purgeItem = (id: string) => setData((current) => ({ ...current, trash: current.trash.filter((entry) => entry.id !== id), updatedAt: new Date().toISOString() }))

  const toggleSuspend = (cardId: string) => {
    setData((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === cardId ? { ...card, suspended: !card.suspended, updatedAt: new Date().toISOString() } : card),
      updatedAt: new Date().toISOString(),
    }))
  }

  const setCardsSuspended = (cardIds: string[], suspended: boolean) => {
    const selected = new Set(cardIds)
    setData((current) => {
      const updatedAt = new Date().toISOString()
      return { ...current, cards: current.cards.map((card) => selected.has(card.id) ? { ...card, suspended, updatedAt } : card), updatedAt }
    })
  }

  const setCardsBuried = (cardIds: string[], buried: boolean) => {
    const selected = new Set(cardIds)
    setData((current) => {
      const updatedAt = new Date().toISOString()
      const nextDay = new Date(updatedAt); nextDay.setHours(24, 0, 0, 0)
      return { ...current, cards: current.cards.map((card) => selected.has(card.id) ? { ...card, buriedUntil: buried ? nextDay.toISOString() : undefined, buriedBy: buried ? 'user' as const : undefined, updatedAt } : card), updatedAt }
    })
  }

  const setCardsFlag = (cardIds: string[], flag: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) => {
    const selected = new Set(cardIds)
    setData((current) => {
      const updatedAt = new Date().toISOString()
      return { ...current, cards: current.cards.map((card) => selected.has(card.id) ? { ...card, flags: flag, updatedAt } : card), updatedAt }
    })
  }

  const reviewCard = (cardId: string, rating: ReviewRating, durationSeconds: number, rawDurationSeconds = durationSeconds) => {
    setData((current) => {
      const card = current.cards.find((candidate) => candidate.id === cardId)
      if (!card) return current
      const reviewedAt = new Date()
      const reschedule = activeSession?.request.reschedule !== false
      const schedulerOptions = card.schedulerOptions || { desiredRetention: current.settings.retention, maximumIntervalDays: 36_500, learningStepsMinutes: [1, 10], relearningStepsMinutes: [10], newCardsPerDay: Number.MAX_SAFE_INTEGER, reviewsPerDay: Number.MAX_SAFE_INTEGER, buryNewSiblings: current.settings.burySiblings, buryReviewSiblings: current.settings.burySiblings, leechThreshold: current.settings.leechThreshold, leechAction: current.settings.leechAction }
      const result = reschedule ? scheduleReview(card, rating, schedulerOptions, reviewedAt) : null
      const nextCard = result ? serializeFSRSCard(result.card) : structuredClone(card.fsrs)
      const nextScheduling = {
        strategy: 'neo-fsrs' as const,
        queue: nextCard.state === 0 ? 'new' as const : nextCard.state === 1 ? 'learn' as const : nextCard.state === 3 ? 'relearn' as const : 'review' as const,
        dueAt: nextCard.due,
        stability: nextCard.stability,
        difficulty: nextCard.difficulty,
        elapsedDays: nextCard.elapsed_days,
        scheduledDays: nextCard.scheduled_days,
        reps: nextCard.reps,
        lapses: nextCard.lapses,
        state: nextCard.state,
        lastReviewAt: nextCard.last_review,
      }
      const nextLocalDay = new Date(reviewedAt)
      nextLocalDay.setHours(24, 0, 0, 0)
      const burySiblings = card.scheduling?.queue === 'new' || card.fsrs.state === 0 ? schedulerOptions.buryNewSiblings : schedulerOptions.buryReviewSiblings
      const siblingChanges = reschedule && burySiblings
        ? current.cards.filter((candidate) => candidate.itemId === card.itemId && candidate.id !== card.id && candidate.buriedUntil !== nextLocalDay.toISOString()).map((candidate) => ({ cardId: candidate.id, previousBuriedUntil: candidate.buriedUntil, previousBuriedBy: candidate.buriedBy }))
        : []
      const isLeech = reschedule && nextCard.lapses >= schedulerOptions.leechThreshold
      const event = {
        id: crypto.randomUUID(),
        deviceId: current.deviceId,
        cardId,
        rating,
        kind: reschedule ? 'review' as const : 'preview' as const,
        reviewedAt: reviewedAt.toISOString(),
        durationSeconds,
        rawDurationSeconds,
        previousDue: card.fsrs.due,
        nextDue: nextCard.due,
        previousCard: structuredClone(card.fsrs),
        previousScheduling: card.scheduling ? structuredClone(card.scheduling) : undefined,
        previousEstimatedSeconds: card.estimatedSeconds,
        previousCardState: { suspended: card.suspended, buriedUntil: card.buriedUntil, buriedBy: card.buriedBy, flags: card.flags, leech: card.leech },
        siblingChanges,
      }
      return {
        ...current,
        cards: current.cards.map((candidate) => {
          if (candidate.id === cardId) return { ...candidate, fsrs: nextCard, scheduling: reschedule ? nextScheduling : candidate.scheduling, leech: candidate.leech || isLeech, suspended: candidate.suspended || (isLeech && schedulerOptions.leechAction === 'suspend'), flags: candidate.flags || (isLeech && schedulerOptions.leechAction === 'flag' ? 1 : 0), estimatedSeconds: Math.round(candidate.estimatedSeconds * 0.7 + durationSeconds * 0.3), updatedAt: reviewedAt.toISOString() }
          if (siblingChanges.some((change) => change.cardId === candidate.id)) return { ...candidate, buriedUntil: nextLocalDay.toISOString(), buriedBy: 'scheduler' as const, updatedAt: reviewedAt.toISOString() }
          return candidate
        }),
        reviews: [...current.reviews, event],
        updatedAt: reviewedAt.toISOString(),
      }
    })
  }

  const undoLastReview = () => {
    setData((current) => {
      const reversed = new Set(current.reviews.filter((review) => review.kind === 'reversal' && review.reversesReviewId).map((review) => review.reversesReviewId!))
      let event: AppData['reviews'][number] | undefined
      const chronological = [...current.reviews].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) || right.id.localeCompare(left.id))
      for (const candidate of chronological) {
        if (candidate.deviceId && candidate.deviceId !== current.deviceId) continue
        if ((candidate.kind === 'review' || candidate.kind === 'preview' || !candidate.kind) && !reversed.has(candidate.id) && candidate.previousCard) { event = candidate; break }
      }
      if (!event?.previousCard) return current
      const updatedAt = new Date().toISOString()
      const card = current.cards.find((candidate) => candidate.id === event.cardId)
      if (!card) return current
      const reversal = {
        id: crypto.randomUUID(),
        deviceId: current.deviceId,
        cardId: event.cardId,
        rating: event.rating,
        kind: 'reversal' as const,
        reversesReviewId: event.id,
        reviewedAt: updatedAt,
        durationSeconds: 0,
        rawDurationSeconds: 0,
        previousDue: card.fsrs.due,
        nextDue: event.previousDue,
        previousCard: structuredClone(card.fsrs),
        previousScheduling: card.scheduling ? structuredClone(card.scheduling) : undefined,
        previousEstimatedSeconds: card.estimatedSeconds,
      }
      return {
        ...current,
        cards: current.cards.map((card) => {
          if (card.id === event.cardId) return { ...card, fsrs: event.previousCard!, scheduling: event.previousScheduling ? structuredClone(event.previousScheduling) : card.scheduling, estimatedSeconds: event.previousEstimatedSeconds ?? card.estimatedSeconds, suspended: event.previousCardState?.suspended ?? card.suspended, buriedUntil: event.previousCardState?.buriedUntil, buriedBy: event.previousCardState?.buriedBy, flags: event.previousCardState?.flags ?? card.flags, leech: event.previousCardState?.leech, updatedAt }
          const sibling = event.siblingChanges?.find((change) => change.cardId === card.id)
          return sibling ? { ...card, buriedUntil: sibling.previousBuriedUntil, buriedBy: sibling.previousBuriedBy, updatedAt } : card
        }),
        reviews: [...current.reviews, reversal],
        updatedAt,
      }
    })
  }

  const loadWorkspaceDocument = useCallback(async () => {
    if (window.neoAnkiDesktop) {
      await flushPendingSaves()
      return window.neoAnkiDesktop.loadWorkspaceV4Document()
    }
    return appDataToWorkspaceDocumentV4(dataRef.current)
  }, [])

  const applyCoreWorkspacePatch = useCallback((patch: WorkspacePatchV2) => {
    const task = corePatchQueue.current.catch(() => undefined).then(async () => {
      if (window.neoAnkiDesktop) {
        await flushPendingSaves()
        const result = await window.neoAnkiDesktop.applyCoreWorkspacePatchV2(patch)
        adoptPersistedData(result.data)
        setData(result.data)
        return
      }
      const previous = appDataToWorkspaceDocumentV4(dataRef.current)
      const document = createWorkspaceDocumentV4(applyWorkspacePatchV2(previous.workspace, patch), previous.clientState)
      const projected = workspaceDocumentV4ToAppData(document)
      projected.workspaceDocumentV4 = document
      const urls = new Map(dataRef.current.assets.map((asset) => [asset.id, asset.dataUrl]))
      projected.assets = projected.assets.map((asset) => ({ ...asset, dataUrl: urls.get(asset.id) || asset.dataUrl }))
      setData(projected)
    })
    corePatchQueue.current = task
    return task
  }, [setData])

  const setCardsDeck = useCallback(async (cardIds: string[], deckName: string) => {
    const document = await loadWorkspaceDocument()
    const selected = new Set(cardIds)
    const deck = document.workspace.decks.find((value) => value.name === deckName)
    if (!deck) throw new Error(`Deck “${deckName}” no longer exists. Reload Library and try again.`)
    const now = new Date().toISOString()
    const operations = document.workspace.cards.filter((card) => selected.has(card.id) && card.deckId !== deck.id).map((card) => ({
      op: 'update' as const, kind: 'card' as const, id: card.id, expectedRevision: card.revision,
      value: { ...card, deckId: deck.id, presetId: deck.presetId, revision: card.revision + 1, updatedAt: now },
    }))
    if (!operations.length) return
    await applyCoreWorkspacePatch({ version: 2, idempotencyKey: `core:move-cards:${crypto.randomUUID()}`, expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations })
  }, [applyCoreWorkspacePatch, loadWorkspaceDocument])

  const setCardsDueDate = useCallback(async (cardIds: string[], localDate: string) => {
    const target = new Date(`${localDate}T00:00:00`)
    if (!localDate || !Number.isFinite(target.getTime())) throw new Error('Choose a valid due date.')
    const document = await loadWorkspaceDocument()
    const selected = new Set(cardIds)
    const cards = document.workspace.cards.filter((card) => selected.has(card.id))
    if (cards.some((card) => card.scheduling.queue === 'new')) throw new Error('New cards use deck position rather than a due date. Select learning or review cards to reschedule.')
    const targetIso = target.toISOString(); const now = new Date().toISOString()
    const operations = cards.map((card) => {
      const scheduling = { ...card.scheduling, dueAt: targetIso, continuityOverrideDueAt: targetIso }
      return { op: 'update' as const, kind: 'card' as const, id: card.id, expectedRevision: card.revision, value: { ...card, scheduling, revision: card.revision + 1, updatedAt: now } }
    })
    if (!operations.length) return
    await applyCoreWorkspacePatch({ version: 2, idempotencyKey: `core:reschedule-cards:${crypto.randomUUID()}`, expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations })
  }, [applyCoreWorkspacePatch, loadWorkspaceDocument])
  const mergeImport: AppContextValue['mergeImport'] = async (imported) => {
    if (imported.workspaceDocumentV4 && window.neoAnkiDesktop) {
      await flushPendingSaves()
      const operation = imported.workspaceV4Operation || ((imported.workspaceDocumentV4 as { workspace?: { sourceEnvelopes?: Array<{ format?: string }> } }).workspace?.sourceEnvelopes?.some((value) => value.format === 'anki-colpkg') ? 'replace-profile' : 'additive')
      const next = await window.neoAnkiDesktop.commitWorkspaceV4Import({ document: imported.workspaceDocumentV4, media: imported.workspaceV4Media || [], sourceArchive: imported.workspaceV4SourceArchive, operation })
      adoptPersistedData(next)
      setData(next)
      return
    }
    setData((current) => mergeImportGraph(current, imported).data)
  }

  const replaceData = (nextData: AppData) => { unlockPersistence(nextData); setWorkspaceLoadFailure(null); setData(nextData) }
  const resetData = () => {
    void (async () => {
      if (!window.neoAnkiDesktop) {
        const checkpoint = await downloadBackup(dataRef.current)
        if (checkpoint.canceled) return
      }
      const empty = createEmptyWorkspaceData()
      empty.settings = { ...empty.settings, ...dataRef.current.settings, onboardingComplete: true }
      empty.updatedAt = new Date().toISOString()
      await clearStoredData()
      unlockPersistence(empty)
      setData(empty)
      await saveData(empty)
      window.location.hash = '#/today'
      window.location.reload()
    })().catch((error) => {
      setPersistenceError(error instanceof Error ? error.message : 'Neo Anki could not erase this workspace safely.')
      setPersistenceState('failed')
    })
  }

  const value: AppContextValue = {
    data,
    workspaceLoading,
    workspaceLoadFailure,
    route,
    plan,
    planning,
    planningError,
    retryPlanning,
    activeSession,
    persistenceError,
    persistenceState,
    retryPersistence,
    retryWorkspaceLoad,
    exportWorkspaceRecoverySource,
    startEmptyAfterRecovery,
    loadDemoWorkspace,
    navigate,
    startSession,
    startCustomSession,
    endSession,
    setDailyMinutes,
    setRetention,
    setRecoveryStrategy,
    setLearningSafeguards,
    toggleTheme,
    completeOnboarding,
    addItem,
    updateItem,
    updateItemsBulk,
    deleteItem,
    deleteItems,
    restoreItem,
    purgeItem,
    toggleSuspend,
    setCardsSuspended,
    setCardsBuried,
    setCardsFlag,
    setCardsDeck,
    setCardsDueDate,
    reviewCard,
    undoLastReview,
    loadWorkspaceDocument,
    applyCoreWorkspacePatch,
    mergeImport,
    replaceData,
    resetData,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
