import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const HARNESS_TSCONFIG = fileURLToPath(new URL('../deepseek-harness/tsconfig.base.json', import.meta.url))

export default defineConfig({
  // Resolve `@deepseek-ai/*` to the harness SOURCE (mirroring the harness
  // root vitest facade): importing the built lib/ artifacts would execute the
  // client closure-factory bundles, which read window.__ModuleLoader__.
  plugins: [tsconfigPaths({ projects: [HARNESS_TSCONFIG] })],
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
})
