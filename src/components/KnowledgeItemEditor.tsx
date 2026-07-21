import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../state/AppContext'
import type { KnowledgeItem } from '../types'
import { useModalDialog } from './useModalDialog'

export const KnowledgeItemEditor = ({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) => {
  const { updateItem } = useApp()
  const [draft, setDraft] = useState(item)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(item)
  const isNeoBasic = Boolean(draft.noteModel && (draft.noteModel.noteTypeId === 'note-type:neo-basic' || draft.noteModel.noteTypeId.startsWith('note-type:neo:')))
  const updateNamedField = (fieldId: string, value: string) => {
    setDraft((current) => {
      if (!current.noteModel) return current
      const fields = current.noteModel.fields.map((field) => field.id === fieldId ? { ...field, value } : field)
      const ordered = fields.slice().sort((left, right) => left.ordinal - right.ordinal)
      return {
        ...current,
        prompt: ordered[0]?.value ?? current.prompt,
        answer: ordered[1]?.value ?? ordered[0]?.value ?? current.answer,
        context: ordered.slice(2).map((field) => field.value).filter(Boolean).join('\n'),
        noteModel: { ...current.noteModel, fields },
      }
    })
  }
  const closeWhenIdle = () => { if (!saving) onClose() }
  const [dialogRef, requestClose, onBackdropMouseDown] = useModalDialog<HTMLFormElement>(closeWhenIdle, { dirty: dirty && !saving, dirtyMessage: 'Discard unsaved edits to this knowledge item?' })
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const ordered = draft.noteModel?.fields.slice().sort((left, right) => left.ordinal - right.ordinal)
    setSaving(true)
    setSaveError('')
    try {
      await updateItem(item.id, { prompt: ordered?.[0]?.value ?? draft.prompt, answer: ordered?.[1]?.value ?? ordered?.[0]?.value ?? draft.answer, context: ordered ? ordered.slice(2).map((field) => field.value).filter(Boolean).join('\n') : draft.context, collection: draft.collection, tags: draft.tags, source: draft.source, citations: draft.citations, noteModel: draft.noteModel })
      onClose()
    } catch (error) {
      setSaveError(`${error instanceof Error ? error.message : 'Neo Anki could not save this knowledge item.'} Your edits are still open; try again.`)
      setSaving(false)
    }
  }
  return (
    <div className="scrim" role="presentation" onMouseDown={onBackdropMouseDown}>
      <form ref={dialogRef} tabIndex={-1} className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" aria-busy={saving} onSubmit={save}>
        <div className="panel-header"><div><p className="eyebrow">Knowledge item</p><h2 id="edit-title">Edit content</h2></div><button type="button" className="icon-button" onClick={requestClose} aria-label="Close editor" disabled={saving}><X size={20} /></button></div>
        <fieldset className="dialog-save-fields" disabled={saving}>
        {draft.noteModel ? <fieldset className="sub-editor note-field-editor"><legend>{isNeoBasic ? 'Knowledge content' : `Named fields · ${draft.noteModel.noteTypeName}`}</legend>{draft.noteModel.fields.slice().sort((left, right) => left.ordinal - right.ordinal).map((field) => {
          const label = isNeoBasic && field.ordinal < 3 ? ['Prompt', 'Answer', 'Context'][field.ordinal] : field.name
          return <div className="form-field" key={field.id}><label htmlFor={`edit-field-${field.id}`}>{label}{isNeoBasic && field.ordinal === 2 && <span aria-hidden="true"> Optional</span>}</label><textarea id={`edit-field-${field.id}`} rows={field.ordinal === 0 ? 4 : 3} value={field.value} onChange={(event) => updateNamedField(field.id, event.target.value)} required={isNeoBasic && field.ordinal < 2} /></div>
        })}</fieldset> : <><div className="form-field"><label htmlFor="edit-prompt">Prompt</label><textarea id="edit-prompt" rows={4} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} required /></div><div className="form-field"><label htmlFor="edit-answer">Answer</label><textarea id="edit-answer" rows={3} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} required /></div><div className="form-field"><label htmlFor="edit-context">Context</label><textarea id="edit-context" rows={2} value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })} /></div></>}
        <div className="field-grid"><div className="form-field"><label htmlFor="edit-collection">Collection</label><input id="edit-collection" value={draft.collection} onChange={(event) => setDraft({ ...draft, collection: event.target.value })} /></div><div className="form-field"><label htmlFor="edit-tags">Tags</label><input id="edit-tags" value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></div></div>
        <fieldset className="sub-editor"><legend>Sources & citations</legend>{draft.citations.map((citation, index) => <div className="citation-row" key={citation.id}><input aria-label={`Edit citation ${index + 1} title`} value={citation.title} onChange={(event) => setDraft({ ...draft, citations: draft.citations.map((value) => value.id === citation.id ? { ...value, title: event.target.value } : value) })}/><input aria-label={`Edit citation ${index + 1} URL`} type="url" value={citation.url || ''} onChange={(event) => setDraft({ ...draft, citations: draft.citations.map((value) => value.id === citation.id ? { ...value, url: event.target.value } : value) })}/><button type="button" className="icon-button" aria-label={`Remove citation ${index + 1}`} onClick={() => setDraft({ ...draft, citations: draft.citations.filter((value) => value.id !== citation.id) })}><Trash2 size={17}/></button></div>)}<button type="button" className="text-button" onClick={() => setDraft({ ...draft, citations: [...draft.citations, { id: crypto.randomUUID(), title: '', url: '' }] })}><Plus size={16}/> Add citation</button></fieldset>
        {saveError && <p className="inline-message error" role="alert">{saveError}</p>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={requestClose}>Cancel</button><button className="primary-button" type="submit" disabled={!dirty || saving || !draft.prompt.trim() || !draft.answer.trim()}>{saving ? 'Saving…' : 'Save changes'}</button></div>
        </fieldset>
      </form>
    </div>
  )
}
