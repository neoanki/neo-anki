import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ExtensionManager } from './extension-manager.js'
import { ExtensionServices } from './extension-services.js'
import { WorkspaceStore } from './workspace-store.js'
import { DiagnosticsLog } from './diagnostics-log.js'
import { DesktopSyncManager } from './sync-manager.js'
import { secureSecretStorageAvailable } from './secret-backend.js'
import type { WorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { WorkspacePatchV2 } from '../packages/compatibility-domain/src/index.js'

const APP_SCHEME = 'neoanki'
const EXTENSION_SCHEME = 'neoanki-extension'
const MEDIA_SCHEME = 'neoanki-media'
const EXTENSION_WORKER_LOCKDOWN = ';(()=>{for(const name of ["fetch","XMLHttpRequest","WebSocket","EventSource","WebTransport","RTCPeerConnection","Worker","SharedWorker","BroadcastChannel","indexedDB","caches","importScripts"]){try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false})}catch{try{globalThis[name]=undefined}catch{}}}})();\n'
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
let extensionServices: ExtensionServices
let workspaceStore: WorkspaceStore
let diagnosticsLog: DiagnosticsLog
let syncManager: DesktopSyncManager
let saveQueue: Promise<void> = Promise.resolve()
let quitAfterFlush = false

let rendererReady = false
let rendererStartupTimer: NodeJS.Timeout | null = null

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
    void createWindow('?safe-mode=1&recovered=extension-startup').then(() => {
      if (!windowToRecover.isDestroyed()) windowToRecover.destroy()
    }).catch((error) => {
      void diagnosticsLog.record({ source: 'main', level: 'error', code: 'safe-mode-window', message: error instanceof Error ? error.message : 'Could not open the safe-mode recovery window.' })
    })
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
    return workspaceStore.createImportCheckpoint()
  })

  ipcMain.handle('neo-anki:list-migration-recovery-files', (event) => {
    assertTrustedSender(event)
    return workspaceStore.listMigrationRecoveryFiles()
  })

  ipcMain.handle('neo-anki:remove-migration-recovery-file', (event, kind: 'source-package' | 'workspace-checkpoint', name: string) => {
    assertTrustedSender(event)
    workspaceStore.removeMigrationRecoveryFile(kind, name)
  })

  ipcMain.handle('neo-anki:commit-workspace-v4-import', async (event, input: { document: unknown; media: unknown[]; sourceArchive?: Uint8Array; operation: 'additive' | 'replace-profile' }) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    return workspaceStore.commitWorkspaceV4Import(input)
  })

  ipcMain.handle('neo-anki:load-workspace-v4-export-payload', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    return workspaceStore.workspaceV4ExportPayload()
  })

  ipcMain.handle('neo-anki:load-workspace-v4-document', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    return workspaceStore.workspaceV4Document()
  })

  ipcMain.handle('neo-anki:apply-core-workspace-patch-v2', async (event, patch: WorkspacePatchV2) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    return workspaceStore.applyCoreWorkspacePatch(patch)
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

  ipcMain.handle('neo-anki:get-release-info', (event) => {
    assertTrustedSender(event)
    return { currentVersion: app.getVersion(), automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }
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
    extensionServices.release(id)
    await extensionManager.setEnabled(id, enabled)
  })

  ipcMain.handle('neo-anki:uninstall-extension', async (event, id: string, deleteSecrets: boolean) => {
    assertTrustedSender(event)
    extensionServices.release(id)
    if (deleteSecrets) await extensionServices.deleteAllSecrets(id)
    await extensionManager.uninstall(id)
  })

  ipcMain.handle('neo-anki:reload-for-extensions', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    extensionServices.release()
    mainWindow?.webContents.reload()
  })
  ipcMain.handle('neo-anki:extension-network-fetch', async (event, token: string, request) => {
    assertTrustedSender(event)
    return extensionServices.fetch(token, request)
  })
  ipcMain.handle('neo-anki:claim-extension-capability', async (event, id: string) => {
    assertTrustedSender(event)
    return extensionServices.claim(id)
  })
  ipcMain.handle('neo-anki:extension-apply-patch-v2', async (event, token: string, patch: WorkspacePatchV2) => {
    assertTrustedSender(event); const extensionId = await extensionServices.authorize(token, 'content:patch-own')
    return workspaceStore.applyExtensionWorkspacePatch(extensionId, patch)
  })
  ipcMain.handle('neo-anki:extension-create-media-v2', async (event, token: string, request: { filename: string; mimeType: string; bytes: Uint8Array; altText?: string }) => {
    assertTrustedSender(event); const extensionId = await extensionServices.authorize(token, 'media:create')
    return workspaceStore.createExtensionMedia(extensionId, request)
  })
  ipcMain.handle('neo-anki:extension-secret-read-batch-v2', (event, token: string, keys: string[]) => { assertTrustedSender(event); return extensionServices.readSecretBatch(token, keys) })
  ipcMain.handle('neo-anki:extension-secret-mutate-batch-v2', (event, token: string, changes) => { assertTrustedSender(event); return extensionServices.mutateSecretBatch(token, changes) })
  ipcMain.handle('neo-anki:extension-config-read-v2', async (event, token: string) => {
    assertTrustedSender(event); const extensionId = await extensionServices.authorize(token, 'config:sync')
    return workspaceStore.readExtensionConfig(extensionId)
  })
  ipcMain.handle('neo-anki:extension-config-write-v2', async (event, token: string, value: unknown) => {
    assertTrustedSender(event); const extensionId = await extensionServices.authorize(token, 'config:sync')
    return workspaceStore.writeExtensionConfig(extensionId, value)
  })
  ipcMain.handle('neo-anki:extension-content-list-notes-v2', async (event, token: string, query: { cursor?: string; limit?: number; noteIds?: string[] }) => {
    assertTrustedSender(event); const extensionId = await extensionServices.authorize(token, 'content:read')
    return workspaceStore.extensionContentNotes(extensionId, query)
  })
  ipcMain.handle('neo-anki:extension-cancel-v2', (event, token: string, operationId: string) => { assertTrustedSender(event); extensionServices.cancel(token, operationId) })
  ipcMain.handle('neo-anki:sync-status', (event) => { assertTrustedSender(event); return syncManager.status() })
  ipcMain.handle('neo-anki:sync-list-devices', (event) => { assertTrustedSender(event); return syncManager.listDevices() })
  ipcMain.handle('neo-anki:sync-create-account', async (event, endpoint: string) => {
    assertTrustedSender(event); await saveQueue
    const payload = workspaceStore.workspaceV4ExportPayload()
    return syncManager.createAccount(endpoint, payload.document, payload.media)
  })
  ipcMain.handle('neo-anki:sync-recover-account', async (event, recoveryBundle: string) => {
    assertTrustedSender(event); await saveQueue
    let data = workspaceStore.load()
    const result = await syncManager.recoverAccount(recoveryBundle, workspaceStore.workspaceV4Document(), async (payload) => {
      await workspaceStore.createAutomaticBackup('before-sync-recovery')
      data = workspaceStore.commitSynchronizedWorkspace(payload)
    })
    return { data, status: result.status }
  })
  ipcMain.handle('neo-anki:sync-now', async (event) => {
    assertTrustedSender(event); await saveQueue
    const payload = workspaceStore.workspaceV4ExportPayload(); let data = workspaceStore.load()
    const result = await syncManager.synchronize(payload.document, payload.media, [], async (synchronized) => {
      if (!synchronized.received) return
      await workspaceStore.createAutomaticBackup('before-sync-merge')
      data = workspaceStore.commitSynchronizedWorkspace(synchronized)
    })
    return { data, status: result.status, sent: result.sent, received: result.received }
  })
  ipcMain.handle('neo-anki:sync-resolve-conflict', async (event, conflictId: string, choice: 'existing' | 'incoming') => {
    assertTrustedSender(event); await saveQueue
    if (!['existing', 'incoming'].includes(choice)) throw new Error('Sync conflict resolution is invalid.')
    const payload = workspaceStore.workspaceV4ExportPayload()
    await workspaceStore.createAutomaticBackup('before-sync-conflict-resolution')
    let data = workspaceStore.load()
    const result = await syncManager.resolveConflict(String(conflictId), choice, payload.document, payload.media, (synchronized) => { data = workspaceStore.commitSynchronizedWorkspace(synchronized) })
    return { data, status: result.status, sent: result.sent, received: result.received }
  })
  ipcMain.handle('neo-anki:sync-rotate-recovery', (event) => { assertTrustedSender(event); return syncManager.rotateRecoveryBundle() })
  ipcMain.handle('neo-anki:sync-revoke-device', (event, actorId: string) => { assertTrustedSender(event); return syncManager.revokeDevice(actorId) })
  ipcMain.handle('neo-anki:sync-disconnect', (event) => { assertTrustedSender(event); return syncManager.disconnect() })
  ipcMain.handle('neo-anki:sync-delete-account', (event) => { assertTrustedSender(event); return syncManager.deleteAccount() })
}

const registerAppProtocol = () => {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    if (url.pathname === '/__extension-worker.js') {
      try {
        const id = url.searchParams.get('id') || ''
        const entry = url.searchParams.get('entry') || ''
        const digest = url.searchParams.get('v') || ''
        const source = await extensionManager.readWorkerEntry(id, entry, digest)
        return new Response(Buffer.concat([Buffer.from(EXTENSION_WORKER_LOCKDOWN), Buffer.from(source)]), { headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; script-src 'none'; connect-src 'none'; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'",
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        } })
      } catch { return new Response('Extension worker not found', { status: 404 }) }
    }
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
    if (!target) return new Response('Extension asset not found', { status: 404 })
    const source = await net.fetch(pathToFileURL(target).toString())
    const javascript = target.endsWith('.js') || target.endsWith('.mjs')
    return new Response(source.body, { status: source.status, headers: {
      'Content-Type': javascript ? 'text/javascript; charset=utf-8' : source.headers.get('content-type') || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      ...(javascript ? { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'" } : {}),
    } })
  })
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'asset') return new Response('Media not found', { status: 404 })
    const asset = workspaceStore.readAsset(decodeURIComponent(url.pathname.replace(/^\//, '')))
    return asset ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType, ETag: `"${asset.hash}"`, 'Cache-Control': 'private, max-age=31536000, immutable' } }) : new Response('Media not found', { status: 404 })
  })
}

const createWindow = async (query = '') => {
  const window = new BrowserWindow({
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
  mainWindow = window

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) { rendererReady = false; armRendererStartupWatchdog() } })
  window.webContents.on('did-finish-load', armRendererStartupWatchdog)

  if (devServerUrl) await window.loadURL(`${devServerUrl}${query}`)
  else await window.loadURL(`${APP_SCHEME}://app/index.html${query}`)
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  diagnosticsLog = new DiagnosticsLog(join(app.getPath('userData'), 'diagnostics'), app.getVersion())
  process.on('uncaughtException', (error) => { void diagnosticsLog.record({ source: 'main', level: 'error', code: 'uncaught-exception', message: error.message, stack: error.stack }) })
  process.on('unhandledRejection', (reason) => { const error = reason instanceof Error ? reason : new Error(String(reason)); void diagnosticsLog.record({ source: 'main', level: 'error', code: 'unhandled-rejection', message: error.message, stack: error.stack }) })
  workspaceStore = new WorkspaceStore(app.getPath('userData'))
  syncManager = new DesktopSyncManager(app.getPath('userData'), {
    available: () => secureSecretStorageAvailable(process.platform, safeStorage.isEncryptionAvailable(), process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined),
    seal: (value) => new Uint8Array(safeStorage.encryptString(value)),
    open: (value) => safeStorage.decryptString(Buffer.from(value)),
  })
  extensionManager = new ExtensionManager(app.getPath('userData'))
  extensionServices = new ExtensionServices(app.getPath('userData'), extensionManager)
  const installPath = process.argv.find((value) => value.startsWith('--install-extension='))?.slice('--install-extension='.length)
  if (installPath) {
    try { await extensionManager.installFile(resolve(installPath)) }
    catch (error) { dialog.showErrorBox('Could not install extension', error instanceof Error ? error.message : 'The extension package is invalid.') }
  }
  registerDesktopIpc()
  registerAppProtocol()
  installApplicationMenu()
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if ((await syncManager.status()).pendingCommit) {
    try {
      const payload = workspaceStore.workspaceV4ExportPayload()
      await syncManager.synchronize(payload.document, payload.media, [], async (synchronized) => {
        await workspaceStore.createAutomaticBackup('before-resuming-sync-commit')
        workspaceStore.commitSynchronizedWorkspace(synchronized)
      })
    } catch (error) {
      await diagnosticsLog.record({ source: 'main', level: 'error', code: 'sync-commit-resume', message: error instanceof Error ? error.message : 'Interrupted sync commit could not be resumed.' })
    }
  }
  await createWindow()
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
