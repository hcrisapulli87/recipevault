import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only: proxy /api to the deployed scrape function so Import works from the
// dev server too (production Electron loads file:// whose null Origin is allowed).
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '')
const scrapeOrigin = env.VITE_SCRAPE_URL ? new URL(env.VITE_SCRAPE_URL).origin : undefined

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
    plugins: [react()],
    server: scrapeOrigin
      ? { proxy: { '/api': { target: scrapeOrigin, changeOrigin: true } } }
      : undefined
  }
})
