import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import type { CreateKnowledgeInput } from '../types'
import { ExtensionRegistry } from './registry'
import type { CoreModuleManifest, CoreModulePermission, NeoAnkiCoreModule } from './core-module'

const manifest = (id: string, permissions: CoreModulePermission[] = []): CoreModuleManifest => ({
  id,
  name: id,
  version: '1.0.0',
  runtime: 'core',
  publisher: 'Neo Anki',
  permissions,
})

const createInput = (variants: string[]): CreateKnowledgeInput => ({
  prompt: 'Question',
  answer: 'Answer',
  context: 'Context',
  collection: 'Tests',
  tags: [],
  citations: [],
  assets: [],
  occlusions: [],
  variants,
})

describe('trusted core-module registry', () => {
  it('enforces declared contribution permissions', () => {
    const registry = new ExtensionRegistry()
    const contribution: NeoAnkiCoreModule = {
      manifest: manifest('independent.prompts'),
      promptTypes: [{ id: 'independent', label: 'Independent', createCards: () => [], render: () => ({ prompt: '', answer: '', context: '', typed: false, citations: [] }) }],
    }
    expect(() => registry.register(contribution)).toThrow('without prompts:contribute')
    contribution.manifest.permissions = ['prompts:contribute']
    expect(() => registry.register(contribution)).not.toThrow()
    expect(registry.list()[0].runtime).toBe('core')
  })

  it('rejects colliding public contribution IDs across extensions', () => {
    const policy = { id: 'fastest', label: 'Fastest', score: () => 1 }
    const registry = new ExtensionRegistry([{ manifest: manifest('com.example.one', ['planning:policies']), queuePolicies: [policy] }])
    expect(() => registry.register({ manifest: manifest('com.example.two', ['planning:policies']), queuePolicies: [policy] })).toThrow('Duplicate extension contribution policy:fastest')
  })

  it('rejects malformed manifests and duplicate IDs inside one extension', () => {
    const registry = new ExtensionRegistry()
    expect(() => registry.register({ manifest: { ...manifest('invalid'), id: 'Invalid Id' } })).toThrow('manifest identity')
    expect(() => registry.register({ manifest: { ...manifest('com.example.invalid'), permissions: ['ui:pages', 'ui:pages'] } })).toThrow('invalid extension permissions')
    expect(() => registry.register({ manifest: manifest('com.example.duplicates', ['planning:policies']), queuePolicies: [{ id: 'same', label: 'One', score: () => 1 }, { id: 'same', label: 'Two', score: () => 2 }] })).toThrow('duplicate contribution IDs')
  })

  it('keeps cards reviewable when a prompt extension is absent or fails', () => {
    const data = createSeedData()
    const item = data.items[0]
    const card = { ...data.cards[0], itemId: item.id, variant: 'broken' }
    const missing = new ExtensionRegistry().render(item, card)
    expect(missing.prompt).toBe(item.prompt)

    const registry = new ExtensionRegistry([{
      manifest: manifest('independent.broken', ['prompts:contribute']),
      promptTypes: [{ id: 'broken', label: 'Broken', createCards: () => [{ promptType: 'broken', estimatedSeconds: 10 }], render: () => { throw new Error('renderer crashed') } }],
    }])
    expect(registry.render(item, card).answer).toBe(item.answer)
    expect(registry.getDiagnostics()).toContainEqual(expect.objectContaining({ extensionId: 'independent.broken', contribution: 'broken.render', message: 'renderer crashed' }))
  })

  it('clamps planning signals and isolates invalid queue policy results', () => {
    const data = createSeedData()
    const registry = new ExtensionRegistry([{
      manifest: manifest('independent.planner', ['planning:signals', 'planning:policies']),
      planningSignals: [{ id: 'priority', signalsFor: () => [{ id: 'high', label: 'High', score: 99 }, { id: 'low', label: 'Low', score: -3 }, { id: 'nan', label: 'Invalid', score: Number.NaN }] }],
      queuePolicies: [{ id: 'invalid', label: 'Invalid', score: () => Number.NaN }],
    }])
    expect(registry.planningSignals(data.items[0], data, new Date()).map((signal) => signal.score)).toEqual([4, 0])
    expect(registry.scoreQueuePolicy('invalid', { card: data.cards[0], overdueDays: 3, extensionBoost: 0 })).toBeNull()
  })

  it('rejects invalid relationships and foreign extension metadata atomically', async () => {
    const data = createSeedData()
    data.items[0].extensionData = { 'another.extension': { protected: true } }
    const registry = new ExtensionRegistry([{
      manifest: manifest('independent.safety', ['content:transactions']),
      commands: [
        { id: 'orphan-card', run: (context) => context.replaceData({ ...context.data, cards: context.data.cards.map((card, index) => index ? card : { ...card, itemId: 'missing-item' }) }) },
        { id: 'foreign-metadata', run: (context) => context.replaceData({ ...context.data, items: context.data.items.map((item, index) => index ? item : { ...item, extensionData: { 'another.extension': { protected: false } } }) }) },
      ],
    }])

    await expect(registry.runCommand('orphan-card', data, undefined)).rejects.toThrow('Unknown knowledge item')
    await expect(registry.runCommand('foreign-metadata', data, undefined)).rejects.toThrow('cannot modify metadata owned by another.extension')
    expect(data.cards[0].itemId).not.toBe('missing-item')
    expect(data.items[0].extensionData).toEqual({ 'another.extension': { protected: true } })
  })

  it('requires explicit transactions and protects review history and settings', async () => {
    const data = createSeedData()
    const registry = new ExtensionRegistry([{
      manifest: manifest('independent.commands', ['content:transactions']),
      commands: [
        { id: 'mutate-without-transaction', run: (context) => { context.data.items[0].answer = 'Attempted mutation' } },
        { id: 'bounded-transaction', run: (context) => context.replaceData({ ...context.data, items: context.data.items.map((item, index) => index ? item : { ...item, answer: 'Allowed content change' }), reviews: [{ id: 'forged', cardId: '', rating: 3, reviewedAt: '', durationSeconds: 1, previousDue: '', nextDue: '' }], settings: { ...context.data.settings, dailyMinutes: 999 } }) },
      ],
    }])

    const ignored = await registry.runCommand('mutate-without-transaction', data, undefined)
    expect(ignored.items[0].answer).toBe(data.items[0].answer)

    const committed = await registry.runCommand('bounded-transaction', data, undefined)
    expect(committed.items[0].answer).toBe('Allowed content change')
    expect(committed.reviews).toEqual(data.reviews)
    expect(committed.settings).toEqual(data.settings)
    expect(committed.deviceId).toBe(data.deviceId)
  })

  it('creates cards from a trusted prompt module', () => {
    const registry = new ExtensionRegistry([{
      manifest: manifest('independent.cards', ['prompts:contribute']),
      promptTypes: [{ id: 'diagram', label: 'Diagram', createCards: () => [{ promptType: 'diagram', estimatedSeconds: 9 }], render: (item) => ({ prompt: item.prompt, answer: item.answer, context: item.context, typed: false, citations: item.citations }) }],
    }])
    expect(registry.createCards(createInput(['diagram']))).toEqual([{ promptType: 'diagram', estimatedSeconds: 9 }])
  })

  it('exposes review and settings surfaces through declared permissions', () => {
    const registry = new ExtensionRegistry()
    const extension: NeoAnkiCoreModule = {
      manifest: manifest('independent.review-tools'),
      settingsPanels: [{ id: 'timer-settings', component: () => null }],
      reviewTools: [{ id: 'timer-review', component: () => null }],
    }
    expect(() => registry.register(extension)).toThrow('without ui:settings-panels')
    extension.manifest.permissions = ['ui:settings-panels', 'review:tools']
    expect(() => registry.register(extension)).not.toThrow()
    expect(registry.settingsPanels()).toEqual([expect.objectContaining({ id: 'timer-settings', extensionId: 'independent.review-tools' })])
    expect(registry.reviewTools()).toEqual([expect.objectContaining({ id: 'timer-review', extensionId: 'independent.review-tools' })])
  })

  it('rejects modules that are not compiled as trusted core code', () => {
    const registry = new ExtensionRegistry()
    expect(() => registry.register({ manifest: { ...manifest('independent.runtime'), runtime: 'worker' as never } })).toThrow('not a trusted core module')
  })
})
