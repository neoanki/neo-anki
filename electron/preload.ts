import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('neoAnkiDesktop', {
  isDesktop: true,
  rendererReady: () => ipcRenderer.send('neo-anki:renderer-ready'),
  loadData: () => ipcRenderer.sendSync('neo-anki:load-data'),
  saveData: (changes: unknown) => ipcRenderer.invoke('neo-anki:save-data', changes),
  exportBackup: () => ipcRenderer.invoke('neo-anki:export-backup'),
  restoreBackup: () => ipcRenderer.invoke('neo-anki:restore-backup'),
  resetData: () => ipcRenderer.invoke('neo-anki:reset-data'),
  createImportCheckpoint: () => ipcRenderer.invoke('neo-anki:create-import-checkpoint'),
  reportDiagnostic: (diagnostic: unknown) => ipcRenderer.invoke('neo-anki:report-diagnostic', diagnostic),
  exportDiagnostics: () => ipcRenderer.invoke('neo-anki:export-diagnostics'),
  getReleaseInfo: () => ipcRenderer.invoke('neo-anki:get-release-info'),
  listExtensions: () => ipcRenderer.invoke('neo-anki:list-extensions'),
  chooseExtensionPackage: () => ipcRenderer.invoke('neo-anki:choose-extension'),
  installExtension: (token: string) => ipcRenderer.invoke('neo-anki:install-extension', token),
  discardExtension: (token: string) => ipcRenderer.invoke('neo-anki:discard-extension', token),
  setExtensionEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('neo-anki:set-extension-enabled', id, enabled),
  uninstallExtension: (id: string) => ipcRenderer.invoke('neo-anki:uninstall-extension', id),
  reloadForExtensions: () => ipcRenderer.invoke('neo-anki:reload-for-extensions'),
  claimExtensionCapability: (id: string) => ipcRenderer.invoke('neo-anki:claim-extension-capability', id),
  extensionNetworkFetch: (token: string, request: unknown) => ipcRenderer.invoke('neo-anki:extension-network-fetch', token, request),
  extensionSecretHas: (token: string, key: string) => ipcRenderer.invoke('neo-anki:extension-secret-has', token, key),
  extensionSecretGet: (token: string, key: string) => ipcRenderer.invoke('neo-anki:extension-secret-get', token, key),
  extensionSecretSet: (token: string, key: string, value: string) => ipcRenderer.invoke('neo-anki:extension-secret-set', token, key, value),
  extensionSecretDelete: (token: string, key: string) => ipcRenderer.invoke('neo-anki:extension-secret-delete', token, key),
  onNavigate: (callback: (destination: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, destination: string) => callback(destination)
    ipcRenderer.on('neo-anki:navigate', listener)
    return () => ipcRenderer.removeListener('neo-anki:navigate', listener)
  },
})
