/**
 * @factory/gears — CoordinatorDO hook functions
 *
 * Thin wrappers around CoordinatorDO fetch routes.
 * Consumed by the Conducting Agent (atom-execution workflow).
 *
 * initRun() must be called before getNextReady() or claimHook() (FR-06, BR-KSP-16).
 *
 * SPEC-FF-GEARS-001 §7
 */

import type { ExecutionBead } from './types.js'

/**
 * Thrown by getNextReady when the CoordinatorDO returns 422 because
 * seedBeads() was never called for the molecule. This is a permanent failure —
 * the molecule cannot be seeded retroactively by a retry.
 */
export class BeadsNotSeededError extends Error {
  constructor(moleculeId: string, detail: string) {
    super(`Molecule ${moleculeId} has no beads — call seedBeads() before dispatching. Detail: ${detail}`)
    this.name = 'BeadsNotSeededError'
  }
}

/**
 * Claim a bead atomically (CAS UPDATE RETURNING).
 * Returns null if the bead is not in 'ready' state or doesn't exist.
 */
export async function claimHook(
  stub:    DurableObjectStub,
  beadId:  string,
  agentId: string,
): Promise<ExecutionBead | null> {
  const res = await stub.fetch(new Request('https://do/claim', {
    method: 'POST',
    body:   JSON.stringify([beadId, agentId]),
  }))
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CoordinatorDO /claim failed: ${res.status} ${text}`)
  }
  return (await res.json()) as ExecutionBead | null
}

/**
 * Release a bead as done, writing result JSON.
 */
export async function releaseHook(
  stub:    DurableObjectStub,
  beadId:  string,
  agentId: string,
  result:  string,
): Promise<void> {
  const res = await stub.fetch(new Request('https://do/release', {
    method: 'POST',
    body:   JSON.stringify([beadId, agentId, result]),
  }))
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CoordinatorDO /release failed: ${res.status} ${text}`)
  }
}

/**
 * Release a bead as failed, writing result JSON.
 */
export async function failHook(
  stub:    DurableObjectStub,
  beadId:  string,
  agentId: string,
  result:  string,
): Promise<void> {
  const res = await stub.fetch(new Request('https://do/fail', {
    method: 'POST',
    body:   JSON.stringify([beadId, agentId, result]),
  }))
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CoordinatorDO /fail failed: ${res.status} ${text}`)
  }
}

/**
 * Get the next ready bead for a molecule (dependency-aware).
 * Returns null if no ready bead exists.
 */
export async function getNextReady(
  stub:       DurableObjectStub,
  moleculeId: string,
): Promise<ExecutionBead | null> {
  const res = await stub.fetch(new Request('https://do/next', {
    method: 'POST',
    body:   JSON.stringify(moleculeId),
  }))
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 422) {
      // Parse the structured error body if possible; fall back to raw text.
      let detail = text
      try {
        const parsed = JSON.parse(text) as { error?: string }
        if (parsed.error) detail = parsed.error
      } catch {
        // non-JSON body — use raw text as-is
      }
      throw new BeadsNotSeededError(moleculeId, detail)
    }
    throw new Error(`CoordinatorDO /next failed: ${res.status} ${text}`)
  }
  return (await res.json()) as ExecutionBead | null
}
