import type { DivergenceDetector, DetectedDivergence } from '@factory/loop-closure';
import type { ArtifactGraphDOBase } from '@factory/artifact-graph';
import type { TraceFragmentData } from './types.js';

// ── Private helpers ───────────────────────────────────────────────────────

function mapInvSeverity(s: string): DetectedDivergence['severity'] {
  if (s === 'critical') return 'critical';
  if (s === 'warning') return 'medium';
  return 'low';
}

// ── factoryDivergenceDetector ─────────────────────────────────────────────

export const factoryDivergenceDetector: DivergenceDetector = async (
  traceNodeId: string,
  _specificationId: string,
  artifactGraph: ArtifactGraphDOBase<unknown>
): Promise<DetectedDivergence[]> => {
  const traceNode = await artifactGraph.getNode(traceNodeId);
  if (!traceNode) return [];

  const trace = traceNode.data as unknown as TraceFragmentData;
  const divergences: DetectedDivergence[] = [];

  // Map detector firings to DetectedDivergences
  for (const firing of trace.detector_firings ?? []) {
    divergences.push({
      claimId:     firing.inv_id,
      description: firing.message,
      severity:    mapInvSeverity(firing.severity),
    });
  }

  // Atom outcome failures
  if (trace.outcome === 'failure' && trace.attempts_exhausted) {
    divergences.push({
      claimId:     `claim-atom-outcome-${trace.atom_id}`,
      description: `Atom ${trace.atom_id} failed after all retry attempts`,
      severity:    'high',
    });
  }

  if (trace.outcome === 'timeout' && trace.attempts_exhausted) {
    divergences.push({
      claimId:     `claim-atom-timeout-${trace.atom_id}`,
      description: `Atom ${trace.atom_id} timed out after all retry attempts`,
      severity:    'high',
    });
  }

  return divergences;
};
