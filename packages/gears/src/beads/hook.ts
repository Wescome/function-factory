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
  await stub.fetch(new Request('https://do/release', {
    method: 'POST',
    body:   JSON.stringify([beadId, agentId, result]),
  }))
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
  await stub.fetch(new Request('https://do/fail', {
    method: 'POST',
    body:   JSON.stringify([beadId, agentId, result]),
  }))
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
  return (await res.json()) as ExecutionBead | null
}
