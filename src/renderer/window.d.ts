import type { InstagramPost, IpcResult } from '../shared/types'

declare global {
  interface Window {
    /** Desktop (Electron) only — absent in the web/PWA build. */
    api?: {
      fetchInstagram(url: string): Promise<IpcResult<InstagramPost>>
    }
  }
}

export {}
