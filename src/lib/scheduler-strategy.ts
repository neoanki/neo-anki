import { createEmptyCard, fsrs, Rating, type FSRSHistory, type Grade, type State } from 'ts-fsrs'
import type { AnkiCardScheduling, ReviewEvent, StoredFSRSCard } from '../types.js'

export interface SchedulerPresetProjection {
  desiredRetention: number
  maximumIntervalDays: number
  learningStepsMinutes: number[]
  relearningStepsMinutes: number[]
}

const rating = (value: 1 | 2 | 3 | 4): Grade => value === 1 ? Rating.Again : value === 2 ? Rating.Hard : value === 3 ? Rating.Good : Rating.Easy
const queueState = (queue: AnkiCardScheduling['queue']): State => queue === 'new' ? 0 : queue === 'learn' ? 1 : queue === 'relearn' ? 3 : 2
const stepUnits = (values: number[]) => values.filter((value) => Number.isFinite(value) && value >= 0).map((value) => `${Math.max(0, Math.round(value))}m` as const)
const due = (source: AnkiCardScheduling, fallback: string) => source.dueAt && Number.isFinite(Date.parse(source.dueAt)) ? source.dueAt : fallback
const elapsedDays = (from: string | undefined, to: string) => from && Number.isFinite(Date.parse(from)) ? Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)) : 0

/**
 * Builds the Neo study projection for an imported Anki card without changing
 * the authoritative Anki scheduling state. Native FSRS memory is used when
 * available; otherwise the immutable revlog is replayed through a pinned,
 * deterministic ts-fsrs routine. In both cases the source due instant remains
 * the initial continuity override.
 */
export const projectAnkiSchedulingToFsrs = (
  source: AnkiCardScheduling,
  reviews: ReviewEvent[],
  preset: SchedulerPresetProjection,
  fallbackDue: string,
): StoredFSRSCard => {
  const exactDue = due(source, fallbackDue)
  const state = queueState(source.queue)
  if (source.stability !== undefined && source.difficulty !== undefined && source.stability > 0 && source.difficulty >= 0 && source.difficulty <= 10) {
    return {
      due: exactDue,
      stability: source.stability,
      difficulty: source.difficulty,
      elapsed_days: elapsedDays(source.lastReviewAt, fallbackDue),
      scheduled_days: Math.max(0, source.intervalDays),
      reps: Math.max(0, source.repetitions),
      lapses: Math.max(0, source.lapses),
      state,
      learning_steps: Math.max(0, source.remainingSteps & 0xffff),
      last_review: source.lastReviewAt,
    }
  }

  const history: FSRSHistory[] = reviews
    .filter((review) => review.kind !== 'reversal' && review.kind !== 'preview' && review.scheduler === 'anki')
    .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt))
    .map((review) => ({ rating: rating(review.rating), review: review.reviewedAt }))
  if (!history.length) {
    return {
      due: exactDue,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: Math.max(0, source.intervalDays),
      reps: Math.max(0, source.repetitions),
      lapses: Math.max(0, source.lapses),
      state,
      learning_steps: Math.max(0, source.remainingSteps & 0xffff),
      last_review: source.lastReviewAt,
    }
  }

  const scheduler = fsrs({
    request_retention: source.desiredRetention || preset.desiredRetention,
    maximum_interval: Math.max(1, preset.maximumIntervalDays),
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: stepUnits(preset.learningStepsMinutes),
    relearning_steps: stepUnits(preset.relearningStepsMinutes),
  })
  const firstReview = history[0]?.review || fallbackDue
  const replayed = scheduler.reschedule(createEmptyCard(firstReview), history, { now: fallbackDue }).collections.at(-1)?.card
  if (!replayed) return { ...createEmptyCard(new Date(exactDue)), due: exactDue, last_review: undefined }
  return {
    due: exactDue,
    stability: replayed.stability,
    difficulty: replayed.difficulty,
    elapsed_days: replayed.elapsed_days,
    scheduled_days: Math.max(0, source.intervalDays || replayed.scheduled_days),
    reps: Math.max(source.repetitions, replayed.reps),
    lapses: Math.max(source.lapses, replayed.lapses),
    state,
    learning_steps: replayed.learning_steps,
    last_review: source.lastReviewAt || replayed.last_review?.toISOString(),
  }
}
