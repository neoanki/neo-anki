import { AlertTriangle, Layers3, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CoreModulePageProps } from '../core-module'
import { validatePackManifest, validatePackPatch } from './service'

export const PacksPanel = ({ data, runCommand }: CoreModulePageProps) => {
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const loadPack = async (file?: File) => {
    if (!file) return
    try {
      const raw = JSON.parse(await file.text()) as unknown
      await runCommand((raw as { format?: string }).format === 'neo-anki-pack' ? 'packs.install' : 'packs.patch', (raw as { format?: string }).format === 'neo-anki-pack' ? validatePackManifest(raw) : validatePackPatch(raw))
      setMessage('Pack data applied. Existing scheduling was preserved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read pack.') }
  }
  return <div className="plans-layout">
    <section className="editor-card compact-form"><h2>Install or update a pack</h2><p>Use a versioned pack or patch. The extension runs through the same transactional command API available to every publisher.</p><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18}/> Choose JSON</button><input className="visually-hidden" ref={fileRef} type="file" accept="application/json" onChange={(event) => loadPack(event.target.files?.[0])}/>{message && <p role="status" className="inline-message">{message}</p>}</section>
    <section className="stack-list"><h2>Installed</h2>{data.packs.map((pack) => <article className="stack-card" key={pack.id}><div><strong>{pack.name}</strong><p>v{pack.installedVersion} · {Object.keys(pack.itemMap).length} items · {pack.author}</p></div></article>)}{!data.packs.length && <div className="empty-state"><Layers3 size={28}/><p>No shared packs installed.</p></div>}</section>
    {data.packConflicts.length > 0 && <section className="conflict-list"><h2><AlertTriangle size={20}/> Update conflicts</h2>{data.packConflicts.map((conflict) => <article className="stack-card" key={conflict.id}><div><strong>{conflict.field === '$delete' ? 'Upstream removed an edited item' : `${conflict.field} changed locally and upstream`}</strong><p>Choose which version should survive.</p></div><div className="button-row"><button className="secondary-button compact" onClick={() => void runCommand('packs.resolve', { id: conflict.id, resolution: 'local' })}>Keep mine</button><button className="secondary-button compact" onClick={() => void runCommand('packs.resolve', { id: conflict.id, resolution: 'upstream' })}>Use update</button></div></article>)}</section>}
  </div>
}
