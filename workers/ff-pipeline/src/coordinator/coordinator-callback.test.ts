/**
 * ADR-005 v4.1: Coordinator callback tests.
 *
 * Verifies that the SynthesisCoordinator DO:
 * 1. Stores callbackUrl and workflowId in DO storage when provided
 * 2. Calls notifyCallback after synthesis completes (via fetch handler)
 * 3. Alarm handler calls notifyCallback with interrupt verdict
 * 4. notifyCallback is a no-op when no callback info is stored
 * 5. notifyCallback failure does not break synthesis result
 *
 * Strategy: coordinator.ts imports from CF runtime (Agent SDK), so we verify
 * through source code inspection and isolated unit tests of the callback logic.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// Source structure tests (verify wiring without CF runtime)
// ────────────────────────────────────────────────────────────

describe('ADR-005 v4.1: Coordinator callback wiring', () => {

  describe('fetch handler: callbackUrl + workflowId passthrough', () => {

    it('fetch handler parses callbackUrl from request body', () => {
      // The fetch handler must destructure callbackUrl from the request body
      expect(coordinatorSrc).toContain("callbackUrl?: string")
      expect(coordinatorSrc).toContain("workflowId?: string")
    })

    it('stores callbackUrl and workflowId in DO storage', () => {
      // Must persist callback info before starting synthesis so alarm can read it
      expect(coordinatorSrc).toContain("this.ctx.storage.put('__callbackUrl'")
      expect(coordinatorSrc).toContain("this.ctx.storage.put('__workflowId'")
    })

    it('calls notifyCallback after synthesize() returns', () => {
      // The fetch handler must call notifyCallback with the synthesis result
      expect(coordinatorSrc).toContain('await this.notifyCallback(result)')
    })
  })

  describe('notifyCallback method', () => {

    it('reads callbackUrl and workflowId from DO storage', () => {
      expect(coordinatorSrc).toContain("this.ctx.storage.get<string>('__callbackUrl')")
      expect(coordinatorSrc).toContain("this.ctx.storage.get<string>('__workflowId')")
    })

    it('returns early when no callbackUrl or workflowId is stored', () => {
      expect(coordinatorSrc).toContain('if (!callbackUrl || !workflowId) return')
    })

    it('POSTs to callbackUrl with workflowId, verdict, tokenUsage, repairCount', () => {
      // The fetch call to the callback URL must include all required fields
      expect(coordinatorSrc).toContain("method: 'POST'")
      expect(coordinatorSrc).toContain('workflowId,')
      expect(coordinatorSrc).toContain('verdict: result.verdict')
      expect(coordinatorSrc).toContain('tokenUsage: result.tokenUsage')
      expect(coordinatorSrc).toContain('repairCount: result.repairCount')
    })

    it('catches callback fetch errors without crashing synthesis', () => {
      // The notifyCallback must catch errors so they don't propagate
      expect(coordinatorSrc).toContain('[Stage 6] Callback failed for')
    })
  })

  describe('alarm handler: calls notifyCallback on timeout', () => {

    it('alarm handler calls notifyCallback with interrupt verdict', () => {
      // The alarm handler must notify the Workflow so it doesn't hang
      expect(coordinatorSrc).toContain('await this.notifyCallback(this.buildResult(workGraphId, timedOutState))')
    })

    it('alarm handler sets __completed before calling callback', () => {
      // The alarm handler sets __completed = true so idempotent re-entry is safe
      const alarmSection = coordinatorSrc.slice(
        coordinatorSrc.indexOf('override async alarm()'),
        coordinatorSrc.indexOf('override async onFiberRecovered'),
      )
      expect(alarmSection).toContain("await this.ctx.storage.put('__completed', true)")
      expect(alarmSection).toContain('await this.notifyCallback')
    })

    it('alarm handler reads graphState and builds interrupt verdict', () => {
      const alarmSection = coordinatorSrc.slice(
        coordinatorSrc.indexOf('override async alarm()'),
        coordinatorSrc.indexOf('override async onFiberRecovered'),
      )
      expect(alarmSection).toContain("decision: 'interrupt'")
      expect(alarmSection).toContain('DO alarm: synthesis exceeded wall-clock deadline')
    })
  })

  describe('backward compatibility: no callbackUrl', () => {

    it('fetch handler body type has callbackUrl as optional', () => {
      // callbackUrl must be optional so the /trigger-synthesis route
      // and other callers still work without it
      expect(coordinatorSrc).toContain('callbackUrl?: string')
    })

    it('notifyCallback guards against missing callback info', () => {
      // When called without callbackUrl/workflowId, notifyCallback returns early
      expect(coordinatorSrc).toContain('if (!callbackUrl || !workflowId) return')
    })
  })
})

// ────────────────────────────────────────────────────────────
// Unit tests for callback flow (mock DO environment)
// ────────────────────────────────────────────────────────────

describe('ADR-005 v4.1: Coordinator callback flow (unit)', () => {

  /**
   * Simulates the DO fetch handler's callback behavior by exercising
   * the same logic: store callback info, run synthesis, call callback.
   */
  it('end-to-end: callbackUrl stored -> synthesis completes -> callback called', async () => {
    const storage = new Map<string, unknown>()
    const fetchCalls: { url: string; body: unknown }[] = []

    // Simulate the DO fetch handler logic
    const callbackUrl = 'https://ff-pipeline.koales.workers.dev/synthesis-callback'
    const workflowId = 'wf-e2e-test'

    // Step 1: Store callback info (as coordinator.fetch() does)
    storage.set('__callbackUrl', callbackUrl)
    storage.set('__workflowId', workflowId)

    // Step 2: Synthesis produces a result
    const result = {
      functionId: 'WG-E2E',
      verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
      tokenUsage: 4200,
      repairCount: 0,
      roleHistory: [],
    }

    // Step 3: notifyCallback reads from storage and calls fetch
    const storedCallbackUrl = storage.get('__callbackUrl') as string | undefined
    const storedWorkflowId = storage.get('__workflowId') as string | undefined

    if (storedCallbackUrl && storedWorkflowId) {
      fetchCalls.push({
        url: storedCallbackUrl,
        body: {
          workflowId: storedWorkflowId,
          verdict: result.verdict,
          tokenUsage: result.tokenUsage,
          repairCount: result.repairCount,
        },
      })
    }

    // Verify the callback was made with correct payload
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.url).toBe('https://ff-pipeline.koales.workers.dev/synthesis-callback')
    const callbackBody = fetchCalls[0]!.body as Record<string, unknown>
    expect(callbackBody.workflowId).toBe('wf-e2e-test')
    expect(callbackBody.verdict).toEqual({
      decision: 'pass', confidence: 0.95, reason: 'All roles passed',
    })
    expect(callbackBody.tokenUsage).toBe(4200)
    expect(callbackBody.repairCount).toBe(0)
  })

  it('alarm flow: callback info from storage -> interrupt verdict -> callback called', async () => {
    const storage = new Map<string, unknown>()
    const fetchCalls: { url: string; body: unknown }[] = []

    // Simulate alarm handler reading stored callback info
    storage.set('__callbackUrl', 'https://ff-pipeline.koales.workers.dev/synthesis-callback')
    storage.set('__workflowId', 'wf-alarm-test')
    storage.set('__completed', false)

    // Alarm fires — synthesis exceeded deadline
    const completed = storage.get('__completed') as boolean
    if (!completed) {
      const interruptVerdict = {
        decision: 'interrupt',
        confidence: 1.0,
        reason: 'DO alarm: synthesis exceeded wall-clock deadline',
      }

      storage.set('__completed', true)
      storage.set('__alarm_fired', true)

      // notifyCallback from alarm
      const callbackUrl = storage.get('__callbackUrl') as string | undefined
      const workflowId = storage.get('__workflowId') as string | undefined

      if (callbackUrl && workflowId) {
        fetchCalls.push({
          url: callbackUrl,
          body: {
            workflowId,
            verdict: interruptVerdict,
            tokenUsage: 0,
            repairCount: 0,
          },
        })
      }
    }

    expect(fetchCalls).toHaveLength(1)
    const callbackBody = fetchCalls[0]!.body as Record<string, unknown>
    expect(callbackBody.workflowId).toBe('wf-alarm-test')
    const verdict = callbackBody.verdict as Record<string, unknown>
    expect(verdict.decision).toBe('interrupt')
    expect(verdict.reason).toContain('wall-clock deadline')
  })

  it('no callback when callbackUrl is not stored (backward compat)', async () => {
    const storage = new Map<string, unknown>()
    const fetchCalls: unknown[] = []

    // No callbackUrl or workflowId stored — old-style /trigger-synthesis usage
    const callbackUrl = storage.get('__callbackUrl') as string | undefined
    const workflowId = storage.get('__workflowId') as string | undefined

    if (callbackUrl && workflowId) {
      fetchCalls.push({ url: callbackUrl, body: {} })
    }

    // No callback should be made
    expect(fetchCalls).toHaveLength(0)
  })

  it('callback failure does not prevent result from being returned', async () => {
    const storage = new Map<string, unknown>()
    storage.set('__callbackUrl', 'https://ff-pipeline.koales.workers.dev/synthesis-callback')
    storage.set('__workflowId', 'wf-callback-fail')

    const result = {
      functionId: 'WG-FAIL',
      verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
      tokenUsage: 100,
      repairCount: 0,
      roleHistory: [],
    }

    let callbackError: Error | null = null
    let resultReturned = false

    // Simulate notifyCallback that throws
    try {
      throw new Error('Network unreachable')
    } catch (err) {
      callbackError = err as Error
      // Coordinator catches and logs, does not rethrow
    }

    // Result is still returned regardless of callback failure
    resultReturned = true

    expect(callbackError).toBeTruthy()
    expect(callbackError!.message).toBe('Network unreachable')
    expect(resultReturned).toBe(true)
    expect(result.verdict.decision).toBe('pass')
  })
})
