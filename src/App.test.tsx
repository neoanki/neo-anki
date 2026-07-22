import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axe from 'axe-core'
import { State } from 'ts-fsrs'
import { App } from './App'
import { createEmptyWorkspaceData, createSeedData } from './data/seed'
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

class FailingPlannerWorkerFixture extends PlannerWorkerFixture {
  override postMessage(payload: PlannerWorkerPayload) {
    queueMicrotask(() => this.onmessage?.({ data: { requestId: payload.requestId, ok: false, error: 'Planner fixture failed.' } } as MessageEvent))
  }
}

const renderApp = (onboarded = true) => {
  const data = createSeedData()
  data.settings.onboardingComplete = onboarded
  localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
  return render(<AppProvider><App /></AppProvider>)
}

describe('application workflows', () => {
  beforeEach(() => { localStorage.clear(); window.location.hash = '#/today' })
  afterEach(() => { vi.unstubAllGlobals(); window.neoAnkiDesktop = undefined })
  it('paints a themed startup shell while desktop data loads asynchronously', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    let finishLoad!: (value: NeoAnkiDesktopLoadResult) => void
    const pending = new Promise<NeoAnkiDesktopLoadResult>((resolve) => { finishLoad = resolve })
    const synchronousLoad = vi.fn(() => { throw new Error('The synchronous loader must not run during startup.') })
    window.neoAnkiDesktop = {
      isDesktop: true,
      loadData: synchronousLoad,
      loadDataAsync: () => pending,
      saveData: async () => undefined,
      onNavigate: () => () => undefined,
    } as unknown as NeoAnkiDesktopBridge

    render(<AppProvider><App /></AppProvider>)
    expect(screen.getByRole('status', { name: 'Opening Neo Anki' })).toHaveTextContent('Opening your workspace…')
    expect(synchronousLoad).not.toHaveBeenCalled()

    finishLoad({ data, storagePath: '/tmp/neo-anki.sqlite', recoveredFromBackup: false })
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(synchronousLoad).not.toHaveBeenCalled()
  })

  it('onboards around time instead of a fixed new-card count', async () => {
    renderApp(false)
    expect(screen.getByRole('heading', { name: /how would you like to begin/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /start fresh/i }))
    expect(screen.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /30 minutes/i }))
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }))
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /add something you want to remember/i })).toBeInTheDocument()
  })

  it('blocks editing and autosave when stored browser data is unreadable', async () => {
    localStorage.setItem('neo-anki:data:v1', '{unreadable')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(<AppProvider><App /></AppProvider>)

    expect(screen.getByRole('heading', { name: 'Your workspace needs attention.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export original data' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start empty' })).toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(write).not.toHaveBeenCalled()
  })

  it('blocks desktop autosave and exposes every recovery action after a preserved-source failure', async () => {
    const saveData = vi.fn(async () => undefined)
    window.neoAnkiDesktop = {
      isDesktop: true,
      loadData: () => ({
        data: null,
        storagePath: '/tmp/neo-anki.sqlite',
        recoveredFromBackup: false,
        error: 'The workspace database could not be opened. 2 automatic backups are available for explicit restore.',
        recoverySourcePath: '/tmp/neo-anki.corrupt.sqlite',
      }),
      saveData,
      exportRecoverySource: async () => ({ canceled: false, path: '/tmp/exported-recovery.sqlite' }),
      onNavigate: () => () => undefined,
    } as unknown as NeoAnkiDesktopBridge

    render(<AppProvider><App /></AppProvider>)

    expect(screen.getByRole('heading', { name: 'Your workspace needs attention.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export original data' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start empty' })).toBeEnabled()
    expect(screen.getByText('/tmp/neo-anki.corrupt.sqlite', { exact: false })).toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(saveData).not.toHaveBeenCalled()
  })

  it('plans large workspaces through the cancellable background worker path', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    const item = data.items[0]; const card = data.cards.find((value) => value.itemId === item.id) || data.cards[0]
    data.items = [item]; data.cards = Array.from({ length: 5_001 }, (_, index) => ({ ...card, id: `worker-card-${index}`, itemId: item.id })); data.reviews = []
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    vi.stubGlobal('Worker', PlannerWorkerFixture)
    render(<AppProvider><App /></AppProvider>)
    expect(screen.getByText(/planning this large workspace/i)).toBeInTheDocument()
    expect(screen.getByText(/building your session/i)).toBeInTheDocument()
    expect(screen.queryByText(/No practice prompts match/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/reviews are ready, with \d+ new practice prompts/i, {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByLabelText('Study for')).toHaveValue('10')
    expect(screen.getByRole('button', { name: /^Study / })).toBeEnabled()
    expect(screen.queryByText(/No practice prompts match/i)).not.toBeInTheDocument()
  })

  it('surfaces background planner failures with a recovery action', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    const item = data.items[0]; const card = data.cards.find((value) => value.itemId === item.id) || data.cards[0]
    data.items = [item]; data.cards = Array.from({ length: 5_001 }, (_, index) => ({ ...card, id: `failing-worker-card-${index}`, itemId: item.id })); data.reviews = []
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    vi.stubGlobal('Worker', FailingPlannerWorkerFixture)
    render(<AppProvider><App /></AppProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Planner fixture failed.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.queryByText(/No practice prompts match/i)).not.toBeInTheDocument()
  })

  it('creates basic knowledge and exposes it in the library', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: /new item/i }))
    await userEvent.type(await screen.findByLabelText('Prompt'), 'What is the testing pyramid?')
    await userEvent.type(screen.getByLabelText('Answer'), 'Unit, integration, and end-to-end tests')
    await userEvent.click(screen.getByRole('button', { name: 'Add knowledge item' }))
    expect(screen.getByRole('status')).toHaveTextContent(/safe new-material queue/i)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    const row = (await screen.findByText('What is the testing pyramid?')).closest('article')!
    expect(within(row).getByRole('button', { name: 'Basic' })).toBeInTheDocument()
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

  it('edits Neo Basic with product terminology while preserving named custom models and field synchronization', async () => {
    const data = createSeedData()
    data.settings.onboardingComplete = true
    const core = data.items[0]
    const custom = data.items[1]
    core.noteModel = {
      noteTypeId: 'note-type:neo-basic',
      noteTypeName: 'Neo Basic',
      fields: [
        { id: 'field:front', name: 'Front', ordinal: 0, value: core.prompt },
        { id: 'field:back', name: 'Back', ordinal: 1, value: core.answer },
        { id: 'field:context', name: 'Context', ordinal: 2, value: core.context },
      ],
    }
    custom.noteModel = {
      noteTypeId: 'note-type:imported-custom',
      noteTypeName: 'Imported Custom',
      fields: [
        { id: 'field:question', name: 'Question text', ordinal: 0, value: custom.prompt },
        { id: 'field:response', name: 'Expected response', ordinal: 1, value: custom.answer },
        { id: 'field:hint', name: 'Hint', ordinal: 2, value: custom.context },
      ],
    }
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    render(<AppProvider><App /></AppProvider>)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])

    await userEvent.click(screen.getByRole('button', { name: `Edit ${core.prompt}` }))
    expect(screen.getByRole('group', { name: 'Knowledge content' })).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue(core.prompt)
    expect(screen.getByLabelText('Answer')).toHaveValue(core.answer)
    expect(screen.getByRole('textbox', { name: 'Context' })).toHaveValue(core.context)
    expect(screen.queryByLabelText('Front')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Prompt'))
    await userEvent.type(screen.getByLabelText('Prompt'), 'Edited product prompt')
    await userEvent.clear(screen.getByLabelText('Answer'))
    await userEvent.type(screen.getByLabelText('Answer'), 'Edited product answer')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Context' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Context' }), 'Edited optional context')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit content' })).not.toBeInTheDocument())
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('neo-anki:data:v1') || '{}') as typeof data
      const item = stored.items.find((candidate) => candidate.id === core.id)!
      expect(item).toMatchObject({ prompt: 'Edited product prompt', answer: 'Edited product answer', context: 'Edited optional context' })
      expect(item.noteModel?.fields.map((field) => field.value)).toEqual(['Edited product prompt', 'Edited product answer', 'Edited optional context'])
    })

    await userEvent.click(screen.getByRole('button', { name: `Edit ${custom.prompt}` }))
    expect(screen.getByRole('group', { name: 'Named fields · Imported Custom' })).toBeInTheDocument()
    expect(screen.getByLabelText('Question text')).toHaveValue(custom.prompt)
    expect(screen.getByLabelText('Expected response')).toHaveValue(custom.answer)
    expect(screen.getByLabelText('Hint')).toHaveValue(custom.context)
    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument()
  })

  it('keeps desktop edits open until their exact snapshot is durably saved', async () => {
    const data = createSeedData()
    data.settings.onboardingComplete = true
    const saved: Array<{ upsert: { items: Array<{ prompt: string }> } }> = []
    let releaseSave!: () => void
    const blockedSave = new Promise<void>((resolve) => { releaseSave = resolve })
    window.neoAnkiDesktop = {
      isDesktop: true,
      loadData: () => ({ data, storagePath: '/tmp/neo-anki-data.json', recoveredFromBackup: false }),
      saveData: async (changes: Parameters<NeoAnkiDesktopBridge['saveData']>[0]) => {
        const captured = changes as typeof saved[number]
        saved.push(captured)
        if (captured.upsert.items.length) await blockedSave
      },
      onNavigate: () => () => undefined,
    } as unknown as NeoAnkiDesktopBridge

    render(<AppProvider><App /></AppProvider>)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    await userEvent.click((await screen.findAllByRole('button', { name: /^Edit / }))[0])
    await userEvent.type(screen.getByLabelText('Prompt'), ' persisted')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('dialog', { name: 'Edit content' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close editor' })).toBeDisabled()
    await waitFor(() => expect(saved.some((changes) => changes.upsert.items.length > 0)).toBe(true))

    releaseSave()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit content' })).not.toBeInTheDocument())
    expect(saved.flatMap((changes) => changes.upsert.items)).toContainEqual(expect.objectContaining({ prompt: expect.stringContaining(' persisted') }))
  })

  it('keeps optional workspace tools out of primary navigation in a fresh core install', async () => {
    renderApp()
    expect(screen.queryByRole('button', { name: 'Plans' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Extensions' }).length).toBeGreaterThan(0)
  })

  it('distinguishes caught-up Today from an empty workspace and shows the next due time', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    data.cards = data.cards.map((card) => ({ ...card, suspended: false, buriedUntil: undefined, fsrs: { ...card.fsrs, state: State.Review, due: tomorrow } }))
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    render(<AppProvider><App /></AppProvider>)
    expect(await screen.findByRole('heading', { name: 'You’re caught up' })).toBeInTheDocument()
    expect(screen.getByText(/next practice prompt is due/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add knowledge item/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse extensions/i })).toBeInTheDocument()
  })

  it('identifies a session filter that excludes otherwise available practice', async () => {
    const data = createSeedData(); data.settings.onboardingComplete = true
    const card = data.cards.find((candidate) => candidate.fsrs.state === State.New) || data.cards[0]
    const item = data.items.find((candidate) => candidate.id === card.itemId)!
    data.items = [item]
    data.cards = [{ ...card, suspended: false, buriedUntil: undefined, fsrs: { ...card.fsrs, state: State.New, due: new Date().toISOString() } }]
    data.reviews = []
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
    render(<AppProvider><App /></AppProvider>)
    await userEvent.selectOptions(await screen.findByLabelText('Mode'), 'urgent')
    expect(screen.getByText(/No practice prompts match “Reviews only.”/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset session settings' })).toBeInTheDocument()
  })

  it('separates an empty Library from a filtered Library', async () => {
    const empty = createEmptyWorkspaceData(); empty.settings.onboardingComplete = true
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(empty))
    const first = render(<AppProvider><App /></AppProvider>)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(screen.getByRole('heading', { name: 'Your Library is empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your first knowledge item' })).toBeInTheDocument()
    first.unmount()

    localStorage.clear(); renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    await userEvent.type(screen.getByLabelText('Search knowledge'), 'no result can match this')
    expect(screen.getByRole('heading', { name: 'No matching knowledge items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('has no automatically detectable serious accessibility violations on Today', async () => {
    renderApp()
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
