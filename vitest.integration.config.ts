import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Integration tests run against LOCAL Supabase only (see tests/integration/README.md).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    passWithNoTests: true,
    // Files share one local database: run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
