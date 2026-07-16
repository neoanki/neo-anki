import { Image, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { CreationPanelProps } from '../sdk'
import { fileToAsset } from '../../lib/media'
import { rectFromPoints, rectStyle } from './geometry'

export const ImageOcclusionEditor = ({ assets, setAssets, occlusions, setOcclusions, selectPromptType }: CreationPanelProps) => {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const imageAsset = assets.find((asset) => asset.mimeType.startsWith('image/'))
  const upload = async (file?: File) => {
    if (!file) return
    const asset = await fileToAsset(file)
    setAssets((current) => [...current.filter((item) => item.hash !== asset.hash), asset])
    if (asset.mimeType.startsWith('image/')) selectPromptType('image-occlusion')
    if (asset.mimeType.startsWith('audio/')) selectPromptType('audio')
  }
  const markImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = { x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100 }
    if (!start) { setStart(point); return }
    setOcclusions((current) => [...current, { ...rectFromPoints(start, point), label: `Mask ${current.length + 1}` }])
    setStart(null)
  }
  return <fieldset className="sub-editor"><legend><Image size={17}/> Media & image occlusion</legend><label className="upload-zone"><Upload size={20}/><span>Add image or audio</span><input className="visually-hidden" type="file" accept="image/*,audio/*" onChange={(event) => upload(event.target.files?.[0])}/></label>{imageAsset && <div className="occlusion-builder"><label className="compact-label">Image description<input value={imageAsset.altText} onChange={(event) => setAssets((current) => current.map((asset) => asset.id === imageAsset.id ? { ...asset, altText: event.target.value, updatedAt: new Date().toISOString() } : asset))} placeholder="Describe the image for non-visual review"/></label><p>Choose two opposite corners to draw each mask. {start ? 'Now choose the second corner.' : ''}</p><button type="button" className="image-stage" onClick={markImage} aria-label={start ? 'Choose second mask corner' : 'Choose first mask corner'}><img src={imageAsset.dataUrl} alt={imageAsset.altText || 'Uploaded source for image occlusion'}/>{occlusions.map((rect) => <span className="occlusion-mask" style={rectStyle(rect)} key={rect.id}>{rect.label}</span>)}</button><button type="button" className="text-button" onClick={() => setOcclusions((current) => [...current, { id: crypto.randomUUID(), x: 25, y: 25, width: 30, height: 20, label: `Mask ${current.length + 1}` }])}><Plus size={16}/> Add keyboard-editable mask</button><div className="mask-list">{occlusions.map((rect, index) => <div key={rect.id}><label>Mask {index + 1}<input aria-label={`Mask ${index + 1} label`} value={rect.label || ''} onChange={(event) => setOcclusions((current) => current.map((value) => value.id === rect.id ? { ...value, label: event.target.value } : value))}/></label><div className="rect-inputs">{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field}<input type="number" min="0" max="100" value={Math.round(rect[field])} onChange={(event) => setOcclusions((current) => current.map((value) => value.id === rect.id ? { ...value, [field]: Number(event.target.value) } : value))}/></label>)}</div><button type="button" className="icon-button" aria-label={`Delete mask ${index + 1}`} onClick={() => setOcclusions((current) => current.filter((value) => value.id !== rect.id))}><Trash2 size={17}/></button></div>)}</div></div>}</fieldset>
}
