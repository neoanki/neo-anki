interface NeoAnkiDesktopLoadResult {
  data: unknown | null
  storagePath: string
  recoveredFromBackup: boolean
  error?: string
}

interface NeoAnkiDesktopBridge {
  isDesktop: true
  loadData(): NeoAnkiDesktopLoadResult
  saveData(data: unknown): Promise<void>
  exportBackup(data: unknown): Promise<{ canceled: boolean; path?: string }>
  resetData(): Promise<void>
  onNavigate(callback: (destination: string) => void): () => void
}

interface Window {
  neoAnkiDesktop?: NeoAnkiDesktopBridge
}
