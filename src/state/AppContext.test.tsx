import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProvider, useApp } from './AppContext'
import { createSeedData } from '../data/seed'

const SafetyProbe = () => {
  const { data, reviewCard, undoLastReview, deleteItem, restoreItem } = useApp()
  const firstCard = data.cards[0]
  const firstItem = data.items[0]
  return <div>
    <output aria-label="counts">{`${data.items.length}:${data.cards.length}:${data.reviews.length}:${data.trash.length}`}</output>
    <output aria-label="due">{firstCard?.fsrs.due || data.trash[0]?.cards[0]?.fsrs.due}</output>
    <button onClick={() => reviewCard(firstCard.id, 3, 12)}>Review</button>
    <button onClick={undoLastReview}>Undo review</button>
    <button onClick={() => deleteItem(firstItem.id)}>Trash</button>
    <button onClick={() => restoreItem(data.trash[0]?.id)}>Restore</button>
  </div>
}

const PedagogyProbe = () => {
  const { data, reviewCard, undoLastReview, setLearningSafeguards } = useApp()
  const siblingItem = data.items.find((item) => data.cards.filter((card) => card.itemId === item.id).length > 1)!
  const cards = data.cards.filter((card) => card.itemId === siblingItem.id)
  return <div>
    <output aria-label="safeguards">{`${cards[0].leech === true}:${cards[0].suspended}:${cards.slice(1).filter((card) => card.buriedUntil).length}`}</output>
    <button onClick={() => setLearningSafeguards({ leechThreshold: 1, leechAction: 'flag', burySiblings: true })}>Configure</button>
    <button onClick={() => reviewCard(cards[0].id, 1, 10)}>Lapse</button>
    <button onClick={undoLastReview}>Undo lapse</button>
  </div>
}

const SchedulerProbe = () => {
  const { data, reviewCard, undoLastReview } = useApp()
  const card = data.cards[0]
  return <div>
    <output aria-label="scheduler">{card.scheduling?.strategy || 'none'}</output>
    <button onClick={() => reviewCard(card.id, 3, 8)}>Review imported card</button>
    <button onClick={undoLastReview}>Undo imported review</button>
  </div>
}

const LibraryStateProbe = () => {
  const { data, setCardsBuried, setCardsFlag } = useApp()
  const card = data.cards[0]
  return <div>
    <output aria-label="library card state">{`${card.flags || 0}:${card.buriedBy || 'none'}:${Boolean(card.buriedUntil)}`}</output>
    <button onClick={() => { setCardsFlag([card.id], 4); setCardsBuried([card.id], true) }}>Flag and bury</button>
    <button onClick={() => setCardsBuried([card.id], false)}>Unbury</button>
  </div>
}

const ImportedEditProbe = ({ imported }: { imported: ReturnType<typeof createSeedData> }) => {
  const { data, mergeImport, updateItem } = useApp()
  const importedItem = imported.items[0]
  return <div>
    <output aria-label="imported prompt">{data.items.find((item) => item.id === importedItem.id)?.prompt || 'missing'}</output>
    <button onClick={async () => {
      await mergeImport({ items: imported.items, cards: imported.cards, assets: imported.assets, workspaceDocumentV4: {}, workspaceV4Operation: 'additive' })
      await updateItem(importedItem.id, { prompt: 'Edited immediately after import' })
    }}>Import and edit</button>
  </div>
}

const CustomStudyProbe = () => {
  const { data, activeSession, startCustomSession, reviewCard } = useApp()
  const card = data.cards[0]
  return <div>
    <output aria-label="custom due">{card.fsrs.due}</output>
    <output aria-label="custom reviews">{data.reviews.length}</output>
    <output aria-label="custom mode">{activeSession?.request.reschedule === false ? 'preview' : 'normal'}</output>
    <button onClick={() => startCustomSession([card.id], false)}>Start preview</button>
    <button onClick={() => reviewCard(card.id, 3, 8)}>Grade preview</button>
  </div>
}

describe('workspace safety actions', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { window.neoAnkiDesktop = undefined })
  it('restores exact scheduling after review undo and preserves trashed content', async () => {
    render(<AppProvider><SafetyProbe /></AppProvider>)
    const initialDue = screen.getByLabelText('due').textContent

    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:1:0$/)
    expect(screen.getByLabelText('due').textContent).not.toBe(initialDue)
    await userEvent.click(screen.getByRole('button', { name: 'Undo review' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:2:0$/)
    expect(screen.getByLabelText('due')).toHaveTextContent(initialDue!)

    await userEvent.click(screen.getByRole('button', { name: 'Trash' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:2:1$/)
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:2:0$/)
    expect(screen.getByLabelText('due')).toHaveTextContent(initialDue!)
  })

  it('buries siblings, flags leeches without forced suspension, and reverses both on undo', async () => {
    render(<AppProvider><PedagogyProbe /></AppProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Configure' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lapse' }))
    expect(screen.getByLabelText('safeguards')).toHaveTextContent('true:false:1')
    await userEvent.click(screen.getByRole('button', { name: 'Undo lapse' }))
    expect(screen.getByLabelText('safeguards')).toHaveTextContent('false:false:0')
  })

  it('converts imported scheduling explicitly on review and restores it on undo', async () => {
    const source = createSeedData()
    source.cards[0].scheduling = {
      strategy: 'anki', queue: 'review', due: 100, dueAt: source.cards[0].fsrs.due,
      intervalDays: 10, easeFactor: 2500, repetitions: 4, lapses: 1,
      remainingSteps: 0, mod: 1_700_000_000, stability: 12, difficulty: 4.5,
      desiredRetention: .9, lastReviewAt: source.cards[0].fsrs.last_review,
    }
    localStorage.setItem('neo-anki:data:v1', JSON.stringify(source))
    render(<AppProvider><SchedulerProbe /></AppProvider>)
    expect(screen.getByLabelText('scheduler')).toHaveTextContent('anki')
    await userEvent.click(screen.getByRole('button', { name: 'Review imported card' }))
    expect(screen.getByLabelText('scheduler')).toHaveTextContent('neo-fsrs')
    await userEvent.click(screen.getByRole('button', { name: 'Undo imported review' }))
    expect(screen.getByLabelText('scheduler')).toHaveTextContent('anki')
  })

  it('applies explicit user-bury and flag state through Library actions', async () => {
    render(<AppProvider><LibraryStateProbe /></AppProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Flag and bury' }))
    expect(screen.getByLabelText('library card state')).toHaveTextContent('4:user:true')
    await userEvent.click(screen.getByRole('button', { name: 'Unbury' }))
    expect(screen.getByLabelText('library card state')).toHaveTextContent('4:none:false')
  })

  it('saves an edit against the newly committed desktop import before another render', async () => {
    const initial = createSeedData()
    const imported = createSeedData()
    const originalItemId = imported.items[0].id
    imported.items[0] = { ...imported.items[0], id: 'imported-item', prompt: 'Imported prompt' }
    imported.cards = imported.cards.map((card) => card.itemId === originalItemId ? { ...card, itemId: imported.items[0].id } : card)
    const saved: Array<Parameters<NeoAnkiDesktopBridge['saveData']>[0]> = []
    let persisted = initial
    window.neoAnkiDesktop = {
      isDesktop: true,
      loadData: () => ({ data: initial, storagePath: '/tmp/neo-anki-data.json', recoveredFromBackup: false }),
      saveData: async (changes: Parameters<NeoAnkiDesktopBridge['saveData']>[0]) => {
        saved.push(changes)
        const upserted = new Map(changes.upsert.items.map((item) => [item.id, item]))
        persisted = { ...persisted, items: persisted.items.map((item) => upserted.get(item.id) || item) }
      },
      commitWorkspaceV4Import: async () => { persisted = imported; return imported },
      onNavigate: () => () => undefined,
    } as unknown as NeoAnkiDesktopBridge

    render(<AppProvider><ImportedEditProbe imported={imported} /></AppProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Import and edit' }))

    await waitFor(() => expect(screen.getByLabelText('imported prompt')).toHaveTextContent('Edited immediately after import'))
    expect(saved.flatMap((changes) => changes.upsert.items)).toContainEqual(expect.objectContaining({ id: imported.items[0].id, prompt: 'Edited immediately after import' }))
    await waitFor(() => expect(persisted.items.find((item) => item.id === imported.items[0].id)?.prompt).toBe('Edited immediately after import'))
  })

  it('records custom preview practice without changing scheduling', async () => {
    render(<AppProvider><CustomStudyProbe /></AppProvider>)
    const before = screen.getByLabelText('custom due').textContent
    await userEvent.click(screen.getByRole('button', { name: 'Start preview' }))
    expect(screen.getByLabelText('custom mode')).toHaveTextContent('preview')
    await userEvent.click(screen.getByRole('button', { name: 'Grade preview' }))
    expect(screen.getByLabelText('custom due')).toHaveTextContent(before!)
    expect(screen.getByLabelText('custom reviews')).toHaveTextContent('1')
  })
})
