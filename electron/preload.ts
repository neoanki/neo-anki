import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('neoAnkiDesktop', {
  isDesktop: true,
  loadData: () => ipcRenderer.sendSync('neo-anki:load-data'),
  saveData: (data: unknown) => ipcRenderer.invoke('neo-anki:save-data', data),
  exportBackup: (data: unknown) => ipcRenderer.invoke('neo-anki:export-backup', data),
  resetData: () => ipcRenderer.invoke('neo-anki:reset-data'),
})

