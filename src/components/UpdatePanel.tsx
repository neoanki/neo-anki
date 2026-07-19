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
    <div className="update-heading"><span><PackageCheck size={18}/><strong>Current version</strong></span><code>v{info.currentVersion}</code></div>
    <p className="release-safety"><ShieldCheck size={16}/> Updates are installed manually.</p>
    <p>Current Neo Anki preview releases are unsigned and are not ready for a mainstream replacement claim. Download only from GitHub, follow your operating system’s security prompt, and verify the checksum and build attestation.</p>
    <div className="button-row">
      <a className="secondary-button" href={info.releasesUrl} target="_blank" rel="noreferrer">View releases <ExternalLink size={16}/></a>
    </div>
  </div>
}
