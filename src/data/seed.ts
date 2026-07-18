import { State } from 'ts-fsrs'
import type { AppData, KnowledgeItem, LearningGoal, PracticeCard, PromptVariant, SavedView } from '../types'
import { addDays } from '../lib/date'
import { makeEmptyFSRSCard } from '../lib/fsrs'

const uid = () => crypto.randomUUID()

const examples = [
  ['What does retrieval practice strengthen?', 'The ability to recall knowledge without cues.', 'Learning science'],
  ['What are the three variables in the FSRS memory model?', 'Difficulty, stability, and retrievability.', 'Learning science'],
  ['What does “local-first” mean?', 'The local copy is primary; the network is used to synchronize it.', 'Product design'],
  ['What is the capital of Portugal?', 'Lisbon', 'General knowledge'],
  ['What is the Spanish verb “recordar”?', 'To remember', 'Spanish'],
  ['Translate “la memoria” into English.', 'Memory', 'Spanish'],
  ['What is progressive disclosure?', 'Showing complexity only when it becomes relevant.', 'Product design'],
  ['Why separate a knowledge item from its prompts?', 'One fact can generate several practice formats without duplicating the source.', 'Neo Anki'],
  ['What should happen when the daily review budget is overloaded?', 'Pause new material and prioritize the most at-risk due knowledge.', 'Neo Anki'],
  ['{{c1::Active recall}} means trying to retrieve an answer before seeing it.', 'Active recall', 'Learning science'],
  ['What is an append-only review log good for?', 'Reliable merging, auditability, and rebuilding scheduler state.', 'Engineering'],
  ['What is the purpose of a content-addressed media store?', 'Deduplication and integrity through stable file hashes.', 'Engineering'],
  ['What does HTTP status 404 mean?', 'The requested resource was not found.', 'Web fundamentals'],
  ['Which HTTP method is normally used to retrieve a resource?', 'GET', 'Web fundamentals'],
  ['What is semantic HTML?', 'Markup that communicates the meaning and structure of content.', 'Web fundamentals'],
  ['What does WCAG require for normal text contrast at level AA?', 'A contrast ratio of at least 4.5:1.', 'Accessibility'],
  ['Why should focus indicators remain visible?', 'Keyboard users need to know which control will receive input.', 'Accessibility'],
  ['What is optimistic UI?', 'Showing the expected result immediately while the operation completes.', 'Product design'],
  ['What is a database transaction?', 'A group of operations that succeeds or fails as one unit.', 'Engineering'],
  ['What property makes review events easy to merge?', 'They are immutable and append-only.', 'Neo Anki'],
  ['What happens to new material when due work exceeds the budget?', 'It is paused until the workload recovers.', 'Neo Anki'],
  ['What determines today’s new prompt count?', 'Remaining time plus the forecast cost of future reinforcement.', 'Neo Anki'],
  ['Translate “aprender” into English.', 'To learn', 'Spanish'],
  ['Translate “tiempo” into English.', 'Time', 'Spanish'],
  ['What is the capital of Finland?', 'Helsinki', 'General knowledge'],
  ['What does idempotent mean?', 'Repeating the same operation has no additional effect.', 'Engineering'],
] as const

export const createSeedData = (): AppData => {
  const now = new Date()
  const timestamp = now.toISOString()
  const items: KnowledgeItem[] = []
  const cards: PracticeCard[] = []

  examples.forEach(([prompt, answer, collection], index) => {
    const itemId = uid()
    const variant: PromptVariant = prompt.includes('{{c1::') ? 'cloze' : 'forward'
    items.push({
      id: itemId,
      prompt,
      answer,
      context: index % 3 === 0 ? 'A compact example included with Neo Anki.' : '',
      collection,
      tags: collection.toLowerCase().split(' '),
      citations: [],
      mediaIds: [],
      occlusions: [],
      createdAt: addDays(now, -20 + index).toISOString(),
      updatedAt: timestamp,
    })

    const fsrs = makeEmptyFSRSCard(addDays(now, -14 + index))
    if (index < 8) {
      fsrs.state = State.Review
      fsrs.reps = 3 + (index % 5)
      fsrs.stability = 1.5 + index * 1.2
      fsrs.difficulty = 4 + (index % 4) * 0.6
      fsrs.scheduled_days = Math.max(1, Math.round(fsrs.stability))
      fsrs.last_review = addDays(now, -Math.max(2, Math.round(fsrs.stability))).toISOString()
      fsrs.due = addDays(now, index - 5).toISOString()
    } else {
      fsrs.due = addDays(now, index - 12).toISOString()
    }
    cards.push({ id: uid(), itemId, variant, promptData: variant === 'cloze' ? { clozeOrdinal: 1 } : undefined, suspended: false, fsrs, estimatedSeconds: 12 + (index % 4) * 2, createdAt: timestamp, updatedAt: timestamp })

    if (index === 4 || index === 5) {
      cards.push({ id: uid(), itemId, variant: 'reverse', suspended: false, fsrs: makeEmptyFSRSCard(now), estimatedSeconds: 14, createdAt: timestamp, updatedAt: timestamp })
    }
  })

  const goals: LearningGoal[] = [
    {
      id: uid(),
      name: 'Conversational Spanish',
      description: 'Keep travel vocabulary ready without exceeding the daily budget.',
      filter: { query: '', collections: ['Spanish'], tags: [], states: [] },
      deadline: addDays(now, 45).toISOString().slice(0, 10),
      priority: 2,
      active: true,
      color: '#356f94',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
  const views: SavedView[] = [
    { id: uid(), name: 'Due today', filter: { query: '', collections: [], tags: [], states: ['due'] }, sort: 'due', createdAt: timestamp, updatedAt: timestamp },
    { id: uid(), name: 'Spanish', filter: { query: '', collections: ['Spanish'], tags: [], states: [] }, sort: 'updated', createdAt: timestamp, updatedAt: timestamp },
  ]

  return {
    version: 3,
    deviceId: uid(),
    items,
    cards,
    reviews: [],
    assets: [],
    goals,
    views,
    packs: [],
    packConflicts: [],
    trash: [],
    settings: {
      dailyMinutes: 30,
      retention: 0.9,
      theme: 'light',
      onboardingComplete: false,
      recoveryStrategy: 'risk',
      burySiblings: true,
      leechThreshold: 8,
      leechAction: 'flag',
    },
    updatedAt: timestamp,
  }
}
