import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import initSqlJs from 'sql.js'
import { createSchema, ensureDefaultProfile } from './db'
import { registerIpcHandlers } from './ipc'
import { initGoogleTasks } from './google-tasks'
import { initSettings } from './settings'

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Open links in system browser, not in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function initDatabase(): Promise<{ db: import('sql.js').Database; dbPath: string }> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      app.isPackaged
        ? join(process.resourcesPath, file)
        : join(process.cwd(), 'node_modules/sql.js/dist/', file)
  })

  const dbPath = join(app.getPath('userData'), 'recipe-vault.sqlite')
  const buffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined
  const db = buffer ? new SQL.Database(buffer) : new SQL.Database()
  createSchema(db)
  return { db, dbPath }
}

app.whenReady().then(async () => {
  const { db, dbPath } = await initDatabase()

  // Persist the whole database to disk once per logical mutation. (Persisting after
  // every individual db.run was both slow — 30+ serializations to save one recipe —
  // and broke saveRecipe, because db.export() resets sqlite's last_insert_rowid().)
  const persist = (): void => {
    fs.writeFileSync(dbPath, Buffer.from(db.export()))
  }

  ensureDefaultProfile(db)
  persist()

  initSettings(app.getPath('userData'))
  initGoogleTasks(app.getPath('userData'))
  registerIpcHandlers(db, persist)

  // Allow the renderer to open the webcam for barcode scanning (local desktop app).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
