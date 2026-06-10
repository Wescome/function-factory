import type { HypothesisBuilder, Hypothesis } from '@factory/loop-closure';
import type { ArtifactGraphDOBase } from '@factory/artifact-graph';

// ── factoryHypothesisBuilder (stub) ───────────────────────────────────────
//
// Stub implementation returns a hardcoded Hypothesis satisfying the
// HypothesisBuilder interface type. Full LLM wiring via @factory/harness-bridge
// dispatcher is a separate task (see tasks.md Step 31 — Full implementation).

export const factoryHypothesisBuilder: HypothesisBuilder = async (
  _divergenceId: string,
  _artifactGraph: ArtifactGraphDOBase<unknown>
): Promise<Hypothesis> => {
  return {
    attribution:    'specification',
    explanation:    'Stub hypothesis — LLM wiring pending',
    confidence:     0.5,
    targetBeadId:   '',
    targetType:     'policy',
    proposedChange: {},
  };
};
