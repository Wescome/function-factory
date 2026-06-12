import { defineConfig } from 'vitest/config'
import path from 'node:path'

const stub = (f: string) => path.resolve(__dirname, `src/__mocks__/${f}`)

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/_archive/**'],
    setupFiles: ['./src/__mocks__/cloudflare-workers-setup.ts'],
    alias: {
      'cloudflare:workers': stub('cloudflare-workers.ts'),
      'cloudflare:email':   stub('cloudflare-email.ts'),
      'cloudflare:sockets': stub('cloudflare-sockets.ts'),
    },
  },
})
