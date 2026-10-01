import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mts,mjs}'],
    testTimeout: 30000,
    hookTimeout: 20000,
    server: {
      deps: {
        // node:sqlite is real but unknown to Vite's builtin list.
        external: [/^node:/],
      },
    },
  },
});
