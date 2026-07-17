import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ExtensionManager } from './extension-manager.js'
import { WorkspaceStore } from './workspace-store.js'
import { DiagnosticsLog } from './diagnostics-log.js'
import type { WorkspaceChangeSet } from '../src/lib/workspace-changes.js'

const APP_SCHEME = 'neoanki'
const EXTENSION_SCHEME = 'neoanki-extension'
const MEDIA_SCHEME = 'neoanki-media'
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const rendererStartupTimeoutMs = process.env.NEO_ANKI_STARTUP_TIMEOUT_MS ? Math.max(500, Number(process.env.NEO_ANKI_STARTUP_TIMEOUT_MS) || 12_000) : 12_000

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: EXTENSION_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

if (process.env.NEO_ANKI_USER_DATA_DIR) app.setPath('userData', resolve(process.env.NEO_ANKI_USER_DATA_DIR))
app.setName('Neo Anki')

let mainWindow: BrowserWindow | null = null
let extensionManager: ExtensionManager
let workspaceStore: WorkspaceStore
let diagnosticsLog: DiagnosticsLog
let saveQueue: Promise<void> = Promise.resolve()
let quitAfterFlush = false

type UpdatePhase = 'development' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error'
interface DesktopUpdateState { phase: UpdatePhase; currentVersion: string; version?: string; percent?: number; error?: string }
let updateState: DesktopUpdateState = { phase: 'development', currentVersion: app.getVersion() }
let applicationUpdater: AppUpdater | null = null
let rendererReady = false
let rendererStartupTimer: NodeJS.Timeout | null = null
const publishUpdateState = (next: DesktopUpdateState) => {
  updateState = next
  mainWindow?.webContents.send('neo-anki:update-state', updateState)
}

const configureUpdates = async () => {
  if (!app.isPackaged) return publishUpdateState({ phase: 'development', currentVersion: app.getVersion() })
  const { autoUpdater } = await import('electron-updater')
  applicationUpdater = autoUpdater
  applicationUpdater.autoDownload = false
  applicationUpdater.autoInstallOnAppQuit = true
  applicationUpdater.allowDowngrade = false
  applicationUpdater.on('checking-for-update', () => publishUpdateState({ phase: 'checking', currentVersion: app.getVersion() }))
  applicationUpdater.on('update-available', (info: UpdateInfo) => publishUpdateState({ phase: 'available', currentVersion: app.getVersion(), version: info.version }))
  applicationUpdater.on('update-not-available', () => publishUpdateState({ phase: 'current', currentVersion: app.getVersion() }))
  applicationUpdater.on('download-progress', (progress: ProgressInfo) => publishUpdateState({ phase: 'downloading', currentVersion: app.getVersion(), version: updateState.version, percent: Math.max(0, Math.min(100, progress.percent)) }))
  applicationUpdater.on('update-downloaded', (info: UpdateInfo) => {
    void workspaceStore.createAutomaticBackup('before-update').catch((error) => diagnosticsLog.record({ source: 'main', level: 'warning', code: 'update-backup', message: error instanceof Error ? error.message : 'Could not create the pre-update backup.' }))
    publishUpdateState({ phase: 'ready', currentVersion: app.getVersion(), version: info.version, percent: 100 })
  })
  applicationUpdater.on('error', (error: Error) => {
    publishUpdateState({ phase: 'error', currentVersion: app.getVersion(), version: updateState.version, error: error.message })
    void diagnosticsLog.record({ source: 'main', level: 'error', code: 'auto-update', message: error.message, stack: error.stack })
  })
  publishUpdateState({ phase: 'idle', currentVersion: app.getVersion() })
  setTimeout(() => { void applicationUpdater?.checkForUpdates() }, 15_000).unref()
}

const hasSingleInstanceLock = process.env.NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES === '1' || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

type DesktopDestination = 'today' | 'library' | 'create' | 'plans' | 'insights' | 'settings'

const sendDestination = (destination: DesktopDestination) => mainWindow?.webContents.send('neo-anki:navigate', destination)

const installApplicationMenu = () => {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendDestination('settings') },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Knowledge Item', accelerator: 'CmdOrCtrl+N', click: () => sendDestination('create') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }]),
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Today', accelerator: 'CmdOrCtrl+1', click: () => sendDestination('today') },
        { label: 'Library', accelerator: 'CmdOrCtrl+2', click: () => sendDestination('library') },
        { label: 'Plans', accelerator: 'CmdOrCtrl+3', click: () => sendDestination('plans') },
        { label: 'Insights', accelerator: 'CmdOrCtrl+4', click: () => sendDestination('insights') },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const queueSave = (changes: WorkspaceChangeSet) => {
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    workspaceStore.applyChanges(changes)
    await workspaceStore.maybeCreateDailyBackup()
  })
  return saveQueue
}

const isTrustedUrl = (url: string) => devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(`${APP_SCHEME}://app/`)
const assertTrustedSender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
  if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('Rejected desktop request from an untrusted renderer.')
}

const clearRendererStartupTimer = () => {
  if (rendererStartupTimer) clearTimeout(rendererStartupTimer)
  rendererStartupTimer = null
}

const armRendererStartupWatchdog = () => {
  clearRendererStartupTimer()
  if (rendererReady || !mainWindow) return
  rendererStartupTimer = setTimeout(() => {
    const currentUrl = mainWindow?.webContents.getURL() || ''
    if (!mainWindow || currentUrl.includes('safe-mode=1')) {
      void diagnosticsLog.record({ source: 'main', level: 'error', code: 'safe-mode-startup-timeout', message: 'The renderer did not become ready in safe mode.' })
      return
    }
    void diagnosticsLog.record({ source: 'extension-host', level: 'error', code: 'extension-startup-timeout', message: 'The renderer did not become ready; Neo Anki restarted without locally installed extensions.' })
    const windowToRecover = mainWindow
    windowToRecover.destroy()
    void createWindow('?safe-mode=1&recovered=extension-startup')
  }, rendererStartupTimeoutMs)
  rendererStartupTimer.unref()
}

const registerDesktopIpc = () => {
  ipcMain.on('neo-anki:renderer-ready', (event) => {
    assertTrustedSender(event)
    rendererReady = true
    clearRendererStartupTimer()
  })
  ipcMain.on('neo-anki:load-data', (event) => {
    try {
      assertTrustedSender(event)
      const status = workspaceStore.status()
      event.returnValue = { data: workspaceStore.load(), storagePath: status.path, recoveredFromBackup: status.recoveredFromBackup, migratedLegacyData: status.migratedLegacyData, error: status.recoveryError }
    } catch (error) {
      event.returnValue = { data: null, storagePath: '', recoveredFromBackup: false, error: error instanceof Error ? error.message : 'Could not load data.' }
    }
  })

  ipcMain.handle('neo-anki:save-data', async (event, changes: WorkspaceChangeSet) => {
    assertTrustedSender(event)
    await queueSave(changes)
  })

  ipcMain.handle('neo-anki:export-backup', async (event) => {
    assertTrustedSender(event)
    const options = {
      title: 'Export Neo Anki Backup',
      defaultPath: `neo-anki-${new Date().toISOString().slice(0, 10)}.neoanki-backup`,
      filters: [{ name: 'Neo Anki backup', extensions: ['neoanki-backup'] }],
    }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    await saveQueue.catch(() => undefined)
    await workspaceStore.exportBackup(result.filePath)
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('neo-anki:restore-backup', async (event) => {
    assertTrustedSender(event)
    const options: Electron.OpenDialogOptions = { title: 'Restore Neo Anki Backup', properties: ['openFile'], filters: [{ name: 'Neo Anki backup', extensions: ['neoanki-backup'] }] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    await saveQueue.catch(() => undefined)
    await workspaceStore.restoreBackup(result.filePaths[0])
    return { canceled: false }
  })

  ipcMain.handle('neo-anki:reset-data', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    await workspaceStore.createAutomaticBackup('before-reset')
    workspaceStore.clear()
  })

  ipcMain.handle('neo-anki:create-import-checkpoint', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    return workspaceStore.createAutomaticBackup('before-import')
  })

  ipcMain.handle('neo-anki:report-diagnostic', async (event, diagnostic: { source?: string; level?: string; code?: string; message?: string; stack?: string }) => {
    assertTrustedSender(event)
    await diagnosticsLog.record({
      source: diagnostic.source === 'extension-host' ? 'extension-host' : 'renderer',
      level: diagnostic.level === 'warning' || diagnostic.level === 'info' ? diagnostic.level : 'error',
      code: diagnostic.code || 'renderer-error',
      message: diagnostic.message || 'Unknown renderer error',
      stack: diagnostic.stack,
    })
  })

  ipcMain.handle('neo-anki:export-diagnostics', async (event) => {
    assertTrustedSender(event)
    const options = { title: 'Export Neo Anki Diagnostics', defaultPath: `neo-anki-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`, filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }] }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    await diagnosticsLog.export(result.filePath)
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('neo-anki:get-update-state', (event) => { assertTrustedSender(event); return updateState })
  ipcMain.handle('neo-anki:check-for-updates', async (event) => {
    assertTrustedSender(event)
    if (!app.isPackaged) return updateState
    if (!applicationUpdater) await configureUpdates()
    await applicationUpdater?.checkForUpdates()
    return updateState
  })
  ipcMain.handle('neo-anki:download-update', async (event) => {
    assertTrustedSender(event)
    if (updateState.phase !== 'available') throw new Error('No verified update is ready to download.')
    if (!applicationUpdater) throw new Error('The update service is not ready.')
    await applicationUpdater.downloadUpdate()
    return updateState
  })
  ipcMain.handle('neo-anki:install-update', async (event) => {
    assertTrustedSender(event)
    if (updateState.phase !== 'ready') throw new Error('The update has not finished downloading.')
    await saveQueue.catch(() => undefined)
    if (!applicationUpdater) throw new Error('The update service is not ready.')
    applicationUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('neo-anki:list-extensions', async (event) => {
    assertTrustedSender(event)
    return extensionManager.list()
  })

  ipcMain.handle('neo-anki:choose-extension', async (event) => {
    assertTrustedSender(event)
    const options: Electron.OpenDialogOptions = { title: 'Choose Neo Anki Extension', properties: ['openFile'], filters: [{ name: 'Neo Anki extension', extensions: ['neoanki-extension'] }] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { canceled: false, candidate: await extensionManager.stage(new Uint8Array(await readFile(result.filePaths[0]))) }
  })

  ipcMain.handle('neo-anki:install-extension', async (event, token: string) => {
    assertTrustedSender(event)
    return extensionManager.install(token)
  })

  ipcMain.handle('neo-anki:discard-extension', (event, token: string) => {
    assertTrustedSender(event)
    extensionManager.discard(token)
  })

  ipcMain.handle('neo-anki:set-extension-enabled', async (event, id: string, enabled: boolean) => {
    assertTrustedSender(event)
    await extensionManager.setEnabled(id, enabled)
  })

  ipcMain.handle('neo-anki:uninstall-extension', async (event, id: string) => {
    assertTrustedSender(event)
    await extensionManager.uninstall(id)
  })

  ipcMain.handle('neo-anki:reload-for-extensions', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    mainWindow?.webContents.reload()
  })
}

const registerAppProtocol = () => {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    const distRoot = resolve(app.getAppPath(), 'dist')
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const target = resolve(distRoot, `.${pathname}`)
    if (relative(distRoot, target).startsWith('..') || !target.startsWith(`${distRoot}${sep}`)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
  protocol.handle(EXTENSION_SCHEME, async (request) => {
    const url = new URL(request.url)
    const requestedPath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const target = await extensionManager.resolveAsset(url.hostname, requestedPath)
    return target ? net.fetch(pathToFileURL(target).toString()) : new Response('Extension asset not found', { status: 404 })
  })
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'asset') return new Response('Media not found', { status: 404 })
    const asset = workspaceStore.readAsset(decodeURIComponent(url.pathname.replace(/^\//, '')))
    return asset ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType, ETag: `"${asset.hash}"`, 'Cache-Control': 'private, max-age=31536000, immutable' } }) : new Response('Media not found', { status: 404 })
  })
}

const createWindow = async (query = '') => {
  mainWindow = new BrowserWindow({
    title: 'Neo Anki',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f1ea',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 15, y: 14 } : undefined,
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; armRendererStartupWatchdog() })
  mainWindow.webContents.on('did-finish-load', armRendererStartupWatchdog)

  if (devServerUrl) await mainWindow.loadURL(`${devServerUrl}${query}`)
  else await mainWindow.loadURL(`${APP_SCHEME}://app/index.html${query}`)
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  diagnosticsLog = new DiagnosticsLog(join(app.getPath('userData'), 'diagnostics'), app.getVersion())
  process.on('uncaughtException', (error) => { void diagnosticsLog.record({ source: 'main', level: 'error', code: 'uncaught-exception', message: error.message, stack: error.stack }) })
  process.on('unhandledRejection', (reason) => { const error = reason instanceof Error ? reason : new Error(String(reason)); void diagnosticsLog.record({ source: 'main', level: 'error', code: 'unhandled-rejection', message: error.message, stack: error.stack }) })
  workspaceStore = new WorkspaceStore(app.getPath('userData'))
  extensionManager = new ExtensionManager(app.getPath('userData'))
  const installPath = process.argv.find((value) => value.startsWith('--install-extension='))?.slice('--install-extension='.length)
  if (installPath) {
    try { await extensionManager.installFile(resolve(installPath)) }
    catch (error) { dialog.showErrorBox('Could not install extension', error instanceof Error ? error.message : 'The extension package is invalid.') }
  }
  registerDesktopIpc()
  registerAppProtocol()
  installApplicationMenu()
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  await createWindow()
  void configureUpdates().catch((error) => {
    publishUpdateState({ phase: 'error', currentVersion: app.getVersion(), error: error instanceof Error ? error.message : 'The update service could not start.' })
    void diagnosticsLog.record({ source: 'main', level: 'error', code: 'update-initialize', message: error instanceof Error ? error.message : 'The update service could not start.' })
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch((error) => {
  dialog.showErrorBox('Neo Anki could not start', error instanceof Error ? error.message : 'The local workspace could not be opened.')
  app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterFlush) return
  event.preventDefault()
  void saveQueue.catch(() => undefined).finally(() => {
    quitAfterFlush = true
    workspaceStore?.close()
    app.quit()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
