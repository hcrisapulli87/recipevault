import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

// The renderer talks to Supabase directly; the ONLY thing the desktop shell adds
// is the local Instagram fetcher (yt-dlp needs a residential IP + a real process).
// `window.api` being undefined is how the renderer detects the web/PWA build.
contextBridge.exposeInMainWorld('api', {
  fetchInstagram: (url: string) => ipcRenderer.invoke(IPC.INSTAGRAM_FETCH, url)
})
