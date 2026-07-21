import { Archive, ArchiveRestore, CalendarClock, Edit3, Eye, Filter, Flag, MoreHorizontal, Play, Plus, Search, Trash2, Undo2 } from 'lucide-react'
import { State } from 'ts-fsrs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDue } from '../lib/date'
import { analyzeCardHealth, normalizeAnswer } from '../lib/content'
import { useApp } from '../state/AppContext'
import type { KnowledgeItem, PracticeCard } from '../types'
import { extensionLibraryPresetsV2, extensionPromptTypesV2 } from '../extensions/v2/registry'
import { KnowledgeItemEditor } from '../components/KnowledgeItemEditor'
import { matchesLibraryQuery, sortLibraryItems, type LibrarySort } from '../lib/library-query'

const LIBRARY_PAGE_SIZE = 100
const cardHasMissingMedia = (card: PracticeCard) => /class=["']media-missing|\b(?:src|href)=["'](?!data:|blob:|neoanki-media:|https?:|#|\/)/i.test(`${card.rendering?.questionHtml || ''}${card.rendering?.answerHtml || ''}`)
const itemHealth = (item: KnowledgeItem, cards: PracticeCard[], duplicatePrompts: Set<string>, assetIds: Set<string>) => ({
  empty: !item.prompt.trim() || !item.answer.trim(),
  duplicate: duplicatePrompts.has(normalizeAnswer(item.prompt)),
  media: item.mediaIds.some((id) => !assetIds.has(id)) || cards.some(cardHasMissingMedia),
  quality: analyzeCardHealth(item.prompt, item.answer, item.citations).some((finding) => finding.severity !== 'info'),
})

export const LibraryPage = () => {
  const { data, navigate, startCustomSession, deleteItem, deleteItems, restoreItem, purgeItem, toggleSuspend, setCardsSuspended, setCardsBuried, setCardsFlag, setCardsDeck, setCardsDueDate, updateItemsBulk } = useApp()
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState('All collections')
  const [editing, setEditing] = useState<KnowledgeItem | null>(null)
  const [recentlyTrashed, setRecentlyTrashed] = useState<{ id: string; name: string } | null>(null)
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<LibrarySort>('updated-desc')
  const [bulkTag, setBulkTag] = useState('')
  const [mode, setMode] = useState<'notes' | 'cards'>('notes')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [healthFilter, setHealthFilter] = useState<'all' | 'quality' | 'empty' | 'duplicate' | 'media'>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const collections = ['All collections', ...new Set([...data.items.map((item) => item.collection), ...data.cards.map((card) => card.deckName).filter((value): value is string => Boolean(value))])]
  const libraryPresets = extensionLibraryPresetsV2()
  const promptTypeLabels = useMemo(() => new Map<string, string>([['forward', 'Basic'], ...extensionPromptTypesV2().map((type) => [type.id, type.label] as [string, string])]), [])
  const cardsByItem = useMemo(() => {
    const result = new Map<string, PracticeCard[]>()
    for (const card of data.cards) {
      const existing = result.get(card.itemId)
      if (existing) existing.push(card)
      else result.set(card.itemId, [card])
    }
    return result
  }, [data.cards])
  const duplicatePrompts = useMemo(() => {
    const counts = new Map<string, number>()
    data.items.forEach((item) => { const key = normalizeAnswer(item.prompt); if (key) counts.set(key, (counts.get(key) || 0) + 1) })
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key))
  }, [data.items])
  const assetIds = useMemo(() => new Set(data.assets.map((asset) => asset.id)), [data.assets])
  const checkCounts = useMemo(() => data.items.reduce((counts, item) => { const health = itemHealth(item, cardsByItem.get(item.id) || [], duplicatePrompts, assetIds); (Object.keys(health) as Array<keyof typeof health>).forEach((key) => { if (health[key]) counts[key] += 1 }); return counts }, { quality: 0, empty: 0, duplicate: 0, media: 0 }), [data.items, cardsByItem, duplicatePrompts, assetIds])
  const filtered = useMemo(() => sortLibraryItems(data.items.filter((item) => matchesLibraryQuery(item, cardsByItem.get(item.id) || [], query) && (healthFilter === 'all' || itemHealth(item, cardsByItem.get(item.id) || [], duplicatePrompts, assetIds)[healthFilter]) && (collection === 'All collections' || item.collection === collection)), cardsByItem, sort), [data.items, cardsByItem, query, collection, sort, healthFilter, duplicatePrompts, assetIds])
  const visibleItems = filtered.slice(0, visibleCount)
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const cardItemOrder = useMemo(() => new Map(sortLibraryItems(data.items, cardsByItem, sort).map((item, index) => [item.id, index])), [data.items, cardsByItem, sort])
  const filteredCards = useMemo(() => data.cards.filter((card) => {
    const item = itemById.get(card.itemId)
    return Boolean(item && matchesLibraryQuery(item, [card], query) && (healthFilter === 'all' || itemHealth(item, [card], duplicatePrompts, assetIds)[healthFilter]) && (collection === 'All collections' || (card.deckName || item.collection) === collection))
  }).sort((left, right) => sort === 'due-asc' ? Date.parse(left.fsrs.due) - Date.parse(right.fsrs.due) || left.id.localeCompare(right.id) : (cardItemOrder.get(left.itemId) || 0) - (cardItemOrder.get(right.itemId) || 0) || left.id.localeCompare(right.id)), [data.cards, itemById, query, collection, sort, cardItemOrder, healthFilter, duplicatePrompts, assetIds])
  const visibleCards = filteredCards.slice(0, visibleCount)
  const selectedCards = mode === 'notes' ? data.cards.filter((card) => selected.has(card.itemId)) : data.cards.filter((card) => selected.has(card.id))
  const deckNames = useMemo(() => [...new Set(data.cards.map((card) => card.deckName || itemById.get(card.itemId)?.collection).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right)), [data.cards, itemById])
  const visibleSelectionIds = mode === 'notes' ? visibleItems.map((item) => item.id) : visibleCards.map((card) => card.id)
  const visibleTotal = mode === 'notes' ? filtered.length : filteredCards.length

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="page library-page">
      <header className="page-header library-header">
        <div><p className="eyebrow">Knowledge</p><h1>Library</h1><p className="page-intro">{data.items.length} knowledge {data.items.length === 1 ? 'item' : 'items'} · {data.cards.length} practice {data.cards.length === 1 ? 'prompt' : 'prompts'}. Edit a knowledge item once and every related practice prompt stays in sync.</p></div>
        <button className="primary-button" onClick={() => navigate('create')}><Plus size={19} /> Add knowledge item</button>
      </header>

      <div className="library-toolbar">
        <div className="library-mode" role="group" aria-label="Browse by"><button type="button" className={mode === 'notes' ? 'active' : ''} aria-pressed={mode === 'notes'} onClick={() => { setMode('notes'); setSelected(new Set()); setVisibleCount(LIBRARY_PAGE_SIZE) }}>Knowledge items</button><button type="button" className={mode === 'cards' ? 'active' : ''} aria-pressed={mode === 'cards'} onClick={() => { setMode('cards'); setSelected(new Set()); setVisibleCount(LIBRARY_PAGE_SIZE) }}>Practice prompts</button></div>
        <label className="search-field"><Search size={19} /><span className="visually-hidden">Search knowledge</span><input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(LIBRARY_PAGE_SIZE) }} placeholder="Search prompts, answers, tags…  /" /></label>
        <label className="filter-field"><Filter size={18} /><span className="visually-hidden">Filter by collection</span><select value={collection} onChange={(event) => { setCollection(event.target.value); setVisibleCount(LIBRARY_PAGE_SIZE) }}>{collections.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="filter-field"><span className="visually-hidden">Sort Library</span><select aria-label="Sort Library" value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}><option value="updated-desc">Recently edited</option><option value="created-desc">Recently added</option><option value="due-asc">Next due</option><option value="difficulty-desc">Highest difficulty</option><option value="deck-asc">Collection name</option></select></label>
        <label className="filter-field"><span className="visually-hidden">Collection check</span><select aria-label="Collection check" value={healthFilter} onChange={(event) => { setHealthFilter(event.target.value as typeof healthFilter); setVisibleCount(LIBRARY_PAGE_SIZE) }}><option value="all">All checks</option><option value="quality">Quality warnings ({checkCounts.quality})</option><option value="empty">Empty prompts or answers ({checkCounts.empty})</option><option value="duplicate">Duplicate prompts ({checkCounts.duplicate})</option><option value="media">Missing media ({checkCounts.media})</option></select></label>
        {libraryPresets.length > 0 && <label className="filter-field"><span className="visually-hidden">Apply saved view</span><select defaultValue="" onChange={(event) => { const preset = libraryPresets.find((candidate) => candidate.id === event.target.value); if (preset) { setQuery(preset.query); setCollection(preset.collection || 'All collections'); setVisibleCount(LIBRARY_PAGE_SIZE) } }}><option value="">Saved views</option>{libraryPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>}
      </div>

      {selected.size > 0 && <div className="bulk-toolbar" role="toolbar" aria-label="Bulk actions">
        <strong>{selected.size} selected</strong>
        <button className="secondary-button compact" disabled={!selectedCards.some((card) => !card.suspended)} onClick={() => startCustomSession(selectedCards.map((card) => card.id), true)} title="Ratings update normal scheduling"><Play size={16} /> Study + reschedule</button>
        <button className="secondary-button compact" disabled={!selectedCards.some((card) => !card.suspended)} onClick={() => startCustomSession(selectedCards.map((card) => card.id), false)} title="Ratings are recorded but due dates do not change"><Eye size={16} /> Preview only</button>
        <button className="secondary-button compact" onClick={() => setCardsSuspended(selectedCards.map((card) => card.id), true)}>Suspend practice prompts</button>
        <button className="secondary-button compact" onClick={() => setCardsSuspended(selectedCards.map((card) => card.id), false)}>Resume practice prompts</button>
        <button className="secondary-button compact" onClick={() => setCardsBuried(selectedCards.map((card) => card.id), true)}>Bury until tomorrow</button>
        <button className="secondary-button compact" onClick={() => setCardsBuried(selectedCards.map((card) => card.id), false)}>Unbury</button>
        <label className="bulk-flag"><Flag size={16} aria-hidden="true" /><span className="visually-hidden">Set flag on selected practice prompts</span><select aria-label="Set flag on selected practice prompts" defaultValue="" onChange={(event) => { if (event.target.value !== '') setCardsFlag(selectedCards.map((card) => card.id), Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7); event.currentTarget.value = '' }}><option value="" disabled>Set flag</option><option value="0">No flag</option>{Array.from({ length: 7 }, (_, index) => <option key={index + 1} value={index + 1}>Flag {index + 1}</option>)}</select></label>
        <label className="bulk-flag"><span className="visually-hidden">Move selected {mode === 'notes' ? 'knowledge items' : 'practice prompts'} to collection</span><select aria-label={`Move selected ${mode === 'notes' ? 'knowledge items' : 'practice prompts'} to collection`} disabled={bulkBusy} defaultValue="" onChange={(event) => { const control = event.currentTarget; const name = control.value; if (name) { if (mode === 'notes') updateItemsBulk([...selected], { collection: name }); else { setBulkBusy(true); void setCardsDeck([...selected], name).then(() => setBulkMessage(`Moved ${selectedCards.length} selected practice ${selectedCards.length === 1 ? 'prompt' : 'prompts'} to ${name}.`)).catch((error) => setBulkMessage(error instanceof Error ? error.message : 'Could not move the selected practice prompts.')).finally(() => setBulkBusy(false)) } } control.value = '' }}><option value="" disabled>Move to collection</option>{deckNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="bulk-due"><span className="visually-hidden">Due date for selected practice prompts</span><input aria-label="Due date for selected practice prompts" type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} /><button type="button" disabled={bulkBusy || !bulkDueDate || !selectedCards.length} onClick={() => { setBulkBusy(true); void setCardsDueDate(selectedCards.map((card) => card.id), bulkDueDate).then(() => setBulkMessage(`Rescheduled ${selectedCards.length} selected practice ${selectedCards.length === 1 ? 'prompt' : 'prompts'}.`)).catch((error) => setBulkMessage(error instanceof Error ? error.message : 'Could not reschedule the selected practice prompts.')).finally(() => setBulkBusy(false)) }}><CalendarClock size={15} /> Set due</button></label>
        {mode === 'notes' && <label className="bulk-tag"><span className="visually-hidden">Tag for selected knowledge items</span><input aria-label="Tag for selected knowledge items" value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder="tag" /><button type="button" disabled={!bulkTag.trim()} onClick={() => { updateItemsBulk([...selected], { addTags: [bulkTag] }); setBulkTag('') }}>Add tag</button><button type="button" disabled={!bulkTag.trim()} onClick={() => { updateItemsBulk([...selected], { removeTags: [bulkTag] }); setBulkTag('') }}>Remove tag</button></label>}
        {mode === 'notes' && <button className="text-button danger" onClick={() => { if (window.confirm(`Move ${selected.size} selected items to Trash?`)) { deleteItems([...selected]); setSelected(new Set()) } }}><Trash2 size={16}/> Move to Trash</button>}
        <button className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>}
      {bulkMessage && <p className="library-action-message" role="status">{bulkMessage}</p>}

      <section className="library-list" role="list" aria-label={mode === 'notes' ? 'Knowledge items' : 'Practice prompts'}>
        <div className="library-list-header"><label><input type="checkbox" aria-label={`Select all visible ${mode === 'notes' ? 'knowledge items' : 'practice prompts'}`} checked={visibleSelectionIds.length > 0 && visibleSelectionIds.every((id) => selected.has(id))} onChange={(event) => setSelected((current) => { const next = new Set(current); visibleSelectionIds.forEach((id) => event.target.checked ? next.add(id) : next.delete(id)); return next })} /></label><span>{mode === 'notes' ? 'Knowledge' : 'Practice prompt'}</span><span>{mode === 'notes' ? 'Practice prompts' : 'Type'}</span><span>Status</span><span className="visually-hidden">Actions</span></div>
        {mode === 'notes' && visibleItems.map((item) => {
          const cards = cardsByItem.get(item.id) || []
          const active = cards.filter((card) => !card.suspended)
          const nextDue = active.map((card) => new Date(card.fsrs.due)).sort((a, b) => a.getTime() - b.getTime())[0]
          const health = analyzeCardHealth(item.prompt, item.answer, item.citations)
          const checks = itemHealth(item, cards, duplicatePrompts, assetIds)
          return (
            <article className="library-row" role="listitem" key={item.id}>
              <label className="row-select"><input type="checkbox" aria-label={`Select ${item.prompt}`} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} /></label>
              <div className="knowledge-cell"><span className="collection-label">{item.collection}</span><strong>{item.prompt || 'Empty prompt'}</strong><p>{item.answer || 'Empty answer'}</p><div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}{checks.quality && <span className="health-warning" title={health.map((finding) => finding.message).join(' ')}>quality warning</span>}{checks.empty && <span className="health-error">empty content</span>}{checks.duplicate && <span className="health-warning">duplicate prompt</span>}{checks.media && <span className="health-error">missing media</span>}{item.citations.length > 0 && <span>{item.citations.length} source{item.citations.length === 1 ? '' : 's'}</span>}</div></div>
              <div className="variant-cell">{cards.map((card) => <button key={card.id} aria-pressed={!card.suspended} className={card.suspended ? 'variant-pill suspended' : 'variant-pill'} onClick={() => toggleSuspend(card.id)} title={card.suspended ? 'Resume practice prompt' : 'Suspend practice prompt'}>{card.flags ? <Flag size={12} aria-label={`Flag ${card.flags}`} /> : null}{promptTypeLabels.get(card.variant) || card.variant}{card.suspended && ' · suspended'}{card.buriedUntil && new Date(card.buriedUntil) > new Date() ? ` · ${card.buriedBy === 'user' ? 'user buried' : 'sibling buried'}` : ''}</button>)}</div>
              <div className="status-cell"><strong>{active.length ? (active.some((card) => card.fsrs.state === State.New) ? 'New' : nextDue ? formatDue(nextDue.toISOString()) : 'Active') : 'Paused'}</strong><span>{cards.reduce((sum, card) => sum + card.fsrs.reps, 0)} reviews</span></div>
              <div className="row-actions"><button className="icon-button" onClick={() => setEditing(item)} aria-label={`Edit ${item.prompt}`}><Edit3 size={18} /></button><button className="icon-button danger-hover" onClick={() => { if (window.confirm('Move this knowledge item to Trash? Its practice prompts and review history will be preserved.')) { deleteItem(item.id); setRecentlyTrashed({ id: item.id, name: item.prompt }) } }} aria-label={`Move ${item.prompt} to Trash`}><Trash2 size={18} /></button></div>
            </article>
          )
        })}
        {mode === 'cards' && visibleCards.map((card) => {
          const item = itemById.get(card.itemId)
          if (!item) return null
          const buried = Boolean(card.buriedUntil && new Date(card.buriedUntil) > new Date())
          return <article className="library-row card-browser-row" role="listitem" key={card.id}>
            <label className="row-select"><input type="checkbox" aria-label={`Select practice prompt ${item.prompt} ${card.variant}`} checked={selected.has(card.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(card.id); else next.delete(card.id); return next })} /></label>
            <div className="knowledge-cell"><span className="collection-label">{card.deckName || item.collection}</span><strong>{item.prompt}</strong><p>{item.answer}</p><div className="tag-row"><span>Practice prompt ID {card.id}</span>{item.noteModel && <span>{item.noteModel.noteTypeName}</span>}</div></div>
            <div className="variant-cell"><button aria-pressed={!card.suspended} className={card.suspended ? 'variant-pill suspended' : 'variant-pill'} onClick={() => toggleSuspend(card.id)}>{card.flags ? <Flag size={12} aria-label={`Flag ${card.flags}`} /> : null}{promptTypeLabels.get(card.variant) || card.variant}{card.suspended ? ' · suspended' : ''}</button></div>
            <div className="status-cell"><strong>{card.suspended ? 'Suspended' : buried ? (card.buriedBy === 'user' ? 'User buried' : 'Sibling buried') : formatDue(card.fsrs.due)}</strong><span>{card.fsrs.reps} reviews</span></div>
            <div className="row-actions"><button className="icon-button" onClick={() => setEditing(item)} aria-label={`Edit knowledge item for ${item.prompt}`}><Edit3 size={18} /></button></div>
          </article>
        })}
        {!visibleTotal && data.items.length === 0 && <div className="empty-state"><Archive size={30} /><h2>Your Library is empty</h2><p>Add one knowledge item and Neo Anki will turn it into practice prompts.</p><button className="primary-button" onClick={() => navigate('create')}><Plus size={18} /> Add your first knowledge item</button></div>}
        {!visibleTotal && data.items.length > 0 && <div className="empty-state"><Archive size={30} /><h2>No matching {mode === 'notes' ? 'knowledge items' : 'practice prompts'}</h2><p>{healthFilter === 'all' ? 'Your current search or collection filter excludes every result.' : 'No matching collection problems were found.'}</p><button className="secondary-button" onClick={() => { setQuery(''); setCollection('All collections'); setHealthFilter('all'); setVisibleCount(LIBRARY_PAGE_SIZE) }}><MoreHorizontal size={18} /> Clear filters</button></div>}
      </section>
      {visibleTotal > (mode === 'notes' ? visibleItems.length : visibleCards.length) && <div className="library-pagination"><p aria-live="polite">Showing {mode === 'notes' ? visibleItems.length : visibleCards.length} of {visibleTotal} matching {mode === 'notes' ? 'knowledge items' : 'practice prompts'}.</p><button className="secondary-button" onClick={() => setVisibleCount((count) => Math.min(visibleTotal, count + LIBRARY_PAGE_SIZE))}>Show {Math.min(LIBRARY_PAGE_SIZE, visibleTotal - (mode === 'notes' ? visibleItems.length : visibleCards.length))} more</button></div>}
      {recentlyTrashed && data.trash.some((entry) => entry.id === recentlyTrashed.id) && <div className="undo-banner" role="status"><span><Trash2 size={17}/><span><strong>Moved to Trash</strong><small>{recentlyTrashed.name}</small></span></span><button className="secondary-button compact" onClick={() => { restoreItem(recentlyTrashed.id); setRecentlyTrashed(null) }}><Undo2 size={16}/> Undo</button></div>}
      {data.trash.length > 0 && <details className="trash-panel"><summary><span><Archive size={18}/> Trash</span><small>{data.trash.length} {data.trash.length === 1 ? 'item' : 'items'}</small></summary><p>Deleted knowledge stays recoverable. Review events remain in your history even after permanent removal.</p><div className="trash-list">{data.trash.map((entry) => <div key={entry.id}><span><strong>{entry.item.prompt}</strong><small>Deleted {new Date(entry.deletedAt).toLocaleString()}</small></span><span><button className="secondary-button compact" onClick={() => restoreItem(entry.id)}><ArchiveRestore size={16}/> Restore</button><button className="text-button danger" onClick={() => window.confirm('Permanently remove this content from Trash? Its historical review events will remain, but the knowledge item cannot be restored.') && purgeItem(entry.id)}><Trash2 size={16}/> Remove permanently</button></span></div>)}</div></details>}
      {editing && <KnowledgeItemEditor item={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
