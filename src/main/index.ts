import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import initSqlJs from 'sql.js'
import { createSchema } from './db'
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

  // Wrap db.run to auto-persist after every write
  const originalRun = db.run.bind(db)
  db.run = (...args: Parameters<typeof db.run>) => {
    const result = originalRun(...args)
    fs.writeFileSync(dbPath, Buffer.from(db.export()))
    return result
  }

  initSettings(app.getPath('userData'))
  initGoogleTasks(app.getPath('userData'))
  registerIpcHandlers(db)
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
