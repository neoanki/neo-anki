import { Check, Eye, Link2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { analyzeCardHealth, findDuplicateItems } from '../lib/content'
import { normalizeRect } from '../lib/occlusion'
import { authoringActionStatusesV2, executeAuthoringActionV2, extensionAuthoringActionsV2, extensionPromptTypesV2, extensionUiContributionsV2, validateExtensionPromptsV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { useApp } from '../state/AppContext'
import type { ExtensionAuthoringActionStatusV1, KnowledgeDraftV1 } from '../../packages/extension-sdk/src/index.js'
import type { Citation, CreateKnowledgeInput, MediaAsset, OcclusionRect, PromptVariant } from '../types'

export const CreatePage = () => {
  const { data, addItem } = useApp()
  const [variants, setVariants] = useState<PromptVariant[]>(['forward'])
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [context, setContext] = useState('')
  const [collection, setCollection] = useState('')
  const [tags, setTags] = useState('')
  const [citations, setCitations] = useState<Array<Omit<Citation, 'id'>>>([{ title: '', url: '' }])
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [occlusions, setOcclusions] = useState<OcclusionRect[]>([])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [promptTouched, setPromptTouched] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [actionResultMessage, setActionResultMessage] = useState('')
  const authoringActions = useMemo(() => extensionAuthoringActionsV2(), [])
  const [selectedActions, setSelectedActions] = useState<Set<string>>(() => new Set(authoringActions.filter((action) => action.defaultSelected).map((action) => `${action.extensionId}:${action.id}`)))
  const [actionStatuses, setActionStatuses] = useState<Map<string, ExtensionAuthoringActionStatusV1>>(new Map())
  const [failedAction, setFailedAction] = useState<{ extensionId: string; actionId: string; itemId: string; idempotencyKey: string; draft: KnowledgeDraftV1 } | null>(null)
  const findings = useMemo(() => prompt.trim() && (promptTouched || attempted) ? analyzeCardHealth(prompt, answer) : [], [prompt, answer, promptTouched, attempted])
  const duplicates = useMemo(() => findDuplicateItems(prompt, data.items), [prompt, data.items])
  const collections = [...new Set(data.items.map((item) => item.collection))]
  const promptTypes: Array<{ value: PromptVariant; label: string; description?: string; authoringHint?: string }> = [
    { value: 'forward', label: 'Basic', description: 'Recall the answer from a direct prompt.' },
    ...extensionPromptTypesV2().map((promptType) => ({ value: promptType.id, label: promptType.label, description: promptType.description, authoringHint: promptType.authoringHint })),
  ]
  const clozeSelected = variants.includes('cloze')
  const draft: KnowledgeDraftV1 = useMemo(() => ({ prompt: prompt.trim(), answer: answer.trim(), context: context.trim(), collection: collection.trim(), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), selectedPromptTypes: [...variants], mediaIds: assets.map((asset) => asset.id) }), [answer, assets, collection, context, prompt, tags, variants])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => { void authoringActionStatusesV2(draft).then((statuses) => {
      if (!current) return
      setActionStatuses(statuses)
      setSelectedActions((selected) => new Set([...selected].filter((key) => statuses.get(key)?.available !== false)))
    }) }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [draft])

  const toggleVariant = (variant: PromptVariant) => setVariants((current) => current.includes(variant) ? current.filter((value) => value !== variant) : [...current, variant])
  const selectPromptType = (id: string) => setVariants((current) => current.includes(id) ? current : [...current, id])
  const clearDraft = () => { setPrompt(''); setAnswer(''); setContext(''); setTags(''); setAssets([]); setOcclusions([]); setCitations([{ title: '', url: '' }]); setAttempted(false); setPromptTouched(false) }
  const retryAuthoringAction = async () => {
    if (!failedAction) return
    setSaving(true); setSaveError('')
    try {
      const result = await executeAuthoringActionV2(failedAction.extensionId, failedAction.actionId, failedAction.itemId, failedAction.idempotencyKey, failedAction.draft)
      if (result && typeof result === 'object' && typeof (result as { message?: unknown }).message === 'string') setActionResultMessage((result as { message: string }).message)
      setFailedAction(null); setSaved(true); window.setTimeout(() => setSaved(false), 2500)
    } catch (error) { setSaveError(`Knowledge saved, but the extension action still failed: ${error instanceof Error ? error.message : 'Try again from the knowledge item.'}`) }
    finally { setSaving(false) }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    setSaveError('')
    setActionResultMessage('')
    if (!prompt.trim() || !answer.trim() || !variants.length) return
    if (clozeSelected && !/{{c\d+::.+?}}/.test(prompt)) {
      setSaveError('Fill in the blank needs at least one deletion such as {{c1::answer}}.')
      return
    }
    const tagsValue = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    const input: CreateKnowledgeInput = { prompt, answer, context, collection, tags: tagsValue, citations: citations.filter((citation) => citation.title.trim()).map((citation) => ({ ...citation, url: citation.url?.trim() || undefined })), assets, occlusions: occlusions.map(normalizeRect), variants }
    let validation
    try { validation = await validateExtensionPromptsV2(input) }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'The selected extension could not validate this knowledge item.'); return }
    if (!validation.valid) { setSaveError(Object.values(validation.fieldErrors).filter(Boolean).join(' ')); return }
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
    clearDraft()
    for (const action of authoringActions.filter((candidate) => { const key = `${candidate.extensionId}:${candidate.id}`; return selectedActions.has(key) && actionStatuses.get(key)?.available !== false })) {
      const idempotencyKey = `${itemId}:${action.extensionId}:${action.id}`
      try {
        const result = await executeAuthoringActionV2(action.extensionId, action.id, itemId, idempotencyKey, submittedDraft)
        if (result && typeof result === 'object' && typeof (result as { message?: unknown }).message === 'string') setActionResultMessage((result as { message: string }).message)
      }
      catch (error) {
        setFailedAction({ extensionId: action.extensionId, actionId: action.id, itemId, idempotencyKey, draft: submittedDraft })
        setSaveError(`Knowledge saved, but ${action.label} failed: ${error instanceof Error ? error.message : 'Use Retry to try again without creating a duplicate item.'}`)
        setSaving(false); setSaved(true)
        return
      }
    }
    setSaving(false)
    setFailedAction(null); setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return <div className="page create-page">
    <header className="page-header"><div><p className="eyebrow">Library</p><h1>New knowledge</h1><p className="page-intro">Write one knowledge item, then choose the prompts Neo Anki should derive from it.</p></div></header>
    <div className="create-layout">
      <form className="editor-card" onSubmit={submit}>
        <fieldset className="prompt-type-fieldset"><legend>Practice prompts</legend><div className="type-tabs wrap-tabs">{promptTypes.map((type) => <button type="button" aria-pressed={variants.includes(type.value)} className={variants.includes(type.value) ? 'active' : ''} onClick={() => toggleVariant(type.value)} key={type.value}>{type.label}</button>)}</div>{promptTypes.filter((type) => variants.includes(type.value) && (type.authoringHint || type.description)).map((type) => <p className="helper-text" key={`${type.value}:help`}><strong>{type.label}:</strong> {type.authoringHint || type.description}</p>)}</fieldset>
        <div className="form-field"><label htmlFor="prompt">Prompt</label><textarea id="prompt" value={prompt} onBlur={() => setPromptTouched(true)} onChange={(event) => setPrompt(event.target.value)} rows={4} required aria-invalid={attempted && !prompt.trim()} aria-describedby={clozeSelected ? 'prompt-cloze-help' : undefined} placeholder="What does retrieval practice strengthen?"/>{clozeSelected && <p className="helper-text" id="prompt-cloze-help">Mark each hidden answer with <code>{'{{c1::hidden answer}}'}</code>.</p>}</div>
        <div className="form-field"><label htmlFor="answer">Answer</label><textarea id="answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} required placeholder="A short, atomic answer."/></div>
        <div className="form-field"><label htmlFor="context">Extra context <span>Optional</span></label><textarea id="context" value={context} onChange={(event) => setContext(event.target.value)} rows={2}/></div>
        <div className="field-grid"><div className="form-field"><label htmlFor="collection">Collection <span>Optional</span></label><input id="collection" list="collections" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="Choose or enter a collection"/><datalist id="collections">{collections.map((name) => <option value={name} key={name}/>)}</datalist></div><div className="form-field"><label htmlFor="tags">Tags <span>Optional</span></label><input id="tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="biology, exam"/></div></div>

        <fieldset className="sub-editor"><legend><Link2 size={17}/> Sources & citations</legend>{citations.map((citation, index) => <div className="citation-row" key={index}><input aria-label={`Citation ${index + 1} title`} value={citation.title} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, title: event.target.value } : value))} placeholder="Source title"/><input aria-label={`Citation ${index + 1} URL`} type="url" value={citation.url || ''} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, url: event.target.value } : value))} placeholder="https://…"/><button type="button" className="icon-button" aria-label={`Remove citation ${index + 1}`} onClick={() => setCitations((current) => current.filter((_, position) => position !== index))}><Trash2 size={17}/></button></div>)}<button type="button" className="text-button" onClick={() => setCitations((current) => [...current, { title: '', url: '' }])}><Plus size={16}/> Add citation</button></fieldset>

        {extensionUiContributionsV2('create').map((contribution) => <ExtensionUiFrameV2 key={`${contribution.extensionId}:${contribution.id}`} contribution={contribution} dto={{ assets, occlusions }} onResult={(value) => {
          const result = value as { assets?: MediaAsset[]; occlusions?: OcclusionRect[]; selectPromptType?: string }
          if (Array.isArray(result.assets)) setAssets(result.assets)
          if (Array.isArray(result.occlusions)) setOcclusions(result.occlusions)
          if (result.selectPromptType) selectPromptType(result.selectPromptType)
        }} />)}

        {authoringActions.length > 0 && <fieldset className="sub-editor authoring-actions"><legend>After adding</legend>{authoringActions.map((action) => { const key = `${action.extensionId}:${action.id}`; const status = actionStatuses.get(key); const unavailable = action.availability === 'status-required' && status?.available !== true; return <label className={`authoring-action${unavailable ? ' disabled' : ''}`} key={key}><input type="checkbox" checked={selectedActions.has(key)} disabled={unavailable} onChange={(event) => setSelectedActions((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next })}/><span><strong>{action.label}</strong>{action.description && <small>{action.description}</small>}{status?.selectionLabel && <small>{status.selectionLabel}</small>}{unavailable && <small>{status?.reason || 'Checking configuration…'}</small>}<small>Provided by {action.extensionName}</small></span></label> })}</fieldset>}

        {saveError && <div className="inline-message error" role="alert"><span>{saveError}</span>{failedAction && <button type="button" className="text-button" disabled={saving} onClick={() => void retryAuthoringAction()}>Retry extension action</button>}</div>}
        <div className="editor-footer"><p><Sparkles size={17}/> New practice prompts enter only when the time forecast has room.</p><button className="primary-button" type="submit" disabled={saving || !prompt.trim() || !answer.trim() || !variants.length}><Plus size={19}/> {saving ? 'Adding…' : selectedActions.size && authoringActions.some((action) => { const key = `${action.extensionId}:${action.id}`; return selectedActions.has(key) && actionStatuses.get(key)?.available !== false && /audio/i.test(action.label) }) ? 'Add knowledge & generate audio' : 'Add knowledge item'}</button></div>
        {saved && <div className="save-toast" role="status"><Check size={18}/> {actionResultMessage || 'Added to your safe new-material queue.'}</div>}
      </form>
      <aside className="create-preview"><div className="preview-heading"><span><Eye size={18}/> Live preview</span><span>{variants.length} practice prompt{variants.length === 1 ? '' : 's'}</span></div><div className="mini-review-card"><p>Prompt</p><h2>{(clozeSelected ? prompt.replace(/{{c\d+::(.*?)(?:::.*?)?}}/g, '[ … ]') : prompt) || 'Your prompt will appear here.'}</h2>{answer && <div className="preview-answer"><p>Answer</p><strong>{answer}</strong></div>}</div><div className="health-card"><div><Sparkles size={18}/><strong>Prompt health</strong></div>{!prompt.trim() && <p>Start writing to get local quality checks.</p>}{prompt.trim() && !promptTouched && !attempted && <p>Quality checks appear after you finish editing the prompt.</p>}{prompt.trim() && (promptTouched || attempted) && findings.length === 0 && <p className="healthy"><Check size={16}/> Clear and appropriately sized.</p>}{findings.map((finding) => <p key={finding.code}>{finding.message} <small>{finding.suggestion}</small></p>)}{prompt.trim() && (promptTouched || attempted) && duplicates.length > 0 && <p>Possible duplicate: “{duplicates[0].prompt}”</p>}</div></aside>
    </div>
  </div>
}
