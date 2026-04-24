// Tangled from specs/reference/literate-canonical-reference.md
// Context: loop
// Blocks: 4
// Generated: 2026-04-24T15:11:44.401Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 2307 (Part VII -- How Does the Code Get Organized?) ---
/**
 * The MemoryProvider interface. All repositories implement this.
 * From memory-substrate Section 3.4.
 *
 * One ArangoMemoryProvider class backs all seven memory tiers.
 */
interface MemoryProvider {
  // Episodic tier
  appendEvent(event: EpisodicEvent): Promise<void>;
  replayEvents(filter: EventFilter): AsyncGenerator<EpisodicEvent>;

  // Working tier
  getWorkingState(sessionId: string): Promise<WorkingState | null>;
  setWorkingState(sessionId: string, state: WorkingState): Promise<void>;

  // Semantic tier
  searchLessons(query: string, limit?: number): Promise<Lesson[]>;
  findSimilarLessons(embedding: number[], limit?: number): Promise<Lesson[]>;

  // Graph tier
  traverseGraph(
    startVertex: string,
    depth: number,
    direction: "outbound" | "inbound"
  ): Promise<GraphPath[]>;
  getNeighborhood(
    vertexId: string,
    edgeTypes?: string[]
  ): Promise<Neighborhood>;

  // Artifact tier
  putArtifact<T>(collection: string, artifact: T): Promise<string>;
  getArtifact<T>(collection: string, id: string): Promise<T | null>;
  queryArtifacts<T>(
    collection: string,
    filter: ArtifactFilter
  ): Promise<T[]>;
  walkLineage(artifactId: string, depth?: number): Promise<LineageChain>;
}

// --- Block from line 2411 (Part VII -- How Does the Code Get Organized?) ---
/**
 * Canonical projection for cross-version lineage scoring.
 * From ratified decisions Section 8.
 *
 * This function handles v1, v2, and later schema versions.
 * Scoring never consumes raw historical blobs directly.
 */
interface CanonicalCandidateView {
  id: string;
  topology: string;
  model_binding: Record<string, unknown>;
  inference_config: Record<string, unknown>;
  tool_policy: Record<string, unknown>;
  convergence_policy: Record<string, unknown>;
  node_type_applied: string;
  objective_scores: Record<string, number> | null;
  selected: boolean;
  schema_version: string;
}

declare function readArchitectureCandidate(
  raw: unknown
): CanonicalCandidateView;

// --- Block from line 2447 (Part VII -- How Does the Code Get Organized?) ---
/**
 * Routing table validation report.
 * From ratified decisions Section 11.
 */
interface RoutingTableLintReport {
  table_id: string;
  table_version: string;
  status: "pass" | "fail";
  structural_errors: string[];
  semantic_errors: string[];
  generated_at: string;
}

// --- Block from line 2843 (Appendix C -- For the Coding Agent) ---
/**
 * The Function Factory's closed-loop compiler.
 *
 * This is NOT the LangGraph.js production graph.
 * This IS the architectural reference.
 * When they disagree, this is the truth.
 */
async function factoryLoop(
  initialSignals: ReadonlyArray<Signal>,
  mode: "bootstrap" | "steady_state"
): Promise<void> {
  let signals: ReadonlyArray<Signal> = initialSignals;
  const allObservations: Observation[] = [];

  while (signals.length > 0) {
    // SPECIFICATION CONTEXT (Stages 1-5)
    // structural_coverage_passed + semantic review run internally
    const compiled = specification_compilePipeline(signals);

    for (const workGraph of compiled.workGraphs) {
      const prd = compiled.prds.find(
        (p) => p.function_id === workGraph.function_id
      );
      if (!prd) continue;

      // SEARCH CONTEXT (Stages 4.5-4.75)
      const { selected: candidate } = search_selectCandidate(
        workGraph, "config/routing-table.yaml", {}
      );

      // EXECUTION CONTEXT (Stage 6)
      // ACL: buildInitialDecisionState runs inside
      // ACL: bundleEvidenceForAcceptanceReview runs inside
      const { traceLog, adherenceReport, gate2Input } =
        execution_runDarkFactory(workGraph, candidate, prd);

      // ASSURANCE CONTEXT: Acceptance Review (scenarios_cover_invariants)
      const verdict = assurance_evaluateAcceptanceReview(gate2Input);
      if (verdict.overall === "fail") continue;

      // Function promoted to monitored
    }

    // OBSERVABILITY CONTEXT (Stages 7-7.25)
    const feedback = observability_processFeedback(
      allObservations, 0.65 // birth gate threshold
    );

    // ASSURANCE CONTEXT: evidence_base_intact (continuous)
    // Runs per monitored function, not per loop iteration

    // ADAPTATION CONTEXT (Stages 8-8.5)
    const { recalibratedPressures, biasReport } =
      adaptation_runRecalibrationCycle(allObservations, [], {});

    // GOVERNANCE CONTEXT (Stages 9-10)
    const { proposedActions } = governance_evaluateAndPropose(
      { policy_stress_indicators: [], amendment_history: [], source_refs: [] },
      biasReport
    );

    // LOOP CLOSURE
    if (mode === "bootstrap") break;
    signals = feedback.reinjectedSignals;
    if (signals.length === 0) break;
  }
}
