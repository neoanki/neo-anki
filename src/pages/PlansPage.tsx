import { useState } from 'react'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { useApp } from '../state/AppContext'

export const PlansPage = () => {
  const { data, plan } = useApp()
  const isolatedPanels = extensionUiContributionsV2('workspace')
  const allPanels = isolatedPanels.map((panel) => ({ id: `${panel.extensionId}:${panel.id}`, label: panel.label, panel }))
  const [active, setActive] = useState(() => allPanels[0]?.id || '')
  const selected = allPanels.find((panel) => panel.id === active) || allPanels[0]
  return <div className="page plans-page">
    <header className="page-header"><div><p className="eyebrow">Workspace tools</p><h1>Plans & sharing</h1><p className="page-intro">Installed tools run in isolated extension frames and keep their own configuration.</p></div></header>
    <div className="type-tabs plan-tabs" role="tablist" aria-label="Workspace tool panels">{allPanels.map((panel) => <button role="tab" key={panel.id} aria-selected={selected?.id === panel.id} className={selected?.id === panel.id ? 'active' : ''} onClick={() => setActive(panel.id)}>{panel.label}</button>)}</div>
    {selected ? <ExtensionUiFrameV2 contribution={selected.panel} dto={{ summary: { notes: data.items.length, cards: data.cards.length, dueToday: plan.dueTotal } }} /> : <div className="empty-state"><h2>No workspace tools installed</h2><p>Add planning or sharing extensions from the marketplace.</p></div>}
  </div>
}
