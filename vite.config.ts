import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Web / PWA build target. The Electron desktop build uses electron.vite.config.ts;
// this one shares the SAME renderer (src/renderer) and emits an installable PWA to
// dist-web, which Vercel serves. Both talk to the same Supabase backend.
export default defineConfig({
  root: 'src/renderer',
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
        theme_color: '#16181d',
        background_color: '#16181d',
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
