// @refresh reset
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppData, CreateKnowledgeInput, KnowledgeItem, LearningGoal, MediaAsset, PackManifest, PackPatch, RecoveryStrategy, ReviewRating, Route, SavedView } from '../types'
import { makeEmptyFSRSCard, scheduleReview, serializeFSRSCard } from '../lib/fsrs'
import { buildDailyPlan } from '../lib/planner'
import { loadData, saveData } from '../lib/storage'
import { createTabSyncTransport, mergeAppData } from '../lib/sync'
import { applyPackPatch, installPack, resolvePackConflict } from '../lib/packs'

interface AppContextValue {
  data: AppData
  route: Route
  plan: ReturnType<typeof buildDailyPlan>
  navigate: (route: Route) => void
  setDailyMinutes: (minutes: number) => void
  setRetention: (retention: number) => void
  setRecoveryStrategy: (strategy: RecoveryStrategy) => void
  toggleTheme: () => void
  completeOnboarding: (minutes: number) => void
  addItem: (input: CreateKnowledgeInput) => string
  updateItem: (id: string, changes: Partial<Pick<KnowledgeItem, 'prompt' | 'answer' | 'context' | 'collection' | 'tags' | 'source' | 'citations' | 'mediaIds' | 'occlusions'>>) => void
  deleteItem: (id: string) => void
  toggleSuspend: (cardId: string) => void
  reviewCard: (cardId: string, rating: ReviewRating, durationSeconds: number) => void
  upsertGoal: (goal: Omit<LearningGoal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void
  deleteGoal: (id: string) => void
  upsertView: (view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void
  deleteView: (id: string) => void
  installPackData: (manifest: PackManifest) => void
  applyPackPatchData: (patch: PackPatch) => void
  resolveConflict: (id: string, resolution: 'local' | 'upstream') => void
  mergeImport: (imported: Pick<AppData, 'items' | 'cards' | 'assets'>) => void
  replaceData: (data: AppData) => void
  resetData: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [data, setData] = useState<AppData>(() => loadData())
  const [route, setRoute] = useState<Route>('today')
  const transportRef = useRef<ReturnType<typeof createTabSyncTransport>>(null)
  const receivingRef = useRef(false)

  useEffect(() => {
    saveData(data)
    if (!receivingRef.current) transportRef.current?.publish(data)
    receivingRef.current = false
  }, [data])

  useEffect(() => {
    const transport = createTabSyncTransport()
    transportRef.current = transport
    return transport?.subscribe((remote) => {
      receivingRef.current = true
      setData((current) => mergeAppData(current, remote))
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme
  }, [data.settings.theme])

  const plan = useMemo(
    () => buildDailyPlan(data.cards, data.reviews, data.settings, new Date(), data.items, data.goals),
    [data.cards, data.reviews, data.settings, data.items, data.goals],
  )

  const navigate = (next: Route) => {
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const setDailyMinutes = (dailyMinutes: number) => {
    setData((current) => ({ ...current, settings: { ...current.settings, dailyMinutes } }))
  }

  const setRetention = (retention: number) => {
    setData((current) => ({ ...current, settings: { ...current.settings, retention } }))
  }

  const setRecoveryStrategy = (recoveryStrategy: RecoveryStrategy) => {
    setData((current) => ({ ...current, settings: { ...current.settings, recoveryStrategy } }))
  }

  const toggleTheme = () => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, theme: current.settings.theme === 'light' ? 'dark' : 'light' },
    }))
  }

  const completeOnboarding = (minutes: number) => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, dailyMinutes: minutes, onboardingComplete: true },
    }))
  }

  const addItem = (input: CreateKnowledgeInput) => {
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
      createdAt: now,
      updatedAt: now,
    }
    const variants = [...new Set(input.variants)]
    setData((current) => ({
      ...current,
      items: [item, ...current.items],
      assets: [...input.assets, ...current.assets.filter((asset) => !input.assets.some((candidate) => candidate.id === asset.id))],
      cards: [
        ...variants.flatMap((variant) => (variant === 'image-occlusion' && input.occlusions.length ? input.occlusions : [undefined]).map((occlusion) => ({
          id: crypto.randomUUID(),
          itemId,
          variant,
          occlusionId: occlusion?.id,
          suspended: false,
          fsrs: makeEmptyFSRSCard(),
          estimatedSeconds: variant === 'cloze' ? 16 : 14,
          createdAt: now,
          updatedAt: now,
        }))),
        ...current.cards,
      ],
    }))
    return itemId
  }

  const updateItem: AppContextValue['updateItem'] = (id, changes) => {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item),
    }))
  }

  const deleteItem = (id: string) => {
    setData((current) => {
      const removedCardIds = new Set(current.cards.filter((card) => card.itemId === id).map((card) => card.id))
      return {
        ...current,
        items: current.items.filter((item) => item.id !== id),
        cards: current.cards.filter((card) => card.itemId !== id),
        reviews: current.reviews.filter((review) => !removedCardIds.has(review.cardId)),
      }
    })
  }

  const toggleSuspend = (cardId: string) => {
    setData((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === cardId ? { ...card, suspended: !card.suspended, updatedAt: new Date().toISOString() } : card),
    }))
  }

  const reviewCard = (cardId: string, rating: ReviewRating, durationSeconds: number) => {
    setData((current) => {
      const card = current.cards.find((candidate) => candidate.id === cardId)
      if (!card) return current
      const reviewedAt = new Date()
      const result = scheduleReview(card, rating, current.settings.retention, reviewedAt)
      const nextCard = serializeFSRSCard(result.card)
      const event = {
        id: crypto.randomUUID(),
        cardId,
        rating,
        reviewedAt: reviewedAt.toISOString(),
        durationSeconds,
        previousDue: card.fsrs.due,
        nextDue: nextCard.due,
      }
      return {
        ...current,
        cards: current.cards.map((candidate) => candidate.id === cardId ? {
          ...candidate,
          fsrs: nextCard,
          estimatedSeconds: Math.round(candidate.estimatedSeconds * 0.7 + durationSeconds * 0.3),
          updatedAt: reviewedAt.toISOString(),
        } : candidate),
        reviews: [...current.reviews, event],
      }
    })
  }

  const upsertGoal: AppContextValue['upsertGoal'] = (goal) => setData((current) => {
    const now = new Date().toISOString()
    const existing = goal.id ? current.goals.find((candidate) => candidate.id === goal.id) : undefined
    const next: LearningGoal = { ...goal, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now }
    return { ...current, goals: existing ? current.goals.map((candidate) => candidate.id === next.id ? next : candidate) : [next, ...current.goals], updatedAt: now }
  })
  const deleteGoal = (id: string) => setData((current) => ({ ...current, goals: current.goals.filter((goal) => goal.id !== id), updatedAt: new Date().toISOString() }))
  const upsertView: AppContextValue['upsertView'] = (view) => setData((current) => {
    const now = new Date().toISOString()
    const existing = view.id ? current.views.find((candidate) => candidate.id === view.id) : undefined
    const next: SavedView = { ...view, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now }
    return { ...current, views: existing ? current.views.map((candidate) => candidate.id === next.id ? next : candidate) : [next, ...current.views], updatedAt: now }
  })
  const deleteView = (id: string) => setData((current) => ({ ...current, views: current.views.filter((view) => view.id !== id), updatedAt: new Date().toISOString() }))

  const installPackData = (manifest: PackManifest) => setData((current) => installPack(current, manifest).data)
  const applyPackPatchData = (patch: PackPatch) => setData((current) => applyPackPatch(current, patch).data)
  const resolveConflict = (id: string, resolution: 'local' | 'upstream') => setData((current) => resolvePackConflict(current, id, resolution))
  const mergeImport = (imported: Pick<AppData, 'items' | 'cards' | 'assets'>) => setData((current) => {
    const itemIds = new Set(current.items.map((item) => item.id))
    const cardIds = new Set(current.cards.map((card) => card.id))
    const assetIds = new Set(current.assets.map((asset) => asset.id))
    return {
      ...current,
      items: [...current.items, ...imported.items.filter((item) => !itemIds.has(item.id))],
      cards: [...current.cards, ...imported.cards.filter((card) => !cardIds.has(card.id))],
      assets: [...current.assets, ...imported.assets.filter((asset: MediaAsset) => !assetIds.has(asset.id))],
      updatedAt: new Date().toISOString(),
    }
  })

  const replaceData = (nextData: AppData) => setData(nextData)
  const resetData = () => {
    localStorage.clear()
    window.location.reload()
  }

  const value = useMemo<AppContextValue>(() => ({
    data,
    route,
    plan,
    navigate,
    setDailyMinutes,
    setRetention,
    setRecoveryStrategy,
    toggleTheme,
    completeOnboarding,
    addItem,
    updateItem,
    deleteItem,
    toggleSuspend,
    reviewCard,
    upsertGoal,
    deleteGoal,
    upsertView,
    deleteView,
    installPackData,
    applyPackPatchData,
    resolveConflict,
    mergeImport,
    replaceData,
    resetData,
  }), [data, route, plan])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
