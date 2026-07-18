import { AlertTriangle, CheckCircle2, FileCheck2, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ImportSummary } from '../types'

type Preflight = NonNullable<ImportSummary['preflight']>

const dispositionCopy = {
  preserved: 'Preserved',
  transformed: 'Transformed',
  reset: 'Reset',
  unsupported: 'Unsupported',
  refused: 'Refused',
} as const

const inventoryLabels: Record<string, string> = {
  notes: 'Notes', cards: 'Cards', reviews: 'Reviews', media: 'Media', noteTypes: 'Note types', decks: 'Decks', presets: 'Presets',
}

export const ImportPreflightReview = ({
  filename,
  preflight,
  busy,
  onCancel,
  onConfirm,
}: {
  filename: string
  preflight: Preflight
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) => {
  const heading = useRef<HTMLHeadingElement>(null)
  const [accepted, setAccepted] = useState(false)
  const acceptanceRecords = preflight.fidelity.filter((record) => record.requiresAcceptance)
  const refused = preflight.fidelity.filter((record) => record.disposition === 'refused')
  const canCommit = preflight.canCommit && refused.length === 0
  useEffect(() => { heading.current?.focus() }, [])

  return (
    <section className="import-preflight" aria-labelledby="import-preflight-title">
      <div className="preflight-heading">
        <span className="preflight-icon"><FileCheck2 aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Migration preflight</p>
          <h2 id="import-preflight-title" ref={heading} tabIndex={-1}>Review exactly what will migrate</h2>
          <p><strong>{filename}</strong> has been inspected. The live workspace has not changed.</p>
        </div>
      </div>

      <dl className="preflight-inventory" aria-label="Package inventory">
        {Object.entries(preflight.inventory).map(([key, count]) => <div key={key}><dt>{inventoryLabels[key] || key}</dt><dd>{count.toLocaleString()}</dd></div>)}
        {preflight.projectedDueNow !== undefined && <div><dt>Due now</dt><dd>{preflight.projectedDueNow.toLocaleString()}</dd></div>}
      </dl>

      <div className="preflight-operation">
        <ShieldCheck aria-hidden="true" />
        <span><strong>{preflight.operation === 'additive' ? 'Additive import' : preflight.operation === 'replace-profile' ? 'Profile replacement' : 'New profile'}</strong><small>{preflight.operation === 'additive' ? 'IDs are deterministically remapped and existing content remains.' : 'A verified checkpoint is created before the imported profile becomes active.'}</small></span>
      </div>

      <div className="preflight-fidelity">
        <h3>Field-level compatibility</h3>
        <ul>
          {preflight.fidelity.map((record) => {
            const risky = record.disposition !== 'preserved'
            const Icon = record.disposition === 'refused' ? XCircle : risky ? AlertTriangle : CheckCircle2
            return <li key={record.path} className={`fidelity-${record.disposition}`}>
              <Icon aria-hidden="true" />
              <span><strong>{record.path}</strong><small>{record.detail}</small></span>
              <span className="fidelity-result"><b>{dispositionCopy[record.disposition]}</b><small>{record.count.toLocaleString()} affected</small></span>
            </li>
          })}
        </ul>
      </div>

      {preflight.sourceSha256 && <p className="preflight-hash"><span>Source SHA-256</span><code>{preflight.sourceSha256}</code></p>}
      {acceptanceRecords.length > 0 && canCommit && <div className="preflight-acceptance"><input id="accept-import-differences" aria-describedby="accept-import-help" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span><label htmlFor="accept-import-differences"><strong>Compatibility differences reviewed</strong></label><small id="accept-import-help">I reviewed {acceptanceRecords.length} explicit {acceptanceRecords.length === 1 ? 'difference' : 'differences'}. The original package and rollback checkpoint remain available after migration.</small></span></div>}
      {!canCommit && <p className="inline-message error" role="alert">This package cannot be committed because the preflight contains refused fields. No workspace data was changed.</p>}
      <div className="preflight-actions">
        <button className="secondary-button" disabled={busy} onClick={onCancel}>Cancel without changes</button>
        <button className="primary-button" disabled={busy || !canCommit || (acceptanceRecords.length > 0 && !accepted)} onClick={onConfirm}>{busy ? 'Creating checkpoint…' : 'Create checkpoint and migrate'}</button>
      </div>
    </section>
  )
}
