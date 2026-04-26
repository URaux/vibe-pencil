import path from 'path'
import { defineConfig } from 'vitest/config'

// Eval-only config — picks up tests/eval/**/*.test.ts exclusively.
// Run: npx vitest run -c vitest.eval.config.ts
export default defineConfig({
  test: {
    include: ['tests/eval/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
