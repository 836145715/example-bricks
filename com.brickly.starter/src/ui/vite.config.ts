import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../out/ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4500
  }
})
