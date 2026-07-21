import { createEmptyCard, fsrs, Rating, type Card, type Grade, type Steps } from 'ts-fsrs'
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
  if (rating === 3) return Rating.Good
  return Rating.Easy
}

export const scheduleReview = (
  card: PracticeCard,
  rating: ReviewRating,
  options: number | NonNullable<PracticeCard['schedulerOptions']>,
  now = new Date(),
) => {
  const retention = typeof options === 'number' ? options : options.desiredRetention
  const scheduler = fsrs({
    request_retention: retention,
    maximum_interval: typeof options === 'number' ? 36_500 : options.maximumIntervalDays,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: (typeof options === 'number' ? [1, 10] : options.learningStepsMinutes).map((value) => `${value}m`) as Steps,
    relearning_steps: (typeof options === 'number' ? [10] : options.relearningStepsMinutes).map((value) => `${value}m`) as Steps,
  })
  return scheduler.next(hydrateFSRSCard(card.fsrs), now, toFSRSRating(rating))
}

export const previewReview = (
  card: PracticeCard,
  options: number | NonNullable<PracticeCard['schedulerOptions']>,
  now = new Date(),
) => {
  const retention = typeof options === 'number' ? options : options.desiredRetention
  const scheduler = fsrs({
    request_retention: retention,
    maximum_interval: typeof options === 'number' ? 36_500 : options.maximumIntervalDays,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: (typeof options === 'number' ? [1, 10] : options.learningStepsMinutes).map((value) => `${value}m`) as Steps,
    relearning_steps: (typeof options === 'number' ? [10] : options.relearningStepsMinutes).map((value) => `${value}m`) as Steps,
  })
  const preview = scheduler.repeat(hydrateFSRSCard(card.fsrs), now)
  return {
    forgot: preview[Rating.Again].card.due,
    effort: preview[Rating.Hard].card.due,
    recalled: preview[Rating.Good].card.due,
    easy: preview[Rating.Easy].card.due,
  }
}
