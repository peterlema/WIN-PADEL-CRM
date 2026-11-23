import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE permite publicar en una subcarpeta (GitHub Pages: /WIN-PADEL-CRM/).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
