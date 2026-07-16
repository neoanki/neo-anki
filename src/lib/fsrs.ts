import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import type { PracticeCard, ReviewRating, StoredFSRSCard } from '../types'

export const serializeFSRSCard = (card: Card): StoredFSRSCard => ({
  ...card,
  due: card.due.toISOString(),
  last_review: card.last_review?.toISOString(),
})

export const hydrateFSRSCard = (card: StoredFSRSCard): Card => ({
  ...card,
  due: new Date(card.due),
  last_review: card.last_review ? new Date(card.last_review) : undefined,
})

export const makeEmptyFSRSCard = (now = new Date()) => serializeFSRSCard(createEmptyCard(now))

const toFSRSRating = (rating: ReviewRating): Grade => {
  if (rating === 1) return Rating.Again
  if (rating === 2) return Rating.Hard
  return Rating.Good
}

export const scheduleReview = (
  card: PracticeCard,
  rating: ReviewRating,
  retention: number,
  now = new Date(),
) => {
  const scheduler = fsrs({
    request_retention: retention,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  })
  return scheduler.next(hydrateFSRSCard(card.fsrs), now, toFSRSRating(rating))
}

export const previewReview = (card: PracticeCard, retention: number, now = new Date()) => {
  const scheduler = fsrs({
    request_retention: retention,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  })
  const preview = scheduler.repeat(hydrateFSRSCard(card.fsrs), now)
  return {
    forgot: preview[Rating.Again].card.due,
    effort: preview[Rating.Hard].card.due,
    recalled: preview[Rating.Good].card.due,
  }
}
