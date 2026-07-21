import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { ExtensionPackageManifest, ExtensionPermissionV2, ExtensionSettingsConditionV1, ExtensionSettingsContributionV1, ExtensionSettingsControlV1 } from './index.js'

export const EXTENSION_PACKAGE_SUFFIX = '.neoanki-extension'
export const EXTENSION_SIGNATURE_PATH = 'signature.json'
export const MAX_EXTENSION_PACKAGE_BYTES = 12 * 1024 * 1024
export const MAX_EXTENSION_UNPACKED_BYTES = 32 * 1024 * 1024
export const MAX_EXTENSION_FILES = 128

export const extensionPermissions: ExtensionPermissionV2[] = ['study:read', 'study:signals', 'study:prompt-types', 'study:queue-policies', 'content:read', 'content:patch-own', 'content:migrate', 'media:create', 'files:save', 'ui:open-external', 'network:fetch', 'secrets:device', 'config:sync', 'ui:review', 'ui:page', 'ui:create', 'ui:workspace', 'ui:migration']

const permissionSet = new Set<string>(extensionPermissions)
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const commitPattern = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i
const networkDomainPattern = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const secretKeyPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i
const unsafeSettingsKeys = new Set(['__proto__', 'prototype', 'constructor'])
const settingsPointerPattern = /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/
const settingsKinds = new Set(['toggle', 'text', 'textarea', 'number', 'range', 'select', 'string-list', 'notice', 'secret', 'group'])
const conditionOperators = new Set(['equals', 'not-equals', 'includes', 'truthy', 'falsy', 'greater-than', 'greater-than-or-equal', 'less-than', 'less-than-or-equal'])

export interface ParsedExtensionPackage {
  manifest: ExtensionPackageManifest
  files: Record<string, Uint8Array>
  compressedBytes: number
  unpackedBytes: number
}

export interface ExtensionPackageSignatureV1 {
  version: 1
  algorithm: 'ed25519'
  publicKey: string
  unsignedDigest: string
  signature: string
}

export const parseExtensionPackageSignature = (bytes: Uint8Array): ExtensionPackageSignatureV1 => {
  let value: unknown
  try { value = JSON.parse(strFromU8(bytes)) }
  catch { throw new Error('Extension signature is not valid JSON.') }
  const candidate = value as Partial<ExtensionPackageSignatureV1>
  if (candidate.version !== 1 || candidate.algorithm !== 'ed25519' || typeof candidate.publicKey !== 'string' || !candidate.publicKey || !/^[a-f\d]{64}$/i.test(candidate.unsignedDigest || '') || typeof candidate.signature !== 'string' || !candidate.signature) throw new Error('Extension signature metadata is invalid.')
  return candidate as ExtensionPackageSignatureV1
}

export const normalizeExtensionPath = (value: string) => {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe extension path: ${value || '(empty)'}.`)
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe extension path: ${value}.`)
  return parts.join('/')
}

const requireText = (value: unknown, field: string, maximum: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Extension manifest field ${field} is invalid.`)
  return value.trim()
}

const settingsRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`)
  return value as Record<string, unknown>
}
const rejectUnknownSettingsKeys = (value: Record<string, unknown>, allowed: readonly string[], field: string) => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key))
  if (unexpected) throw new Error(`${field}.${unexpected} is not supported.`)
}
const optionalSettingsText = (value: unknown, field: string, maximum: number) => value === undefined ? undefined : requireText(value, field, maximum)
const optionalSettingsDefaultText = (value: unknown, field: string, maximum: number) => {
  if (value !== undefined && (typeof value !== 'string' || value.length > maximum)) throw new Error(`Extension manifest field ${field} is invalid.`)
  return value as string | undefined
}
const optionalSettingsBoolean = (value: unknown, field: string) => {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`)
  return value as boolean | undefined
}
const optionalSettingsNumber = (value: unknown, field: string, integer = false) => {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)))) throw new Error(`${field} must be ${integer ? 'an integer' : 'a finite number'}.`)
  return value as number | undefined
}
const settingsPointer = (value: unknown, field: string) => {
  const pointer = requireText(value, field, 240)
  if (!settingsPointerPattern.test(pointer)) throw new Error(`${field} must be a JSON Pointer.`)
  const segments = pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (segments.length > 8 || segments.some((segment) => unsafeSettingsKeys.has(segment))) throw new Error(`${field} contains an unsafe or excessively deep path.`)
  return pointer
}
const safeSettingsJson = (value: unknown, field: string): unknown => {
  let encoded: string | undefined
  try { encoded = JSON.stringify(value) }
  catch { throw new Error(`${field} must be serializable JSON.`) }
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 256 * 1024) throw new Error(`${field} is too large.`)
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 12) throw new Error(`${field} is too deeply nested.`)
    if (!entry || typeof entry !== 'object') return
    if (Array.isArray(entry)) { entry.forEach((item) => visit(item, depth + 1)); return }
    for (const [key, item] of Object.entries(entry as Record<string, unknown>)) {
      if (unsafeSettingsKeys.has(key)) throw new Error(`${field} contains an unsafe key.`)
      visit(item, depth + 1)
    }
  }
  const parsed = JSON.parse(encoded) as unknown
  visit(parsed, 0)
  return parsed
}
const parseSettingsCondition = (value: unknown, field: string): ExtensionSettingsConditionV1 | undefined => {
  if (value === undefined) return undefined
  const candidate = settingsRecord(value, field)
  rejectUnknownSettingsKeys(candidate, ['path', 'scope', 'operator', 'value'], field)
  const operator = requireText(candidate.operator, `${field}.operator`, 40)
  if (!conditionOperators.has(operator)) throw new Error(`${field}.operator is unsupported.`)
  const scope = candidate.scope === undefined ? undefined : candidate.scope
  if (scope !== undefined && scope !== 'current' && scope !== 'root') throw new Error(`${field}.scope is invalid.`)
  const hasValue = Object.prototype.hasOwnProperty.call(candidate, 'value')
  if (['truthy', 'falsy'].includes(operator) ? hasValue : !hasValue) throw new Error(`${field}.value does not match its operator.`)
  const conditionValue = candidate.value
  if (hasValue && !['string', 'number', 'boolean'].includes(typeof conditionValue) && conditionValue !== null) throw new Error(`${field}.value must be a scalar.`)
  if (operator.startsWith('greater-') || operator.startsWith('less-')) if (typeof conditionValue !== 'number' || !Number.isFinite(conditionValue)) throw new Error(`${field}.value must be numeric.`)
  return { path: settingsPointer(candidate.path, `${field}.path`), ...(scope ? { scope } : {}), operator: operator as ExtensionSettingsConditionV1['operator'], ...(hasValue ? { value: conditionValue as ExtensionSettingsConditionV1['value'] } : {}) }
}

const parseExtensionSettings = (value: unknown, permissions: ExtensionPermissionV2[]): ExtensionSettingsContributionV1 | undefined => {
  if (value === undefined) return undefined
  const candidate = settingsRecord(value, 'settings')
  rejectUnknownSettingsKeys(candidate, ['schemaVersion', 'label', 'description', 'helpText', 'icon', 'sections'], 'settings')
  if (candidate.schemaVersion !== 1) throw new Error('Extension settings schemaVersion must be 1.')
  if (!Array.isArray(candidate.sections) || !candidate.sections.length || candidate.sections.length > 32) throw new Error('Extension settings must contain between 1 and 32 sections.')
  const ids = new Set<string>()
  let controlCount = 0
  let usesConfig = false
  let usesSecrets = false
  const uniqueId = (value: unknown, field: string) => {
    const id = requireText(value, field, 80)
    if (ids.has(id)) throw new Error(`Extension settings id ${id} is duplicated.`)
    ids.add(id)
    return id
  }
  const parseControl = (value: unknown, field: string, groupDepth: number): ExtensionSettingsControlV1 => {
    const control = settingsRecord(value, field)
    const kind = requireText(control.kind, `${field}.kind`, 24)
    if (!settingsKinds.has(kind)) throw new Error(`${field}.kind is unsupported; settings cannot declare actions or dynamic providers.`)
    const commonAllowed = ['kind', 'id', 'label', 'description', 'visibleWhen', 'enabledWhen']
    const storedAllowed = [...commonAllowed, 'path', 'required', 'requiredWhen']
    const common = {
      id: uniqueId(control.id, `${field}.id`),
      label: optionalSettingsText(control.label, `${field}.label`, 100),
      description: optionalSettingsText(control.description, `${field}.description`, 400),
      visibleWhen: parseSettingsCondition(control.visibleWhen, `${field}.visibleWhen`),
      enabledWhen: parseSettingsCondition(control.enabledWhen, `${field}.enabledWhen`),
    }
    controlCount += 1
    if (controlCount > 128) throw new Error('Extension settings may contain at most 128 controls.')
    if (kind === 'notice') {
      rejectUnknownSettingsKeys(control, [...commonAllowed, 'text', 'tone'], field)
      const tone = control.tone === undefined ? undefined : control.tone
      if (tone !== undefined && !['neutral', 'info', 'warning', 'privacy'].includes(String(tone))) throw new Error(`${field}.tone is invalid.`)
      return { ...common, kind, text: requireText(control.text, `${field}.text`, 1000), ...(tone ? { tone: tone as 'neutral' | 'info' | 'warning' | 'privacy' } : {}) }
    }
    if (kind === 'secret') {
      if (groupDepth > 0) throw new Error('Extension secret controls cannot be repeated.')
      rejectUnknownSettingsKeys(control, [...commonAllowed, 'secretKey', 'placeholder'], field)
      const secretKey = requireText(control.secretKey, `${field}.secretKey`, 120)
      if (!secretKeyPattern.test(secretKey)) throw new Error(`${field}.secretKey is invalid.`)
      usesSecrets = true
      return { ...common, kind, secretKey, placeholder: optionalSettingsText(control.placeholder, `${field}.placeholder`, 160) }
    }
    usesConfig = true
    const stored = { ...common, path: settingsPointer(control.path, `${field}.path`), required: optionalSettingsBoolean(control.required, `${field}.required`), requiredWhen: parseSettingsCondition(control.requiredWhen, `${field}.requiredWhen`) }
    if (kind === 'toggle') {
      rejectUnknownSettingsKeys(control, [...storedAllowed, 'defaultValue'], field)
      const defaultValue = control.defaultValue === undefined ? undefined : optionalSettingsBoolean(control.defaultValue, `${field}.defaultValue`)
      return { ...stored, kind, defaultValue }
    }
    if (kind === 'text' || kind === 'textarea') {
      rejectUnknownSettingsKeys(control, [...storedAllowed, 'defaultValue', 'placeholder', 'minLength', 'maxLength', 'pattern'], field)
      const defaultValue = optionalSettingsDefaultText(control.defaultValue, `${field}.defaultValue`, 65_536)
      const minLength = optionalSettingsNumber(control.minLength, `${field}.minLength`, true)
      const maxLength = optionalSettingsNumber(control.maxLength, `${field}.maxLength`, true)
      if ((minLength ?? 0) < 0 || (maxLength ?? 65_536) > 65_536 || minLength !== undefined && maxLength !== undefined && minLength > maxLength) throw new Error(`${field} text bounds are invalid.`)
      const pattern = optionalSettingsText(control.pattern, `${field}.pattern`, 500)
      if (pattern) try { new RegExp(pattern) } catch { throw new Error(`${field}.pattern is invalid.`) }
      return { ...stored, kind, defaultValue, placeholder: optionalSettingsText(control.placeholder, `${field}.placeholder`, 160), minLength, maxLength, pattern }
    }
    if (kind === 'number' || kind === 'range') {
      rejectUnknownSettingsKeys(control, [...storedAllowed, 'defaultValue', 'min', 'max', 'step'], field)
      const defaultValue = optionalSettingsNumber(control.defaultValue, `${field}.defaultValue`)
      const min = optionalSettingsNumber(control.min, `${field}.min`); const max = optionalSettingsNumber(control.max, `${field}.max`); const step = optionalSettingsNumber(control.step, `${field}.step`)
      if (min !== undefined && max !== undefined && min > max || step !== undefined && step <= 0 || defaultValue !== undefined && (min !== undefined && defaultValue < min || max !== undefined && defaultValue > max)) throw new Error(`${field} numeric bounds are invalid.`)
      return { ...stored, kind, defaultValue, min, max, step }
    }
    if (kind === 'select') {
      rejectUnknownSettingsKeys(control, [...storedAllowed, 'defaultValue', 'options'], field)
      if (!Array.isArray(control.options) || !control.options.length || control.options.length > 100) throw new Error(`${field}.options must contain between 1 and 100 static options.`)
      const values = new Set<string>()
      const options = control.options.map((option, index) => {
        const entry = settingsRecord(option, `${field}.options[${index}]`); rejectUnknownSettingsKeys(entry, ['value', 'label'], `${field}.options[${index}]`)
        const optionValue = requireText(entry.value, `${field}.options[${index}].value`, 200)
        if (values.has(optionValue)) throw new Error(`${field}.options contains duplicate values.`); values.add(optionValue)
        return { value: optionValue, label: requireText(entry.label, `${field}.options[${index}].label`, 100) }
      })
      const defaultValue = control.defaultValue === undefined ? undefined : requireText(control.defaultValue, `${field}.defaultValue`, 200)
      if (defaultValue !== undefined && !values.has(defaultValue)) throw new Error(`${field}.defaultValue must match an option.`)
      return { ...stored, kind, defaultValue, options }
    }
    if (kind === 'string-list') {
      rejectUnknownSettingsKeys(control, [...storedAllowed, 'defaultValue', 'placeholder', 'minItems', 'maxItems', 'itemMinLength', 'itemMaxLength', 'unique'], field)
      const minItems = optionalSettingsNumber(control.minItems, `${field}.minItems`, true); const maxItems = optionalSettingsNumber(control.maxItems, `${field}.maxItems`, true)
      const itemMinLength = optionalSettingsNumber(control.itemMinLength, `${field}.itemMinLength`, true); const itemMaxLength = optionalSettingsNumber(control.itemMaxLength, `${field}.itemMaxLength`, true)
      if ((minItems ?? 0) < 0 || (maxItems ?? 1000) > 1000 || minItems !== undefined && maxItems !== undefined && minItems > maxItems || (itemMinLength ?? 0) < 0 || (itemMaxLength ?? 1000) > 1000 || itemMinLength !== undefined && itemMaxLength !== undefined && itemMinLength > itemMaxLength) throw new Error(`${field} list bounds are invalid.`)
      const unique = optionalSettingsBoolean(control.unique, `${field}.unique`)
      const defaultValue = control.defaultValue === undefined ? undefined : Array.isArray(control.defaultValue) && control.defaultValue.every((item) => typeof item === 'string') ? [...control.defaultValue] as string[] : (() => { throw new Error(`${field}.defaultValue must be a string array.`) })()
      if (defaultValue && (minItems !== undefined && defaultValue.length < minItems || maxItems !== undefined && defaultValue.length > maxItems || unique && new Set(defaultValue).size !== defaultValue.length)) throw new Error(`${field}.defaultValue violates its list bounds.`)
      return { ...stored, kind, defaultValue, placeholder: optionalSettingsText(control.placeholder, `${field}.placeholder`, 160), minItems, maxItems, itemMinLength, itemMaxLength, unique }
    }
    rejectUnknownSettingsKeys(control, [...storedAllowed, 'addLabel', 'itemLabelPath', 'itemIdPath', 'minItems', 'maxItems', 'defaultItems', 'newItem', 'fields'], field)
    if (groupDepth >= 2) throw new Error('Extension settings groups may nest at most two levels.')
    const minItems = optionalSettingsNumber(control.minItems, `${field}.minItems`, true); const maxItems = optionalSettingsNumber(control.maxItems, `${field}.maxItems`, true)
    if ((minItems ?? 0) < 0 || (maxItems ?? 100) > 100 || minItems !== undefined && maxItems !== undefined && minItems > maxItems) throw new Error(`${field} group bounds are invalid.`)
    if (!Array.isArray(control.fields) || !control.fields.length) throw new Error(`${field}.fields must be a non-empty array.`)
    const defaultItems = control.defaultItems === undefined ? undefined : Array.isArray(control.defaultItems) && control.defaultItems.every((item) => item && typeof item === 'object' && !Array.isArray(item)) ? safeSettingsJson(control.defaultItems, `${field}.defaultItems`) as Array<Record<string, unknown>> : (() => { throw new Error(`${field}.defaultItems must be an object array.`) })()
    if (defaultItems && (minItems !== undefined && defaultItems.length < minItems || maxItems !== undefined && defaultItems.length > maxItems)) throw new Error(`${field}.defaultItems violates its group bounds.`)
    const newItem = control.newItem === undefined ? undefined : safeSettingsJson(settingsRecord(control.newItem, `${field}.newItem`), `${field}.newItem`) as Record<string, unknown>
    return { ...stored, kind: 'group', addLabel: optionalSettingsText(control.addLabel, `${field}.addLabel`, 100), itemLabelPath: control.itemLabelPath === undefined ? undefined : settingsPointer(control.itemLabelPath, `${field}.itemLabelPath`), itemIdPath: control.itemIdPath === undefined ? undefined : settingsPointer(control.itemIdPath, `${field}.itemIdPath`), minItems, maxItems, defaultItems, newItem, fields: control.fields.map((entry, index) => parseControl(entry, `${field}.fields[${index}]`, groupDepth + 1)) }
  }
  const sections = candidate.sections.map((value, sectionIndex) => {
    const section = settingsRecord(value, `settings.sections[${sectionIndex}]`)
    rejectUnknownSettingsKeys(section, ['id', 'title', 'description', 'controls'], `settings.sections[${sectionIndex}]`)
    if (!Array.isArray(section.controls) || !section.controls.length) throw new Error(`settings.sections[${sectionIndex}].controls must be a non-empty array.`)
    return { id: uniqueId(section.id, `settings.sections[${sectionIndex}].id`), title: requireText(section.title, `settings.sections[${sectionIndex}].title`, 100), description: optionalSettingsText(section.description, `settings.sections[${sectionIndex}].description`, 500), controls: section.controls.map((control, controlIndex) => parseControl(control, `settings.sections[${sectionIndex}].controls[${controlIndex}]`, 0)) }
  })
  if (usesConfig && !permissions.includes('config:sync')) throw new Error('Synchronized extension settings require config:sync.')
  if (usesSecrets && !permissions.includes('secrets:device')) throw new Error('Secret extension settings require secrets:device.')
  return { schemaVersion: 1, label: optionalSettingsText(candidate.label, 'settings.label', 80), description: optionalSettingsText(candidate.description, 'settings.description', 300), helpText: optionalSettingsText(candidate.helpText, 'settings.helpText', 500), icon: optionalSettingsText(candidate.icon, 'settings.icon', 48), sections }
}

export const validateExtensionPackageManifest = (value: unknown): ExtensionPackageManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension manifest must be an object.')
  const candidate = value as Partial<ExtensionPackageManifest>
  if (candidate.format !== 'neo-anki-extension' || candidate.schemaVersion !== 2 || candidate.sdkVersion !== 2) throw new Error('Only Neo Anki extension SDK 2 packages are supported.')
  const id = requireText(candidate.id, 'id', 120)
  if (!extensionIdPattern.test(id)) throw new Error('Extension id must use lowercase reverse-domain notation.')
  const version = requireText(candidate.version, 'version', 64)
  if (!semverPattern.test(version)) throw new Error('Extension version must be valid semantic versioning.')
  const minimumNeoAnkiVersion = candidate.minimumNeoAnkiVersion ? requireText(candidate.minimumNeoAnkiVersion, 'minimumNeoAnkiVersion', 64) : undefined
  if (minimumNeoAnkiVersion && !semverPattern.test(minimumNeoAnkiVersion)) throw new Error('Extension minimum Neo Anki version must use valid semantic versioning.')
  const permissions = candidate.permissions as ExtensionPermissionV2[] | undefined
  if (!Array.isArray(permissions) || permissions.some((permission) => !permissionSet.has(permission))) throw new Error('Extension manifest contains an unknown permission.')
  if (new Set(permissions).size !== permissions.length) throw new Error('Extension permissions must not contain duplicates.')
  const homepage = candidate.homepage?.trim()
  if (homepage) {
    try {
      const url = new URL(homepage)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Extension homepage must use HTTP or HTTPS.')
    } catch (error) {
      if (error instanceof Error && error.message.includes('must use')) throw error
      throw new Error('Extension homepage must be a valid HTTP or HTTPS URL.')
    }
  }
  const networkDomains = candidate.networkDomains
  if (networkDomains !== undefined) {
    if (!Array.isArray(networkDomains) || networkDomains.length > 32 || networkDomains.some((domain) => typeof domain !== 'string' || !networkDomainPattern.test(domain))) throw new Error('Extension network domains are invalid.')
    if (!permissions.includes('network:fetch') && networkDomains.length) throw new Error('Extension network domains require network:fetch.')
  }
  const common = { format: 'neo-anki-extension' as const, id, name: requireText(candidate.name, 'name', 80), version, minimumNeoAnkiVersion, publisher: requireText(candidate.publisher, 'publisher', 100), description: candidate.description ? requireText(candidate.description, 'description', 300) : undefined, homepage: homepage || undefined, networkDomains: networkDomains ? [...new Set(networkDomains.map((domain) => domain.toLowerCase()))] : undefined }
  const v2 = candidate
  const workerEntry = v2.workerEntry ? normalizeExtensionPath(requireText(v2.workerEntry, 'workerEntry', 240)) : undefined
  if (workerEntry && !/\.(?:js|mjs)$/.test(workerEntry)) throw new Error('Extension worker entry must be a JavaScript module.')
  const uiEntries = v2.uiEntries?.map((entry) => ({
    id: requireText(entry.id, 'uiEntries.id', 80), surface: entry.surface, entry: normalizeExtensionPath(requireText(entry.entry, 'uiEntries.entry', 240)),
    label: entry.label ? requireText(entry.label, 'uiEntries.label', 80) : undefined,
    description: entry.description ? requireText(entry.description, 'uiEntries.description', 240) : undefined,
    helpText: entry.helpText ? requireText(entry.helpText, 'uiEntries.helpText', 300) : undefined,
    icon: entry.icon ? requireText(entry.icon, 'uiEntries.icon', 48) : undefined,
    launchDestination: entry.launchDestination ? requireText(entry.launchDestination, 'uiEntries.launchDestination', 128) : undefined,
  }))
  if (uiEntries?.some((entry) => !['review', 'page', 'create', 'workspace', 'migration'].includes(entry.surface) || !/\.(?:js|mjs)$/.test(entry.entry))) throw new Error('Extension UI entries are invalid; settings must use the declarative settings contract.')
  const surfacePermission = { review: 'ui:review', page: 'ui:page', create: 'ui:create', workspace: 'ui:workspace', migration: 'ui:migration' } as const
  if (uiEntries?.some((entry) => !permissions.includes(surfacePermission[entry.surface]))) throw new Error('Extension UI entries require their matching UI permission.')
  const settings = parseExtensionSettings(v2.settings, permissions)
  if (!workerEntry && !uiEntries?.length && !settings) throw new Error('SDK v2 extension needs a worker, UI entry, or declarative settings contribution.')
  if (uiEntries && new Set(uiEntries.map((entry) => entry.id)).size !== uiEntries.length) throw new Error('Extension UI entry ids must be unique.')
  const provenance = v2.provenance
  if (!provenance || typeof provenance !== 'object') throw new Error('SDK v2 extension provenance is required.')
  const sourceCommit = requireText(provenance.sourceCommit, 'provenance.sourceCommit', 128)
  const coreCommit = provenance.coreCommit ? requireText(provenance.coreCommit, 'provenance.coreCommit', 128) : undefined
  if (!commitPattern.test(sourceCommit) || (coreCommit && !commitPattern.test(coreCommit))) throw new Error('Extension provenance commits must be complete Git object ids.')
  const contributions = v2.contributions
  const parseContributions = (values: unknown, field: string) => values === undefined ? undefined : Array.isArray(values) && values.length <= 64 ? values.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Extension ${field} contributions are invalid.`)
    const entry = value as { id?: unknown; label?: unknown }
    return { id: requireText(entry.id, `${field}.id`, 80), label: requireText(entry.label, `${field}.label`, 80) }
  }) : (() => { throw new Error(`Extension ${field} contributions are invalid.`) })()
  const promptTypes = contributions?.promptTypes === undefined ? undefined : Array.isArray(contributions.promptTypes) && contributions.promptTypes.length <= 64 ? contributions.promptTypes.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension promptTypes contributions are invalid.')
    const entry = value as { id?: unknown; label?: unknown; description?: unknown; authoringHint?: unknown; requiredFields?: unknown }
    const requiredFields = entry.requiredFields === undefined ? undefined : Array.isArray(entry.requiredFields) && entry.requiredFields.length <= 5 && entry.requiredFields.every((field) => ['prompt', 'answer', 'audio', 'image', 'occlusions'].includes(String(field))) ? [...new Set(entry.requiredFields)] as Array<'prompt' | 'answer' | 'audio' | 'image' | 'occlusions'> : (() => { throw new Error('Extension promptTypes.requiredFields is invalid.') })()
    return { id: requireText(entry.id, 'promptTypes.id', 80), label: requireText(entry.label, 'promptTypes.label', 80), description: entry.description ? requireText(entry.description, 'promptTypes.description', 240) : undefined, authoringHint: entry.authoringHint ? requireText(entry.authoringHint, 'promptTypes.authoringHint', 300) : undefined, requiredFields }
  }) : (() => { throw new Error('Extension promptTypes contributions are invalid.') })()
  const authoringActions = contributions?.authoringActions === undefined ? undefined : Array.isArray(contributions.authoringActions) && contributions.authoringActions.length <= 64 ? contributions.authoringActions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension authoringActions contributions are invalid.')
    const entry = value as { id?: unknown; label?: unknown; description?: unknown; defaultSelected?: unknown; availability?: unknown; configurationDestination?: unknown }
    if (entry.defaultSelected !== undefined && typeof entry.defaultSelected !== 'boolean') throw new Error('Extension authoringActions.defaultSelected is invalid.')
    if (entry.availability !== undefined && entry.availability !== 'always' && entry.availability !== 'status-required') throw new Error('Extension authoringActions.availability is invalid.')
    return { id: requireText(entry.id, 'authoringActions.id', 80), label: requireText(entry.label, 'authoringActions.label', 80), description: entry.description ? requireText(entry.description, 'authoringActions.description', 240) : undefined, defaultSelected: entry.defaultSelected as boolean | undefined, availability: entry.availability as 'always' | 'status-required' | undefined, configurationDestination: entry.configurationDestination ? requireText(entry.configurationDestination, 'authoringActions.configurationDestination', 128) : undefined }
  }) : (() => { throw new Error('Extension authoringActions contributions are invalid.') })()
  const normalizedContributions = contributions ? {
    promptTypes,
    queuePolicies: parseContributions(contributions.queuePolicies, 'queuePolicies'),
    libraryPresets: parseContributions(contributions.libraryPresets, 'libraryPresets'),
    authoringActions,
  } : undefined
  for (const values of Object.values(normalizedContributions || {})) if (values && new Set(values.map((entry) => entry.id)).size !== values.length) throw new Error('Extension contribution ids must be unique within their type.')
  if (normalizedContributions?.promptTypes?.length && !permissions.includes('study:prompt-types')) throw new Error('Prompt type contributions require study:prompt-types.')
  if (normalizedContributions?.queuePolicies?.length && !permissions.includes('study:queue-policies')) throw new Error('Queue policy contributions require study:queue-policies.')
  return { ...common, schemaVersion: 2, sdkVersion: 2, permissions: [...permissions], publisherKey: requireText(v2.publisherKey, 'publisherKey', 4096), workerEntry, uiEntries, settings, contributions: normalizedContributions, provenance: { sourceCommit, coreCommit, buildSystem: requireText(provenance.buildSystem, 'provenance.buildSystem', 200) } }
}

export const parseExtensionPackage = (bytes: Uint8Array): ParsedExtensionPackage => {
  if (!bytes.byteLength || bytes.byteLength > MAX_EXTENSION_PACKAGE_BYTES) throw new Error('Extension package is empty or larger than 12 MB.')
  let filesSeen = 0
  let unpackedBytes = 0
  const unpacked = unzipSync(bytes, {
    filter: (file) => {
      filesSeen += 1
      unpackedBytes += file.originalSize
      if (filesSeen > MAX_EXTENSION_FILES) throw new Error('Extension package contains too many files.')
      if (unpackedBytes > MAX_EXTENSION_UNPACKED_BYTES) throw new Error('Extension package expands beyond 32 MB.')
      normalizeExtensionPath(file.name.endsWith('/') ? file.name.slice(0, -1) : file.name)
      return !file.name.endsWith('/')
    },
  })
  const files = Object.fromEntries(Object.entries(unpacked).map(([path, contents]) => [normalizeExtensionPath(path), contents]))
  const manifestBytes = files['manifest.json']
  if (!manifestBytes || manifestBytes.byteLength > 64 * 1024) throw new Error('Extension package needs a small root manifest.json.')
  let rawManifest: unknown
  try { rawManifest = JSON.parse(strFromU8(manifestBytes)) as unknown }
  catch { throw new Error('Extension manifest is not valid JSON.') }
  const manifest = validateExtensionPackageManifest(rawManifest)
  const entries = [manifest.workerEntry, ...(manifest.uiEntries || []).map((value) => value.entry)].filter((value): value is string => Boolean(value))
  for (const entry of entries) if (!files[entry]) throw new Error(`Extension entry ${entry} is missing from the package.`)
  return { manifest, files, compressedBytes: bytes.byteLength, unpackedBytes }
}

export const createExtensionPackage = (manifest: ExtensionPackageManifest, files: Record<string, Uint8Array | string>) => {
  const validated = validateExtensionPackageManifest(manifest)
  const raw: Record<string, Uint8Array> = { 'manifest.json': strToU8(`${JSON.stringify(validated, null, 2)}\n`) }
  for (const [path, value] of Object.entries(files)) raw[normalizeExtensionPath(path)] = typeof value === 'string' ? strToU8(value) : value
  const entries = [validated.workerEntry, ...(validated.uiEntries || []).map((value) => value.entry)].filter((value): value is string => Boolean(value))
  for (const entry of entries) if (!raw[entry]) throw new Error(`Extension entry ${entry} is missing.`)
  // ZIP stores DOS wall-clock fields without a timezone. Construct midnight in
  // the active timezone so every builder/runtime writes the same fields. A UTC
  // instant here shifts the stored hour by the local offset and makes signed
  // packages unverifiable when build and install happen in different zones.
  const epoch = new Date(1980, 0, 1, 0, 0, 0, 0)
  const contents: Zippable = Object.fromEntries(Object.keys(raw).sort().map((path) => [path, [raw[path], { level: 9, mtime: epoch }]]))
  const archive = zipSync(contents, { level: 9, mtime: epoch })
  parseExtensionPackage(archive)
  return archive
}
