import { Archive, Edit3, Filter, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react'
import { State } from 'ts-fsrs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDue } from '../lib/date'
import { analyzeCardHealth } from '../lib/content'
import { useApp } from '../state/AppContext'
import type { KnowledgeItem } from '../types'

const EditDialog = ({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) => {
  const { updateItem } = useApp()
  const [draft, setDraft] = useState(item)
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    updateItem(item.id, { prompt: draft.prompt, answer: draft.answer, context: draft.context, collection: draft.collection, tags: draft.tags, source: draft.source, citations: draft.citations })
    onClose()
  }
  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" onSubmit={save}>
        <div className="panel-header"><div><p className="eyebrow">Knowledge item</p><h2 id="edit-title">Edit content</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close editor"><X size={20} /></button></div>
        <div className="form-field"><label htmlFor="edit-prompt">Prompt</label><textarea id="edit-prompt" rows={4} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="edit-answer">Answer</label><textarea id="edit-answer" rows={3} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="edit-context">Context</label><textarea id="edit-context" rows={2} value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })} /></div>
        <div className="field-grid"><div className="form-field"><label htmlFor="edit-collection">Collection</label><input id="edit-collection" value={draft.collection} onChange={(event) => setDraft({ ...draft, collection: event.target.value })} /></div><div className="form-field"><label htmlFor="edit-tags">Tags</label><input id="edit-tags" value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></div></div>
        <fieldset className="sub-editor"><legend>Sources & citations</legend>{draft.citations.map((citation, index) => <div className="citation-row" key={citation.id}><input aria-label={`Edit citation ${index + 1} title`} value={citation.title} onChange={(event) => setDraft({ ...draft, citations: draft.citations.map((value) => value.id === citation.id ? { ...value, title: event.target.value } : value) })}/><input aria-label={`Edit citation ${index + 1} URL`} type="url" value={citation.url || ''} onChange={(event) => setDraft({ ...draft, citations: draft.citations.map((value) => value.id === citation.id ? { ...value, url: event.target.value } : value) })}/><button type="button" className="icon-button" aria-label={`Remove citation ${index + 1}`} onClick={() => setDraft({ ...draft, citations: draft.citations.filter((value) => value.id !== citation.id) })}><Trash2 size={17}/></button></div>)}<button type="button" className="text-button" onClick={() => setDraft({ ...draft, citations: [...draft.citations, { id: crypto.randomUUID(), title: '', url: '' }] })}><Plus size={16}/> Add citation</button></fieldset>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save changes</button></div>
      </form>
    </div>
  )
}

export const LibraryPage = () => {
  const { data, navigate, deleteItem, toggleSuspend } = useApp()
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState('All collections')
  const [editing, setEditing] = useState<KnowledgeItem | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const collections = ['All collections', ...new Set(data.items.map((item) => item.collection))]
  const filtered = useMemo(() => data.items.filter((item) => {
    const haystack = `${item.prompt} ${item.answer} ${item.collection} ${item.tags.join(' ')}`.toLowerCase()
    return haystack.includes(query.toLowerCase()) && (collection === 'All collections' || item.collection === collection)
  }), [data.items, query, collection])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="page library-page">
      <header className="page-header library-header">
        <div><p className="eyebrow">Knowledge library</p><h1>{data.items.length} ideas, {data.cards.length} ways to practice.</h1><p className="page-intro">Edit knowledge once and every related prompt stays in sync.</p></div>
        <button className="primary-button" onClick={() => navigate('create')}><Plus size={19} /> Add knowledge</button>
      </header>

      <div className="library-toolbar">
        <label className="search-field"><Search size={19} /><span className="visually-hidden">Search knowledge</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions, answers, tags…  /" /></label>
        <label className="filter-field"><Filter size={18} /><span className="visually-hidden">Filter by collection</span><select value={collection} onChange={(event) => setCollection(event.target.value)}>{collections.map((name) => <option key={name}>{name}</option>)}</select></label>
        {data.views.length > 0 && <label className="filter-field"><span className="visually-hidden">Apply saved view</span><select defaultValue="" onChange={(event) => { const view = data.views.find((candidate) => candidate.id === event.target.value); if (view) { setQuery(view.filter.query); setCollection(view.filter.collections[0] || 'All collections') } }}><option value="">Saved views</option>{data.views.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label>}
      </div>

      <section className="library-list" aria-label="Knowledge items">
        <div className="library-list-header"><span>Knowledge</span><span>Practice prompts</span><span>Status</span><span className="visually-hidden">Actions</span></div>
        {filtered.map((item) => {
          const cards = data.cards.filter((card) => card.itemId === item.id)
          const active = cards.filter((card) => !card.suspended)
          const nextDue = active.map((card) => new Date(card.fsrs.due)).sort((a, b) => a.getTime() - b.getTime())[0]
          const health = analyzeCardHealth(item.prompt, item.answer, item.citations)
          return (
            <article className="library-row" key={item.id}>
              <div className="knowledge-cell"><span className="collection-label">{item.collection}</span><strong>{item.prompt}</strong><p>{item.answer}</p><div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}{health.some((finding) => finding.severity !== 'info') && <span className="health-warning" title={health.map((finding) => finding.message).join(' ')}>needs attention</span>}{item.citations.length > 0 && <span>{item.citations.length} source{item.citations.length === 1 ? '' : 's'}</span>}</div></div>
              <div className="variant-cell">{cards.map((card) => <button key={card.id} className={card.suspended ? 'variant-pill suspended' : 'variant-pill'} onClick={() => toggleSuspend(card.id)} title={card.suspended ? 'Resume prompt' : 'Suspend prompt'}>{card.variant}{card.suspended && ' · paused'}</button>)}</div>
              <div className="status-cell"><strong>{active.length ? (active.some((card) => card.fsrs.state === State.New) ? 'New' : nextDue ? formatDue(nextDue.toISOString()) : 'Active') : 'Paused'}</strong><span>{cards.reduce((sum, card) => sum + card.fsrs.reps, 0)} reviews</span></div>
              <div className="row-actions"><button className="icon-button" onClick={() => setEditing(item)} aria-label={`Edit ${item.prompt}`}><Edit3 size={18} /></button><button className="icon-button danger-hover" onClick={() => window.confirm('Delete this knowledge item and all of its review history?') && deleteItem(item.id)} aria-label={`Delete ${item.prompt}`}><Trash2 size={18} /></button></div>
            </article>
          )
        })}
        {!filtered.length && <div className="empty-state"><Archive size={30} /><h2>No knowledge found</h2><p>Try another filter or add a new item.</p><button className="secondary-button" onClick={() => { setQuery(''); setCollection('All collections') }}><MoreHorizontal size={18} /> Clear filters</button></div>}
      </section>
      {editing && <EditDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
