import { describe, expect, it } from 'vitest'
import { createDemoWorkspaceData } from '../data/seed'
import { parseWorkspaceData } from './workspace-schema'

const deterministicRandom = (initialSeed: number) => {
  let state = initialSeed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

const invalidMutations: Array<(value: ReturnType<typeof createDemoWorkspaceData>, suffix: string) => void> = [
  (value) => { value.items.push(structuredClone(value.items[0])) },
  (value) => { value.cards.push(structuredClone(value.cards[0])) },
  (value, suffix) => { value.cards[0].itemId = `missing-item-${suffix}` },
  (value, suffix) => { value.items[0].mediaIds = [`missing-media-${suffix}`] },
  (value, suffix) => { value.items[0].citations = [{ id: `citation-${suffix}`, title: 'One' }, { id: `citation-${suffix}`, title: 'Two' }] },
  (value, suffix) => { value.items[0].occlusions = [{ id: `occlusion-${suffix}`, x: 0.9, y: 0.9, width: 0.2, height: 0.2 }] },
  (value) => { value.cards[0].fsrs.stability = -1 },
  (value) => { value.settings.dailyMinutes = Number.NaN },
]

describe('adversarial workspace contracts', () => {
  it('rejects seeded graph, boundary, and non-finite mutations deterministically', () => {
    const cases = Math.max(1, Number.parseInt(process.env.NEO_ANKI_QA_CASES || '128', 10) || 128)
    for (let seed = 1; seed <= cases; seed += 1) {
      const random = deterministicRandom(seed)
      const value = createDemoWorkspaceData()
      const mutation = invalidMutations[Math.floor(random() * invalidMutations.length)]
      mutation(value, String(seed))
      expect(() => parseWorkspaceData(value), `seed ${seed}`).toThrow(/invalid/i)
    }
  })

  it('round-trips multilingual and combining content without normalization or loss', () => {
    const value = createDemoWorkspaceData()
    value.items[0].prompt = 'Що означає 記憶? 🧠 — café — مرحبًا'
    value.items[0].answer = 'Пам’ять · memory · الذاكرة · e\u0301'
    value.items[0].tags = ['Українська', '日本語', 'العربية', 'emoji-🧠']
    const parsed = parseWorkspaceData(JSON.parse(JSON.stringify(value)))
    expect(parsed.items[0]).toMatchObject({ prompt: value.items[0].prompt, answer: value.items[0].answer, tags: value.items[0].tags })
  })

  it('bounds invariant diagnostics for hostile workspaces', () => {
    const value = createDemoWorkspaceData()
    value.cards = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(value.cards[0]), id: `hostile-${index}`, itemId: `missing-${index}` }))
    expect(() => parseWorkspaceData(value)).toThrow(/^Workspace invariants are invalid\.(?: [^;]+;?){1,5}$/)
  })
})
