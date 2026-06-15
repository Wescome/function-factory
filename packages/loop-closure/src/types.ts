import type { ArtifactGraphDOBase } from '@factory/artifact-graph';
import type { BeadGraphDOBase } from '@factory/bead-graph';

// Injectable function types (domain-provided)
export type DivergenceDetector = (
  traceNodeId:     string,
  specificationId: string,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<DetectedDivergence[]>;

export type HypothesisBuilder = (
  divergenceId:  string,
  artifactGraph: ArtifactGraphDOBase<unknown>
) => Promise<Hypothesis>;

export type AmendmentVerifier = (
  amendmentId:     string,
  proposedChange:  unknown,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<VerificationResult>;

// Core config
export interface LoopClosureConfig {
  artifactGraphDO:   ArtifactGraphDOBase<unknown>;
  beadGraphDO:       BeadGraphDOBase<unknown>;
  kvStore:           KVNamespace;
  detectDivergences: DivergenceDetector;
  buildHypothesis:   HypothesisBuilder;
  verifyAmendment:   AmendmentVerifier;
  /**
   * Optional CommissioningAgent DO namespace.
   * When provided, recordOutcome() will push DivergenceNotifications to the CA
   * so hypothesis-formation is triggered immediately on divergence detection.
   * Non-fatal if absent or if the push fails.
   */
  commissioningAgentDO?: DurableObjectNamespace;
  /** Optional subscription-buffer binding for live event fan-out. Fire-and-forget. */
  subBuffer?:       DurableObjectNamespace;
  subBufferSecret?: string;
}

// Session state (stored in KV)
export interface Session {
  sessionId:              string;
  orgId:                  string;
  roleId:                 string;
  agentId:                string;
  ksRetrievedAt:          number;
  activeSpecificationId:  string;
  autonomyFloor:          Autonomy;
  policyBeadId?:          string;
  trustBeadId?:           string;
}

export type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';

export interface DetectedDivergence {
  claimId:     string;
  description: string;
  severity:    'low' | 'medium' | 'high' | 'critical';
}

export interface Hypothesis {
  attribution:    string;
  explanation:    string;
  confidence:     number;
  targetBeadId:   string;
  targetType:     'trust' | 'policy';
  proposedChange: unknown;
}

export interface VerificationResult {
  passed: boolean;
  gate:   string;
  score:  number;
}

export interface ExecutionContent {
  domain:        string;
  action:        string;
  toolCallCount: number;
  status:        string;
  summary:       string;
}

export interface OutcomeContent {
  toolCallCount:         number;
  status:                string;
  summary:               string;
  triggers_amendment?:   boolean;
}
