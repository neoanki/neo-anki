import { CheckCircle2, Download, RefreshCw, Rocket } from 'lucide-react'
import { useEffect, useState } from 'react'

export const UpdatePanel = () => {
  const bridge = window.neoAnkiDesktop
  const [state, setState] = useState<NeoAnkiUpdateState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.getUpdateState().then((value) => { if (active) setState(value) })
    const remove = bridge.onUpdateState((value) => { if (active) { setState(value); setBusy(false) } })
    return () => { active = false; remove() }
  }, [bridge])

  if (!bridge || !state) return null
  const act = async (action: 'check' | 'download' | 'install') => {
    setBusy(true)
    try {
      if (action === 'check') setState(await bridge.checkForUpdates())
      if (action === 'download') setState(await bridge.downloadUpdate())
      if (action === 'install') await bridge.installUpdate()
    } catch (error) {
      setState({ ...state, phase: 'error', error: error instanceof Error ? error.message : 'The update action failed.' })
      setBusy(false)
    }
  }

  return <div className="setting-block update-panel">
    <div className="update-heading"><span><RefreshCw size={18}/><strong>Application updates</strong></span><code>v{state.currentVersion}</code></div>
    {state.phase === 'development' && <p>Update checks are enabled in signed, installed builds.</p>}
    {(state.phase === 'idle' || state.phase === 'current') && <p>{state.phase === 'current' ? 'Neo Anki is up to date.' : 'Check the signed GitHub release channel for a newer version.'}</p>}
    {state.phase === 'checking' && <p role="status">Checking the signed release channel…</p>}
    {state.phase === 'available' && <p role="status">Version {state.version} is available. Download it now; installation waits for your confirmation.</p>}
    {state.phase === 'downloading' && <div role="status"><p>Downloading verified version {state.version}… {Math.round(state.percent || 0)}%</p><div className="update-progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.percent || 0)}><span style={{ width: `${state.percent || 0}%` }}/></div></div>}
    {state.phase === 'ready' && <p role="status"><CheckCircle2 size={16}/> Version {state.version} is verified and ready. Neo Anki created a recovery backup before installation.</p>}
    {state.phase === 'error' && <p className="storage-error" role="alert">Update check failed: {state.error || 'Unknown error'}. Your current version is unchanged.</p>}
    <div className="button-row">
      {['idle', 'current', 'error'].includes(state.phase) && <button className="secondary-button" disabled={busy} onClick={() => void act('check')}><RefreshCw size={17}/> {busy || state.phase === 'checking' ? 'Checking…' : 'Check for updates'}</button>}
      {state.phase === 'available' && <button className="primary-button" disabled={busy} onClick={() => void act('download')}><Download size={17}/> {busy ? 'Starting…' : `Download ${state.version}`}</button>}
      {state.phase === 'ready' && <button className="primary-button" disabled={busy} onClick={() => void act('install')}><Rocket size={17}/> Restart and install</button>}
    </div>
  </div>
}
