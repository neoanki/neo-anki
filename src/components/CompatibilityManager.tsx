import { CheckCircle2, Code2, Layers3, LoaderCircle, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CardTemplate, Deck, DeckPreset, FieldDefinition, NoteType, WorkspaceDocumentV4, WorkspacePatchOperationV2 } from '../../packages/compatibility-domain/src/index'
import { renderWorkspaceCard } from '../lib/card-rendering'
import { useApp } from '../state/AppContext'
import { SandboxedCardFrame } from './SandboxedCardFrame'

const stepsText = (values: number[]) => values.join(', ')
const parseSteps = (value: string) => {
  const steps = value.split(',').map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part > 0)
  if (!steps.length) throw new Error('Enter at least one positive learning step in minutes.')
  return steps
}

const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right)

export const CompatibilityManager = () => {
  const { data, loadWorkspaceDocument, applyCoreWorkspacePatch } = useApp()
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
    setDeck(structuredClone(source.workspace.decks.find((value) => value.id === id) || null))
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
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load compatibility settings.') })
    return () => { current = false }
  }, [loadWorkspaceDocument])

  const reload = async () => {
    const next = await loadWorkspaceDocument()
    setDocument(next)
    chooseNoteType(next, next.workspace.noteTypes.some((value) => value.id === noteTypeId) ? noteTypeId : next.workspace.noteTypes[0]?.id || '', templateId)
    choosePreset(next, next.workspace.presets.some((value) => value.id === presetId) ? presetId : next.workspace.presets[0]?.id || '')
    chooseDeck(next, next.workspace.decks.some((value) => value.id === deckId) ? deckId : next.workspace.decks[0]?.id || '')
  }

  const preview = useMemo(() => {
    if (!document || !noteType || !template) return null
    const note = document.workspace.notes.find((value) => value.noteTypeId === noteType.id)
    const card = note ? document.workspace.cards.find((value) => value.noteId === note.id && value.templateId === template.id) || document.workspace.cards.find((value) => value.noteId === note.id) : undefined
    if (!note || !card) return null
    const activeDeck = document.workspace.decks.find((value) => value.id === card.deckId)
    return renderWorkspaceCard(card, note, noteType, template, fields.map((field) => ({ id: field.id, name: field.name })), activeDeck?.name || 'Default', document.workspace.media, (asset) => `neoanki-media://asset/${encodeURIComponent(asset.id)}?v=${asset.sha256.slice(0, 16)}`)
  }, [document, noteType, template, fields])

  const commit = async (label: string, operations: WorkspacePatchOperationV2[]) => {
    if (!document || !operations.length) { setMessage('No changes to save.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await applyCoreWorkspacePatch({ version: 2, idempotencyKey: `core-editor:${crypto.randomUUID()}`, expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations })
      setMessage(`${label} saved atomically.`)
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not save ${label.toLowerCase()}. Reload and try again.`) }
    finally { setBusy(false) }
  }

  const saveNoteType = async () => {
    if (!document || !noteType) return
    const now = new Date().toISOString(); const operations: WorkspacePatchOperationV2[] = []
    const originalType = document.workspace.noteTypes.find((value) => value.id === noteType.id)!
    if (changed(originalType, noteType)) operations.push({ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: originalType.revision, value: { ...noteType, revision: originalType.revision + 1, updatedAt: now } })
    for (const field of fields) {
      const original = document.workspace.fields.find((value) => value.id === field.id)!
      if (changed(original, field)) operations.push({ op: 'update', kind: 'field', id: field.id, expectedRevision: original.revision, value: { ...field, revision: original.revision + 1, updatedAt: now } })
    }
    if (template) {
      const original = document.workspace.templates.find((value) => value.id === template.id)!
      if (changed(original, template)) operations.push({ op: 'update', kind: 'template', id: template.id, expectedRevision: original.revision, value: { ...template, revision: original.revision + 1, updatedAt: now } })
    }
    await commit('Note type and template', operations)
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

  if (!document) return <div className="setting-block compatibility-manager"><strong>Compatibility setup</strong>{error ? <p className="inline-error" role="alert">{error}</p> : <p><LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading note types, templates, and presets…</p>}</div>

  return <div className="setting-block compatibility-manager">
    <div className="compatibility-heading"><span><Settings2 size={19} aria-hidden="true" /><span><strong>Compatibility setup</strong><p>Edit imported structures without flattening named fields, templates, CSS, or deck scheduling.</p></span></span></div>
    <details>
      <summary>Note types, fields, templates, and CSS</summary>
      <div className="compatibility-editor">
        <label className="form-field"><span>Note type</span><select aria-label="Note type" value={noteTypeId} onChange={(event) => chooseNoteType(document, event.target.value)}>{document.workspace.noteTypes.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
        {noteType && <>
          <div className="field-grid"><label className="form-field"><span>Name</span><input value={noteType.name} onChange={(event) => setNoteType({ ...noteType, name: event.target.value })} /></label><label className="form-field"><span>Kind</span><input value={noteType.kind === 'cloze' ? 'Cloze' : 'Standard'} readOnly aria-readonly="true" /></label></div>
          <fieldset className="sub-editor"><legend>Fields</legend>{fields.map((field) => <div className="compatibility-field-row" key={field.id}><label className="form-field"><span>Field {field.ordinal + 1} name</span><input value={field.name} onChange={(event) => setFields((current) => current.map((value) => value.id === field.id ? { ...value, name: event.target.value } : value))} /></label><label className="check-row" aria-label={`Right-to-left ${field.name}`}><input type="checkbox" checked={field.rtl} onChange={(event) => setFields((current) => current.map((value) => value.id === field.id ? { ...value, rtl: event.target.checked } : value))} /><span><strong>Right-to-left</strong></span></label><label className="check-row" aria-label={`Sticky ${field.name}`}><input type="checkbox" checked={field.sticky} onChange={(event) => setFields((current) => current.map((value) => value.id === field.id ? { ...value, sticky: event.target.checked } : value))} /><span><strong>Sticky</strong></span></label></div>)}</fieldset>
          <label className="form-field"><span>Card template</span><select value={templateId} onChange={(event) => chooseTemplate(document, event.target.value)}>{noteType.templateIds.map((id) => document.workspace.templates.find((value) => value.id === id)).filter((value): value is CardTemplate => Boolean(value)).map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
          {template && <fieldset className="sub-editor"><legend><Code2 size={15} aria-hidden="true" /> Template</legend><label className="form-field"><span>Template name</span><input value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} /></label><label className="form-field"><span>Question template</span><textarea rows={5} spellCheck={false} value={template.questionFormat} onChange={(event) => setTemplate({ ...template, questionFormat: event.target.value })} /></label><label className="form-field"><span>Answer template</span><textarea rows={5} spellCheck={false} value={template.answerFormat} onChange={(event) => setTemplate({ ...template, answerFormat: event.target.value })} /></label></fieldset>}
          <label className="form-field"><span>Card CSS</span><textarea className="code-editor" rows={8} spellCheck={false} value={noteType.css} onChange={(event) => setNoteType({ ...noteType, css: event.target.value })} /><small>Scripts and remote network resources remain blocked in preview and review.</small></label>
          <div className="compatibility-preview"><strong>Representative card preview</strong>{preview ? <><span>Question</span><SandboxedCardFrame html={preview.questionHtml} css={preview.css} title={`Question preview for ${noteType.name}`} theme={data.settings.theme} /><span>Answer</span><SandboxedCardFrame html={preview.answerHtml} css={preview.css} title={`Answer preview for ${noteType.name}`} theme={data.settings.theme} /></> : <p>No existing card uses this template, so a representative preview is unavailable.</p>}</div>
          <button className="primary-button" disabled={busy || !noteType.name.trim()} onClick={() => void saveNoteType()}>{busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Save note type</button>
        </>}
      </div>
    </details>
    <details>
      <summary>Deck presets and scheduling limits</summary>
      <div className="compatibility-editor">
        <label className="form-field"><span>Deck</span><select aria-label="Deck" value={deckId} onChange={(event) => chooseDeck(document, event.target.value)}>{document.workspace.decks.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
        {deck && <label className="form-field"><span>Preset used by this deck</span><select aria-label="Preset used by this deck" value={deck.presetId} onChange={(event) => { setDeck({ ...deck, presetId: event.target.value }); choosePreset(document, event.target.value) }}>{document.workspace.presets.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>}
        <label className="form-field"><span>Edit preset</span><select aria-label="Edit preset" value={presetId} onChange={(event) => choosePreset(document, event.target.value)}>{document.workspace.presets.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
        {preset && <><div className="field-grid"><label className="form-field"><span>Name</span><input value={preset.name} onChange={(event) => setPreset({ ...preset, name: event.target.value })} /></label><label className="form-field"><span>Scheduler</span><input value={preset.scheduler === 'anki' ? 'Imported Anki' : 'Neo FSRS'} readOnly aria-readonly="true" /></label></div>
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
