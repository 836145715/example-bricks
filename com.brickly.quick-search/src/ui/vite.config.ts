import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 浮窗页经 file:// 加载：相对 base；产物命名沿用原构建脚本约定。
// outDir 由构建管线以 --outDir 传入暂存段（或包根 build.mjs 指向 out/ui）。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
