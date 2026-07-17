import { useState } from 'react'
import { extensionRuntime } from '../extensions/runtime'
import { createExtensionHost } from '../extensions/host'
import { useApp } from '../state/AppContext'

export const PlansPage = () => {
  const { data, plan, runExtensionCommand } = useApp()
  const panels = extensionRuntime.workspacePanels()
  const [active, setActive] = useState(() => panels[0]?.id || '')
  const selected = panels.find((panel) => panel.id === active) || panels[0]
  const Panel = selected?.component
  return <div className="page plans-page">
    <header className="page-header"><div><p className="eyebrow">Extensions</p><h1>Plans & sharing</h1><p className="page-intro">These workspace tools are extension contributions. Bundled and independently authored extensions use the same public panel and command APIs.</p></div></header>
    <div className="type-tabs plan-tabs" role="tablist" aria-label="Extension workspace panels">{panels.map((panel) => <button role="tab" key={panel.id} aria-selected={selected?.id === panel.id} className={selected?.id === panel.id ? 'active' : ''} onClick={() => setActive(panel.id)}>{panel.label}</button>)}</div>
    {selected && Panel ? <Panel extensionId={selected.extensionId} data={data} plan={plan} host={createExtensionHost(selected.extensionId)} runCommand={runExtensionCommand}/> : <div className="empty-state"><h2>No workspace extensions</h2><p>Install an extension that contributes a workspace panel.</p></div>}
  </div>
}
