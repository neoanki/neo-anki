import { AlertTriangle, Flag, Layers3, Plus, Save, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { validatePackManifest, validatePackPatch } from '../lib/packs'
import { emptyViewFilter } from '../lib/views'
import { useApp } from '../state/AppContext'

type Tab = 'goals' | 'views' | 'packs'

export const PlansPage = () => {
  const { data, upsertGoal, deleteGoal, upsertView, deleteView, installPackData, applyPackPatchData, resolveConflict } = useApp()
  const [tab, setTab] = useState<Tab>('goals')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [deadline, setDeadline] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    if (tab === 'goals') upsertGoal({ name, description: '', filter: { ...emptyViewFilter(), query }, deadline: deadline || undefined, priority: 2, active: true, color: '#6246a5' })
    else upsertView({ name, filter: { ...emptyViewFilter(), query }, sort: 'updated' })
    setName(''); setQuery(''); setDeadline('')
  }

  const loadPack = async (file?: File) => {
    if (!file) return
    try {
      const raw = JSON.parse(await file.text()) as unknown
      if ((raw as { format?: string }).format === 'neo-anki-pack') installPackData(validatePackManifest(raw))
      else applyPackPatchData(validatePackPatch(raw))
      setMessage('Pack data applied. Existing scheduling was preserved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read pack.') }
  }

  return (
    <div className="page plans-page">
      <header className="page-header"><div><p className="eyebrow">Workspace</p><h1>Plans & sharing</h1><p className="page-intro">Goals influence the adaptive queue. Saved views organize knowledge. Shared packs update content without resetting review history.</p></div></header>
      <div className="type-tabs plan-tabs" role="tablist" aria-label="Plans sections">
        <button role="tab" aria-selected={tab === 'goals'} className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}><Flag size={17}/> Goals</button>
        <button role="tab" aria-selected={tab === 'views'} className={tab === 'views' ? 'active' : ''} onClick={() => setTab('views')}><Save size={17}/> Saved views</button>
        <button role="tab" aria-selected={tab === 'packs'} className={tab === 'packs' ? 'active' : ''} onClick={() => setTab('packs')}><Layers3 size={17}/> Shared packs</button>
      </div>

      {tab !== 'packs' && <div className="plans-layout">
        <form className="editor-card compact-form" onSubmit={add}>
          <h2>{tab === 'goals' ? 'Add learning goal' : 'Save a library view'}</h2>
          <div className="form-field"><label htmlFor="plan-name">Name</label><input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={tab === 'goals' ? 'Pass Spanish B2' : 'Difficult biology'} required /></div>
          <div className="form-field"><label htmlFor="plan-query">Search terms <span>Optional</span></label><input id="plan-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="tag, collection, or text" /></div>
          {tab === 'goals' && <div className="form-field"><label htmlFor="goal-deadline">Deadline <span>Optional</span></label><input id="goal-deadline" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></div>}
          <button className="primary-button" type="submit"><Plus size={18}/> Add</button>
        </form>
        <section className="stack-list" aria-label={tab === 'goals' ? 'Learning goals' : 'Saved views'}>
          {(tab === 'goals' ? data.goals : data.views).map((entry) => <article className="stack-card" key={entry.id}><div><strong>{entry.name}</strong><p>{entry.filter.query || 'All matching knowledge'}{'deadline' in entry && entry.deadline ? ` · due ${entry.deadline}` : ''}</p></div><button className="icon-button danger-hover" aria-label={`Delete ${entry.name}`} onClick={() => tab === 'goals' ? deleteGoal(entry.id) : deleteView(entry.id)}><Trash2 size={18}/></button></article>)}
        </section>
      </div>}

      {tab === 'packs' && <div className="plans-layout">
        <section className="editor-card compact-form"><h2>Install or update a pack</h2><p>Use a <code>neo-anki-pack</code> manifest or a versioned patch. Three-way merge keeps local edits and surfaces real conflicts.</p><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18}/> Choose JSON</button><input className="visually-hidden" ref={fileRef} type="file" accept="application/json" onChange={(event) => loadPack(event.target.files?.[0])}/>{message && <p role="status" className="inline-message">{message}</p>}</section>
        <section className="stack-list"><h2>Installed</h2>{data.packs.map((pack) => <article className="stack-card" key={pack.id}><div><strong>{pack.name}</strong><p>v{pack.installedVersion} · {Object.keys(pack.itemMap).length} items · {pack.author}</p></div></article>)}{!data.packs.length && <div className="empty-state"><Layers3 size={28}/><p>No shared packs installed.</p></div>}</section>
        {data.packConflicts.length > 0 && <section className="conflict-list"><h2><AlertTriangle size={20}/> Update conflicts</h2>{data.packConflicts.map((conflict) => <article className="stack-card" key={conflict.id}><div><strong>{conflict.field === '$delete' ? 'Upstream removed an edited item' : `${conflict.field} changed locally and upstream`}</strong><p>Choose which version should survive.</p></div><div className="button-row"><button className="secondary-button compact" onClick={() => resolveConflict(conflict.id, 'local')}>Keep mine</button><button className="secondary-button compact" onClick={() => resolveConflict(conflict.id, 'upstream')}>Use update</button></div></article>)}</section>}
      </div>}
    </div>
  )
}
