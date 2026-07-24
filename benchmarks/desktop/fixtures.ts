import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { State } from 'ts-fsrs'
import { createDemoWorkspaceData, createEmptyWorkspaceData } from '../../src/data/seed'
import { makeEmptyFSRSCard } from '../../src/lib/fsrs'
import type { AppData, KnowledgeItem, PracticeCard, ReviewEvent } from '../../src/types'
import type { BenchmarkDataset } from './types'

const datasetSizes: Record<Exclude<BenchmarkDataset, 'fresh'>, { items: number; reviews: number }> = {
  small: { items: 120, reviews: 400 },
  typical: { items: 5_000, reviews: 25_000 },
  large: { items: 50_000, reviews: 100_000 },
}

const timestamp = '2020-01-02T09:00:00.000Z'
const dueTimestamp = '2020-01-01T09:00:00.000Z'

export const createBenchmarkWorkspace = (dataset: Exclude<BenchmarkDataset, 'fresh'>): AppData => {
  const size = datasetSizes[dataset]
  const seed = createDemoWorkspaceData()
  const itemTemplate = seed.items[0]
  const items: KnowledgeItem[] = Array.from({ length: size.items }, (_, index) => ({
    ...itemTemplate,
    id: `benchmark-item-${index}`,
    prompt: `Benchmark prompt ${index}: what should remain responsive?`,
    answer: `Benchmark answer ${index}`,
    context: index % 5 === 0 ? `Supporting context ${index}` : '',
    collection: `Collection ${index % 20}`,
    tags: [`tag-${index % 10}`, index % 17 === 0 ? 'quality-check' : 'benchmark'],
    citations: index % 25 === 0 ? [{ id: `citation-${index}`, title: `Source ${index}`, url: 'https://example.com/source' }] : [],
    mediaIds: [],
    occlusions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const cards: PracticeCard[] = items.map((item, index) => {
    const fsrs = makeEmptyFSRSCard(new Date(dueTimestamp))
    fsrs.state = index % 5 === 0 ? State.New : State.Review
    fsrs.reps = index % 5 === 0 ? 0 : 3 + (index % 8)
    fsrs.stability = 1 + (index % 60)
    fsrs.difficulty = 1 + (index % 9)
    fsrs.due = dueTimestamp
    return {
      id: `benchmark-card-${index}`,
      itemId: item.id,
      variant: 'forward',
      suspended: index % 101 === 0,
      flags: index % 211 === 0 ? 1 : 0,
      fsrs,
      estimatedSeconds: 12 + (index % 6),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })
  const reviews: ReviewEvent[] = Array.from({ length: size.reviews }, (_, index) => {
    const card = cards[index % cards.length]
    return {
      id: `benchmark-review-${index}`,
      deviceId: 'benchmark-device',
      cardId: card.id,
      rating: ((index % 4) + 1) as ReviewEvent['rating'],
      kind: 'review',
      reviewedAt: new Date(Date.parse(timestamp) - index * 60_000).toISOString(),
      durationSeconds: 10 + (index % 8),
      rawDurationSeconds: 10 + (index % 8),
      previousDue: dueTimestamp,
      nextDue: timestamp,
    }
  })
  const empty = createEmptyWorkspaceData()
  return {
    ...empty,
    deviceId: 'benchmark-device',
    items,
    cards,
    reviews,
    settings: { ...empty.settings, onboardingComplete: true, dailyMinutes: 30 },
    updatedAt: timestamp,
  }
}

export const prepareBenchmarkProfile = async (userData: string, dataset: BenchmarkDataset) => {
  await mkdir(userData, { recursive: true })
  if (dataset === 'fresh') return
  const workspace = createBenchmarkWorkspace(dataset)
  await writeFile(join(userData, 'neo-anki-data.json'), `${JSON.stringify(workspace)}\n`, 'utf8')
}

export const benchmarkDatasetCounts = (dataset: BenchmarkDataset) => dataset === 'fresh'
  ? { notes: 0, cards: 0, reviews: 0 }
  : {
      notes: datasetSizes[dataset].items,
      cards: datasetSizes[dataset].items,
      reviews: datasetSizes[dataset].reviews,
    }
