import type { NeoAnkiCoreModule } from '../core-module'

export const recoveryPoliciesExtension: NeoAnkiCoreModule = {
  manifest: {
    id: 'neo-anki.recovery-policies',
    name: 'Recovery Policies',
    version: '1.1.0',
    runtime: 'core',
    publisher: 'Neo Anki',
    permissions: ['planning:policies'],
  },
  queuePolicies: [
    { id: 'oldest', label: 'Oldest overdue first', score: ({ card, overdueDays, extensionBoost }) => overdueDays * 2 + card.fsrs.lapses * 0.08 + extensionBoost },
    { id: 'momentum', label: 'Quick wins first', score: ({ card, extensionBoost }) => 35 / Math.max(7, card.estimatedSeconds) + 1 / Math.max(1, card.fsrs.difficulty) + extensionBoost },
  ],
}
