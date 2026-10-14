import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const contracts = fileURLToPath(new URL('../../contracts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@contracts': contracts } },
  server: { fs: { allow: ['.', contracts] } },
})
