import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppProvider, useApp } from './AppContext'

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

describe('workspace safety actions', () => {
  it('restores exact scheduling after review undo and preserves trashed content', async () => {
    render(<AppProvider><SafetyProbe /></AppProvider>)
    const initialCounts = screen.getByLabelText('counts').textContent
    const initialDue = screen.getByLabelText('due').textContent

    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:1:0$/)
    expect(screen.getByLabelText('due').textContent).not.toBe(initialDue)
    await userEvent.click(screen.getByRole('button', { name: 'Undo review' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(initialCounts!)
    expect(screen.getByLabelText('due')).toHaveTextContent(initialDue!)

    await userEvent.click(screen.getByRole('button', { name: 'Trash' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(/:0:1$/)
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(screen.getByLabelText('counts')).toHaveTextContent(initialCounts!)
    expect(screen.getByLabelText('due')).toHaveTextContent(initialDue!)
  })
})
