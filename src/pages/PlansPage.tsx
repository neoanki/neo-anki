import { useState } from 'react'
import { extensionRuntime } from '../extensions/runtime'
import { useApp } from '../state/AppContext'

export const PlansPage = () => {
  const { data, plan, runExtensionCommand } = useApp()
  const panels = extensionRuntime.workspacePanels()
  const [active, setActive] = useState(() => panels[0]?.id || '')
  const selected = panels.find((panel) => panel.id === active) || panels[0]
  const Panel = selected?.component
  return <div className="page plans-page">
    <header className="page-header"><div><p className="eyebrow">Workspace tools</p><h1>Plans & sharing</h1><p className="page-intro">These tools are trusted modules shipped with Neo Anki. Installable packages use the isolated extension SDK and never join this application context.</p></div></header>
    <div className="type-tabs plan-tabs" role="tablist" aria-label="Workspace tool panels">{panels.map((panel) => <button role="tab" key={panel.id} aria-selected={selected?.id === panel.id} className={selected?.id === panel.id ? 'active' : ''} onClick={() => setActive(panel.id)}>{panel.label}</button>)}</div>
    {selected && Panel ? <Panel moduleId={selected.extensionId} data={data} plan={plan} runCommand={runExtensionCommand}/> : <div className="empty-state"><h2>No workspace tools</h2><p>This build contains no workspace tool modules.</p></div>}
  </div>
}
