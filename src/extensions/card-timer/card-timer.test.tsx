import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeedData } from '../../data/seed'
import { AppProvider, useApp } from '../../state/AppContext'
import { ReviewPage } from '../../pages/ReviewPage'
import { CARD_TIMER_STORAGE_KEY, CardTimerReviewTool, CardTimerSettingsPanel } from './index'
import { useEffect, useRef } from 'react'

const seed = createSeedData()
const card = seed.cards[0]
const item = seed.items.find((candidate) => candidate.id === card.itemId)!

afterEach(() => vi.useRealTimers())

describe('Card Timer extension', () => {
  it('is disabled by default', () => {
    vi.useFakeTimers()
    const submitRating = vi.fn()
    render(<CardTimerReviewTool extensionId="org.neoanki.card-timer" card={card} item={item} revealed={false} submitRating={submitRating} />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(60_000))
    expect(submitRating).not.toHaveBeenCalled()
  })

  it('lets the user enable the extension and clamps the per-card limit', async () => {
    render(<CardTimerSettingsPanel extensionId="org.neoanki.card-timer" />)
    const toggle = screen.getByRole('checkbox', { name: /disabled/i })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByLabelText('Seconds per card')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    const seconds = screen.getByLabelText('Seconds per card')
    expect(seconds).toHaveValue(20)
    fireEvent.change(seconds, { target: { value: '999' } })
    expect(seconds).toHaveValue(300)
    expect(JSON.parse(localStorage.getItem(CARD_TIMER_STORAGE_KEY)!)).toEqual({ enabled: true, seconds: 300 })
  })

  it('submits Forgot exactly once when time expires', () => {
    localStorage.setItem(CARD_TIMER_STORAGE_KEY, JSON.stringify({ enabled: true, seconds: 5 }))
    vi.useFakeTimers()
    const submitRating = vi.fn()
    render(<CardTimerReviewTool extensionId="org.neoanki.card-timer" card={card} item={item} revealed={false} submitRating={submitRating} />)
    expect(screen.getByRole('timer')).toHaveTextContent('5s')
    act(() => vi.advanceTimersByTime(5_000))
    expect(submitRating).toHaveBeenCalledTimes(1)
    expect(submitRating).toHaveBeenCalledWith(1)
    act(() => vi.advanceTimersByTime(5_000))
    expect(submitRating).toHaveBeenCalledTimes(1)
  })

  it('records Forgot and advances through the guarded review host', () => {
    localStorage.setItem(CARD_TIMER_STORAGE_KEY, JSON.stringify({ enabled: true, seconds: 5 }))
    vi.useFakeTimers()

    const SessionHarness = () => {
      const { data, startSession } = useApp()
      const started = useRef(false)
      useEffect(() => {
        if (started.current) return
        started.current = true
        startSession({ minutes: 5, intent: 'balanced' })
      }, [startSession])
      return <><output aria-label="review ratings">{data.reviews.map((review) => review.rating).join(',')}</output><ReviewPage /></>
    }

    render(<AppProvider><SessionHarness /></AppProvider>)
    expect(screen.getByRole('timer')).toHaveTextContent('5s')
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.getByLabelText('review ratings')).toHaveTextContent('1')
    expect(screen.getByRole('timer')).toHaveTextContent('5s')
  })
})
