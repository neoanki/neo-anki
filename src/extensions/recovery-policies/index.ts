import type { NeoAnkiExtension } from '../sdk'

export const recoveryPoliciesExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.recovery-policies',
    name: 'Recovery Policies',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['planning:policies'],
  },
  queuePolicies: [
    { id: 'oldest', label: 'Oldest overdue first', score: ({ card, overdueDays, extensionBoost }) => overdueDays * 2 + card.fsrs.lapses * 0.08 + extensionBoost },
    { id: 'momentum', label: 'Quick wins first', score: ({ card, extensionBoost }) => 35 / Math.max(7, card.estimatedSeconds) + 1 / Math.max(1, card.fsrs.difficulty) + extensionBoost },
  ],
}
