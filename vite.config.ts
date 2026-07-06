import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Web / PWA build target. The Electron desktop build uses electron.vite.config.ts;
// this one shares the SAME renderer (src/renderer) and emits an installable PWA to
// dist-web, which Vercel serves. Both talk to the same Supabase backend.
export default defineConfig({
  root: 'src/renderer',
  // Vite reads .env from `root` by default, which for this config is src/renderer —
  // so local dev/preview builds silently missed the project-root .env (VITE_SUPABASE_*)
  // and crashed with "supabaseUrl is required". Vercel worked only because it injects
  // env itself. Point envDir back at the repo root (path is relative to `root`).
  envDir: '../..',
  publicDir: '../../public',
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'RecipeVault',
        short_name: 'RecipeVault',
        description: 'Your recipe library and weekly meal planner, in your pocket.',
        theme_color: '#f2f4f7',
        background_color: '#f2f4f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
  },
})
