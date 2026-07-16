import { defineExtension, ExtensionHeader, ExtensionMetric, ExtensionMetricGrid, ExtensionPage, type ExtensionPageProps } from '@neo-anki/extension-sdk'

const StudyPulsePage = ({ data, plan }: ExtensionPageProps) => (
  <ExtensionPage>
    <ExtensionHeader eyebrow="Example extension" title="Study Pulse" description="This page is loaded from a local third-party extension package through SDK v1."/>
    <ExtensionMetricGrid label="Study Pulse summary">
      <ExtensionMetric label="Knowledge items" value={data.items.length} detail="Read through public extension props"/>
      <ExtensionMetric label="Ready prompts" value={plan.queue.length} detail="From the public daily plan"/>
      <ExtensionMetric label="Time remaining" value={`${Math.ceil(plan.remainingSeconds / 60)}m`} detail="Shared daily time envelope"/>
      <ExtensionMetric label="Deferred" value={plan.deferred} detail="Reviews outside today’s budget"/>
    </ExtensionMetricGrid>
  </ExtensionPage>
)

export default defineExtension({
  manifest: {
    id: 'org.neoanki.examples.study-pulse',
    name: 'Study Pulse',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki SDK examples',
    description: 'A third-party example that adds a workload page and a shortest-first recovery policy.',
    permissions: ['ui:pages', 'planning:policies'],
  },
  pages: [{ route: 'study-pulse', label: 'Study Pulse', component: StudyPulsePage }],
  queuePolicies: [{ id: 'study-pulse.shortest', label: 'Shortest prompts first', score: ({ card, extensionBoost }) => 100 / Math.max(5, card.estimatedSeconds) + extensionBoost }],
})
