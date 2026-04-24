/**
 * Walkthrough — Type-composition validation for the Factory lifecycle.
 *
 * Imports REAL Zod schemas from @factory/schemas and traces one synthetic
 * Function through the complete lifecycle:
 *
 *   Signal -> Pressure -> Capability -> Proposal -> PRD ->
 *   CoverageReport -> WorkGraph -> ArchitectureCandidate ->
 *   ExecutionTrace -> Gate2Verdict -> TrustComposite
 *
 * Each step uses schema.parse() so Zod validates the shape. If any
 * parse fails, the walkthrough fails with a clear error — proving
 * the types don't compose end-to-end.
 *
 * Run: npx tsx packages/literate-tools/src/walkthrough.ts
 */

import {
  ExternalSignal,
  Pressure,
  BusinessCapability,
  FunctionProposal,
  PRDDraft,
  Gate1Report,
  WorkGraph,
  ArchitectureCandidate,
  ExecutionTrace,
  Gate2Verdict,
  TrustComposite,
  ArchitectureCandidateSelection,
  RuntimeAdmissionArtifact,
  ExecutionStart,
} from "@factory/schemas"

const NOW = new Date().toISOString()

let stepCount = 0

function step<T>(label: string, fn: () => T): T {
  stepCount++
  process.stdout.write(`  [${stepCount}] ${label}...`)
  try {
    const result = fn()
    console.log(" OK")
    return result
  } catch (err) {
    console.log(" FAIL")
    console.error(`\n--- Step ${stepCount} failed: ${label} ---`)
    console.error(err)
    process.exit(1)
  }
}

function main(): void {
  console.log("Walkthrough: tracing one synthetic Function through the Factory lifecycle\n")

  // Shared lineage fields helper
  const lineage = (sourceRefs: string[]) => ({
    source_refs: sourceRefs,
    explicitness: "explicit" as const,
    rationale: "Synthetic walkthrough data for type-composition validation",
  })

  // ── Step 1: ExternalSignal ──────────────────────────────────────────
  const signal = step("ExternalSignal (Stage 1 - Signal intake)", () =>
    ExternalSignal.parse({
      id: "SIG-WALK-001",
      ...lineage([]),
      type: "market",
      source: "walkthrough-synthetic",
      title: "Synthetic signal for lifecycle validation",
      description: "A synthetic market signal used to validate end-to-end type composition",
      timestamp: NOW,
      confidence: 0.85,
      tags: ["synthetic", "walkthrough"],
      entities: ["factory"],
    })
  )

  // ── Step 2: Pressure ────────────────────────────────────────────────
  const pressure = step("Pressure (Stage 2 - Forcing function)", () =>
    Pressure.parse({
      id: "PRS-WALK-001",
      ...lineage([signal.id]),
      category: "growth",
      name: "walkthrough_growth_pressure",
      description: "Synthetic pressure derived from walkthrough signal",
      derivedFromSignalIds: [signal.id],
      affectedDomains: ["core"],
      affectedPersonas: ["developer"],
      strength: 0.7,
      urgency: 0.6,
      frequency: 0.5,
      confidence: 0.8,
    })
  )

  // ── Step 3: BusinessCapability ──────────────────────────────────────
  const capability = step("BusinessCapability (Stage 3 - Capability)", () =>
    BusinessCapability.parse({
      id: "BC-WALK-001",
      ...lineage([pressure.id]),
      name: "walkthrough_capability",
      purpose: "Demonstrate end-to-end type composition across Factory stages",
      addressesPressureIds: [pressure.id],
      desiredOutcomes: ["Types compose without errors across all lifecycle stages"],
      constraints: ["Must use real Zod schemas"],
      successMetrics: ["All 11 lifecycle steps pass Zod validation"],
      affectedPersonas: ["developer"],
      strategicPriority: 0.9,
      confidence: 0.95,
    })
  )

  // ── Step 4: FunctionProposal ────────────────────────────────────────
  const proposal = step("FunctionProposal (Stage 4 - Proposal)", () =>
    FunctionProposal.parse({
      id: "FP-WALK-001",
      ...lineage([capability.id]),
      capabilityId: capability.id,
      name: "walkthrough_validator",
      purpose: "Validate lifecycle type composition end-to-end",
      functionType: "evidence",
      expectedInputs: ["ExternalSignal"],
      expectedOutputs: ["TrustComposite"],
      governingConstraints: ["Must use schema.parse()"],
      candidateInvariants: ["All stages must parse without error"],
      successSignals: ["Walkthrough complete message printed"],
      confidence: 0.9,
    })
  )

  // ── Step 5: PRDDraft ────────────────────────────────────────────────
  const prd = step("PRDDraft (Stage 5 - PRD specification)", () =>
    PRDDraft.parse({
      id: "PRD-WALK-001",
      ...lineage([capability.id, proposal.id]),
      sourceCapabilityId: capability.id,
      sourceFunctionId: proposal.id,
      title: "Walkthrough Lifecycle Validator",
      problem: "No end-to-end validation that Factory schemas compose across all stages",
      goal: "Prove Signal-to-TrustComposite type chain composes without errors",
      constraints: ["Must import real schemas", "Must use Zod parse"],
      acceptanceCriteria: ["All 11 steps pass", "Clear error on failure"],
      successMetrics: ["100% step pass rate"],
      outOfScope: ["Runtime execution", "Persistence"],
    })
  )

  // ── Step 6: Gate1Report (CoverageReport) ────────────────────────────
  const gate1 = step("Gate1Report (Gate 1 - Compile coverage)", () =>
    Gate1Report.parse({
      id: "CR-WALK-001",
      ...lineage([prd.id]),
      gate: 1,
      prd_id: prd.id,
      timestamp: NOW,
      overall: "pass",
      checks: {
        atom_coverage: { status: "pass", details: [], orphan_atoms: [] },
        invariant_coverage: {
          status: "pass",
          details: [],
          invariants_missing_validation: [],
          invariants_missing_detector: [],
        },
        validation_coverage: {
          status: "pass",
          details: [],
          validations_covering_nothing: [],
        },
        dependency_closure: {
          status: "pass",
          details: [],
          dangling_dependencies: [],
        },
      },
      remediation: "No remediation needed — all checks pass",
    })
  )

  // ── Step 7: WorkGraph ───────────────────────────────────────────────
  const workGraph = step("WorkGraph (Stage 5 - Work decomposition)", () =>
    WorkGraph.parse({
      id: "WG-WALK-001",
      ...lineage([prd.id, gate1.id]),
      functionId: proposal.id,
      nodes: [
        { id: "node-1", type: "interface", title: "Signal intake interface" },
        { id: "node-2", type: "execution", title: "Lifecycle traversal" },
        { id: "node-3", type: "evidence", title: "Trust computation" },
      ],
      edges: [
        { from: "node-1", to: "node-2" },
        { from: "node-2", to: "node-3" },
      ],
    })
  )

  // ── Step 8: ArchitectureCandidate ───────────────────────────────────
  const candidate = step("ArchitectureCandidate (Stage 6 - Architecture)", () =>
    ArchitectureCandidate.parse({
      id: "AC-WALK-001",
      ...lineage([workGraph.id, prd.id]),
      sourcePrdId: prd.id,
      sourceWorkGraphId: workGraph.id,
      candidateStatus: "selected",
      topology: { shape: "linear_chain", summary: "Signal -> ... -> TrustComposite linear pipeline" },
      modelBinding: { bindingMode: "fixed", summary: "Deterministic validation — no model needed" },
      toolPolicy: { mode: "none", summary: "Pure validation — no tool calls" },
      convergencePolicy: { mode: "single_pass", summary: "Single deterministic pass" },
    })
  )

  // Intermediate: Selection + Admission + ExecutionStart (needed for ExecutionTrace)
  const selection = step("CandidateSelection (intermediate)", () =>
    ArchitectureCandidateSelection.parse({
      id: "ACS-WALK-001",
      ...lineage([candidate.id, workGraph.id]),
      sourceArchitectureCandidateId: candidate.id,
      sourceWorkGraphId: workGraph.id,
      decision: "selected",
      threshold: 0.5,
      scorecard: {
        dimensions: [
          { name: "topologyComplexity", score: 0.9, rationale: "Simple linear chain" },
          { name: "policyRisk", score: 0.95, rationale: "No tool calls, no risk" },
          { name: "toolExposure", score: 1.0, rationale: "No tools exposed" },
          { name: "convergenceStrictness", score: 1.0, rationale: "Single pass, deterministic" },
          { name: "runtimeReadiness", score: 0.9, rationale: "All schemas available" },
        ],
        totalScore: 0.95,
      },
    })
  )

  const admission = step("RuntimeAdmission (intermediate)", () =>
    RuntimeAdmissionArtifact.parse({
      id: "RAD-WALK-001",
      ...lineage([candidate.id, selection.id, workGraph.id]),
      sourceWorkGraphId: workGraph.id,
      sourceArchitectureCandidateId: candidate.id,
      sourceSelectionId: selection.id,
      decision: "allow",
      reason: "All preconditions met for walkthrough execution",
    })
  )

  const execStart = step("ExecutionStart (intermediate)", () =>
    ExecutionStart.parse({
      id: "EXS-WALK-001",
      ...lineage([admission.id, candidate.id, selection.id, workGraph.id]),
      sourceWorkGraphId: workGraph.id,
      sourceArchitectureCandidateId: candidate.id,
      sourceSelectionId: selection.id,
      sourceAdmissionId: admission.id,
      runId: "walkthrough-run-001",
      status: "started",
    })
  )

  // ── Step 9: ExecutionTrace ──────────────────────────────────────────
  const trace = step("ExecutionTrace (Stage 6 - Trace log)", () =>
    ExecutionTrace.parse({
      id: "EXT-WALK-001",
      ...lineage([workGraph.id, candidate.id, selection.id, admission.id, execStart.id]),
      sourceWorkGraphId: workGraph.id,
      sourceArchitectureCandidateId: candidate.id,
      sourceSelectionId: selection.id,
      sourceAdmissionId: admission.id,
      sourceExecutionStartId: execStart.id,
      runId: "walkthrough-run-001",
      nodeCount: 3,
      traversedNodeIds: ["node-1", "node-2", "node-3"],
      completionMode: "deterministic_single_path",
      summary: "All three nodes traversed successfully in walkthrough",
    })
  )

  // ── Step 10: Gate2Verdict ───────────────────────────────────────────
  step("Gate2Verdict (Gate 2 - Acceptance)", () =>
    Gate2Verdict.parse({
      verdict: "accepted",
      evidence_reviewed: ["EXT-WALK-001", "CR-WALK-001"],
      scenario_coverage_score: 1.0,
      invariant_exercise_rate: 1.0,
      remediation_notes: [],
    })
  )

  // ── Step 11: TrustComposite ─────────────────────────────────────────
  step("TrustComposite (Stage 7 - Trust measurement)", () =>
    TrustComposite.parse({
      correctness: 0.95,
      compliance: 0.90,
      observability: 0.85,
      stability: 0.92,
      user_response: 0.88,
      composite: 0.95 * 0.30 + 0.90 * 0.25 + 0.85 * 0.20 + 0.92 * 0.15 + 0.88 * 0.10,
      computed_at: NOW,
    })
  )

  console.log(
    `\nWalkthrough complete: Function traversed lifecycle ` +
    `designed -> specified -> candidate -> produced -> accepted -> monitored`
  )
  console.log(`  ${stepCount} steps validated with Zod .parse()`)
}

main()
