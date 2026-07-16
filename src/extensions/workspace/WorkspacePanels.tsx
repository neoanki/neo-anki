import { Flag, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ExtensionPageProps } from '../sdk'
import { emptyViewFilter } from './service'

const WorkspaceForm = ({ kind, runCommand }: { kind: 'goal' | 'view'; runCommand: ExtensionPageProps['runCommand'] }) => {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [deadline, setDeadline] = useState('')
  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const value = kind === 'goal'
      ? { name, description: '', filter: { ...emptyViewFilter(), query }, deadline: deadline || undefined, priority: 2, active: true, color: '#6246a5' }
      : { name, filter: { ...emptyViewFilter(), query }, sort: 'updated' }
    void runCommand(`workspace.upsert-${kind}`, value)
    setName(''); setQuery(''); setDeadline('')
  }
  return <form className="editor-card compact-form" onSubmit={add}>
    <h2>{kind === 'goal' ? 'Add learning goal' : 'Save a library view'}</h2>
    <div className="form-field"><label htmlFor={`${kind}-name`}>Name</label><input id={`${kind}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'goal' ? 'Pass Spanish B2' : 'Difficult biology'} required /></div>
    <div className="form-field"><label htmlFor={`${kind}-query`}>Search terms <span>Optional</span></label><input id={`${kind}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="tag, collection, or text" /></div>
    {kind === 'goal' && <div className="form-field"><label htmlFor="goal-deadline">Deadline <span>Optional</span></label><input id="goal-deadline" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></div>}
    <button className="primary-button" type="submit"><Plus size={18}/> Add</button>
  </form>
}

export const GoalsPanel = ({ data, runCommand }: ExtensionPageProps) => {
  return <div className="plans-layout"><WorkspaceForm kind="goal" runCommand={runCommand}/><section className="stack-list" aria-label="Learning goals">{data.goals.map((goal) => <article className="stack-card" key={goal.id}><div><strong>{goal.name}</strong><p>{goal.filter.query || 'All matching knowledge'}{goal.deadline ? ` · due ${goal.deadline}` : ''}</p></div><button className="icon-button danger-hover" aria-label={`Delete ${goal.name}`} onClick={() => void runCommand('workspace.delete-goal', goal.id)}><Trash2 size={18}/></button></article>)}{!data.goals.length && <div className="empty-state"><Flag size={28}/><p>No learning goals.</p></div>}</section></div>
}

export const SavedViewsPanel = ({ data, runCommand }: ExtensionPageProps) => {
  return <div className="plans-layout"><WorkspaceForm kind="view" runCommand={runCommand}/><section className="stack-list" aria-label="Saved views">{data.views.map((view) => <article className="stack-card" key={view.id}><div><strong>{view.name}</strong><p>{view.filter.query || 'All matching knowledge'}</p></div><button className="icon-button danger-hover" aria-label={`Delete ${view.name}`} onClick={() => void runCommand('workspace.delete-view', view.id)}><Trash2 size={18}/></button></article>)}{!data.views.length && <div className="empty-state"><Save size={28}/><p>No saved views.</p></div>}</section></div>
}
