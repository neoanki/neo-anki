import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'apps/mobile/src/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/lib/**/*.ts',
        'src/state/AppContext.tsx',
        'src/extensions/registry.ts',
        'src/extensions/package-format.ts',
        'src/extensions/card-timer/index.tsx',
        'src/extensions/v2/runtime.ts',
        'src/extensions/interoperability/{anki,index}.ts',
        'electron/{diagnostics-log,extension-manager,extension-services,secret-backend,sync-manager,workspace-store}.ts',
        'apps/mobile/src/{rendering,workspace}.ts',
      ],
      // Browser workers execute in the production Playwright journeys; V8's
      // jsdom runner cannot load their global scope meaningfully.
      exclude: ['**/*.test.{ts,tsx}', 'src/lib/*.worker.ts'],
      // These floors cover the integrity-critical host, state, extension, sync,
      // and mobile modules above. Raise them with tests; never narrow the list
      // back to the historically better-covered utility layer.
      thresholds: { lines: 83, functions: 73, statements: 75, branches: 64 },
    },
  },
})
