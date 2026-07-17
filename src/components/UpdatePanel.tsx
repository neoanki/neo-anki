import { ExternalLink, PackageCheck, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

export const UpdatePanel = () => {
  const bridge = window.neoAnkiDesktop
  const [info, setInfo] = useState<NeoAnkiReleaseInfo | null>(null)

  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.getReleaseInfo().then((value) => { if (active) setInfo(value) })
    return () => { active = false }
  }, [bridge])

  if (!bridge || !info) return null

  return <div className="setting-block update-panel">
    <div className="update-heading"><span><PackageCheck size={18}/><strong>Application releases</strong></span><code>v{info.currentVersion}</code></div>
    <p className="release-safety"><ShieldCheck size={16}/> Community builds update manually.</p>
    <p>Automatic installation is disabled because these no-cost builds are not backed by Apple or Microsoft code-signing certificates. Download a newer release yourself and verify its checksum or GitHub attestation before replacing this version.</p>
    <div className="button-row">
      <a className="secondary-button" href={info.releasesUrl} target="_blank" rel="noreferrer">View verified releases <ExternalLink size={16}/></a>
    </div>
  </div>
}
