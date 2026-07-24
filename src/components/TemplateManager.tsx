import { CheckCircle2, Layers3, LoaderCircle, Plus, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CardTemplate, Deck, DeckPreset, FieldDefinition, NoteType, WorkspaceDocumentV4, WorkspacePatchOperationV2 } from '../../packages/compatibility-domain/src/index'
import { renderWorkspaceCard } from '../lib/card-rendering'
import { useApp } from '../state/AppContext'
import { NativeCardContent } from './NativeCardContent'

const stepsText = (values: number[]) => values.join(', ')
const parseSteps = (value: string) => {
  const steps = value.split(',').map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part > 0)
  if (!steps.length) throw new Error('Enter at least one positive learning step in minutes.')
  return steps
}

const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right)

export const TemplateManager = () => {
  const { loadWorkspaceDocument, applyCoreWorkspacePatch } = useApp()
  const [document, setDocument] = useState<WorkspaceDocumentV4 | null>(null)
  const [noteTypeId, setNoteTypeId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [deckId, setDeckId] = useState('')
  const [noteType, setNoteType] = useState<NoteType | null>(null)
  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [template, setTemplate] = useState<CardTemplate | null>(null)
  const [preset, setPreset] = useState<DeckPreset | null>(null)
  const [deck, setDeck] = useState<Deck | null>(null)
  const [learningSteps, setLearningSteps] = useState('')
  const [relearningSteps, setRelearningSteps] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const chooseTemplate = (source: WorkspaceDocumentV4, id: string) => {
    setTemplateId(id)
    setTemplate(id ? structuredClone(source.workspace.templates.find((value) => value.id === id) || null) : null)
  }

  const chooseNoteType = (source: WorkspaceDocumentV4, id: string, preferredTemplateId = '') => {
    setNoteTypeId(id)
    const selected = source.workspace.noteTypes.find((value) => value.id === id) || null
    setNoteType(selected ? structuredClone(selected) : null)
    const selectedFields = selected ? selected.fieldIds.map((fieldId) => source.workspace.fields.find((value) => value.id === fieldId)).filter((value): value is FieldDefinition => Boolean(value)).map((value) => structuredClone(value)) : []
    setFields(selectedFields)
    chooseTemplate(source, selected?.templateIds.includes(preferredTemplateId) ? preferredTemplateId : selected?.templateIds[0] || '')
  }

  const choosePreset = (source: WorkspaceDocumentV4, id: string) => {
    setPresetId(id)
    const selected = source.workspace.presets.find((value) => value.id === id) || null
    setPreset(selected ? structuredClone(selected) : null)
    setLearningSteps(selected ? stepsText(selected.learningStepsMinutes) : '')
    setRelearningSteps(selected ? stepsText(selected.relearningStepsMinutes) : '')
  }

  const chooseDeck = (source: WorkspaceDocumentV4, id: string) => {
    setDeckId(id)
    const selected = source.workspace.decks.find((value) => value.id === id) || null
    setDeck(structuredClone(selected))
    if (selected) choosePreset(source, selected.presetId)
  }

  useEffect(() => {
    let current = true
    void loadWorkspaceDocument().then((next) => {
      if (!current) return
      const firstType = next.workspace.noteTypes[0] || null
      const firstTemplateId = firstType?.templateIds[0] || ''
      const firstPreset = next.workspace.presets[0] || null
      const firstDeck = next.workspace.decks[0] || null
      setDocument(next); setNoteTypeId(firstType?.id || ''); setNoteType(firstType ? structuredClone(firstType) : null)
      setFields(firstType ? firstType.fieldIds.map((id) => next.workspace.fields.find((value) => value.id === id)).filter((value): value is FieldDefinition => Boolean(value)).map((value) => structuredClone(value)) : [])
      setTemplateId(firstTemplateId); setTemplate(firstTemplateId ? structuredClone(next.workspace.templates.find((value) => value.id === firstTemplateId) || null) : null)
      setPresetId(firstPreset?.id || ''); setPreset(firstPreset ? structuredClone(firstPreset) : null); setLearningSteps(firstPreset ? stepsText(firstPreset.learningStepsMinutes) : ''); setRelearningSteps(firstPreset ? stepsText(firstPreset.relearningStepsMinutes) : '')
      setDeckId(firstDeck?.id || ''); setDeck(firstDeck ? structuredClone(firstDeck) : null)
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load card templates.') })
    return () => { current = false }
  }, [loadWorkspaceDocument])

  const reload = async (preferredNoteTypeId = noteTypeId, preferredTemplateId = templateId) => {
    const next = await loadWorkspaceDocument()
    setDocument(next)
    chooseNoteType(next, next.workspace.noteTypes.some((value) => value.id === preferredNoteTypeId) ? preferredNoteTypeId : next.workspace.noteTypes[0]?.id || '', preferredTemplateId)
    choosePreset(next, next.workspace.presets.some((value) => value.id === presetId) ? presetId : next.workspace.presets[0]?.id || '')
    chooseDeck(next, next.workspace.decks.some((value) => value.id === deckId) ? deckId : next.workspace.decks[0]?.id || '')
  }

  const preview = useMemo(() => {
    if (!document || !noteType || !template) return null
    const note = document.workspace.notes.find((value) => value.noteTypeId === noteType.id)
    const storedCard = note ? document.workspace.cards.find((value) => value.noteId === note.id && value.templateId === template.id) || document.workspace.cards.find((value) => value.noteId === note.id) : undefined
    const card = storedCard ? { ...storedCard, templateId: template.id, ordinal: template.ordinal } : undefined
    if (!note || !card) return null
    return renderWorkspaceCard(card, note, template, fields.map((field) => ({ id: field.id, name: field.name })))
  }, [document, noteType, template, fields])
  const templateIsNew = Boolean(template && document && !document.workspace.templates.some((value) => value.id === template.id))

  const commit = async (label: string, operations: WorkspacePatchOperationV2[], selection?: { noteTypeId: string; templateId?: string }) => {
    if (!document || !operations.length) { setMessage('No changes to save.'); return false }
    setBusy(true); setError(''); setMessage('')
    try {
      await applyCoreWorkspacePatch({ version: 2, idempotencyKey: `core-editor:${crypto.randomUUID()}`, expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations })
      setMessage(`${label} saved atomically.`)
      await reload(selection?.noteTypeId, selection?.templateId)
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not save ${label.toLowerCase()}. Reload and try again.`) }
    finally { setBusy(false) }
    return false
  }

  const saveNoteType = async () => {
    if (!document || !noteType) return
    const now = new Date().toISOString(); const operations: WorkspacePatchOperationV2[] = []
    const originalType = document.workspace.noteTypes.find((value) => value.id === noteType.id)
    if (originalType && changed(originalType, noteType)) operations.push({ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: originalType.revision, value: { ...noteType, revision: originalType.revision + 1, updatedAt: now } })
    for (const field of fields) {
      const original = document.workspace.fields.find((value) => value.id === field.id)
      if (!original) operations.push({ op: 'create', kind: 'field', id: field.id, value: field })
      else if (changed(original, field)) operations.push({ op: 'update', kind: 'field', id: field.id, expectedRevision: original.revision, value: { ...field, revision: original.revision + 1, updatedAt: now } })
    }
    if (template) {
      const original = document.workspace.templates.find((value) => value.id === template.id)
      if (!original) operations.push({ op: 'create', kind: 'template', id: template.id, value: template })
      else if (changed(original, template)) operations.push({ op: 'update', kind: 'template', id: template.id, expectedRevision: original.revision, value: { ...template, revision: original.revision + 1, updatedAt: now } })
    }
    await commit('Content type and template', operations)
  }

  const createContentType = async () => {
    if (!document) return
    const profile = document.workspace.profiles.find((value) => value.active) || document.workspace.profiles[0]
    if (!profile) { setError('Create a profile before adding a content type.'); return }
    const now = new Date().toISOString()
    const typeId = `content-type:${crypto.randomUUID()}`
    const promptFieldId = `field:${crypto.randomUUID()}`
    const answerFieldId = `field:${crypto.randomUUID()}`
    const contextFieldId = `field:${crypto.randomUUID()}`
    const nextTemplateId = `template:${crypto.randomUUID()}`
    const nextFields: FieldDefinition[] = [
      { id: promptFieldId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Prompt', ordinal: 0, rtl: false, sticky: false },
      { id: answerFieldId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Answer', ordinal: 1, rtl: false, sticky: false },
      { id: contextFieldId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Context', ordinal: 2, rtl: false, sticky: false },
    ]
    const nextTemplate: CardTemplate = { id: nextTemplateId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Recall', ordinal: 0, promptFieldId, answerFieldId, supportingFieldIds: [contextFieldId], responseMode: 'reveal' }
    const nextType: NoteType = { id: typeId, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, name: 'New content type', fieldIds: nextFields.map((field) => field.id), templateIds: [nextTemplateId], kind: 'standard' }
    await commit('Content type', [
      ...nextFields.map((field): WorkspacePatchOperationV2 => ({ op: 'create', kind: 'field', id: field.id, value: field })),
      { op: 'create', kind: 'template', id: nextTemplate.id, value: nextTemplate },
      { op: 'create', kind: 'noteType', id: nextType.id, value: nextType },
    ], { noteTypeId: typeId, templateId: nextTemplateId })
  }

  const addField = () => {
    if (!noteType) return
    const now = new Date().toISOString()
    const field: FieldDefinition = { id: `field:${crypto.randomUUID()}`, revision: 1, createdAt: now, updatedAt: now, noteTypeId: noteType.id, name: `Field ${fields.length + 1}`, ordinal: fields.length, rtl: false, sticky: false }
    setFields((current) => [...current, field])
    setNoteType({ ...noteType, fieldIds: [...noteType.fieldIds, field.id] })
  }

  const addTemplate = () => {
    if (!noteType || fields.length < 2) { setError('Add at least two fields before creating a card template.'); return }
    const now = new Date().toISOString()
    const nextTemplate: CardTemplate = { id: `template:${crypto.randomUUID()}`, revision: 1, createdAt: now, updatedAt: now, noteTypeId: noteType.id, name: `Card ${noteType.templateIds.length + 1}`, ordinal: noteType.templateIds.length, promptFieldId: fields[0].id, answerFieldId: fields[1].id, supportingFieldIds: fields.slice(2).map((field) => field.id), responseMode: 'reveal' }
    setTemplate(nextTemplate)
    setTemplateId(nextTemplate.id)
    setNoteType({ ...noteType, templateIds: [...noteType.templateIds, nextTemplate.id] })
  }

  const savePreset = async () => {
    if (!document || !preset || !deck) return
    const now = new Date().toISOString()
    let nextPreset: DeckPreset
    try { nextPreset = { ...preset, learningStepsMinutes: parseSteps(learningSteps), relearningStepsMinutes: parseSteps(relearningSteps) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Learning steps are invalid.'); return }
    const operations: WorkspacePatchOperationV2[] = []
    const originalPreset = document.workspace.presets.find((value) => value.id === preset.id)!
    const originalDeck = document.workspace.decks.find((value) => value.id === deck.id)!
    if (changed(originalPreset, nextPreset)) operations.push({ op: 'update', kind: 'preset', id: preset.id, expectedRevision: originalPreset.revision, value: { ...nextPreset, revision: originalPreset.revision + 1, updatedAt: now } })
    if (changed(originalDeck, deck)) operations.push({ op: 'update', kind: 'deck', id: deck.id, expectedRevision: originalDeck.revision, value: { ...deck, revision: originalDeck.revision + 1, updatedAt: now } })
    await commit('Deck and preset', operations)
  }

  if (!document) return <div className="setting-block template-manager"><strong>Card templates</strong>{error ? <p className="inline-error" role="alert">{error}</p> : <p><LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading fields and templates…</p>}</div>

  return <div className="setting-block template-manager">
    <div className="template-heading"><span><Settings2 size={19} aria-hidden="true" /><span><strong>Card templates</strong><p>Choose which fields appear as the prompt, answer, and supporting context. Every card uses the app’s native typography, spacing, colors, and accessibility behavior.</p></span></span></div>
    <details>
      <summary>Fields and card layouts</summary>
      <div className="template-editor">
        <div className="template-picker-row"><label className="form-field"><span>Content type</span><select aria-label="Content type" value={noteTypeId} onChange={(event) => chooseNoteType(document, event.target.value)}>{document.workspace.noteTypes.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void createContentType()}><Plus size={16} /> New content type</button></div>
        {noteType && <>
          <div className="field-grid"><label className="form-field"><span>Content type name</span><input value={noteType.name} onChange={(event) => setNoteType({ ...noteType, name: event.target.value })} /></label><label className="form-field"><span>Behavior</span><input value={noteType.kind === 'deletion' ? 'Text deletion' : 'Prompt and answer'} readOnly aria-readonly="true" /></label></div>
          <fieldset className="sub-editor"><legend>Fields</legend>{fields.map((field) => <div className="template-field-row" key={field.id}><label className="form-field"><span>Field {field.ordinal + 1} name</span><input value={field.name} onChange={(event) => setFields((current) => current.map((value) => value.id === field.id ? { ...value, name: event.target.value } : value))} /></label><label className="check-row" aria-label={`Right-to-left ${field.name}`}><input type="checkbox" checked={field.rtl} onChange={(event) => setFields((current) => current.map((value) => value.id === field.id ? { ...value, rtl: event.target.checked } : value))} /><span><strong>Right-to-left</strong></span></label></div>)}<button type="button" className="text-button" onClick={addField}><Plus size={16} /> Add field</button></fieldset>
          <div className="template-picker-row"><label className="form-field"><span>Card template</span><select value={templateId} disabled={templateIsNew} onChange={(event) => chooseTemplate(document, event.target.value)}>{noteType.templateIds.map((id) => document.workspace.templates.find((value) => value.id === id) || (template?.id === id ? template : undefined)).filter((value): value is CardTemplate => Boolean(value)).map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select>{templateIsNew && <small>Save this new template before switching.</small>}</label><button type="button" className="secondary-button compact" disabled={templateIsNew} onClick={addTemplate}><Plus size={16} /> Add card template</button></div>
          {template && <fieldset className="sub-editor template-layout-editor"><legend>Layout</legend><label className="form-field"><span>Template name</span><input value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} /></label><div className="field-grid"><label className="form-field"><span>Prompt field</span><select value={template.promptFieldId} onChange={(event) => setTemplate({ ...template, promptFieldId: event.target.value, supportingFieldIds: template.supportingFieldIds.filter((id) => id !== event.target.value) })}>{fields.map((field) => <option disabled={field.id === template.answerFieldId} key={field.id} value={field.id}>{field.name}</option>)}</select></label><label className="form-field"><span>Answer field</span><select value={template.answerFieldId} onChange={(event) => setTemplate({ ...template, answerFieldId: event.target.value, supportingFieldIds: template.supportingFieldIds.filter((id) => id !== event.target.value) })}>{fields.map((field) => <option disabled={field.id === template.promptFieldId} key={field.id} value={field.id}>{field.name}</option>)}</select></label></div><label className="form-field"><span>Answer interaction</span><select value={template.responseMode} onChange={(event) => setTemplate({ ...template, responseMode: event.target.value as 'reveal' | 'type' })}><option value="reveal">Reveal the answer</option><option value="type">Type, then compare</option></select></label><fieldset className="template-supporting-fields"><legend>Supporting fields shown after reveal</legend>{fields.filter((field) => field.id !== template.promptFieldId && field.id !== template.answerFieldId).map((field) => <label className="check-row" aria-label={`${field.name || 'Unnamed field'} supporting field`} key={field.id}><input type="checkbox" checked={template.supportingFieldIds.includes(field.id)} onChange={(event) => setTemplate({ ...template, supportingFieldIds: event.target.checked ? [...template.supportingFieldIds, field.id] : template.supportingFieldIds.filter((id) => id !== field.id) })} /><span><strong>{field.name}</strong></span></label>)}</fieldset></fieldset>}
          <div className="template-preview"><strong>Live preview</strong>{preview ? <NativeCardContent content={preview} revealed /> : <p>Add an item with this content type to preview it here.</p>}</div>
          <button className="primary-button" disabled={busy || !noteType.name.trim() || fields.some((field) => !field.name.trim()) || !template} onClick={() => void saveNoteType()}>{busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Save fields and templates</button>
        </>}
      </div>
    </details>
    <details>
      <summary>Deck presets and scheduling limits</summary>
      <div className="template-editor">
        <label className="form-field"><span>Deck</span><select aria-label="Deck" value={deckId} onChange={(event) => chooseDeck(document, event.target.value)}>{document.workspace.decks.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
        {deck && <label className="form-field"><span>Preset used by this deck</span><select aria-label="Preset used by this deck" value={deck.presetId} onChange={(event) => { setDeck({ ...deck, presetId: event.target.value }); choosePreset(document, event.target.value) }}>{document.workspace.presets.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>}
        <label className="form-field"><span>Edit preset</span><select aria-label="Edit preset" value={presetId} onChange={(event) => choosePreset(document, event.target.value)}>{document.workspace.presets.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
        {preset && <><label className="form-field"><span>Preset name</span><input value={preset.name} onChange={(event) => setPreset({ ...preset, name: event.target.value })} /></label>
          <div className="field-grid"><label className="form-field"><span>Desired retention</span><input type="number" min="0.8" max="0.99" step="0.01" value={preset.desiredRetention} onChange={(event) => setPreset({ ...preset, desiredRetention: Number(event.target.value) })} /></label><label className="form-field"><span>Maximum interval (days)</span><input type="number" min="1" max="36500" value={preset.maximumIntervalDays} onChange={(event) => setPreset({ ...preset, maximumIntervalDays: Number(event.target.value) })} /></label></div>
          <div className="field-grid"><label className="form-field"><span>Learning steps (minutes)</span><input aria-label="Learning steps (minutes)" value={learningSteps} onChange={(event) => setLearningSteps(event.target.value)} aria-describedby="learning-step-help" /><small id="learning-step-help">Comma-separated, for example 1, 10.</small></label><label className="form-field"><span>Relearning steps (minutes)</span><input aria-label="Relearning steps (minutes)" value={relearningSteps} onChange={(event) => setRelearningSteps(event.target.value)} /></label></div>
          <div className="field-grid"><label className="form-field"><span>New cards per day</span><input type="number" min="0" max="9999" value={preset.newCardsPerDay} onChange={(event) => setPreset({ ...preset, newCardsPerDay: Number(event.target.value) })} /></label><label className="form-field"><span>Reviews per day</span><input type="number" min="0" max="9999" value={preset.reviewsPerDay} onChange={(event) => setPreset({ ...preset, reviewsPerDay: Number(event.target.value) })} /></label></div>
          <div className="field-grid"><label className="form-field"><span>Leech threshold</span><input type="number" min="1" max="100" value={preset.leechThreshold} onChange={(event) => setPreset({ ...preset, leechThreshold: Number(event.target.value) })} /></label><label className="form-field"><span>Leech action</span><select value={preset.leechAction} onChange={(event) => setPreset({ ...preset, leechAction: event.target.value as 'flag' | 'suspend' })}><option value="flag">Flag for repair</option><option value="suspend">Flag and suspend</option></select></label></div>
          <label className="check-row" aria-label="Bury new siblings"><input type="checkbox" checked={preset.buryNewSiblings} onChange={(event) => setPreset({ ...preset, buryNewSiblings: event.target.checked })} /><span><strong>Bury new siblings</strong></span></label><label className="check-row" aria-label="Bury review siblings"><input type="checkbox" checked={preset.buryReviewSiblings} onChange={(event) => setPreset({ ...preset, buryReviewSiblings: event.target.checked })} /><span><strong>Bury review siblings</strong></span></label>
          <button className="primary-button" disabled={busy || !preset.name.trim()} onClick={() => void savePreset()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Layers3 size={17} />} Save deck and preset</button></>}
      </div>
    </details>
    {message && <p className="inline-message" role="status">{message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>
}
