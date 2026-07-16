import type { NeoAnkiExtension } from '../sdk'
import { InsightsPage } from './InsightsPage'

export const insightsExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.insights',
    name: 'Memory Insights',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['ui:pages'],
  },
  pages: [{ route: 'insights', label: 'Insights', component: InsightsPage }],
}
