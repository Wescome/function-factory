/**
 * @module crp
 *
 * Phase D — CRP auto-generation (ontology constraint C7).
 *
 * When any agent produces output with confidence < 0.7, a
 * ConsultationRequestPack (CRP) is auto-created and persisted
 * to the `consultation_requests` collection.
 *
 * CRP creation is NON-BLOCKING — it must never halt the pipeline.
 * The CRP's existence is queryable; a human or the Architect agent
 * can check for pending CRPs and resolve them via VCR.
 *
 * Ontology reference:
 *   ff:ConsultationRequestPack ff:persistedIn ff:col_consultation_requests
 *   C7 shape: ConfidenceEscalationShape (factory-shapes.ttl)
 */

import type { ArangoClient } from '@factory/arango-client'

// ── Types ──────────────────────────────────────────────────────────

export interface ConsultationRequestPack {
  _key: string
  type: 'crp'
  status: 'pending' | 'resolved' | 'expired'
  relatedArtifact: string       // _key of the artifact that triggered it
  relatedCollection: string     // collection name
  confidence: number            // the low confidence that triggered it
  context: string               // what the agent was trying to do
  agentRole: string             // which agent role produced it
  workGraphId: string           // which synthesis run
  createdAt: string
  resolvedAt?: string
  resolution?: string           // VCR content when resolved
}

// ── Key generation ─────────────────────────────────────────────────

let crpCounter = 0

function generateCRPKey(): string {
  crpCounter++
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `CRP-${ts}-${rand}-${crpCounter}`
}

// ── Main export ────────────────────────────────────────────────────

/**
 * Create a ConsultationRequestPack and persist it to ArangoDB.
 *
 * NON-BLOCKING: If the db.save fails, the error is caught and logged.
 * The returned CRP object is always valid even if persistence failed.
 * This ensures CRP creation never halts the pipeline.
 */
export async function createCRP(
  db: ArangoClient,
  opts: {
    artifactKey: string
    collection: string
    confidence: number
    context: string
    agentRole: string
    workGraphId: string
  },
): Promise<ConsultationRequestPack> {
  const crp: ConsultationRequestPack = {
    _key: generateCRPKey(),
    type: 'crp',
    status: 'pending',
    relatedArtifact: opts.artifactKey,
    relatedCollection: opts.collection,
    confidence: opts.confidence,
    context: opts.context,
    agentRole: opts.agentRole,
    workGraphId: opts.workGraphId,
    createdAt: new Date().toISOString(),
  }

  try {
    await db.save('consultation_requests', crp as unknown as Record<string, unknown>)
  } catch (err) {
    // NON-BLOCKING: CRP is informational. Log but do not throw.
    console.warn(
      `[CRP] Failed to persist CRP ${crp._key} for ${opts.artifactKey}: ${err instanceof Error ? err.message : err}`,
    )
  }

  return crp
}
