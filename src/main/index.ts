import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { IPC } from '../shared/types'
import type { InstagramPost, IpcResult } from '../shared/types'

const IG_URL = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/

/**
 * Fetch a reel's caption via the locally installed yt-dlp (`python -m yt_dlp`).
 * Runs here (not on Vercel) because Instagram blocks datacenter IPs — the home
 * connection is the only place this works. No login/cookies needed for public posts.
 */
function fetchInstagram(url: string): Promise<IpcResult<InstagramPost>> {
  const clean = String(url).trim()
  if (!IG_URL.test(clean)) {
    return Promise.resolve({ ok: false, message: 'Not an Instagram post URL.' })
  }
  return new Promise((resolve) => {
    const proc = spawn(
      'python',
      ['-m', 'yt_dlp', '--skip-download', '--dump-json', '--no-warnings', clean],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      proc.kill()
      resolve({ ok: false, message: 'Instagram fetch timed out (90s). Try again.' })
    }, 90_000)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', () => {
      clearTimeout(timer)
      resolve({
        ok: false,
        message: 'Python not found — install Python, then run: pip install --user yt-dlp'
      })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const message = /no module named/i.test(err)
          ? 'yt-dlp is not installed — run: pip install --user yt-dlp'
          : 'Instagram fetch failed — the post may be private, or Instagram changed something. Try: pip install -U yt-dlp'
        resolve({ ok: false, message })
        return
      }
      try {
        const d = JSON.parse(out) as { description?: string; uploader?: string; channel?: string }
        resolve({
          ok: true,
          data: { caption: d.description ?? '', uploader: d.uploader ?? d.channel ?? null }
        })
      } catch {
        resolve({ ok: false, message: 'Could not read yt-dlp output.' })
      }
    })
  })
}

// Desktop shell only: all data lives in Supabase and the renderer talks to it
// directly (same code as the web PWA), so main just makes a window and grants
// the camera for barcode scanning.
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

app.whenReady().then(async () => {
  // Allow the renderer to open the webcam for barcode scanning (local desktop app).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  ipcMain.handle(IPC.INSTAGRAM_FETCH, (_e, url: string) => fetchInstagram(url))

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
