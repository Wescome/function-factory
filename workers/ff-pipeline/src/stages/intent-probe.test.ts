/**
 * IntentProbe Phase 2: Inter-pass probing tests (TDD).
 *
 * Verifies:
 *   1. probeAnchors produces ProbeResult[] with correct violation detection
 *   2. Handles JSON response from LLM
 *   3. Handles non-JSON response via fallback parsing
 *   4. Fail-safe: on error/timeout, block-severity anchors treated as violated
 *   5. Input truncation: pass output > 4K tokens is truncated (SE-4)
 *   6. Probe isolation: only sees pass output + questions, not compilation context
 *   7. Routes through callModel with TaskKind 'probe'
 *   8. Returns empty array when no anchors provided
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

// ─── Mock callModel ───
const mockCallModel = vi.fn()
vi.mock('../model-bridge', () => ({
  callModel: (...args: unknown[]) => mockCallModel(...args),
}))

import { probeAnchors, type ProbeResult } from './intent-probe'
import type { IntentAnchor } from './crystallize-intent'
import type { PipelineEnv } from '../types'

// ── Helpers ────────────────────────────────────────────────────

function makeAnchor(overrides: Partial<IntentAnchor> & { id: string }): IntentAnchor {
  return {
    signal_id: 'SIG-TEST',
    claim: 'Test claim',
    probe_question: 'Does this output reference the test type?',
    violation_signal: 'no',
    severity: 'block',
    times_probed: 0,
    times_violated: 0,
    ...overrides,
  }
}

function makeMockEnv(): PipelineEnv {
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
      run: vi.fn().mockResolvedValue({ response: '{"1": "yes"}' }),
    },
  } as unknown as PipelineEnv
}

// ── Tests ──────────────────────────────────────────────────────

describe('probeAnchors', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockCallModel.mockReset()
  })

  describe('basic probe flow', () => {
    it('returns empty array when no anchors provided', async () => {
      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', [], env, false)

      expect(results).toEqual([])
      expect(mockCallModel).not.toHaveBeenCalled()
    })

    it('produces ProbeResult[] with correct anchor_id and pass_name', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes', '2': 'no' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', probe_question: 'Does this output reference LifecycleState?', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', probe_question: 'Does this output reference LifecycleTransition?', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors(
        JSON.stringify({ atoms: [{ title: 'LifecycleState' }] }),
        anchors,
        env,
        false,
      )

      expect(results).toHaveLength(2)
      expect(results[0]!.anchor_id).toBe('IA-01')
      expect(results[1]!.anchor_id).toBe('IA-02')
      expect(typeof results[0]!.timestamp).toBe('string')
    })

    it('routes through callModel with TaskKind probe', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01' }),
      ]

      const env = makeMockEnv()
      await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(mockCallModel).toHaveBeenCalledOnce()
      // First arg is task kind
      expect(mockCallModel.mock.calls[0]![0]).toBe('probe')
    })
  })

  describe('violation detection', () => {
    it('detects violation when answer matches violation_signal (violation_signal=no, answer=no)', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'no' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.is_violation).toBe(true)
      expect(results[0]!.answer).toBe('no')
    })

    it('detects violation when answer matches violation_signal (violation_signal=yes, answer=yes)', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'yes' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.is_violation).toBe(true)
      expect(results[0]!.answer).toBe('yes')
    })

    it('no violation when answer differs from violation_signal', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.is_violation).toBe(false)
      expect(results[0]!.answer).toBe('yes')
    })
  })

  describe('JSON parsing and fallback', () => {
    it('handles clean JSON response', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes', '2': 'no' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.answer).toBe('yes')
      expect(results[1]!.answer).toBe('no')
    })

    it('handles response with markdown code fences', async () => {
      mockCallModel.mockResolvedValue('```json\n{"1": "yes", "2": "no"}\n```')

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.answer).toBe('yes')
      expect(results[1]!.answer).toBe('no')
    })

    it('handles fallback parsing from free-text response', async () => {
      // Model returns prose instead of JSON
      mockCallModel.mockResolvedValue('Question 1: yes\nQuestion 2: no')

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      // Fallback parser should extract yes/no from text patterns
      expect(results[0]!.answer).toBe('yes')
      expect(results[1]!.answer).toBe('no')
    })

    it('normalizes answer variations (true/false/1/0)', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'true', '2': 'false' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01' }),
        makeAnchor({ id: 'IA-02' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.answer).toBe('yes')
      expect(results[1]!.answer).toBe('no')
    })
  })

  describe('fail-safe behavior', () => {
    it('treats block-severity anchors as violated on callModel error', async () => {
      mockCallModel.mockRejectedValue(new Error('Workers AI rate limit exceeded'))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', severity: 'warn', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-03', severity: 'log', violation_signal: 'no' }),
      ]

      const env = makeMockEnv()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      // Only block-severity anchors should be fail-safed
      expect(results).toHaveLength(1)
      expect(results[0]!.anchor_id).toBe('IA-01')
      expect(results[0]!.is_violation).toBe(true)
      expect(results[0]!.explanation).toContain('rate limit')

      consoleSpy.mockRestore()
    })

    it('fail-safe results have violation_signal as the answer (triggers violation)', async () => {
      mockCallModel.mockRejectedValue(new Error('timeout'))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block', violation_signal: 'yes' }),
      ]

      const env = makeMockEnv()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const results = await probeAnchors('{"atoms": []}', anchors, env, false)

      expect(results[0]!.answer).toBe('yes')
      expect(results[0]!.is_violation).toBe(true)
      consoleSpy.mockRestore()
    })
  })

  describe('input truncation (SE-4)', () => {
    it('truncates pass output larger than 4K tokens to prevent context overflow', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01' }),
      ]

      // Create a very large pass output (> 16K chars ~ > 4K tokens)
      const largeOutput = JSON.stringify({
        atoms: Array.from({ length: 500 }, (_, i) => ({
          id: `atom-${String(i).padStart(3, '0')}`,
          title: `A very long atom title that contains lots of words to inflate the token count for testing purposes ${i}`,
          description: `This is a detailed description of atom ${i} that includes implementation details, acceptance criteria, and various other fields that make it quite verbose.`,
        })),
      })

      const env = makeMockEnv()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await probeAnchors(largeOutput, anchors, env, false)

      // The callModel should have been called with truncated input
      expect(mockCallModel).toHaveBeenCalledOnce()
      const userMessage = mockCallModel.mock.calls[0]![2] as string
      // The user message should be shorter than the original large output
      // (4K tokens ~ 16K chars, plus some overhead for the probe prompt structure)
      expect(userMessage.length).toBeLessThan(largeOutput.length)

      consoleSpy.mockRestore()
    })

    it('emits pipeline:probe-input-truncated signal when truncating', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01' }),
      ]

      const largeOutput = 'x'.repeat(20000) // > 4K tokens

      const env = makeMockEnv()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await probeAnchors(largeOutput, anchors, env, false)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SIGNAL] pipeline:probe-input-truncated'),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('probe isolation', () => {
    it('probe system prompt identifies as specification fidelity evaluator', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01' }),
      ]

      const env = makeMockEnv()
      await probeAnchors('{"atoms": []}', anchors, env, false)

      // Second arg to callModel is system prompt
      const systemPrompt = mockCallModel.mock.calls[0]![1] as string
      expect(systemPrompt).toContain('specification fidelity evaluator')
      expect(systemPrompt).toContain('yes')
      expect(systemPrompt).toContain('no')
    })

    it('probe user message contains ONLY pass output text and questions', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ '1': 'yes' }))

      const passOutput = JSON.stringify({ atoms: [{ title: 'LifecycleState' }] })
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', probe_question: 'Does this output reference LifecycleState?' }),
      ]

      const env = makeMockEnv()
      await probeAnchors(passOutput, anchors, env, false)

      const userMessage = mockCallModel.mock.calls[0]![2] as string
      // Should contain the pass output
      expect(userMessage).toContain('LifecycleState')
      // Should contain the probe question
      expect(userMessage).toContain('Does this output reference LifecycleState?')
      // Should NOT contain compilation context markers
      expect(userMessage).not.toContain('PRD')
      expect(userMessage).not.toContain('signal')
    })
  })

  describe('dry-run mode', () => {
    it('returns all-pass results in dry-run mode without calling LLM', async () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', violation_signal: 'no' }),
        makeAnchor({ id: 'IA-02', violation_signal: 'yes' }),
      ]

      const env = makeMockEnv()
      const results = await probeAnchors('{"atoms": []}', anchors, env, true)

      expect(results).toHaveLength(2)
      // In dry-run, no violations should be detected
      for (const r of results) {
        expect(r.is_violation).toBe(false)
      }
      expect(mockCallModel).not.toHaveBeenCalled()
    })
  })
})
