import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'apps/mobile/src/**/*.test.ts', 'packages/extension-marketplace/src/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/lib/**/*.ts',
        'src/state/AppContext.tsx',
        'src/extensions/package-format.ts',
        'src/extensions/v2/runtime.ts',
        'src/extensions/v2/registry.ts',
        'src/extensions/v2/host.ts',
        'electron/{diagnostics-log,extension-manager,extension-services,secret-backend,sync-manager,workspace-store}.ts',
        'apps/mobile/src/{rendering,workspace}.ts',
      ],
      // Browser workers execute in the production Playwright journeys; V8's
      // jsdom runner cannot load their global scope meaningfully.
      exclude: ['**/*.test.{ts,tsx}', 'src/lib/*.worker.ts'],
      // Extraction removed highly covered optional feature code while retaining
      // the lower-covered persistence/host denominator. Keep that broad scope
      // and pin the post-extraction baseline; raise it as host tests expand.
      thresholds: { lines: 73, functions: 60, statements: 65, branches: 51 },
    },
  },
})
