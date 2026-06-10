import type { AmendmentVerifier, VerificationResult } from '@factory/loop-closure';
import type { ArtifactGraphDOBase, PathResult } from '@factory/artifact-graph';

// ── Internal types ────────────────────────────────────────────────────────

interface AmendmentNodeData {
  proposed_change: Record<string, unknown>;
  status:          string;
}

interface ClaimNodeData {
  description: string;
  [key: string]: unknown;
}

interface ArchitectAgentDO {
  checkCrossRepoPattern(proposedChange: Record<string, unknown>): Promise<number>;
}

// ── Dependencies injectable for testability ───────────────────────────────

export interface VerifierDeps {
  /** Scores how well the proposed change resolves the linked Divergence claims. Range: 0..1 */
  evaluateCoherence: (
    proposedChange: Record<string, unknown>,
    claims: PathResult[]
  ) => number;
  /** Architect Agent DO (optional — only called when coherenceScore > 0.7) */
  architectAgentDO?: ArchitectAgentDO | undefined;
}

// ── Helper: find Divergence IDs linked to an Amendment ───────────────────

async function getLinkedDivergences(
  amendmentId: string,
  artifactGraph: ArtifactGraphDOBase<unknown>
): Promise<string[]> {
  // Walk proposes_modification_of edges backward to find Specification nodes,
  // then find Divergence nodes that diverge_from that Specification.
  // Simplified: walk evidences edges backward from divergence nodes that have
  // proposes_modification_of → amendment edges.
  const results = await artifactGraph.walkBoundedPath(amendmentId, [
    { rel: 'proposes_modification_of', targetType: 'Specification' },
  ]);

  const divergenceIds: string[] = [];
  for (const r of results) {
    const specNode = r.path[1];
    if (!specNode) continue;
    // Find ExecutionTrace nodes that diverge_from this spec
    const traces = await artifactGraph.getEdgesTo(specNode.id, 'diverges_from');
    for (const traceEdge of traces) {
      // Find Divergences evidenced by this trace
      const evidences = await artifactGraph.getEdgesFrom(traceEdge.source, 'evidences');
      for (const ev of evidences) {
        divergenceIds.push(ev.target);
      }
    }
  }

  return divergenceIds;
}

// ── Factory function (for testability) ───────────────────────────────────

export function createFactoryAmendmentVerifier(deps: {
  evaluateCoherence: (proposedChange: Record<string, unknown>, claims: PathResult[]) => number;
  architectAgentDO?: ArchitectAgentDO | undefined;
}): AmendmentVerifier {
  return async (
    amendmentId: string,
    _proposedChange: unknown,
    artifactGraph: ArtifactGraphDOBase<unknown>
  ): Promise<VerificationResult> => {
    // 1. Get amendment node
    const amdNode = await artifactGraph.getNode(amendmentId);
    const amendment = (amdNode?.data ?? {}) as unknown as AmendmentNodeData;

    // 2. Get linked Divergences → Claims
    const divergenceIds = await getLinkedDivergences(amendmentId, artifactGraph);
    const claimsNested = await Promise.all(
      divergenceIds.map((id) =>
        artifactGraph.walkBoundedPath(id, [{ rel: 'concerns', targetType: 'Claim' }])
      )
    );
    const claims = claimsNested.flat() as PathResult[];

    // 3. Evaluate coherence
    const coherenceScore = deps.evaluateCoherence(amendment.proposed_change ?? {}, claims);

    // 4. Cross-repo pattern scan — only run if coherenceScore > 0.7
    const patternScore =
      coherenceScore > 0.7 && deps.architectAgentDO !== undefined
        ? await deps.architectAgentDO.checkCrossRepoPattern(amendment.proposed_change ?? {})
        : 0.5;

    // 5. Return VerificationResult
    const passed = coherenceScore >= 0.75 && patternScore >= 0.5;
    const score = (coherenceScore + patternScore) / 2;

    return { passed, gate: 'compile', score };
  };
}

// ── Default export (no real architectAgentDO wired yet) ──────────────────
//
// Uses a placeholder coherenceScore evaluator and no Architect Agent DO.
// Consumers (Mediation Agent, Commissioning Agent) should call
// createFactoryAmendmentVerifier({ evaluateCoherence, architectAgentDO })
// with their runtime-bound dependencies.

function defaultEvaluateCoherence(
  _proposedChange: Record<string, unknown>,
  _claims: PathResult[]
): number {
  // Placeholder: returns 0.8 (above all thresholds) as a safe default.
  // Real implementation scores proposed_change against claim descriptions.
  return 0.8;
}

export const factoryAmendmentVerifier: AmendmentVerifier = createFactoryAmendmentVerifier({
  evaluateCoherence: defaultEvaluateCoherence,
});

// Export ClaimNodeData for test helpers
export type { ClaimNodeData };
