import { prepareExtensionHost } from './host'
import { initializeExtensionRegistryV2 } from './v2/registry'

const diagnostics: Array<{ extensionId: string; contribution: string; message: string }> = []
export const extensionRuntime = {
  reportDiagnostic(extensionId: string, contribution: string, error: unknown) { diagnostics.unshift({ extensionId, contribution, message: error instanceof Error ? error.message : String(error) }); if (diagnostics.length > 500) diagnostics.length = 500 },
  getDiagnostics: () => [...diagnostics],
}

export const initializeExternalExtensions = async () => {
  if (!window.neoAnkiDesktop || new URLSearchParams(window.location.search).get('safe-mode') === '1') return
  let installed: NeoAnkiInstalledExtension[] = []
  try { installed = await window.neoAnkiDesktop.listExtensions() }
  catch (error) { extensionRuntime.reportDiagnostic('extension-host', 'list', error); void window.neoAnkiDesktop.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-list', message: error instanceof Error ? error.message : 'Could not list extensions.' }); return }
  const enabled = installed.filter((candidate) => candidate.enabled)
  await Promise.all(enabled.map((record) => prepareExtensionHost(record.manifest.id).catch((error) => extensionRuntime.reportDiagnostic(record.manifest.id, 'capability-host', error))))
  await initializeExtensionRegistryV2(enabled)
}
