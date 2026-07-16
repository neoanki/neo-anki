import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ExtensionManager } from './extension-manager.js'

const APP_SCHEME = 'neoanki'
const EXTENSION_SCHEME = 'neoanki-extension'
const DATA_FILE = 'neo-anki-data.json'
const RECOVERY_FILE = 'neo-anki-data.recovery.json'
const TEMP_FILE = 'neo-anki-data.next.json'
const devServerUrl = process.env.VITE_DEV_SERVER_URL

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: EXTENSION_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

if (process.env.NEO_ANKI_USER_DATA_DIR) app.setPath('userData', resolve(process.env.NEO_ANKI_USER_DATA_DIR))
app.setName('Neo Anki')

let mainWindow: BrowserWindow | null = null
let extensionManager: ExtensionManager
let saveQueue: Promise<void> = Promise.resolve()
let quitAfterFlush = false

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

const storagePaths = () => {
  const root = app.getPath('userData')
  return {
    root,
    data: join(root, DATA_FILE),
    recovery: join(root, RECOVERY_FILE),
    temporary: join(root, TEMP_FILE),
  }
}

const isPersistableData = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.version === 'number' && Array.isArray(candidate.items) && Array.isArray(candidate.cards) && Array.isArray(candidate.reviews)
}

const readJsonFile = (path: string) => {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!isPersistableData(parsed)) throw new Error('Stored data does not match the Neo Anki schema.')
  return parsed
}

const loadPersistedData = () => {
  const paths = storagePaths()
  try {
    if (!existsSync(paths.data)) return { data: null, storagePath: paths.data, recoveredFromBackup: false }
    return { data: readJsonFile(paths.data), storagePath: paths.data, recoveredFromBackup: false }
  } catch {
    try {
      const corruptPath = join(paths.root, `neo-anki-data.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      if (existsSync(paths.data)) copyFileSync(paths.data, corruptPath)
      if (!existsSync(paths.recovery)) return { data: null, storagePath: paths.data, recoveredFromBackup: false }
      return { data: readJsonFile(paths.recovery), storagePath: paths.data, recoveredFromBackup: true }
    } catch {
      return { data: null, storagePath: paths.data, recoveredFromBackup: false }
    }
  }
}

const atomicWrite = async (data: unknown, destination = storagePaths().data) => {
  if (!isPersistableData(data)) throw new Error('Refusing to save invalid Neo Anki data.')
  const paths = storagePaths()
  const temporary = destination === paths.data ? paths.temporary : `${destination}.next`
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  if (destination === paths.data && existsSync(paths.data)) {
    try {
      readJsonFile(paths.data)
      await copyFile(paths.data, paths.recovery)
    } catch {
      // Preserve the known-good recovery file when the primary file is corrupt.
    }
  }
  await rename(temporary, destination)
}

const queueSave = (data: unknown) => {
  saveQueue = saveQueue.catch(() => undefined).then(() => atomicWrite(data))
  return saveQueue
}

const isTrustedUrl = (url: string) => devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(`${APP_SCHEME}://app/`)
const assertTrustedSender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
  if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('Rejected desktop request from an untrusted renderer.')
}

const registerDesktopIpc = () => {
  ipcMain.on('neo-anki:load-data', (event) => {
    try {
      assertTrustedSender(event)
      event.returnValue = loadPersistedData()
    } catch (error) {
      event.returnValue = { data: null, storagePath: '', recoveredFromBackup: false, error: error instanceof Error ? error.message : 'Could not load data.' }
    }
  })

  ipcMain.handle('neo-anki:save-data', async (event, data: unknown) => {
    assertTrustedSender(event)
    await queueSave(data)
  })

  ipcMain.handle('neo-anki:export-backup', async (event, data: unknown) => {
    assertTrustedSender(event)
    if (!isPersistableData(data)) throw new Error('Cannot export invalid Neo Anki data.')
    const options = {
      title: 'Export Neo Anki Backup',
      defaultPath: `neo-anki-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Neo Anki backup', extensions: ['json'] }],
    }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    await atomicWrite(data, result.filePath)
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('neo-anki:reset-data', async (event) => {
    assertTrustedSender(event)
    await saveQueue.catch(() => undefined)
    const paths = storagePaths()
    await Promise.all([rm(paths.data, { force: true }), rm(paths.recovery, { force: true }), rm(paths.temporary, { force: true })])
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
}

const createWindow = async () => {
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

  if (devServerUrl) await mainWindow.loadURL(devServerUrl)
  else await mainWindow.loadURL(`${APP_SCHEME}://app/index.html`)
}

app.whenReady().then(async () => {
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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('before-quit', (event) => {
  if (quitAfterFlush) return
  event.preventDefault()
  void saveQueue.catch(() => undefined).finally(() => {
    quitAfterFlush = true
    app.quit()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
