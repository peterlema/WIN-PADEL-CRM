import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// VITE_BASE permite publicar en una subcarpeta (GitHub Pages: /WIN-PADEL-CRM/).
// La versión sale de package.json y el commit de GITHUB_SHA (lo ve la persona al pie de la web).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify((process.env.GITHUB_SHA || process.env.WORKERS_CI_COMMIT_SHA || 'local').slice(0, 7)),
  },
})
