import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../state/AppContext'
import type { KnowledgeItem } from '../types'
import { useModalDialog } from './useModalDialog'

export const KnowledgeItemEditor = ({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) => {
  const { data, updateItem } = useApp()
  const [draft, setDraft] = useState(item)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(item)
  const primaryRendering = data.cards.find((card) => card.itemId === item.id && card.rendering)?.rendering
  const orderedDraftFields = draft.contentModel?.fields.slice().sort((left, right) => left.ordinal - right.ordinal) || []
  const promptFieldId = primaryRendering?.prompt.id || orderedDraftFields[0]?.id
  const answerFieldId = primaryRendering?.answer.id || orderedDraftFields[1]?.id || orderedDraftFields[0]?.id
  const projectFields = (fields: NonNullable<KnowledgeItem['contentModel']>['fields'], current: KnowledgeItem) => {
    const ordered = fields.slice().sort((left, right) => left.ordinal - right.ordinal)
    const values = new Map(fields.map((field) => [field.id, field.value]))
    return {
      prompt: values.get(primaryRendering?.prompt.id || '') ?? ordered[0]?.value ?? current.prompt,
      answer: values.get(primaryRendering?.answer.id || '') ?? ordered[1]?.value ?? ordered[0]?.value ?? current.answer,
      context: primaryRendering
        ? primaryRendering.supporting.map((field) => values.get(field.id) || '').filter(Boolean).join('\n')
        : ordered.slice(2).map((field) => field.value).filter(Boolean).join('\n'),
    }
  }
  const updateNamedField = (fieldId: string, value: string) => {
    setDraft((current) => {
      if (!current.contentModel) return current
      const fields = current.contentModel.fields.map((field) => field.id === fieldId ? { ...field, value } : field)
      return {
        ...current,
        ...projectFields(fields, current),
        contentModel: { ...current.contentModel, fields },
      }
    })
  }
  const closeWhenIdle = () => { if (!saving) onClose() }
  const [dialogRef, requestClose, onBackdropMouseDown] = useModalDialog<HTMLFormElement>(closeWhenIdle, { dirty: dirty && !saving, dirtyMessage: 'Discard unsaved edits to this knowledge item?' })
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const projected = draft.contentModel ? projectFields(draft.contentModel.fields, draft) : draft
    setSaving(true)
    setSaveError('')
    try {
      await updateItem(item.id, { prompt: projected.prompt, answer: projected.answer, context: projected.context, collection: draft.collection, tags: draft.tags, source: draft.source, citations: draft.citations, contentModel: draft.contentModel })
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
        {draft.contentModel ? <fieldset className="sub-editor note-field-editor"><legend>{`Fields · ${draft.contentModel.contentTypeName}`}</legend>{draft.contentModel.fields.slice().sort((left, right) => left.ordinal - right.ordinal).map((field) => {
          const required = field.id === promptFieldId || field.id === answerFieldId
          return <div className="form-field" key={field.id}><label htmlFor={`edit-field-${field.id}`}>{field.name}{!required && <span aria-hidden="true"> Optional</span>}</label><textarea id={`edit-field-${field.id}`} rows={field.id === promptFieldId ? 4 : 3} value={field.value} onChange={(event) => updateNamedField(field.id, event.target.value)} required={required} /></div>
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
