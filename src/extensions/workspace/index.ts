import type { NeoAnkiCoreModule } from '../core-module'
import { goalUrgency, goalsForItem } from './service'
import type { LearningGoal, SavedView } from '../../types'
import { GoalsPanel, SavedViewsPanel } from './WorkspacePanels'

export const workspaceExtension: NeoAnkiCoreModule = {
  manifest: {
    id: 'neo-anki.workspace',
    name: 'Goals & Saved Views',
    version: '1.1.0',
    runtime: 'core',
    publisher: 'Neo Anki',
    permissions: ['planning:signals', 'content:transactions', 'ui:workspace-panels', 'ui:library-presets'],
  },
  planningSignals: [{
    id: 'learning-goals',
    signalsFor: (item, data, now) => goalsForItem(item, data.cards, data.goals, now).map((goal) => ({ id: goal.id, label: goal.name, score: goalUrgency(goal, now) })),
  }],
  commands: [
    { id: 'workspace.upsert-goal', run: (context, payload) => { const now = new Date().toISOString(); const goal = payload as Omit<LearningGoal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }; const existing = goal.id ? context.data.goals.find((value) => value.id === goal.id) : undefined; const next = { ...goal, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now } as LearningGoal; context.replaceData({ ...context.data, goals: existing ? context.data.goals.map((value) => value.id === next.id ? next : value) : [next, ...context.data.goals], updatedAt: now }) } },
    { id: 'workspace.delete-goal', run: (context, payload) => context.replaceData({ ...context.data, goals: context.data.goals.filter((goal) => goal.id !== payload), updatedAt: new Date().toISOString() }) },
    { id: 'workspace.upsert-view', run: (context, payload) => { const now = new Date().toISOString(); const view = payload as Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }; const existing = view.id ? context.data.views.find((value) => value.id === view.id) : undefined; const next = { ...view, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now } as SavedView; context.replaceData({ ...context.data, views: existing ? context.data.views.map((value) => value.id === next.id ? next : value) : [next, ...context.data.views], updatedAt: now }) } },
    { id: 'workspace.delete-view', run: (context, payload) => context.replaceData({ ...context.data, views: context.data.views.filter((view) => view.id !== payload), updatedAt: new Date().toISOString() }) },
  ],
  workspacePanels: [
    { id: 'goals', label: 'Goals', component: GoalsPanel },
    { id: 'views', label: 'Saved views', component: SavedViewsPanel },
  ],
  libraryPresets: [{
    id: 'saved-views',
    presets: (data) => data.views.map((view) => ({ id: view.id, label: view.name, query: view.filter.query, collection: view.filter.collections[0] })),
  }],
}

export { emptyViewFilter, filterItems, goalUrgency, goalsForItem, itemMatchesFilter } from './service'
