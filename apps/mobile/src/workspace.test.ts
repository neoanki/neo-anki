import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { addBasicNote, createEmptyWorkspace, dueCards, reviewCard, undoLastReview } from './workspace'

describe('mobile Workspace v4 study behavior', () => {
  it('enforces preset daily limits while retaining exact learning priority', () => {
    let document = createEmptyWorkspace()
    document.workspace.presets[0]!.newCardsPerDay = 1
    document = addBasicNote(document, 'one', '1')
    document = addBasicNote(document, 'two', '2')
    document = addBasicNote(document, 'three', '3')
    expect(dueCards(document).filter((card) => card.scheduling.queue === 'new')).toHaveLength(1)
    const learning = document.workspace.cards[1]!
    learning.scheduling = { strategy: 'neo-fsrs', queue: 'learn', dueAt: new Date(Date.now() - 1_000).toISOString(), stability: 0.1, difficulty: 5, elapsedDays: 0, scheduledDays: 0, reps: 1, lapses: 0, state: State.Learning }
    expect(dueCards(document)[0]!.id).toBe(learning.id)
  })

  it('buries siblings, flags a leech, records exact state, and reverses the review append-only', () => {
    const document = addBasicNote(createEmptyWorkspace(), 'front', 'back')
    const card = document.workspace.cards[0]!
    card.scheduling = { strategy: 'neo-fsrs', queue: 'review', dueAt: new Date(Date.now() - 1_000).toISOString(), stability: 1, difficulty: 5, elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, state: State.Review }
    document.workspace.presets[0]!.leechThreshold = 1; document.workspace.presets[0]!.leechAction = 'flag'; document.workspace.presets[0]!.buryReviewSiblings = true
    document.workspace.cards.push({ ...structuredClone(card), id: 'sibling-card', revision: 1 })
    const reviewed = reviewCard(document, card.id, 1, 1_200)
    expect(reviewed.workspace.cards.find((value) => value.id === card.id)).toMatchObject({ leech: true, flags: 1 })
    expect(reviewed.workspace.cards.find((value) => value.id === 'sibling-card')?.buriedBy).toBe('scheduler')
    expect(reviewed.workspace.reviews.at(-1)).toMatchObject({ kind: 'review', previousScheduling: { strategy: 'neo-fsrs' }, siblingChanges: [{ cardId: 'sibling-card' }] })
    const undone = undoLastReview(reviewed)
    expect(undone.workspace.cards.find((value) => value.id === card.id)).toMatchObject({ leech: false, flags: 0 })
    expect(undone.workspace.cards.find((value) => value.id === 'sibling-card')?.buriedUntil).toBeUndefined()
    expect(undone.workspace.reviews.at(-1)).toMatchObject({ kind: 'reversal', reversesReviewId: reviewed.workspace.reviews.at(-1)?.id })
  })

  it('uses imported Anki memory/history for the first Neo transition without changing initial eligibility', () => {
    const document = addBasicNote(createEmptyWorkspace(), 'imported', 'answer')
    const card = document.workspace.cards[0]!; const dueAt = new Date(Date.now() - 1_000).toISOString()
    card.scheduling = { strategy: 'anki', queue: 'review', due: 10, dueAt, intervalDays: 10, easeFactor: 2500, repetitions: 3, lapses: 0, remainingSteps: 0, mod: 1 }
    document.workspace.reviews.push({ id: 'anki-review', revision: 1, createdAt: new Date(Date.now() - 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 86_400_000).toISOString(), profileId: card.profileId, cardId: card.id, kind: 'review', rating: 3, reviewedAt: new Date(Date.now() - 86_400_000).toISOString(), durationMilliseconds: 500, intervalBefore: 5, intervalAfter: 10, scheduler: 'anki' })
    expect(dueCards(document)[0]!.scheduling).toMatchObject({ strategy: 'anki', dueAt })
    const reviewed = reviewCard(document, card.id, 3, 900)
    expect(reviewed.workspace.reviews.at(-1)?.previousScheduling).toMatchObject({ strategy: 'anki', dueAt })
    expect(reviewed.workspace.cards[0]!.scheduling.strategy).toBe('neo-fsrs')
  })
})
