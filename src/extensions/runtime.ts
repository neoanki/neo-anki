import { ExtensionRegistry } from './registry'
import { imageOcclusionExtension } from './image-occlusion'
import { interoperabilityExtension } from './interoperability'
import { promptTypesExtension } from './prompts'
import { recoveryPoliciesExtension } from './recovery-policies'
import { tabSyncExtension } from './tab-sync'
import { workspaceExtension } from './workspace'
import { sharedPacksExtension } from './shared-packs'
import { insightsExtension } from './insights'
import type { NeoAnkiExtension } from './sdk'

const bundledExtensions: NeoAnkiExtension[] = [
  promptTypesExtension,
  imageOcclusionExtension,
  interoperabilityExtension,
  recoveryPoliciesExtension,
  tabSyncExtension,
  workspaceExtension,
  sharedPacksExtension,
  insightsExtension,
]

export const extensionRuntime = new ExtensionRegistry(bundledExtensions)
export const bundledExtensionIds = new Set(bundledExtensions.map((extension) => extension.manifest.id))

const sameManifest = (extension: NeoAnkiExtension, installed: NeoAnkiInstalledExtension) => {
  const left = extension.manifest
  const right = installed.manifest
  return left.id === right.id
    && left.version === right.version
    && left.sdkVersion === right.sdkVersion
    && left.publisher === right.publisher
    && JSON.stringify([...left.permissions].sort()) === JSON.stringify([...right.permissions].sort())
}

export const initializeExternalExtensions = async () => {
  if (!window.neoAnkiDesktop || new URLSearchParams(window.location.search).get('safe-mode') === '1') return
  let installed: NeoAnkiInstalledExtension[] = []
  try { installed = await window.neoAnkiDesktop.listExtensions() }
  catch (error) { extensionRuntime.reportDiagnostic('extension-host', 'list', error); void window.neoAnkiDesktop.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-list', message: error instanceof Error ? error.message : 'Could not list extensions.' }); return }
  for (const record of installed.filter((candidate) => candidate.enabled)) {
    try {
      const module = await import(/* @vite-ignore */ record.entryUrl) as { default?: unknown }
      const extension = module.default as NeoAnkiExtension | undefined
      if (!extension?.manifest || !sameManifest(extension, record)) throw new Error('Runtime manifest does not match the reviewed package manifest.')
      extensionRuntime.register(extension)
    } catch (error) {
      extensionRuntime.reportDiagnostic(record.manifest.id, 'load', error)
      void window.neoAnkiDesktop.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-load', message: `${record.manifest.id}: ${error instanceof Error ? error.message : 'Extension load failed.'}`, stack: error instanceof Error ? error.stack : undefined })
    }
  }
}
