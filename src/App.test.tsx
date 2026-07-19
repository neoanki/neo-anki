import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axe from 'axe-core'
import { App } from './App'
import { createSeedData } from './data/seed'
import { AppProvider } from './state/AppContext'
import { buildDailyPlan } from './lib/planner'
import type { PlannerWorkerPayload } from './lib/planner-worker-client'

class PlannerWorkerFixture {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(payload: PlannerWorkerPayload) {
    const signals = new Map(payload.signalsByItem); const scores = new Map(payload.queueScoresByCard)
    const plan = buildDailyPlan(payload.cards, payload.reviews, payload.settings, new Date(payload.now), payload.items, { signalsFor: (item) => signals.get(item.id) || [], scoreQueuePolicy: (_strategy, candidate) => scores.get(candidate.card.id) ?? null })
    queueMicrotask(() => this.onmessage?.({ data: { requestId: payload.requestId, ok: true, plan } } as MessageEvent))
  }
  terminate() {}
}

const renderApp = (onboarded = true) => {
  const data = createSeedData()
  data.settings.onboardingComplete = onboarded
  localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
  return render(<AppProvider><App /></AppProvider>)
}

describe('application workflows', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())
  it('onboards around time instead of a fixed new-card count', async () => {
    renderApp(false)
    expect(screen.getByRole('heading', { name: /what are you bringing/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /create a fresh workspace/i }))
    expect(screen.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /30 minutes/i }))
    await userEvent.click(screen.getByRole('button', { name: /build my first plan/i }))
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /30 min available/i })).toBeInTheDocument()
  })

  it('plans large workspaces through the cancellable background worker path', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    const item = data.items[0]; const card = data.cards.find((value) => value.itemId === item.id) || data.cards[0]
    data.items = [item]; data.cards = Array.from({ length: 5_001 }, (_, index) => ({ ...card, id: `worker-card-${index}`, itemId: item.id })); data.reviews = []
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    vi.stubGlobal('Worker', PlannerWorkerFixture)
    render(<AppProvider><App /></AppProvider>)
    expect(screen.getByText(/planning this large workspace/i)).toBeInTheDocument()
    expect(await screen.findByText(/reviews and \d+ new prompts are ready/i, {}, { timeout: 10_000 })).toBeInTheDocument()
  })

  it('creates typed knowledge and exposes it in the library', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: /new item/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Typed answer' }))
    await userEvent.type(screen.getByLabelText('Prompt or cloze sentence'), 'What is the testing pyramid?')
    await userEvent.type(screen.getByLabelText('Answer'), 'Unit, integration, and end-to-end tests')
    await userEvent.click(screen.getByRole('button', { name: /add knowledge/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/safe new-material queue/i)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(await screen.findByText('What is the testing pyramid?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'typed' })).toBeInTheDocument()
  })

  it('enables editor save only after the controlled draft has changed', async () => {
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    await userEvent.click((await screen.findAllByRole('button', { name: /^Edit / }))[0])
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Prompt'), ' updated')
    expect(save).toBeEnabled()
  })

  it('creates a learning goal from Plans', async () => {
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Plans' })[0])
    const form = (await screen.findByRole('heading', { name: 'Add learning goal' })).closest('form')!
    await userEvent.type(within(form).getByLabelText('Name'), 'Ship Phase 2')
    await userEvent.type(within(form).getByLabelText(/search terms/i), 'testing')
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Ship Phase 2')).toBeInTheDocument()
  })

  it('has no automatically detectable serious accessibility violations on Today', async () => {
    renderApp()
    const result = await axe.run(document)
    expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  })

  it('provides exact, accessible review and deck statistics alongside heuristic forecasts', async () => {
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Insights' })[0])
    expect(await screen.findByRole('heading', { name: 'Daily activity · last 30 days' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Workload and observed recall' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Due now' })).toBeInTheDocument()
    const result = await axe.run(document)
    expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  })

  it('finds duplicate prompts and broken media references from Library checks', async () => {
    const data = createSeedData()
    data.settings.onboardingComplete = true
    data.items[1].prompt = data.items[0].prompt
    data.cards[0].rendering = { questionHtml: '<img src="missing.png">', answerHtml: data.items[0].answer, css: '', source: 'neo-native' }
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    render(<AppProvider><App /></AppProvider>)
    if (screen.queryByRole('heading', { name: /what are you bringing/i })) {
      await userEvent.click(screen.getByRole('button', { name: /create a fresh workspace/i }))
      await userEvent.click(screen.getByRole('button', { name: /30 minutes/i }))
      await userEvent.click(screen.getByRole('button', { name: /build my first plan/i }))
    }
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(await screen.findByRole('option', { name: 'Duplicate prompts (2)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Missing media (1)' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Collection check'), 'duplicate')
    expect(screen.getAllByText(data.items[0].prompt)).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('Collection check'), 'media')
    expect(screen.getByText('missing media')).toBeInTheDocument()
  })
})
