import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('neoAnkiDesktop', {
  isDesktop: true,
  loadData: () => ipcRenderer.sendSync('neo-anki:load-data'),
  saveData: (data: unknown) => ipcRenderer.invoke('neo-anki:save-data', data),
  exportBackup: (data: unknown) => ipcRenderer.invoke('neo-anki:export-backup', data),
  resetData: () => ipcRenderer.invoke('neo-anki:reset-data'),
  listExtensions: () => ipcRenderer.invoke('neo-anki:list-extensions'),
  chooseExtensionPackage: () => ipcRenderer.invoke('neo-anki:choose-extension'),
  installExtension: (token: string) => ipcRenderer.invoke('neo-anki:install-extension', token),
  discardExtension: (token: string) => ipcRenderer.invoke('neo-anki:discard-extension', token),
  setExtensionEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('neo-anki:set-extension-enabled', id, enabled),
  uninstallExtension: (id: string) => ipcRenderer.invoke('neo-anki:uninstall-extension', id),
  reloadForExtensions: () => ipcRenderer.invoke('neo-anki:reload-for-extensions'),
  onNavigate: (callback: (destination: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, destination: string) => callback(destination)
    ipcRenderer.on('neo-anki:navigate', listener)
    return () => ipcRenderer.removeListener('neo-anki:navigate', listener)
  },
})
