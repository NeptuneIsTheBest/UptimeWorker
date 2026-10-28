import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LOCAL_DEV__: 'false' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    testTimeout: 15000,
    hookTimeout: 30000,
    env: { WRANGLER_LOG_PATH: '.wrangler/test.log', WRANGLER_SEND_METRICS: 'false' },
  },
});
