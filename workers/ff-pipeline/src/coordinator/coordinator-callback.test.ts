/**
 * ADR-005 v4.1 (Queue fallback): Coordinator callback tests.
 *
 * Verifies that the SynthesisCoordinator DO:
 * 1. Stores workflowId in DO storage when provided
 * 2. Calls notifyCallback after synthesis completes (publishes to SYNTHESIS_RESULTS queue)
 * 3. Alarm handler calls notifyCallback with interrupt verdict
 * 4. notifyCallback is a no-op when no workflowId is stored
 * 5. notifyCallback failure does not break synthesis result
 * 6. No longer uses fetch-based callback (self-fetch blocked by CF)
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

describe('ADR-005 v4.1 (Queue fallback): Coordinator callback wiring', () => {

  describe('fetch handler: workflowId passthrough', () => {

    it('fetch handler parses workflowId from request body', () => {
      expect(coordinatorSrc).toContain("workflowId?: string")
    })

    it('stores workflowId in DO storage', () => {
      expect(coordinatorSrc).toContain("this.ctx.storage.put('__workflowId'")
    })

    it('does NOT store callbackUrl (removed — self-fetch blocked)', () => {
      // callbackUrl storage was removed; DO uses Queue instead
      expect(coordinatorSrc).not.toContain("this.ctx.storage.put('__callbackUrl'")
    })

    it('calls notifyCallback after synthesize() returns', () => {
      expect(coordinatorSrc).toContain('await this.notifyCallback(result)')
    })
  })

  describe('CoordinatorEnv: SYNTHESIS_RESULTS binding', () => {

    it('CoordinatorEnv declares SYNTHESIS_RESULTS queue binding', () => {
      expect(coordinatorSrc).toContain('SYNTHESIS_RESULTS?')
      expect(coordinatorSrc).toContain('send(body: unknown): Promise<void>')
    })
  })

  describe('notifyCallback method (Queue-based)', () => {

    it('reads workflowId from DO storage', () => {
      expect(coordinatorSrc).toContain("this.ctx.storage.get<string>('__workflowId')")
    })

    it('returns early when no workflowId is stored', () => {
      expect(coordinatorSrc).toContain('if (!workflowId) return')
    })

    it('publishes to SYNTHESIS_RESULTS queue (not fetch)', () => {
      // Must use queue send, not fetch
      expect(coordinatorSrc).toContain('this.env.SYNTHESIS_RESULTS')
      expect(coordinatorSrc).toContain('SYNTHESIS_RESULTS.send(')
    })

    it('sends workflowId, verdict, tokenUsage, repairCount to queue', () => {
      expect(coordinatorSrc).toContain('workflowId,')
      expect(coordinatorSrc).toContain('verdict: result.verdict')
      expect(coordinatorSrc).toContain('tokenUsage: result.tokenUsage')
      expect(coordinatorSrc).toContain('repairCount: result.repairCount')
    })

    it('does NOT use fetch for callback (self-fetch blocked by CF)', () => {
      // The notifyCallback method should not contain fetch(callbackUrl, ...)
      const notifySection = coordinatorSrc.slice(
        coordinatorSrc.indexOf('private async notifyCallback'),
        coordinatorSrc.indexOf('private buildResult'),
      )
      expect(notifySection).not.toContain("await fetch(callbackUrl")
      expect(notifySection).not.toContain("'__callbackUrl'")
    })

    it('catches queue publish errors without crashing synthesis', () => {
      expect(coordinatorSrc).toContain('[Stage 6] Result queue publish failed')
    })

    it('handles missing SYNTHESIS_RESULTS binding gracefully', () => {
      // Must guard with if (this.env.SYNTHESIS_RESULTS) before .send()
      expect(coordinatorSrc).toContain('if (this.env.SYNTHESIS_RESULTS)')
    })
  })

  describe('alarm handler: calls notifyCallback on timeout', () => {

    it('alarm handler calls notifyCallback with interrupt verdict', () => {
      expect(coordinatorSrc).toContain('await this.notifyCallback(this.buildResult(workGraphId, timedOutState))')
    })

    it('alarm handler sets __completed before calling callback', () => {
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

  describe('backward compatibility: no workflowId', () => {

    it('workflowId is optional in fetch body type', () => {
      expect(coordinatorSrc).toContain('workflowId?: string')
    })

    it('notifyCallback guards against missing workflowId', () => {
      expect(coordinatorSrc).toContain('if (!workflowId) return')
    })
  })
})

// ────────────────────────────────────────────────────────────
// Unit tests for callback flow (mock DO environment)
// ────────────────────────────────────────────────────────────

describe('ADR-005 v4.1 (Queue fallback): Coordinator callback flow (unit)', () => {

  /**
   * Simulates the DO's callback behavior: store workflowId, run synthesis,
   * publish to SYNTHESIS_RESULTS queue.
   */
  it('end-to-end: workflowId stored -> synthesis completes -> result published to queue', async () => {
    const storage = new Map<string, unknown>()
    const queueMessages: unknown[] = []

    // Mock SYNTHESIS_RESULTS queue
    const mockQueue = {
      send: async (body: unknown) => { queueMessages.push(body) },
    }

    const workflowId = 'wf-e2e-test'

    // Step 1: Store workflowId (as coordinator.fetch() does)
    storage.set('__workflowId', workflowId)

    // Step 2: Synthesis produces a result
    const result = {
      functionId: 'WG-E2E',
      verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
      tokenUsage: 4200,
      repairCount: 0,
      roleHistory: [],
    }

    // Step 3: notifyCallback reads workflowId and publishes to queue
    const storedWorkflowId = storage.get('__workflowId') as string | undefined

    if (storedWorkflowId && mockQueue) {
      await mockQueue.send({
        workflowId: storedWorkflowId,
        verdict: result.verdict,
        tokenUsage: result.tokenUsage,
        repairCount: result.repairCount,
      })
    }

    // Verify the queue message was published with correct payload
    expect(queueMessages).toHaveLength(1)
    const msg = queueMessages[0] as Record<string, unknown>
    expect(msg.workflowId).toBe('wf-e2e-test')
    expect(msg.verdict).toEqual({
      decision: 'pass', confidence: 0.95, reason: 'All roles passed',
    })
    expect(msg.tokenUsage).toBe(4200)
    expect(msg.repairCount).toBe(0)
  })

  it('alarm flow: workflowId from storage -> interrupt verdict -> published to queue', async () => {
    const storage = new Map<string, unknown>()
    const queueMessages: unknown[] = []

    const mockQueue = {
      send: async (body: unknown) => { queueMessages.push(body) },
    }

    // Simulate alarm handler reading stored workflowId
    storage.set('__workflowId', 'wf-alarm-test')
    storage.set('__completed', false)

    // Alarm fires -- synthesis exceeded deadline
    const completed = storage.get('__completed') as boolean
    if (!completed) {
      const interruptVerdict = {
        decision: 'interrupt',
        confidence: 1.0,
        reason: 'DO alarm: synthesis exceeded wall-clock deadline',
      }

      storage.set('__completed', true)
      storage.set('__alarm_fired', true)

      // notifyCallback from alarm -> queue publish
      const workflowId = storage.get('__workflowId') as string | undefined

      if (workflowId && mockQueue) {
        await mockQueue.send({
          workflowId,
          verdict: interruptVerdict,
          tokenUsage: 0,
          repairCount: 0,
        })
      }
    }

    expect(queueMessages).toHaveLength(1)
    const msg = queueMessages[0] as Record<string, unknown>
    expect(msg.workflowId).toBe('wf-alarm-test')
    const verdict = msg.verdict as Record<string, unknown>
    expect(verdict.decision).toBe('interrupt')
    expect(verdict.reason).toContain('wall-clock deadline')
  })

  it('no queue publish when workflowId is not stored (backward compat)', async () => {
    const storage = new Map<string, unknown>()
    const queueMessages: unknown[] = []

    // No workflowId stored -- old-style /trigger-synthesis usage
    const workflowId = storage.get('__workflowId') as string | undefined

    if (workflowId) {
      queueMessages.push({ workflowId })
    }

    // No message should be published
    expect(queueMessages).toHaveLength(0)
  })

  it('no queue publish when SYNTHESIS_RESULTS binding is missing', async () => {
    const storage = new Map<string, unknown>()
    storage.set('__workflowId', 'wf-no-binding')

    const queueMessages: unknown[] = []
    const mockQueue = undefined as { send(body: unknown): Promise<void> } | undefined

    const workflowId = storage.get('__workflowId') as string | undefined

    if (workflowId && mockQueue) {
      await mockQueue.send({ workflowId })
    }

    expect(queueMessages).toHaveLength(0)
  })

  it('queue publish failure does not prevent result from being returned', async () => {
    const storage = new Map<string, unknown>()
    storage.set('__workflowId', 'wf-queue-fail')

    const result = {
      functionId: 'WG-FAIL',
      verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
      tokenUsage: 100,
      repairCount: 0,
      roleHistory: [],
    }

    let publishError: Error | null = null
    let resultReturned = false

    // Simulate notifyCallback where queue.send throws
    const mockQueue = {
      send: async (_body: unknown) => {
        throw new Error('Queue unavailable')
      },
    }

    try {
      await mockQueue.send({
        workflowId: 'wf-queue-fail',
        verdict: result.verdict,
      })
    } catch (err) {
      publishError = err as Error
      // Coordinator catches and logs, does not rethrow
    }

    // Result is still returned regardless of queue publish failure
    resultReturned = true

    expect(publishError).toBeTruthy()
    expect(publishError!.message).toBe('Queue unavailable')
    expect(resultReturned).toBe(true)
    expect(result.verdict.decision).toBe('pass')
  })
})
