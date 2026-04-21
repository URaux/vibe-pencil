import path from 'path'
import { defineConfig } from 'vitest/config'

// Default (developer) test run. The CI pipeline uses vitest.ci.config.ts
// which excludes additional known-broken / flaky files; keep this config
// lean so `npm test` stays representative of what CI enforces.
//
// Real-repo verification tests that parse the live tree (tight timing
// assertions, writes to disk cache) are intentionally NOT in the default
// suite. Invoke them explicitly via:
//   npm run test:verify-real
// or:
//   npx vitest run tests/lib/ingest/facts-verify-real.test.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: [
      'output/**',
      'workspace/**',
      'node_modules/**',
      'tests/lib/ingest/facts-verify-real.test.ts',
      'tests/lib/ingest/name-verify-real.test.ts',
      'tests/e2e/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
