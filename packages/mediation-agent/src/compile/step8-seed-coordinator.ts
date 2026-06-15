/**
 * Step 8 — Seed CoordinatorDO
 *
 * 1. POST /init  — body is [runId, orgId] (tuple — matches CoordinatorDO.fetch() line 359)
 * 2. POST /seed  — body is { moleculeId, beads: [...] } (matches CoordinatorDO.seedBeads())
 *
 * CoordinatorDO is keyed by coordinator:{runId}.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 8
 */

import type { CoordinatorDO } from '@factory/gears'
import type { AtomDirective } from '@factory/schemas'
import { CompileError } from '../types.js'

export async function seedCoordinator(
  coordinatorDO: DurableObjectNamespace<CoordinatorDO>,
  runId: string,
  orgId: string,
  workGraphId: string,
  directives: Map<string, AtomDirective>,
): Promise<void> {
  const stub = coordinatorDO.get(coordinatorDO.idFromName(`coordinator:${runId}`))

  // ── POST /init ─────────────────────────────────────────────────────────
  const initBody: [string, string] = [runId, orgId]
  const initRes = await stub.fetch(
    new Request('https://coordinator/init', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(initBody),
    }),
  )

  if (!initRes.ok) {
    const text = await initRes.text().catch(() => '')
    throw new CompileError(
      'coordinator_seed_failed',
      `CoordinatorDO /init failed (HTTP ${initRes.status}): ${text}`,
    )
  }

  // ── POST /seed ─────────────────────────────────────────────────────────
  const beads = [...directives.entries()].map(([atomId, directive]) => ({
    id:        atomId,
    gearId:    extractGearId(directive),
    nodeId:    directive.d1ArtifactRef,
    payload:   JSON.stringify(directive),
    dependsOn: directive.dependsOn,
  }))

  const seedBody = {
    moleculeId: `WG-${workGraphId}`,
    beads,
  }

  const seedRes = await stub.fetch(
    new Request('https://coordinator/seed', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(seedBody),
    }),
  )

  if (!seedRes.ok) {
    const text = await seedRes.text().catch(() => '')
    throw new CompileError(
      'coordinator_seed_failed',
      `CoordinatorDO /seed failed (HTTP ${seedRes.status}): ${text}`,
    )
  }
}

/**
 * Extract gearId from the policyBeadId field.
 * policyBeadId is set to BEAD-{atomId} in step 6.
 * We use the gear's bead type from the directive's toolPolicy as a proxy.
 * In v2.0, there is no direct gearId field on AtomDirective — we reconstruct
 * it from the model field prefix as a best effort (GEAR-{model-slug}).
 */
function extractGearId(directive: AtomDirective): string {
  // The gearId is not stored directly on AtomDirective v2.0.
  // Use policyBeadId prefix substitution as a stable stand-in identifier.
  // Real implementations should carry gearId through the pipeline.
  return `GEAR-${directive.policyBeadId.replace(/^BEAD-/, '')}`
}
