import type { NeoAnkiCoreModule } from '../core-module'
import { InsightsPage } from './InsightsPage'

export const insightsExtension: NeoAnkiCoreModule = {
  manifest: {
    id: 'neo-anki.insights',
    name: 'Memory Insights',
    version: '1.1.0',
    runtime: 'core',
    publisher: 'Neo Anki',
    permissions: ['ui:pages'],
  },
  pages: [{ route: 'insights', label: 'Insights', component: InsightsPage }],
}
