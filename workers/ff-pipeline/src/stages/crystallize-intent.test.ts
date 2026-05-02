/**
 * Crystallizer Phase 1: Intent crystallization tests (TDD).
 *
 * Verifies:
 *   1. crystallizeIntent produces valid IntentAnchor array (3-6 items)
 *   2. Each anchor has required fields (id, claim, probe_question, violation_signal, severity)
 *   3. Dry-run returns stub anchors
 *   4. Parse failure returns empty anchors (graceful degradation)
 *   5. Feature flag disabled -> returns empty anchors
 *   6. Workers AI binding unavailable -> returns empty anchors + logs infra signal
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mock cloudflare:workers runtime ───
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
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

import { crystallizeIntent, type IntentAnchor, type CrystallizationResult } from './crystallize-intent'
import type { PipelineEnv } from '../types'

// ── Helpers ────────────────────────────────────────────────────

function makeMockEnv(overrides?: Partial<PipelineEnv>): PipelineEnv {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    GATES: { evaluateGate1: vi.fn() },
    FACTORY_PIPELINE: { create: vi.fn(), get: vi.fn() },
    COORDINATOR: {} as any,
    ATOM_EXECUTOR: {} as any,
    SYNTHESIS_QUEUE: { send: vi.fn() } as any,
    SYNTHESIS_RESULTS: { send: vi.fn() } as any,
    ATOM_RESULTS: { send: vi.fn() } as any,
    ENVIRONMENT: 'test',
    AI: {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify([
          {
            claim: 'The signal exports LifecycleState type',
            probe_question: 'Does this output reference the LifecycleState type?',
            violation_signal: 'no',
            severity: 'block',
          },
          {
            claim: 'The signal exports LifecycleTransition type',
            probe_question: 'Does this output reference the LifecycleTransition type?',
            violation_signal: 'no',
            severity: 'block',
          },
          {
            claim: 'Types are exported, not defined as internal',
            probe_question: 'Does this output mark these types as exported?',
            violation_signal: 'no',
            severity: 'warn',
          },
        ]),
      }),
    },
    ...overrides,
  } as unknown as PipelineEnv
}

const SIGNAL_INPUT = {
  signalId: 'SIG-TEST123',
  title: 'Export LifecycleState and LifecycleTransition',
  description: 'Export the LifecycleState enum and LifecycleTransition type from the lifecycle module.',
  specContent: 'The lifecycle module must export LifecycleState and LifecycleTransition for downstream consumers.',
}

// ── Tests ──────────────────────────────────────────────────────

describe('crystallizeIntent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('produces a valid IntentAnchor array with 3-6 items', async () => {
    const env = makeMockEnv()
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    expect(result.anchors.length).toBeGreaterThanOrEqual(3)
    expect(result.anchors.length).toBeLessThanOrEqual(6)
    expect(result.signal_id).toBe('SIG-TEST123')
    expect(typeof result.model_used).toBe('string')
    expect(typeof result.latency_ms).toBe('number')
    expect(typeof result.timestamp).toBe('string')
  })

  it('each anchor has all required fields', async () => {
    const env = makeMockEnv()
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    for (const anchor of result.anchors) {
      expect(anchor).toHaveProperty('id')
      expect(anchor).toHaveProperty('claim')
      expect(anchor).toHaveProperty('probe_question')
      expect(anchor).toHaveProperty('violation_signal')
      expect(anchor).toHaveProperty('severity')
      expect(anchor).toHaveProperty('times_probed')
      expect(anchor).toHaveProperty('times_violated')

      expect(typeof anchor.id).toBe('string')
      expect(anchor.id).toMatch(/^IA-/)
      expect(typeof anchor.claim).toBe('string')
      expect(typeof anchor.probe_question).toBe('string')
      expect(['yes', 'no']).toContain(anchor.violation_signal)
      expect(['block', 'warn', 'log']).toContain(anchor.severity)
      expect(anchor.times_probed).toBe(0)
      expect(anchor.times_violated).toBe(0)
    }
  })

  it('dry-run returns stub anchors without calling LLM', async () => {
    const env = makeMockEnv()
    const result = await crystallizeIntent(SIGNAL_INPUT, env, true, true)

    expect(result.anchors.length).toBeGreaterThanOrEqual(1)
    expect(result.model_used).toBe('dry-run')
    // Should NOT have called the AI binding
    expect(env.AI!.run).not.toHaveBeenCalled()

    // Stub anchors should still have valid structure
    for (const anchor of result.anchors) {
      expect(anchor.id).toMatch(/^IA-/)
      expect(['yes', 'no']).toContain(anchor.violation_signal)
      expect(['block', 'warn', 'log']).toContain(anchor.severity)
    }
  })

  it('returns empty anchors on parse failure (graceful degradation)', async () => {
    const env = makeMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({
          response: 'This is not JSON at all, just prose about anchors.',
        }),
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    expect(result.anchors).toEqual([])
    // Should have logged infra signal
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[INFRA SIGNAL] infra:crystallizer-parse-failure'),
    )
    consoleSpy.mockRestore()
  })

  it('returns empty anchors when feature flag is disabled', async () => {
    const env = makeMockEnv()
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, false) // enabled=false

    expect(result.anchors).toEqual([])
    expect(result.model_used).toBe('disabled')
    // Should NOT have called the AI binding
    expect(env.AI!.run).not.toHaveBeenCalled()
  })

  it('returns empty anchors when AI binding is unavailable', async () => {
    const env = makeMockEnv({ AI: undefined })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    expect(result.anchors).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[INFRA SIGNAL] infra:crystallizer-binding-unavailable'),
    )
    consoleSpy.mockRestore()
  })

  it('returns empty anchors when AI.run throws (rate limit, timeout, etc)', async () => {
    const env = makeMockEnv({
      AI: {
        run: vi.fn().mockRejectedValue(new Error('rate limit exceeded')),
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    expect(result.anchors).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[INFRA SIGNAL] infra:crystallizer-call-failure'),
    )
    consoleSpy.mockRestore()
  })

  it('assigns signal_id to each anchor', async () => {
    const env = makeMockEnv()
    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)

    for (const anchor of result.anchors) {
      expect(anchor.signal_id).toBe('SIG-TEST123')
    }
  })

  it('clamps anchors to max 6 even if LLM returns more', async () => {
    const env = makeMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({
          response: JSON.stringify(
            Array.from({ length: 10 }, (_, i) => ({
              claim: `Claim ${i}`,
              probe_question: `Question ${i}?`,
              violation_signal: 'no',
              severity: 'log',
            })),
          ),
        }),
      },
    })

    const result = await crystallizeIntent(SIGNAL_INPUT, env, false, true)
    expect(result.anchors.length).toBeLessThanOrEqual(6)
  })
})
