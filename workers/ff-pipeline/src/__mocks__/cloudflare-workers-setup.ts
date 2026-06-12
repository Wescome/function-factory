/**
 * Global vitest setup: mock cloudflare:workers before any test module loads.
 *
 * @cloudflare/sandbox@0.12+ statically imports from "cloudflare:workers", which
 * is unavailable in the Node.js test environment. vi.mock() in individual test
 * files can't intercept static ESM imports from dependencies, so this setup file
 * pre-registers the mock via globalThis.__vi_mocks__ before module resolution.
 *
 * Referenced in vitest.config.ts setupFiles.
 */
import { vi } from 'vitest'

vi.mock('cloudflare:workers', () => {
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  class WorkflowEntrypoint {
    env: unknown
    constructor() {}
  }
  class RpcTarget {}
  class RpcStub {}
  return { DurableObject, WorkflowEntrypoint, RpcTarget, RpcStub }
})
