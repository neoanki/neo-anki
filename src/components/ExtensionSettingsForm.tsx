import { ArrowDown, ArrowUp, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtensionManifestV2, ExtensionSettingsConditionV1, ExtensionSettingsControlV1 } from '../../packages/extension-sdk/src/index'
import { extensionCapabilityToken } from '../extensions/host'

type JsonObject = Record<string, unknown>
type ErrorMap = Record<string, string>

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])
const clone = <T,>(value: T): T => structuredClone(value)
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const pointerSegments = (pointer: string) => pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
const getPointer = (source: unknown, pointer: string): unknown => {
  let value = source
  for (const segment of pointerSegments(pointer)) {
    if (unsafeKeys.has(segment)) return undefined
    if (Array.isArray(value) && /^\d+$/.test(segment)) value = value[Number(segment)]
    else if (isObject(value)) value = value[segment]
    else return undefined
  }
  return value
}
const setPointer = (source: JsonObject, pointer: string, value: unknown) => {
  const segments = pointerSegments(pointer)
  let target = source
  segments.forEach((segment, index) => {
    if (unsafeKeys.has(segment)) return
    if (index === segments.length - 1) target[segment] = value
    else {
      if (!isObject(target[segment])) target[segment] = {}
      target = target[segment] as JsonObject
    }
  })
}

type StoredControl = Exclude<ExtensionSettingsControlV1, { kind: 'notice' } | { kind: 'secret' }>
const isStored = (control: ExtensionSettingsControlV1): control is StoredControl => control.kind !== 'notice' && control.kind !== 'secret'
const allControls = (manifest: ExtensionManifestV2) => {
  const result: ExtensionSettingsControlV1[] = []
  const collect = (controls: ExtensionSettingsControlV1[]) => controls.forEach((control) => { result.push(control); if (control.kind === 'group') collect(control.fields) })
  manifest.settings?.sections.forEach((section) => collect(section.controls))
  return result
}

const evaluateCondition = (condition: ExtensionSettingsConditionV1 | undefined, current: JsonObject, root: JsonObject) => {
  if (!condition) return true
  const actual = getPointer(condition.scope === 'root' ? root : current, condition.path)
  if (condition.operator === 'truthy') return Boolean(actual)
  if (condition.operator === 'falsy') return !actual
  if (condition.operator === 'equals') return actual === condition.value
  if (condition.operator === 'not-equals') return actual !== condition.value
  if (condition.operator === 'includes') return Array.isArray(actual) ? actual.includes(condition.value) : typeof actual === 'string' && typeof condition.value === 'string' ? actual.includes(condition.value) : false
  if (typeof actual !== 'number' || typeof condition.value !== 'number') return false
  if (condition.operator === 'greater-than') return actual > condition.value
  if (condition.operator === 'greater-than-or-equal') return actual >= condition.value
  if (condition.operator === 'less-than') return actual < condition.value
  return actual <= condition.value
}

const applyDefaults = (controls: ExtensionSettingsControlV1[], current: JsonObject, root: JsonObject) => {
  for (const control of controls) {
    if (!isStored(control)) continue
    let value = getPointer(current, control.path)
    if (value === undefined) {
      const fallback = control.kind === 'group' ? control.defaultItems : control.defaultValue
      if (fallback !== undefined) { setPointer(current, control.path, clone(fallback)); value = getPointer(current, control.path) }
    }
    if (control.kind === 'group' && Array.isArray(value)) for (const item of value) if (isObject(item)) applyDefaults(control.fields, item, root)
  }
}

const emptyValue = (value: unknown) => value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0
const validateControls = (controls: ExtensionSettingsControlV1[], current: JsonObject, root: JsonObject, prefix: string, errors: ErrorMap) => {
  controls.forEach((control) => {
    if (!evaluateCondition(control.visibleWhen, current, root) || !evaluateCondition(control.enabledWhen, current, root)) return
    if (!isStored(control)) return
    const value = getPointer(current, control.path)
    const errorKey = `${prefix}:${control.id}`
    const required = control.required || Boolean(control.requiredWhen && evaluateCondition(control.requiredWhen, current, root))
    if (required && emptyValue(value)) { errors[errorKey] = `${control.label || 'This setting'} is required.`; return }
    if (emptyValue(value) && !required) return
    if (control.kind === 'toggle') { if (typeof value !== 'boolean') errors[errorKey] = 'Choose enabled or disabled.'; return }
    if (control.kind === 'text' || control.kind === 'textarea') {
      if (typeof value !== 'string') { errors[errorKey] = 'Enter text.'; return }
      if (control.minLength !== undefined && value.length < control.minLength) errors[errorKey] = `Enter at least ${control.minLength} characters.`
      else if (control.maxLength !== undefined && value.length > control.maxLength) errors[errorKey] = `Enter no more than ${control.maxLength} characters.`
      else if (control.pattern && !new RegExp(control.pattern).test(value)) errors[errorKey] = 'Enter a value in the required format.'
      return
    }
    if (control.kind === 'number' || control.kind === 'range') {
      if (typeof value !== 'number' || !Number.isFinite(value)) { errors[errorKey] = 'Enter a valid number.'; return }
      if (control.min !== undefined && value < control.min) errors[errorKey] = `Enter ${control.min} or greater.`
      else if (control.max !== undefined && value > control.max) errors[errorKey] = `Enter ${control.max} or less.`
      return
    }
    if (control.kind === 'select') { if (typeof value !== 'string' || !control.options.some((option) => option.value === value)) errors[errorKey] = 'Choose one of the available options.'; return }
    if (control.kind === 'string-list') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) { errors[errorKey] = 'Enter a comma-separated list.'; return }
      if (control.minItems !== undefined && value.length < control.minItems) errors[errorKey] = `Enter at least ${control.minItems} values.`
      else if (control.maxItems !== undefined && value.length > control.maxItems) errors[errorKey] = `Enter no more than ${control.maxItems} values.`
      else if (control.unique && new Set(value).size !== value.length) errors[errorKey] = 'Remove duplicate values.'
      else if (value.some((item) => control.itemMinLength !== undefined && item.length < control.itemMinLength! || control.itemMaxLength !== undefined && item.length > control.itemMaxLength!)) errors[errorKey] = 'One or more list values has an invalid length.'
      return
    }
    if (control.kind !== 'group') return
    if (!Array.isArray(value)) { errors[errorKey] = 'This group is invalid.'; return }
    if (control.minItems !== undefined && value.length < control.minItems) errors[errorKey] = `Add at least ${control.minItems} items.`
    else if (control.maxItems !== undefined && value.length > control.maxItems) errors[errorKey] = `Keep no more than ${control.maxItems} items.`
    value.forEach((item, index) => { if (isObject(item)) validateControls(control.fields, item, root, `${prefix}${control.path}/${index}`, errors) })
  })
}

const controlDescriptionId = (instanceKey: string, suffix: string) => `${instanceKey.replace(/[^a-zA-Z0-9_-]/g, '-')}-${suffix}`

const SecretControl = ({ extensionId, control, status, onStatus }: { extensionId: string; control: Extract<ExtensionSettingsControlV1, { kind: 'secret' }>; status: boolean | undefined; onStatus: (key: string, configured: boolean) => void }) => {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const token = extensionCapabilityToken(extensionId)
  const save = async () => {
    if (!value || !token || !window.neoAnkiDesktop) return
    setBusy(true); setMessage('')
    try {
      await window.neoAnkiDesktop.extensionSecretMutateBatchV2(token, [{ op: 'set', key: control.secretKey, value }])
      onStatus(control.secretKey, true); setMessage('Credential saved on this device.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Credential could not be saved.') }
    finally { setValue(''); setBusy(false) }
  }
  const remove = async () => {
    if (!token || !window.neoAnkiDesktop || !window.confirm(`Delete the saved credential for ${control.label || control.secretKey}?`)) return
    setBusy(true); setMessage('')
    try {
      await window.neoAnkiDesktop.extensionSecretMutateBatchV2(token, [{ op: 'delete', key: control.secretKey }])
      setValue(''); onStatus(control.secretKey, false); setMessage('Credential deleted from this device.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Credential could not be deleted.') }
    finally { setBusy(false) }
  }
  const inputId = `extension-secret-${extensionId}-${control.id}`
  return <div className="extension-setting-field extension-setting-secret">
    <div className="extension-secret-heading"><label htmlFor={inputId}>{control.label || 'Credential'}</label><span className={status ? 'configured' : ''}>{status === undefined ? 'Status unavailable' : status ? 'Configured' : 'Not configured'}</span></div>
    {control.description && <p id={`${inputId}-help`}>{control.description}</p>}
    <div className="extension-secret-controls"><input id={inputId} type="password" value={value} placeholder={control.placeholder} autoComplete="off" spellCheck={false} disabled={busy} aria-describedby={control.description ? `${inputId}-help` : undefined} onChange={(event) => setValue(event.currentTarget.value)} /><button type="button" className="secondary-button compact" disabled={busy || !value} onClick={() => void save()}><KeyRound size={15}/>{status ? 'Replace' : 'Set'}</button>{status && <button type="button" className="text-button danger" disabled={busy} onClick={() => void remove()}>Delete</button>}</div>
    {message && <p className="extension-setting-message" role="status">{message}</p>}
  </div>
}

interface RenderControlsProps {
  controls: ExtensionSettingsControlV1[]
  current: JsonObject
  root: JsonObject
  prefix: string
  errors: ErrorMap
  extensionId: string
  secretStatuses: Record<string, boolean | undefined>
  onSecretStatus: (key: string, configured: boolean) => void
  onChange: (mutate: (draft: JsonObject) => void) => void
  onBlur: () => void
}

const RenderControls = ({ controls, current, root, prefix, errors, extensionId, secretStatuses, onSecretStatus, onChange, onBlur }: RenderControlsProps) => <>
  {controls.map((control) => {
    if (!evaluateCondition(control.visibleWhen, current, root)) return null
    const enabled = evaluateCondition(control.enabledWhen, current, root)
    const instanceKey = `${prefix}:${control.id}`
    const inputId = controlDescriptionId(instanceKey, 'input')
    const helpId = controlDescriptionId(instanceKey, 'help')
    const errorId = controlDescriptionId(instanceKey, 'error')
    if (control.kind === 'notice') return <aside key={instanceKey} className={`extension-settings-notice ${control.tone || 'neutral'}`}><strong>{control.label}</strong><p>{control.text}</p></aside>
    if (control.kind === 'secret') return <SecretControl key={instanceKey} extensionId={extensionId} control={control} status={secretStatuses[control.secretKey]} onStatus={onSecretStatus}/>
    const value = getPointer(current, control.path)
    const describedBy = [control.description ? helpId : '', errors[instanceKey] ? errorId : ''].filter(Boolean).join(' ') || undefined
    const update = (next: unknown) => onChange((draftRoot) => {
      const target = prefix === 'root' ? draftRoot : getPointer(draftRoot, prefix.replace(/^root/, ''))
      if (isObject(target)) setPointer(target, control.path, next)
    })
    if (control.kind === 'group') {
      const items = Array.isArray(value) ? value.filter(isObject) : []
      const minimum = control.minItems || 0
      const maximum = control.maxItems ?? 100
      const updateItems = (next: JsonObject[]) => update(next)
      const add = () => {
        const item = clone(control.newItem || {})
        applyDefaults(control.fields, item, root)
        if (control.itemIdPath && emptyValue(getPointer(item, control.itemIdPath))) setPointer(item, control.itemIdPath, crypto.randomUUID())
        updateItems([...items, item])
      }
      return <fieldset key={instanceKey} className="extension-settings-group" data-error-key={errors[instanceKey] ? instanceKey : undefined} tabIndex={errors[instanceKey] ? -1 : undefined}>
        <legend>{control.label || 'Items'}</legend>{control.description && <p>{control.description}</p>}
        {items.map((item, index) => {
          const itemName = control.itemLabelPath ? getPointer(item, control.itemLabelPath) : undefined
          const itemPrefix = `${prefix}${control.path}/${index}`
          return <section className="extension-settings-group-item" key={control.itemIdPath ? String(getPointer(item, control.itemIdPath) || index) : index}>
            <header><strong>{typeof itemName === 'string' && itemName ? itemName : `${control.label || 'Item'} ${index + 1}`}</strong><div className="extension-settings-item-actions"><button type="button" className="icon-button" disabled={index === 0} aria-label={`Move ${control.label || 'item'} ${index + 1} up`} onClick={() => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateItems(next) }}><ArrowUp size={16}/></button><button type="button" className="icon-button" disabled={index === items.length - 1} aria-label={`Move ${control.label || 'item'} ${index + 1} down`} onClick={() => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; updateItems(next) }}><ArrowDown size={16}/></button><button type="button" className="icon-button danger" disabled={items.length <= minimum} aria-label={`Remove ${control.label || 'item'} ${index + 1}`} onClick={() => updateItems(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16}/></button></div></header>
            <RenderControls controls={control.fields} current={item} root={root} prefix={itemPrefix} errors={errors} extensionId={extensionId} secretStatuses={secretStatuses} onSecretStatus={onSecretStatus} onChange={onChange} onBlur={onBlur}/>
          </section>
        })}
        <button type="button" className="secondary-button compact" disabled={!enabled || items.length >= maximum} onClick={add}><Plus size={16}/>{control.addLabel || `Add ${control.label || 'item'}`}</button>
        {errors[instanceKey] && <p id={errorId} className="extension-setting-error" role="alert">{errors[instanceKey]}</p>}
      </fieldset>
    }
    const common = { id: inputId, disabled: !enabled, 'aria-invalid': Boolean(errors[instanceKey]), 'aria-describedby': describedBy, 'data-error-key': errors[instanceKey] ? instanceKey : undefined, onBlur }
    return <div className="extension-setting-field" key={instanceKey}>
      {control.kind === 'toggle' ? <label className="check-row" htmlFor={inputId}><input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.currentTarget.checked)}/><span><strong>{control.label}</strong>{control.description && <small id={helpId}>{control.description}</small>}</span></label> : <>
        <label htmlFor={inputId}>{control.label}{control.required || control.requiredWhen ? <span aria-hidden="true"> *</span> : null}</label>
        {control.description && <p id={helpId}>{control.description}</p>}
        {control.kind === 'textarea' ? <textarea {...common} value={typeof value === 'string' ? value : ''} placeholder={control.placeholder} minLength={control.minLength} maxLength={control.maxLength} required={control.required} onChange={(event) => update(event.currentTarget.value)}/>
          : control.kind === 'text' ? <input {...common} type="text" value={typeof value === 'string' ? value : ''} placeholder={control.placeholder} minLength={control.minLength} maxLength={control.maxLength} pattern={control.pattern} required={control.required} onChange={(event) => update(event.currentTarget.value)}/>
          : control.kind === 'number' ? <input {...common} type="number" value={typeof value === 'number' ? value : ''} min={control.min} max={control.max} step={control.step} required={control.required} onChange={(event) => update(event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)}/>
          : control.kind === 'range' ? <div className="extension-setting-range"><input {...common} type="range" value={typeof value === 'number' ? value : control.min || 0} min={control.min} max={control.max} step={control.step} onChange={(event) => update(event.currentTarget.valueAsNumber)}/><output htmlFor={inputId}>{typeof value === 'number' ? value : control.min || 0}</output></div>
          : control.kind === 'select' ? <select {...common} value={typeof value === 'string' ? value : ''} required={control.required} onChange={(event) => update(event.currentTarget.value)}><option value="" disabled>Choose…</option>{control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input {...common} type="text" value={Array.isArray(value) ? value.join(', ') : ''} placeholder={'placeholder' in control ? control.placeholder : undefined} required={control.required} onChange={(event) => update(event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean))}/>}</>}
      {errors[instanceKey] && <p id={errorId} className="extension-setting-error" role="alert">{errors[instanceKey]}</p>}
    </div>
  })}
</>

export const ExtensionSettingsForm = ({ manifest, onDirtyChange }: { manifest: ExtensionManifestV2; onDirtyChange?: (dirty: boolean) => void }) => {
  const settings = manifest.settings!
  const controls = useMemo(() => allControls(manifest), [manifest])
  const hasConfig = controls.some(isStored)
  const secretKeys = useMemo(() => controls.filter((control): control is Extract<ExtensionSettingsControlV1, { kind: 'secret' }> => control.kind === 'secret').map((control) => control.secretKey), [controls])
  const [saved, setSaved] = useState<JsonObject>({})
  const [draft, setDraft] = useState<JsonObject>({})
  const [secretStatuses, setSecretStatuses] = useState<Record<string, boolean | undefined>>({})
  const [errors, setErrors] = useState<ErrorMap>({})
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const firstError = useRef('')
  const token = extensionCapabilityToken(manifest.id)
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  useEffect(() => {
    const navigate = (event: Event) => { if (dirty && !window.confirm('Discard unsaved extension settings?')) event.preventDefault() }
    window.addEventListener('neo-anki:before-navigate', navigate)
    return () => window.removeEventListener('neo-anki:before-navigate', navigate)
  }, [dirty])
  useEffect(() => {
    let current = true
    const load = async () => {
      setState('loading'); setMessage('')
      if (!window.neoAnkiDesktop || !token) { setState('error'); setMessage('Extension settings require Neo Anki desktop.'); return }
      try {
        const stored = hasConfig ? await window.neoAnkiDesktop.extensionConfigReadV2(token) : {}
        const next = isObject(stored) ? clone(stored) : {}
        settings.sections.forEach((section) => applyDefaults(section.controls, next, next))
        let statuses: Record<string, boolean | undefined> = {}
        if (secretKeys.length && window.neoAnkiDesktop.extensionSecretStatusBatchV2) try { statuses = await window.neoAnkiDesktop.extensionSecretStatusBatchV2(token, secretKeys) }
        catch { statuses = Object.fromEntries(secretKeys.map((key) => [key, undefined])) }
        if (!current) return
        setSaved(clone(next)); setDraft(next); setSecretStatuses(statuses); setState('ready')
      } catch (error) { if (current) { setState('error'); setMessage(error instanceof Error ? error.message : 'Extension settings could not be loaded.') } }
    }
    void load()
    return () => { current = false }
  }, [hasConfig, manifest.id, secretKeys, settings.sections, token])

  const validate = () => {
    const next: ErrorMap = {}
    settings.sections.forEach((section) => validateControls(section.controls, draft, draft, 'root', next))
    setErrors(next)
    firstError.current = Object.keys(next)[0] || ''
    return Object.keys(next).length === 0
  }
  const update = (mutate: (next: JsonObject) => void) => setDraft((current) => { const next = clone(current); mutate(next); setMessage(''); return next })
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) {
      queueMicrotask(() => document.querySelector<HTMLElement>(`[data-error-key="${CSS.escape(firstError.current)}"]`)?.focus())
      return
    }
    if (!window.neoAnkiDesktop || !token || !hasConfig) return
    setState('saving'); setMessage('')
    try {
      const result = await window.neoAnkiDesktop.extensionConfigWriteV2(token, draft)
      window.dispatchEvent(new CustomEvent('neo-anki:workspace-updated-v4', { detail: result.data }))
      setSaved(clone(draft)); setState('ready'); setMessage('Settings saved to the encrypted workspace.')
    } catch (error) { setState('ready'); setMessage(error instanceof Error ? error.message : 'Settings could not be saved.') }
  }
  const discard = () => { setDraft(clone(saved)); setErrors({}); setMessage('Changes discarded.') }

  if (state === 'loading') return <div className="marketplace-state" role="status">Loading settings…</div>
  if (state === 'error') return <div className="marketplace-state error" role="alert"><strong>Settings unavailable</strong><span>{message}</span></div>
  return <form className="extension-settings-form" onSubmit={(event) => void save(event)} noValidate>
    {settings.helpText && <p className="extension-settings-help">{settings.helpText}</p>}
    {settings.sections.map((section) => <section className="extension-settings-section" key={section.id} aria-labelledby={`${manifest.id}-${section.id}-title`}><header><h3 id={`${manifest.id}-${section.id}-title`}>{section.title}</h3>{section.description && <p>{section.description}</p>}</header><RenderControls controls={section.controls} current={draft} root={draft} prefix="root" errors={errors} extensionId={manifest.id} secretStatuses={secretStatuses} onSecretStatus={(key, configured) => setSecretStatuses((current) => ({ ...current, [key]: configured }))} onChange={update} onBlur={validate}/></section>)}
    {dirty && hasConfig && <div className="extension-settings-savebar"><span>Unsaved changes</span><div className="button-row"><button type="button" className="secondary-button" disabled={state === 'saving'} onClick={discard}>Discard</button><button type="submit" className="primary-button" disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save settings'}</button></div></div>}
    {message && <p className="inline-message" role="status">{message}</p>}
  </form>
}
