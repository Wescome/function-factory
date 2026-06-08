import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub worker-runtime modules so the handler's transitive import graph
// (index.ts -> pipeline.ts -> cloudflare:workers) resolves under the node test
// environment. Mirrors the preamble in diagnostic-routes.test.ts. These mocks
// are hoisted above the handler import by vitest.
vi.mock('cloudflare:workers', () => {
  class WorkflowEntrypoint {
    env: unknown
    constructor() {}
  }
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { WorkflowEntrypoint, DurableObject }
})
vi.mock('agents', () => {
  class Agent {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
    async runFiber(_name: string, fn: (ctx: unknown) => Promise<unknown>) {
      return fn({ id: 'mock-fiber', stash: () => {}, snapshot: null })
    }
    stash() {}
    async onFiberRecovered() {}
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})
vi.mock('@cloudflare/sandbox', () => ({ Sandbox: class {}, getSandbox: () => ({}) }))
vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }))

import { handleSmokeE2E } from './smoke-e2e-handler'
import type { PipelineEnv } from '../types.js'

// Mock Gas City fetcher signature (the service-binding `fetch`).
type GcFetch = (url: string, init?: RequestInit) => Promise<Response>

interface SmokeBody {
  outcome?: string
  reason?: string
  workflowId?: string
  durationMs?: number
  detail?: { missing?: string[] } & Record<string, unknown>
  error?: string
}

// Build a PipelineEnv. With no OPERATOR_CONTROL_TOKEN and a non-production
// ENVIRONMENT, authorizeOperatorControl returns { ok: true } — so these tests
// exercise the handler without mocking the worker entrypoint. The Gas City
// path is driven through the GAS_CITY service binding's `fetch`.
function makeEnv(opts: { gasCity?: GcFetch; overrides?: Record<string, unknown> } = {}): PipelineEnv {
  const base: Record<string, unknown> = {
    ENVIRONMENT: 'dev',
    GAS_CITY_BASE_URL: 'https://gc.example',
    GAS_CITY_CITY_NAME: 'smoke-city',
    GAS_CITY_BEARER_TOKEN: 'gc-token',
    GAS_CITY_AGENT_NAME: 'smoke-agent',
    ...(opts.gasCity ? { GAS_CITY: { fetch: opts.gasCity } } : {}),
    ...opts.overrides,
  }
  return base as unknown as PipelineEnv
}

function smokeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://ff-pipeline.example/smoke/e2e', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  })
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('handleSmokeE2E', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns the auth error when operator authorization is required but missing', async () => {
    // A configured token with no Authorization header => 401 from the real auth helper.
    const env = makeEnv({ overrides: { OPERATOR_CONTROL_TOKEN: 'secret' } })
    const res = await handleSmokeE2E(smokeRequest(), env)
    expect(res.status).toBe(401)
    const body = (await res.json()) as SmokeBody
    expect(body.error).toMatch(/authorization required/i)
  })

  it('fails when Gas City env vars are not configured', async () => {
    const env = makeEnv({
      overrides: {
        GAS_CITY_BASE_URL: '',
        GAS_CITY_CITY_NAME: '',
        GAS_CITY_BEARER_TOKEN: '',
        GAS_CITY_AGENT_NAME: '',
      },
    })
    const res = await handleSmokeE2E(smokeRequest(), env)
    expect(res.status).toBe(500)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('failed')
    expect(body.reason).toBe('gas_city_env_not_configured')
    expect(body.detail?.missing).toEqual([
      'GAS_CITY_BASE_URL',
      'GAS_CITY_CITY_NAME',
      'GAS_CITY_BEARER_TOKEN',
      'GAS_CITY_AGENT_NAME',
    ])
  })

  it('returns skipped when the noop formula is not registered (404 template_not_found)', async () => {
    const gasCity = vi.fn<GcFetch>(async () => jsonRes({ error: 'template_not_found' }, 404))
    const res = await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('skipped')
    expect(body.reason).toBe('noop_formula_not_registered')
    // No polling on the skip path.
    expect(gasCity).toHaveBeenCalledTimes(1)
  })

  it('fails (does not swallow) on a non-2xx sling response', async () => {
    const gasCity = vi.fn<GcFetch>(async () => jsonRes({ error: 'boom' }, 500))
    const res = await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(res.status).toBe(500)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('failed')
    expect(body.reason).toBe('sling_error_500')
  })

  it('fails when the sling response status is not "slung"', async () => {
    const gasCity = vi.fn<GcFetch>(async () => jsonRes({ status: 'rejected' }, 200))
    const res = await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(res.status).toBe(500)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('failed')
    expect(body.reason).toBe('sling_rejected')
  })

  it('approves even when the slung response omits a workflow id', async () => {
    // Polling was removed: smoke approves on successful sling regardless of
    // whether workflow_id is present. A slung bead proves the dispatch path.
    const gasCity = vi.fn<GcFetch>(async () => jsonRes({ status: 'slung' }, 200))
    const res = await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('approved')
    expect(body.workflowId).toBeUndefined()
  })

  it('approves and surfaces workflow_id when sling returns one', async () => {
    const gasCity = vi.fn<GcFetch>(async () =>
      jsonRes({ status: 'slung', workflow_id: 'wf-smoke-1' }, 200),
    )
    const res = await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SmokeBody
    expect(body.outcome).toBe('approved')
    expect(body.workflowId).toBe('wf-smoke-1')
  })

  it('makes exactly one GC request (no polling after sling)', async () => {
    // Polling was removed to avoid CF container-instance limits during smoke runs.
    // The sling call is the only GC subrequest.
    const gasCity = vi.fn<GcFetch>(async () =>
      jsonRes({ status: 'slung', workflow_id: 'wf-smoke-2' }, 200),
    )
    await handleSmokeE2E(smokeRequest(), makeEnv({ gasCity }))
    expect(gasCity).toHaveBeenCalledTimes(1)
  })
})
