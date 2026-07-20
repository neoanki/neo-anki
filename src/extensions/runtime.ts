import { ExtensionRegistry } from './registry'
import { imageOcclusionExtension } from './image-occlusion'
import { interoperabilityExtension } from './interoperability'
import { promptTypesExtension } from './prompts'
import { recoveryPoliciesExtension } from './recovery-policies'
import { workspaceExtension } from './workspace'
import { sharedPacksExtension } from './shared-packs'
import type { NeoAnkiCoreModule } from './core-module'
import { prepareExtensionHost } from './host'
import { initializeExtensionRegistryV2 } from './v2/registry'

const bundledModules: NeoAnkiCoreModule[] = [
  promptTypesExtension,
  imageOcclusionExtension,
  interoperabilityExtension,
  recoveryPoliciesExtension,
  workspaceExtension,
  sharedPacksExtension,
]

export const extensionRuntime = new ExtensionRegistry(bundledModules)

export const initializeExternalExtensions = async () => {
  if (!window.neoAnkiDesktop || new URLSearchParams(window.location.search).get('safe-mode') === '1') return
  let installed: NeoAnkiInstalledExtension[] = []
  try { installed = await window.neoAnkiDesktop.listExtensions() }
  catch (error) { extensionRuntime.reportDiagnostic('extension-host', 'list', error); void window.neoAnkiDesktop.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-list', message: error instanceof Error ? error.message : 'Could not list extensions.' }); return }
  const enabled = installed.filter((candidate) => candidate.enabled)
  await Promise.all(enabled.map((record) => prepareExtensionHost(record.manifest.id).catch((error) => extensionRuntime.reportDiagnostic(record.manifest.id, 'capability-host', error))))
  await initializeExtensionRegistryV2(enabled)
}
