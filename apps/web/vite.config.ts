import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

const seed = fileURLToPath(new URL('../../services/api/seed', import.meta.url))
const contracts = fileURLToPath(new URL('../../contracts', import.meta.url))

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'mic-worklet.js', 'push-sw.js'],
    manifest: {
      name: 'Alter · Your AI representative', short_name: 'Alter', description: 'Ask teammates, review work, and control what your AI representative may do.',
      theme_color: '#f7f6f2', background_color: '#f7f6f2', display: 'standalone', start_url: '/', scope: '/',
      icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    workbox: {
      importScripts: ['/push-sw.js'],
      globPatterns: ['**/*.{js,css,html,svg,png}'],
      navigateFallbackDenylist: [/^\/v1\//],
      runtimeCaching: [], cleanupOutdatedCaches: true,
    },
  })],
  resolve: { alias: { '@contracts': contracts } },
  server: {
    fs: { allow: ['.', contracts, seed] },
    watch: { ignored: ['**/backend-test-results/**', '**/test-results/**', '**/playwright-report/**'] },
  },
})
