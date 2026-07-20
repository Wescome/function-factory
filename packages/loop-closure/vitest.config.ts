import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // Prevent cloudflare:workers from being imported in tests
      // by mapping it to a stub that exports DurableObject as a plain class
      'cloudflare:workers': new URL('./tests/__mocks__/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
});
