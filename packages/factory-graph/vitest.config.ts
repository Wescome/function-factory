import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./tests/__mocks__/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
});
