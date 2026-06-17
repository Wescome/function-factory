/**
 * Step 7 — emit-to-mediation
 *
 * Derives a deterministic runId from the signal, builds a CommissionRequest,
 * and POSTs it to MediationAgentDO /commission via DO stub fetch.
 */

import type { IntentSpecification } from '@factory/schemas'
import type { CommissioningSignal } from '../../schemas.js'
import { WorkflowStepError } from './fetch-elucidation.js'

// ── Internal helpers ─────────────────────────────────────────────────────────

async function computeHash(str: string): Promise<string> {
  const arr = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest('SHA-256', arr)
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 16).toUpperCase()
}

// ── CommissionRequest body ────────────────────────────────────────────────────

interface CommissionRequestBody {
  runId: string
  orgId: string
  workGraphId: string
  workGraphVersion: string
  eluciationArtifactId: string
  d1ArtifactRefs: string[]
  dispositionEventId: string
}

// ── Step implementation ───────────────────────────────────────────────────────

/**
 * Emit a CommissionRequest to MediationAgentDO /commission.
 *
 * @param isNode          The compiled IntentSpecification (IS-* node)
 * @param signal          The originating CommissioningSignal
 * @param mediationStub   DO stub for MediationAgentDO (plain DurableObjectStub)
 * @returns               { runId, atomCount } from the mediation response
 * @throws WorkflowStepError  When mediation returns a non-2xx response
 */
export async function emitToMediationStep(
  isNode: IntentSpecification,
  signal: CommissioningSignal,
  mediationStub: DurableObjectStub,
): Promise<{ runId: string; atomCount: number }> {
  const runId =
    'RUN-' + (await computeHash(`${signal.orgId}:${isNode.id}:${signal.dispositionEventId}`))

  const body: CommissionRequestBody = {
    runId,
    orgId: signal.orgId,
    workGraphId: isNode.id,
    workGraphVersion: signal.workGraphVersion ?? 'v1',
    eluciationArtifactId: signal.elucidationArtifactId,
    d1ArtifactRefs: [],
    dispositionEventId: signal.dispositionEventId,
  }

  const res = await mediationStub.fetch(
    new Request('https://mediation/commission', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  if (!res.ok) {
    throw new WorkflowStepError('mediation-emit-failed', await res.text())
  }

  const json = (await res.json()) as { runId: string; atomCount: number }

  return { runId: json.runId, atomCount: json.atomCount }
}
