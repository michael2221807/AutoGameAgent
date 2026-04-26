import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: [
        'src/engine/**/*.test.ts',
        'src/engine/**/__test-utils__/**',
        'src/engine/types/**',
        'src/engine/stores/**',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
    },
  },
});
