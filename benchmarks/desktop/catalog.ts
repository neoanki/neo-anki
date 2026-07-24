import type { BenchmarkBudget, OperationSpec } from './types'

const measured = (
  id: string,
  area: OperationSpec['area'],
  label: string,
  tier: OperationSpec['tier'],
  dataset: OperationSpec['dataset'],
  stages: OperationSpec['stages'],
  variants?: string[],
): OperationSpec => ({ id, area, label, tier, dataset, stages, variants, disposition: 'measured' })
const credentialedSync = (
  id: string,
  label: string,
  dataset: OperationSpec['dataset'],
  stages: OperationSpec['stages'],
): OperationSpec => process.env.NEO_ANKI_BENCHMARK_SYNC_CREDENTIALS === '1'
  ? measured(id, 'sync', label, 'full', dataset, stages)
  : {
      id,
      area: 'sync',
      label,
      tier: 'full',
      dataset,
      stages: [],
      disposition: 'setup-only',
      reason: 'Runs only in a signed packaged app with secure macOS secret storage; unavailable in unsigned hidden runs.',
    }

export const CATALOG_VERSION = 1
export const operationCatalog: OperationSpec[] = [
  measured('lifecycle.launch.fresh', 'lifecycle', 'Fresh-profile packaged launch', 'smoke', 'fresh', ['lifecycle']),
  measured('lifecycle.launch.established', 'lifecycle', 'Established workspace launch', 'full', 'typical', ['lifecycle']),
  measured('lifecycle.launch.large', 'lifecycle', '50,000-card workspace launch', 'full', 'large', ['lifecycle']),
  measured('lifecycle.relaunch.warm', 'lifecycle', 'Warm relaunch using the same profile', 'smoke', 'small', ['lifecycle']),
  measured('lifecycle.quit.idle', 'lifecycle', 'Full quit while idle', 'smoke', 'small', ['lifecycle']),
  measured('lifecycle.quit.pending-save', 'lifecycle', 'Full quit while a save is pending', 'full', 'typical', ['lifecycle', 'durable']),
  measured('lifecycle.restart.durable', 'lifecycle', 'Restart restores durable workspace and route', 'smoke', 'small', ['lifecycle', 'durable']),
  measured('lifecycle.window.close', 'lifecycle', 'Close the last macOS window without quitting', 'full', 'small', ['lifecycle']),
  measured('lifecycle.window.reopen', 'lifecycle', 'Reopen after last-window close', 'full', 'small', ['lifecycle']),
  { id: 'lifecycle.second-instance', area: 'lifecycle', label: 'Focus the existing app from a second launch', tier: 'full', dataset: 'small', stages: [], disposition: 'setup-only', reason: 'The hidden packaged harness deliberately enables isolated concurrent instances; verify single-instance OS focus in release QA.' },

  measured('recovery.corrupt-launch', 'recovery', 'Launch with a corrupt workspace into blocked recovery', 'full', 'small', ['lifecycle', 'settled']),
  measured('recovery.actions', 'recovery', 'Retry, export preserved source, restore backup, and start empty', 'full', 'small', ['feedback', 'settled', 'durable'], ['Retry', 'Export original data', 'Restore backup', 'Start empty']),
  { id: 'recovery.error-boundary', area: 'recovery', label: 'Reload, diagnostics, and safe mode from the fatal renderer boundary', tier: 'full', dataset: 'small', stages: [], disposition: 'setup-only', reason: 'Requires a signed release fault-injection build; production packages expose no user-triggerable fatal-renderer hook.' },

  measured('navigation.onboarding.start-fresh', 'navigation', 'Choose a fresh workspace', 'smoke', 'fresh', ['feedback', 'settled']),
  measured('navigation.onboarding.complete', 'navigation', 'Complete onboarding', 'smoke', 'fresh', ['feedback', 'settled', 'durable']),
  measured('navigation.routes.cold', 'navigation', 'First lazy route transitions', 'smoke', 'small', ['feedback', 'settled'], ['Library', 'Create', 'Extensions']),
  measured('navigation.routes.warm', 'navigation', 'Warm route transitions', 'full', 'small', ['feedback', 'settled'], ['Today', 'Library', 'Create', 'Extensions']),
  measured('navigation.shortcuts', 'navigation', 'Keyboard route shortcuts', 'full', 'small', ['feedback', 'settled'], ['Cmd+1', 'Cmd+2', 'Cmd+3', 'Cmd+N']),
  measured('navigation.history', 'navigation', 'Back and forward navigation', 'full', 'small', ['feedback', 'settled']),
  measured('navigation.settings.open-close', 'navigation', 'Open and dismiss Settings', 'smoke', 'small', ['feedback', 'settled'], ['button', 'Cmd+,', 'Escape']),
  measured('navigation.window.resize', 'navigation', 'Resize between default and minimum layouts', 'full', 'small', ['settled']),

  measured('today.render.available', 'today', 'Render available-work dashboard', 'smoke', 'small', ['settled']),
  measured('today.daily-target', 'today', 'Change daily target', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('today.session-options', 'today', 'Change session length and mode', 'full', 'small', ['feedback', 'settled'], ['length', 'balanced', 'focus', 'urgent']),
  measured('today.planning-details', 'today', 'Expand planning details', 'full', 'small', ['feedback', 'settled']),
  measured('today.session.start', 'today', 'Build and start study session', 'smoke', 'small', ['feedback', 'settled']),
  measured('today.planner.large', 'today', 'Large-workspace background planning', 'full', 'large', ['settled']),

  measured('authoring.route-ready', 'authoring', 'Authoring route and templates ready', 'smoke', 'small', ['settled']),
  measured('authoring.input-preview', 'authoring', 'Field input, validation, health checks, and preview', 'smoke', 'small', ['feedback', 'settled'], ['prompt', 'answer', 'collection', 'tags', 'blur']),
  measured('authoring.content-type', 'authoring', 'Switch content type', 'full', 'typical', ['feedback', 'settled']),
  measured('authoring.citations', 'authoring', 'Add, edit, and remove citation', 'full', 'small', ['feedback', 'settled']),
  measured('authoring.create', 'authoring', 'Create knowledge item', 'smoke', 'small', ['feedback', 'settled', 'durable']),
  measured('authoring.draft-reload', 'authoring', 'Restore draft after reload', 'full', 'small', ['settled', 'durable']),

  measured('library.render.small', 'library', 'Render small Library', 'smoke', 'small', ['settled']),
  measured('library.render.typical', 'library', 'Render typical Library', 'full', 'typical', ['settled']),
  measured('library.render.large', 'library', 'Render large Library first page', 'full', 'large', ['settled']),
  measured('library.mode', 'library', 'Switch knowledge and practice-prompt modes', 'full', 'typical', ['feedback', 'settled']),
  measured('library.search', 'library', 'Search and clear Library', 'smoke', 'typical', ['feedback', 'settled'], ['plain', 'operator', 'wildcard', 'negative', 'no-result']),
  measured('library.filters-sorts', 'library', 'Collection, health, and sort controls', 'full', 'typical', ['feedback', 'settled']),
  measured('library.pagination', 'library', 'Load the next Library page', 'full', 'large', ['feedback', 'settled']),
  measured('library.selection', 'library', 'Select rows and select all visible', 'full', 'typical', ['feedback', 'settled']),
  measured('library.single-suspend', 'library', 'Suspend and resume one prompt', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('library.edit', 'library', 'Open, change, and save knowledge editor', 'smoke', 'small', ['feedback', 'settled', 'durable']),
  measured('library.bulk-state', 'library', 'Bulk suspend, bury, flag, and resume', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('library.bulk-metadata', 'library', 'Bulk collection, due date, and tag changes', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('library.trash', 'library', 'Trash, undo, restore, and purge', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('library.custom-study', 'library', 'Start rescheduled and preview-only custom study', 'full', 'small', ['feedback', 'settled']),

  measured('review.prompt', 'review', 'Render review prompt', 'smoke', 'small', ['settled']),
  measured('review.typed-input', 'review', 'Enter a typed answer', 'full', 'small', ['feedback', 'settled']),
  measured('review.reveal', 'review', 'Reveal answer by button and keyboard', 'smoke', 'small', ['feedback', 'settled'], ['button', 'Space', 'Enter']),
  measured('review.grade', 'review', 'Grade and render next state', 'smoke', 'small', ['feedback', 'settled', 'durable'], ['Forgot', 'Effort', 'Recalled', 'Easy']),
  measured('review.undo', 'review', 'Undo the previous grade', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('review.edit', 'review', 'Edit knowledge during review', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('review.block-transition', 'review', 'Continue across subject block boundary', 'full', 'small', ['feedback', 'settled']),
  measured('review.end-complete', 'review', 'End or complete a session and return', 'smoke', 'small', ['feedback', 'settled']),

  measured('settings.theme', 'settings', 'Switch theme', 'smoke', 'small', ['feedback', 'settled', 'durable']),
  measured('settings.learning', 'settings', 'Change retention and safeguards', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('settings.templates.load', 'settings', 'Load and expand template managers', 'full', 'typical', ['feedback', 'settled']),
  measured('settings.templates.save', 'settings', 'Create and atomically save fields/templates', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('settings.presets.save', 'settings', 'Edit and save deck preset', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('settings.backup.export', 'settings', 'Export core backup after deterministic file selection', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('settings.backup.restore', 'settings', 'Restore core JSON backup', 'full', 'typical', ['feedback', 'settled', 'durable']),
  measured('settings.workspace.erase', 'settings', 'Erase workspace and restart empty', 'full', 'small', ['feedback', 'settled', 'durable']),
  measured('settings.diagnostics.export', 'settings', 'Export diagnostics after deterministic file selection', 'full', 'small', ['feedback', 'settled']),

  measured('sync.status', 'sync', 'Load sync status', 'full', 'small', ['settled']),
  credentialedSync('sync.account', 'Create and recover sync account', 'small', ['feedback', 'settled', 'durable']),
  credentialedSync('sync.roundtrip', 'Synchronize no-change and changed workspaces', 'typical', ['feedback', 'settled', 'durable']),
  credentialedSync('sync.conflict', 'Render and resolve sync conflict', 'typical', ['feedback', 'settled', 'durable']),
  credentialedSync('sync.devices', 'Rotate recovery key, revoke device, and disconnect', 'small', ['feedback', 'settled', 'durable']),
  credentialedSync('sync.failure-retry', 'Display sync failure and retry', 'small', ['feedback', 'settled']),

  { id: 'extensions.execution', area: 'settings', label: 'Extension execution and configuration', tier: 'full', dataset: 'small', stages: [], disposition: 'excluded', reason: 'User-selected core-only scope.' },
  { id: 'imports.anki', area: 'settings', label: 'Anki package import', tier: 'full', dataset: 'typical', stages: [], disposition: 'excluded', reason: 'Implemented by the interoperability extension.' },
  { id: 'os.file-picker', area: 'settings', label: 'Native file-picker user think time', tier: 'full', dataset: 'small', stages: [], disposition: 'os-owned', reason: 'macOS-owned interaction; timing starts after deterministic selection.' },
  { id: 'os.external-app', area: 'settings', label: 'External application startup', tier: 'full', dataset: 'small', stages: [], disposition: 'os-owned', reason: 'Only Neo Anki shell handoff is in scope.' },
]

const defaultLimit = (stage: OperationSpec['stages'][number], dataset: OperationSpec['dataset'], id: string) => {
  if (stage === 'feedback') return 100
  if (stage === 'durable') return dataset === 'large' ? 2_000 : 1_000
  if (stage === 'lifecycle') {
    if (id.includes('quit.idle')) return 2_000
    if (id.includes('quit.pending')) return 5_000
    return dataset === 'large' ? 5_000 : 3_000
  }
  return dataset === 'large' ? 500 : 250
}

export const initialBudgets: BenchmarkBudget[] = operationCatalog
  .filter((operation) => operation.disposition === 'measured')
  .flatMap((operation) => operation.stages.map((stage) => ({
    operationId: operation.id,
    stage,
    absoluteLimitMs: defaultLimit(stage, operation.dataset, operation.id),
    enforcement: 'calibrating' as const,
  })))

export const operationsForTier = (tier: OperationSpec['tier']) => operationCatalog.filter((operation) => operation.disposition === 'measured' && (
  tier === 'endurance' || operation.tier === 'smoke' || operation.tier === tier
))
