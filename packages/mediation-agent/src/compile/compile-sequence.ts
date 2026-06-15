/**
 * Compile sequence orchestrator — runs all nine steps in order.
 *
 * Returns CompileResult on success.
 * Throws CompileError (with typed reason) on any step failure.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2
 */

import type { CoordinatorDO } from '@factory/gears'
import type { FactoryArtifactGraphDO } from '@factory/factory-graph'
import type { AtomDirective } from '@factory/schemas'
import { type CommissionRequest, type CompileResult, CompileError } from '../types.js'
import { validateEluciationArtifact }  from './step1-validate-eluciation.js'
import { fetchWorkgraphAtoms }         from './step2-fetch-workgraph.js'
import { resolveGearBindings }         from './step3-resolve-gears.js'
import { runCoherenceProbe }           from './step4-coherence-probe.js'
import { writeSpecificationNode }      from './step5-write-specification-node.js'
import { writeAtomDirectiveNodes }     from './step6-write-atom-directive-nodes.js'
import { persistCompiledMolecules }    from './step7-persist-compiled-molecules.js'
import { seedCoordinator }             from './step8-seed-coordinator.js'
import { enqueueAtoms }                from './step9-enqueue-atoms.js'

interface CompileSequenceEnv {
  COORDINATOR_DO:       DurableObjectNamespace<CoordinatorDO>
  ARTIFACT_GRAPH:       DurableObjectNamespace<FactoryArtifactGraphDO>
  D1_AUDIT:             D1Database
  KV_KS:                KVNamespace
  ATOM_EXECUTION_QUEUE: Queue
}

/**
 * Runs the full nine-step compile sequence.
 * The sql reference is used for step 7 (persist compiled molecules).
 */
export async function runCompileSequence(
  req: CommissionRequest,
  env: CompileSequenceEnv,
  sql: SqlStorage,
): Promise<CompileResult> {
  // ── Step 1: Validate eluciation artifact ─────────────────────────────
  await validateEluciationArtifact(env.ARTIFACT_GRAPH, req.eluciationArtifactId)

  // ── Step 2: Fetch WorkGraph atoms from D1 ────────────────────────────
  const atoms = await fetchWorkgraphAtoms(env.D1_AUDIT, req.d1ArtifactRefs)

  // ── Step 3: Resolve Gear bindings ────────────────────────────────────
  const bindings = await resolveGearBindings(env.KV_KS, atoms)

  // ── Step 4: Coherence probe (deterministic, no LLM) ──────────────────
  // Build the global invariant set from all atoms' invariantIds
  const knownInvariantIds = new Set<string>()
  for (const { atom } of bindings) {
    for (const id of atom.invariantIds) {
      knownInvariantIds.add(id)
    }
  }
  runCoherenceProbe(bindings, knownInvariantIds)

  // ── Step 5: Write SpecificationNode to ArtifactGraphDO ───────────────
  const compiledAt = new Date().toISOString()
  const specificationNodeId = await writeSpecificationNode(env.ARTIFACT_GRAPH, {
    workGraphId:            req.workGraphId,
    workGraphVersion:       req.workGraphVersion,
    eluciationArtifactId:   req.eluciationArtifactId,
    compiledAt,
  })

  // ── Step 6: Write AtomDirective nodes to ArtifactGraphDO ─────────────
  const directives: Map<string, AtomDirective> = await writeAtomDirectiveNodes(env.ARTIFACT_GRAPH, {
    bindings,
    specificationNodeId,
    runId:                req.runId,
    workGraphId:          req.workGraphId,
    workGraphVersion:     req.workGraphVersion,
    eluciationArtifactId: req.eluciationArtifactId,
  })

  // ── Step 7: Persist compiled molecules to DO SQLite ───────────────────
  persistCompiledMolecules(sql, directives, req.runId, req.workGraphId)

  // ── Step 8: Seed CoordinatorDO ────────────────────────────────────────
  await seedCoordinator(
    env.COORDINATOR_DO,
    req.runId,
    req.orgId,
    req.workGraphId,
    directives,
  )

  // ── Step 9: Enqueue atoms to CF Queue ─────────────────────────────────
  await enqueueAtoms(env.ATOM_EXECUTION_QUEUE, req.runId, directives)

  return { specificationNodeId, directives }
}

export { CompileError }
