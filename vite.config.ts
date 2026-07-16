import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        app: resolve(root, 'index.html'),
        'extension-host/react': resolve(root, 'src/extension-host/react.ts'),
        'extension-host/jsx-runtime': resolve(root, 'src/extension-host/jsx-runtime.ts'),
        'extension-host/jsx-dev-runtime': resolve(root, 'src/extension-host/jsx-dev-runtime.ts'),
      },
      output: {
        entryFileNames: (chunk) => chunk.name.startsWith('extension-host/') ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
