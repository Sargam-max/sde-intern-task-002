import { defineConfig } from 'vitest/config'

// Unit tests for browser code that has no browser dependencies (the bill text parser).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
