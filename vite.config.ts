import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: { output: { manualChunks: (id) => id.includes('/node_modules/react') ? 'react' : id.includes('/node_modules/ts-fsrs') ? 'scheduler' : id.includes('/node_modules/zod') ? 'validation' : undefined } },
  },
})
