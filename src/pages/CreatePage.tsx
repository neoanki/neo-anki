import { Check, Eye, Link2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CardTemplate, FieldDefinition, NoteType, WorkspaceDocumentV4 } from '../../packages/compatibility-domain/src/index'
import type { ExtensionAuthoringActionStatusV1, KnowledgeDraftV1 } from '../../packages/extension-sdk/src/index.js'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { authoringActionStatusesV2, executeAuthoringActionV2, extensionAuthoringActionsV2, extensionUiContributionsV2 } from '../extensions/v2/registry'
import { analyzeCardHealth, findDuplicateItems } from '../lib/content'
import { renderCardFields } from '../lib/card-rendering'
import { normalizeRect } from '../lib/occlusion'
import { useApp } from '../state/AppContext'
import type { Citation, CreateKnowledgeInput, MediaAsset, OcclusionRect } from '../types'
import { NativeCardContent } from '../components/NativeCardContent'

interface FailedAuthoringAction { extensionId: string; actionId: string; itemId: string; idempotencyKey: string; draft: KnowledgeDraftV1 }
interface RetainedCreateDraft {
  contentTypeId: string
  fieldValues: Record<string, string>
  prompt?: string
  answer?: string
  context?: string
  collection: string
  tags: string
  citations: Array<Omit<Citation, 'id'>>
  assets: MediaAsset[]
  occlusions: OcclusionRect[]
  selectedActions: string[]
  failedAction: FailedAuthoringAction | null
}

let retainedCreateDraft: RetainedCreateDraft | null = null
const createDraftStorageKey = 'neoanki:create-draft:v2'
const legacyCreateDraftStorageKey = 'neoanki:create-draft:v1'
const extensionReturnKey = 'neoanki:extensions:return:v1'
const markExtensionReturnToCreate = () => window.sessionStorage.setItem(extensionReturnKey, JSON.stringify({ route: 'create', createdAt: Date.now() }))
const loadRetainedCreateDraft = (): RetainedCreateDraft | null => {
  if (retainedCreateDraft) return retainedCreateDraft
  try {
    const value = JSON.parse(window.sessionStorage.getItem(createDraftStorageKey) || window.sessionStorage.getItem(legacyCreateDraftStorageKey) || 'null') as Partial<RetainedCreateDraft> | null
    if (!value || typeof value !== 'object') return null
    retainedCreateDraft = {
      contentTypeId: typeof value.contentTypeId === 'string' ? value.contentTypeId : '',
      fieldValues: value.fieldValues && typeof value.fieldValues === 'object' ? value.fieldValues : {},
      prompt: typeof value.prompt === 'string' ? value.prompt : '',
      answer: typeof value.answer === 'string' ? value.answer : '',
      context: typeof value.context === 'string' ? value.context : '',
      collection: typeof value.collection === 'string' ? value.collection : '',
      tags: typeof value.tags === 'string' ? value.tags : '',
      citations: Array.isArray(value.citations) ? value.citations : [{ title: '', url: '' }],
      assets: Array.isArray(value.assets) ? value.assets : [],
      occlusions: Array.isArray(value.occlusions) ? value.occlusions : [],
      selectedActions: Array.isArray(value.selectedActions) ? value.selectedActions.filter((entry): entry is string => typeof entry === 'string') : [],
      failedAction: value.failedAction && typeof value.failedAction === 'object'
        && typeof value.failedAction.extensionId === 'string' && typeof value.failedAction.actionId === 'string'
        && typeof value.failedAction.itemId === 'string' && typeof value.failedAction.idempotencyKey === 'string'
        && value.failedAction.draft && typeof value.failedAction.draft === 'object'
        ? value.failedAction as FailedAuthoringAction : null,
    }
    return retainedCreateDraft
  } catch { return null }
}
const persistCreateDraft = (draft: RetainedCreateDraft) => {
  retainedCreateDraft = draft
  try {
    window.sessionStorage.setItem(createDraftStorageKey, JSON.stringify(draft))
    window.sessionStorage.removeItem(legacyCreateDraftStorageKey)
  } catch { /* Keep the in-memory draft if browser storage is unavailable or full. */ }
}
const discardCreateDraft = () => {
  retainedCreateDraft = null
  try {
    window.sessionStorage.removeItem(createDraftStorageKey)
    window.sessionStorage.removeItem(legacyCreateDraftStorageKey)
  } catch { /* The cleared in-memory draft remains authoritative. */ }
}

const fieldsFor = (document: WorkspaceDocumentV4, type: NoteType | undefined) => type
  ? type.fieldIds.map((id) => document.workspace.fields.find((field) => field.id === id)).filter((field): field is FieldDefinition => Boolean(field)).sort((left, right) => left.ordinal - right.ordinal)
  : []
const templatesFor = (document: WorkspaceDocumentV4, type: NoteType | undefined) => type
  ? type.templateIds.map((id) => document.workspace.templates.find((template) => template.id === id)).filter((template): template is CardTemplate => Boolean(template)).sort((left, right) => left.ordinal - right.ordinal)
  : []

export const CreatePage = () => {
  const { data, addItem, navigate, loadWorkspaceDocument } = useApp()
  const initialDraft = useMemo(() => loadRetainedCreateDraft(), [])
  const [document, setDocument] = useState<WorkspaceDocumentV4 | null>(null)
  const [contentTypeId, setContentTypeId] = useState(() => initialDraft?.contentTypeId || '')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => initialDraft?.fieldValues || {})
  const [collection, setCollection] = useState(() => initialDraft?.collection || '')
  const [tags, setTags] = useState(() => initialDraft?.tags || '')
  const [citations, setCitations] = useState<Array<Omit<Citation, 'id'>>>(() => initialDraft?.citations || [{ title: '', url: '' }])
  const [assets, setAssets] = useState<MediaAsset[]>(() => initialDraft?.assets || [])
  const [occlusions, setOcclusions] = useState<OcclusionRect[]>(() => initialDraft?.occlusions || [])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [promptTouched, setPromptTouched] = useState(false)
  const [saveError, setSaveError] = useState(() => initialDraft?.failedAction ? 'Knowledge was saved, but its extension action was interrupted. Retry it without creating a duplicate item.' : '')
  const [actionResultMessage, setActionResultMessage] = useState('')
  const authoringActions = useMemo(() => extensionAuthoringActionsV2(), [])
  const [selectedActions, setSelectedActions] = useState<Set<string>>(() => new Set(initialDraft?.selectedActions || authoringActions.filter((action) => action.defaultSelected).map((action) => `${action.extensionId}:${action.id}`)))
  const [actionStatuses, setActionStatuses] = useState<Map<string, ExtensionAuthoringActionStatusV1>>(new Map())
  const [failedAction, setFailedAction] = useState<FailedAuthoringAction | null>(() => initialDraft?.failedAction || null)

  useEffect(() => {
    let current = true
    void loadWorkspaceDocument().then((next) => {
      if (!current) return
      const selected = next.workspace.noteTypes.find((type) => type.id === contentTypeId) || next.workspace.noteTypes[0]
      setDocument(next)
      setContentTypeId(selected?.id || '')
      if (selected) {
        const selectedFields = fieldsFor(next, selected)
        setFieldValues((values) => Object.fromEntries(selectedFields.map((field, index) => [
          field.id,
          values[field.id] ?? (index === 0 ? initialDraft?.prompt : index === 1 ? initialDraft?.answer : index === 2 ? initialDraft?.context : '') ?? '',
        ])))
      }
    }).catch((error) => { if (current) setSaveError(error instanceof Error ? error.message : 'Could not load card templates.') })
    return () => { current = false }
  }, [contentTypeId, initialDraft?.answer, initialDraft?.context, initialDraft?.prompt, loadWorkspaceDocument])

  const contentType = document?.workspace.noteTypes.find((type) => type.id === contentTypeId)
  const fields = useMemo(() => document ? fieldsFor(document, contentType) : [], [contentType, document])
  const templates = useMemo(() => document ? templatesFor(document, contentType) : [], [contentType, document])
  const primaryTemplate = templates[0]
  const prompt = primaryTemplate ? fieldValues[primaryTemplate.promptFieldId] || '' : ''
  const answer = primaryTemplate ? fieldValues[primaryTemplate.answerFieldId] || '' : ''
  const context = primaryTemplate ? primaryTemplate.supportingFieldIds.map((id) => fieldValues[id] || '').filter(Boolean).join('\n') : ''
  const requiredFieldIds = useMemo(() => new Set(templates.flatMap((template) => [template.promptFieldId, template.answerFieldId])), [templates])
  const missingRequiredField = fields.some((field) => requiredFieldIds.has(field.id) && !fieldValues[field.id]?.trim())
  const findings = useMemo(() => prompt.trim() && (promptTouched || attempted) ? analyzeCardHealth(prompt, answer) : [], [prompt, answer, promptTouched, attempted])
  const duplicates = useMemo(() => findDuplicateItems(prompt, data.items), [prompt, data.items])
  const collections = [...new Set(data.items.map((item) => item.collection))]
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields])
  const preview = primaryTemplate ? renderCardFields(primaryTemplate, fieldValues, fields.map((field) => ({ id: field.id, name: field.name }))) : null
  const draft: KnowledgeDraftV1 = useMemo(() => ({ prompt: prompt.trim(), answer: answer.trim(), context: context.trim(), collection: collection.trim(), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), selectedPromptTypes: templates.map((template) => template.id), mediaIds: assets.map((asset) => asset.id) }), [answer, assets, collection, context, prompt, tags, templates])

  useEffect(() => {
    persistCreateDraft({ contentTypeId, fieldValues, collection, tags, citations, assets, occlusions, selectedActions: [...selectedActions], failedAction })
  }, [assets, citations, collection, contentTypeId, failedAction, fieldValues, occlusions, selectedActions, tags])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => { void authoringActionStatusesV2(draft).then((statuses) => {
      if (!current) return
      setActionStatuses(statuses)
      setSelectedActions((selected) => new Set([...selected].filter((key) => statuses.get(key)?.available !== false)))
    }) }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [draft])

  const selectContentType = (id: string) => {
    if (!document) return
    const selected = document.workspace.noteTypes.find((type) => type.id === id)
    setContentTypeId(id)
    setFieldValues(Object.fromEntries(fieldsFor(document, selected).map((field) => [field.id, ''])))
    setAttempted(false)
    setPromptTouched(false)
  }
  const clearDraft = () => {
    discardCreateDraft()
    setFieldValues(Object.fromEntries(fields.map((field) => [field.id, ''])))
    setTags(''); setAssets([]); setOcclusions([]); setCitations([{ title: '', url: '' }]); setAttempted(false); setPromptTouched(false)
  }
  const configureAction = (extensionId: string) => {
    markExtensionReturnToCreate()
    navigate(`extensions:${extensionId}`)
  }
  const retryAuthoringAction = async () => {
    if (!failedAction) return
    setSaving(true); setSaveError('')
    try {
      const result = await executeAuthoringActionV2(failedAction.extensionId, failedAction.actionId, failedAction.itemId, failedAction.idempotencyKey, failedAction.draft)
      if (result && typeof result === 'object' && typeof (result as { message?: unknown }).message === 'string') setActionResultMessage((result as { message: string }).message)
      setFailedAction(null); clearDraft(); setSaved(true); window.setTimeout(() => setSaved(false), 2500)
    } catch (error) { setSaveError(`Knowledge saved, but the extension action still failed: ${error instanceof Error ? error.message : 'Try again from the knowledge item.'}`) }
    finally { setSaving(false) }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    setSaveError('')
    setActionResultMessage('')
    if (!contentType || !templates.length || missingRequiredField) return
    const tagsValue = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    const input: CreateKnowledgeInput = {
      prompt,
      answer,
      context,
      contentModel: {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        fields: fields.map((field) => ({ id: field.id, name: field.name, ordinal: field.ordinal, value: fieldValues[field.id] || '' })),
      },
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        promptFieldId: template.promptFieldId,
        answerFieldId: template.answerFieldId,
        supportingFieldIds: [...template.supportingFieldIds],
        responseMode: template.responseMode,
      })),
      collection,
      tags: tagsValue,
      citations: citations.filter((citation) => citation.title.trim()).map((citation) => ({ ...citation, url: citation.url?.trim() || undefined })),
      assets,
      occlusions: occlusions.map(normalizeRect),
    }
    const submittedDraft: KnowledgeDraftV1 = { ...draft, collection: collection.trim() || 'Unsorted', tags: tagsValue }
    setSaving(true)
    let itemId = ''
    try {
      itemId = await addItem(input)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Neo Anki could not add this knowledge item. Your draft is still here; try again.')
      setSaving(false)
      return
    }
    for (const action of authoringActions.filter((candidate) => { const key = `${candidate.extensionId}:${candidate.id}`; return selectedActions.has(key) && actionStatuses.get(key)?.available !== false })) {
      const idempotencyKey = `${itemId}:${action.extensionId}:${action.id}`
      try {
        const result = await executeAuthoringActionV2(action.extensionId, action.id, itemId, idempotencyKey, submittedDraft)
        if (result && typeof result === 'object' && typeof (result as { message?: unknown }).message === 'string') setActionResultMessage((result as { message: string }).message)
      } catch (error) {
        setFailedAction({ extensionId: action.extensionId, actionId: action.id, itemId, idempotencyKey, draft: submittedDraft })
        setSaveError(`Knowledge saved, but ${action.label} failed: ${error instanceof Error ? error.message : 'Use Retry to try again without creating a duplicate item.'}`)
        setSaving(false); setSaved(true)
        return
      }
    }
    setSaving(false)
    setFailedAction(null); clearDraft(); setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return <div className="page create-page">
    <header className="page-header"><div><p className="eyebrow">Library</p><h1>New knowledge</h1><p className="page-intro">Choose a content type, fill its fields, and get consistent native cards from its templates.</p></div></header>
    <div className="create-layout">
      <form className="editor-card" onSubmit={submit}>
        <label className="form-field"><span>Content type</span><select className="content-type-select" aria-label="Content type" value={contentTypeId} onChange={(event) => selectContentType(event.target.value)} disabled={!document}>{document?.workspace.noteTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select><small>Fields and card layouts are managed in Settings → Card templates.</small></label>
        <fieldset className="sub-editor content-fields"><legend>Content fields</legend>
          {fields.map((field) => <label className="form-field" key={field.id}><span>{field.name}{requiredFieldIds.has(field.id) ? '' : ' (optional)'}</span><textarea value={fieldValues[field.id] || ''} onBlur={() => { if (field.id === primaryTemplate?.promptFieldId) setPromptTouched(true) }} onChange={(event) => setFieldValues((values) => ({ ...values, [field.id]: event.target.value }))} rows={field.id === primaryTemplate?.promptFieldId ? 4 : 3} required={requiredFieldIds.has(field.id)} aria-invalid={attempted && requiredFieldIds.has(field.id) && !fieldValues[field.id]?.trim()} placeholder={field.id === primaryTemplate?.promptFieldId ? 'Write a clear retrieval prompt.' : field.id === primaryTemplate?.answerFieldId ? 'Write a short, atomic answer.' : `Add ${field.name.toLowerCase()}.`} /></label>)}
          {!fields.length && <p className="inline-message">{document ? 'This content type has no fields yet. Add fields in Settings.' : 'Loading content fields…'}</p>}
        </fieldset>
        <div className="template-summary"><strong>{templates.length} card template{templates.length === 1 ? '' : 's'} will be created</strong>{templates.map((template) => <span key={template.id}>{template.name}: {fieldById.get(template.promptFieldId)?.name || 'Prompt'} → {fieldById.get(template.answerFieldId)?.name || 'Answer'}{template.responseMode === 'type' ? ' · typed response' : ''}</span>)}</div>
        <div className="field-grid"><div className="form-field"><label htmlFor="collection">Collection <span>Optional</span></label><input id="collection" list="collections" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="Choose or enter a collection"/><datalist id="collections">{collections.map((name) => <option value={name} key={name}/>)}</datalist></div><div className="form-field"><label htmlFor="tags">Tags <span>Optional</span></label><input id="tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="biology, exam"/></div></div>
        <fieldset className="sub-editor"><legend><Link2 size={17}/> Sources & citations</legend>{citations.map((citation, index) => <div className="citation-row" key={index}><input aria-label={`Citation ${index + 1} title`} value={citation.title} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, title: event.target.value } : value))} placeholder="Source title"/><input aria-label={`Citation ${index + 1} URL`} type="url" value={citation.url || ''} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, url: event.target.value } : value))} placeholder="https://…"/><button type="button" className="icon-button" aria-label={`Remove citation ${index + 1}`} onClick={() => setCitations((current) => current.filter((_, position) => position !== index))}><Trash2 size={17}/></button></div>)}<button type="button" className="text-button" onClick={() => setCitations((current) => [...current, { title: '', url: '' }])}><Plus size={16}/> Add citation</button></fieldset>
        {extensionUiContributionsV2('create').map((contribution) => <ExtensionUiFrameV2 key={`${contribution.extensionId}:${contribution.id}`} contribution={contribution} dto={{ assets, occlusions }} onResult={(value) => {
          const result = value as { assets?: MediaAsset[]; occlusions?: OcclusionRect[] }
          if (Array.isArray(result.assets)) setAssets(result.assets)
          if (Array.isArray(result.occlusions)) setOcclusions(result.occlusions)
        }} />)}
        {authoringActions.length > 0 && <fieldset className="sub-editor authoring-actions"><legend>After adding</legend>{authoringActions.map((action) => { const key = `${action.extensionId}:${action.id}`; const status = actionStatuses.get(key); const unavailable = action.availability === 'status-required' && status?.available !== true; return <div className={`authoring-action${unavailable ? ' unavailable' : ''}`} key={key}><label><input type="checkbox" checked={selectedActions.has(key)} disabled={unavailable} onChange={(event) => setSelectedActions((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next })}/><span><strong>{action.label}</strong>{action.description && <small>{action.description}</small>}{status?.selectionLabel && <small>{status.selectionLabel}</small>}{unavailable && <small className="authoring-action-reason">{status?.reason || 'Checking configuration…'}</small>}<small>Provided by {action.extensionName}</small></span></label>{unavailable && action.configurationDestination && <button type="button" className="secondary-button compact" onClick={() => configureAction(action.extensionId)}>Set up {action.extensionName}</button>}</div> })}</fieldset>}
        {saveError && <div className="inline-message error" role="alert"><span>{saveError}</span>{failedAction && <button type="button" className="text-button" disabled={saving} onClick={() => void retryAuthoringAction()}>Retry extension action</button>}</div>}
        <div className="editor-footer"><p><Sparkles size={17}/> New cards enter only when the time forecast has room.</p><button className="primary-button" type="submit" disabled={saving || Boolean(failedAction) || !templates.length || missingRequiredField}><Plus size={19}/> {saving ? 'Adding…' : 'Add knowledge item'}</button></div>
        {saved && <div className="save-toast" role="status"><Check size={18}/> {actionResultMessage || 'Added to your safe new-material queue.'}</div>}
      </form>
      <aside className="create-preview"><div className="preview-heading"><span><Eye size={18}/> Live preview</span><span>{primaryTemplate?.name || 'No template'}</span></div>{preview ? <NativeCardContent content={preview} revealed /> : <div className="mini-review-card"><p>Add a card template to preview this content type.</p></div>}<div className="health-card"><div><Sparkles size={18}/><strong>Prompt health</strong></div>{!prompt.trim() && <p>Start writing to get local quality checks.</p>}{prompt.trim() && !promptTouched && !attempted && <p>Quality checks appear after you finish editing the prompt.</p>}{prompt.trim() && (promptTouched || attempted) && findings.length === 0 && <p className="healthy"><Check size={16}/> Clear and appropriately sized.</p>}{findings.map((finding) => <p key={finding.code}>{finding.message} <small>{finding.suggestion}</small></p>)}{prompt.trim() && (promptTouched || attempted) && duplicates.length > 0 && <p>Possible duplicate: “{duplicates[0].prompt}”</p>}</div></aside>
    </div>
  </div>
}
