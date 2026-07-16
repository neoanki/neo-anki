import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_SCHEME = 'neoanki'
const DATA_FILE = 'neo-anki-data.json'
const RECOVERY_FILE = 'neo-anki-data.recovery.json'
const TEMP_FILE = 'neo-anki-data.next.json'
const devServerUrl = process.env.VITE_DEV_SERVER_URL

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

if (process.env.NEO_ANKI_USER_DATA_DIR) app.setPath('userData', resolve(process.env.NEO_ANKI_USER_DATA_DIR))
app.setName('Neo Anki')

let mainWindow: BrowserWindow | null = null
let saveQueue: Promise<void> = Promise.resolve()
let quitAfterFlush = false

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
  registerDesktopIpc()
  registerAppProtocol()
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
