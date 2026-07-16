import { Check, Eye, Image, Link2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { analyzeCardHealth, findDuplicateItems } from '../lib/content'
import { fileToAsset } from '../lib/media'
import { normalizeRect, rectFromPoints, rectStyle } from '../lib/occlusion'
import { useApp } from '../state/AppContext'
import type { Citation, MediaAsset, OcclusionRect, PromptVariant } from '../types'

const promptTypes: Array<{ value: PromptVariant; label: string }> = [
  { value: 'forward', label: 'Basic' }, { value: 'reverse', label: 'Reverse' }, { value: 'cloze', label: 'Cloze' },
  { value: 'typed', label: 'Typed answer' }, { value: 'image-occlusion', label: 'Image occlusion' }, { value: 'audio', label: 'Audio' },
]

export const CreatePage = () => {
  const { data, addItem } = useApp()
  const [variants, setVariants] = useState<PromptVariant[]>(['forward'])
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [context, setContext] = useState('')
  const [collection, setCollection] = useState('Learning science')
  const [tags, setTags] = useState('')
  const [citations, setCitations] = useState<Array<Omit<Citation, 'id'>>>([{ title: '', url: '' }])
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [occlusions, setOcclusions] = useState<OcclusionRect[]>([])
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [saved, setSaved] = useState(false)
  const findings = useMemo(() => analyzeCardHealth(prompt, answer), [prompt, answer])
  const duplicates = useMemo(() => findDuplicateItems(prompt, data.items), [prompt, data.items])
  const imageAsset = assets.find((asset) => asset.mimeType.startsWith('image/'))
  const collections = [...new Set(data.items.map((item) => item.collection))]

  const toggleVariant = (variant: PromptVariant) => setVariants((current) => current.includes(variant) ? current.filter((value) => value !== variant) : [...current, variant])
  const upload = async (file?: File) => {
    if (!file) return
    const asset = await fileToAsset(file)
    setAssets((current) => [...current.filter((item) => item.hash !== asset.hash), asset])
    if (asset.mimeType.startsWith('image/')) setVariants((current) => current.includes('image-occlusion') ? current : [...current, 'image-occlusion'])
    if (asset.mimeType.startsWith('audio/')) setVariants((current) => current.includes('audio') ? current : [...current, 'audio'])
  }
  const markImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = { x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100 }
    if (!start) { setStart(point); return }
    setOcclusions((current) => [...current, { ...rectFromPoints(start, point), label: `Mask ${current.length + 1}` }])
    setStart(null)
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!prompt.trim() || !answer.trim() || !variants.length) return
    addItem({ prompt, answer, context, collection, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), citations: citations.filter((citation) => citation.title.trim()).map((citation) => ({ ...citation, url: citation.url?.trim() || undefined })), assets, occlusions: occlusions.map(normalizeRect), variants })
    setPrompt(''); setAnswer(''); setContext(''); setTags(''); setAssets([]); setOcclusions([]); setCitations([{ title: '', url: '' }]); setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return <div className="page create-page">
    <header className="page-header"><div><p className="eyebrow">Library</p><h1>New knowledge</h1><p className="page-intro">Write one knowledge item, then choose the prompts Neo Anki should derive from it.</p></div></header>
    <div className="create-layout">
      <form className="editor-card" onSubmit={submit}>
        <fieldset className="prompt-type-fieldset"><legend>Practice prompts</legend><div className="type-tabs wrap-tabs">{promptTypes.map((type) => <button type="button" aria-pressed={variants.includes(type.value)} className={variants.includes(type.value) ? 'active' : ''} onClick={() => toggleVariant(type.value)} key={type.value}>{type.label}</button>)}</div></fieldset>
        <div className="form-field"><label htmlFor="prompt">Prompt or cloze sentence</label><textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} required placeholder="What does retrieval practice strengthen?"/><p className="helper-text">Cloze syntax: <code>{'{{c1::hidden answer}}'}</code></p></div>
        <div className="form-field"><label htmlFor="answer">Answer</label><textarea id="answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} required placeholder="A short, atomic answer."/></div>
        <div className="form-field"><label htmlFor="context">Extra context <span>Optional</span></label><textarea id="context" value={context} onChange={(event) => setContext(event.target.value)} rows={2}/></div>
        <div className="field-grid"><div className="form-field"><label htmlFor="collection">Collection</label><input id="collection" list="collections" value={collection} onChange={(event) => setCollection(event.target.value)} required/><datalist id="collections">{collections.map((name) => <option value={name} key={name}/>)}</datalist></div><div className="form-field"><label htmlFor="tags">Tags</label><input id="tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="biology, exam"/></div></div>

        <fieldset className="sub-editor"><legend><Link2 size={17}/> Sources & citations</legend>{citations.map((citation, index) => <div className="citation-row" key={index}><input aria-label={`Citation ${index + 1} title`} value={citation.title} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, title: event.target.value } : value))} placeholder="Source title"/><input aria-label={`Citation ${index + 1} URL`} type="url" value={citation.url || ''} onChange={(event) => setCitations((current) => current.map((value, position) => position === index ? { ...value, url: event.target.value } : value))} placeholder="https://…"/><button type="button" className="icon-button" aria-label={`Remove citation ${index + 1}`} onClick={() => setCitations((current) => current.filter((_, position) => position !== index))}><Trash2 size={17}/></button></div>)}<button type="button" className="text-button" onClick={() => setCitations((current) => [...current, { title: '', url: '' }])}><Plus size={16}/> Add citation</button></fieldset>

        <fieldset className="sub-editor"><legend><Image size={17}/> Media & image occlusion</legend><label className="upload-zone"><Upload size={20}/><span>Add image or audio</span><input className="visually-hidden" type="file" accept="image/*,audio/*" onChange={(event) => upload(event.target.files?.[0])}/></label>{imageAsset && <div className="occlusion-builder"><label className="compact-label">Image description<input value={imageAsset.altText} onChange={(event) => setAssets((current) => current.map((asset) => asset.id === imageAsset.id ? { ...asset, altText: event.target.value, updatedAt: new Date().toISOString() } : asset))} placeholder="Describe the image for non-visual review"/></label><p>Choose two opposite corners to draw each mask. {start ? 'Now choose the second corner.' : ''}</p><button type="button" className="image-stage" onClick={markImage} aria-label={start ? 'Choose second mask corner' : 'Choose first mask corner'}><img src={imageAsset.dataUrl} alt={imageAsset.altText || 'Uploaded source for image occlusion'}/>{occlusions.map((rect) => <span className="occlusion-mask" style={rectStyle(rect)} key={rect.id}>{rect.label}</span>)}</button><button type="button" className="text-button" onClick={() => setOcclusions((current) => [...current, { id: crypto.randomUUID(), x: 25, y: 25, width: 30, height: 20, label: `Mask ${current.length + 1}` }])}><Plus size={16}/> Add keyboard-editable mask</button><div className="mask-list">{occlusions.map((rect, index) => <div key={rect.id}><label>Mask {index + 1}<input aria-label={`Mask ${index + 1} label`} value={rect.label || ''} onChange={(event) => setOcclusions((current) => current.map((value) => value.id === rect.id ? { ...value, label: event.target.value } : value))}/></label><div className="rect-inputs">{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field}<input type="number" min="0" max="100" value={Math.round(rect[field])} onChange={(event) => setOcclusions((current) => current.map((value) => value.id === rect.id ? { ...value, [field]: Number(event.target.value) } : value))}/></label>)}</div><button type="button" className="icon-button" aria-label={`Delete mask ${index + 1}`} onClick={() => setOcclusions((current) => current.filter((value) => value.id !== rect.id))}><Trash2 size={17}/></button></div>)}</div></div>}</fieldset>

        <div className="editor-footer"><p><Sparkles size={17}/> New prompts enter only when the time forecast has room.</p><button className="primary-button" type="submit" disabled={!prompt.trim() || !answer.trim() || !variants.length}><Plus size={19}/> Add knowledge</button></div>
        {saved && <div className="save-toast" role="status"><Check size={18}/> Added to your safe new-material queue.</div>}
      </form>
      <aside className="create-preview"><div className="preview-heading"><span><Eye size={18}/> Live preview</span><span>{variants.length} prompt{variants.length === 1 ? '' : 's'}</span></div><div className="mini-review-card"><p>Prompt</p><h2>{prompt.replace(/{{c\d+::(.*?)(?:::.*?)?}}/g, '[ … ]') || 'Your prompt will appear here.'}</h2>{answer && <div className="preview-answer"><p>Answer</p><strong>{answer}</strong></div>}</div><div className="health-card"><div><Sparkles size={18}/><strong>Prompt health</strong></div>{!prompt && <p>Start writing to get local quality checks.</p>}{prompt && findings.length === 0 && <p className="healthy"><Check size={16}/> Clear and appropriately sized.</p>}{findings.map((finding) => <p key={finding.code}>{finding.message} <small>{finding.suggestion}</small></p>)}{duplicates.length > 0 && <p>Possible duplicate: “{duplicates[0].prompt}”</p>}</div></aside>
    </div>
  </div>
}
